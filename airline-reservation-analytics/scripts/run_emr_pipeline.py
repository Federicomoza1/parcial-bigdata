"""Automates generating raw data, uploading to S3, running a transient EMR cluster with
AutoTermination (m4.large only, R10 & R11), waiting for completion, and registering Glue tables.

Usage:
  python scripts/run_emr_pipeline.py --bucket YOUR-S3-BUCKET
"""
import argparse
import os
import subprocess
import sys
import time

import boto3

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT_DIR)

from harness.config import load_config


def main():
    ap = argparse.ArgumentParser(description="End-to-end S3 + EMR (m4.large) + Glue/Athena pipeline")
    ap.add_argument("--bucket", required=True, help="S3 bucket name (will be created if it does not exist)")
    ap.add_argument("--skip-generate", action="store_true", help="Skip local CSV generation if ./raw already exists")
    ap.add_argument("--skip-upload", action="store_true", help="Skip uploading ./raw to S3")
    ap.add_argument("--release-label", default="emr-6.15.0", help="EMR release label (default: emr-6.15.0)")
    args = ap.parse_args()

    cfg = load_config(os.path.join(ROOT_DIR, "config.yaml"))
    seed = int(cfg["seed"])
    region = (cfg.get("aws") or {}).get("region", "us-east-1")
    bucket = args.bucket.strip().replace("s3://", "").split("/")[0]

    session = boto3.Session(region_name=region)
    s3 = session.client("s3")
    emr = session.client("emr")
    ec2 = session.client("ec2")

    # 1. Ensure S3 bucket exists
    try:
        s3.head_bucket(Bucket=bucket)
        print(f"[S3] Using existing bucket: s3://{bucket}")
    except Exception:
        print(f"[S3] Creating bucket: s3://{bucket} in {region}...")
        if region == "us-east-1":
            s3.create_bucket(Bucket=bucket)
        else:
            s3.create_bucket(Bucket=bucket, CreateBucketConfiguration={"LocationConstraint": region})

    # 2. Generate raw data locally
    raw_dir = os.path.join(ROOT_DIR, "raw")
    if not args.skip_generate:
        print(f"[Data] Generating 2,000,000 rows for seed={seed}...")
        subprocess.run(
            [sys.executable, "-m", "airline_data.generate", "--seed", str(seed), "--rows", "2000000", "--out", raw_dir],
            cwd=ROOT_DIR,
            check=True,
        )

    # 3. Upload raw CSVs and PySpark script to S3
    if not args.skip_upload:
        for fname in ("flights.csv", "reservations.csv"):
            fpath = os.path.join(raw_dir, fname)
            print(f"[S3] Uploading {fname} to s3://{bucket}/raw/{fname} ...")
            s3.upload_file(fpath, bucket, f"raw/{fname}")

    etl_script = os.path.join(ROOT_DIR, "emr", "etl_job.py")
    print(f"[S3] Uploading emr/etl_job.py to s3://{bucket}/code/etl_job.py ...")
    s3.upload_file(etl_script, bucket, "code/etl_job.py")

    # 4. Find default VPC subnet for EMR
    subnets = ec2.describe_subnets(Filters=[{"Name": "default-for-az", "Values": ["true"]}])["Subnets"]
    if not subnets:
        subnets = ec2.describe_subnets()["Subnets"]
    subnet_id = subnets[0]["SubnetId"]

    detail_tbl = cfg["aws"]["tables"]["detail"]
    metrics_tbl = cfg["aws"]["tables"]["metrics"]

    raw_s3 = f"s3://{bucket}/raw"
    curated_s3 = f"s3://{bucket}/curated/{detail_tbl}"
    metrics_s3 = f"s3://{bucket}/curated/{metrics_tbl}"

    print(f"[EMR] Launching transient EMR cluster (m4.large only, KeepJobFlowAliveWhenNoSteps=False)...")
    resp = emr.run_job_flow(
        Name="airline-analytics-etl",
        ReleaseLabel=args.release_label,
        LogUri=f"s3://{bucket}/emr-logs/",
        Applications=[{"Name": "Spark"}],
        Instances={
            "InstanceGroups": [
                {
                    "Name": "Master",
                    "Market": "ON_DEMAND",
                    "InstanceRole": "MASTER",
                    "InstanceType": "m4.large",
                    "InstanceCount": 1,
                },
                {
                    "Name": "Core",
                    "Market": "ON_DEMAND",
                    "InstanceRole": "CORE",
                    "InstanceType": "m4.large",
                    "InstanceCount": 2,
                },
            ],
            "Ec2SubnetId": subnet_id,
            "KeepJobFlowAliveWhenNoSteps": False,
            "TerminationProtected": False,
        },
        Steps=[
            {
                "Name": "CleanAndAggregateReservations",
                "ActionOnFailure": "TERMINATE_CLUSTER",
                "HadoopJarStep": {
                    "Jar": "command-runner.jar",
                    "Args": [
                        "spark-submit",
                        "--deploy-mode",
                        "cluster",
                        f"s3://{bucket}/code/etl_job.py",
                        "--raw-s3",
                        raw_s3,
                        "--curated-s3",
                        curated_s3,
                        "--metrics-s3",
                        metrics_s3,
                    ],
                },
            }
        ],
        JobFlowRole="EMR_EC2_DefaultRole",
        ServiceRole="EMR_DefaultRole",
        VisibleToAllUsers=True,
    )

    cluster_id = resp["JobFlowId"]
    print(f"[EMR] Cluster launched: {cluster_id}. Waiting for step completion and auto-termination (R4 & R10)...")

    while True:
        desc = emr.describe_cluster(ClusterId=cluster_id)["Cluster"]
        state = desc["Status"]["State"]
        print(f"  [EMR] Cluster {cluster_id} state: {state}")
        if state in ("TERMINATED", "TERMINATED_WITH_ERRORS"):
            break
        time.sleep(30)

    if state == "TERMINATED_WITH_ERRORS":
        reason = desc["Status"].get("StateChangeReason", {})
        raise RuntimeError(f"EMR cluster terminated with errors: {reason}")

    print("[EMR] Cluster terminated cleanly! Setting up Glue Data Catalog & Athena tables (R5)...")
    subprocess.run(
        [sys.executable, os.path.join(ROOT_DIR, "scripts", "setup_glue_athena.py"), "--bucket", bucket],
        cwd=ROOT_DIR,
        check=True,
    )
    print("[Success] Pipeline completed and all EMR resources are terminated!")


if __name__ == "__main__":
    main()
