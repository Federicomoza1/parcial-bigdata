"""Registers the Glue Data Catalog database, tables, and 24 partitions (R5, R6).

Creates:
  1. Database `airline_analytics` (or as configured in config.yaml)
  2. Table `reservations_curated` (Parquet, partitioned by `month` string) + MSCK REPAIR TABLE
  3. Table `route_month_metrics` (Parquet, unpartitioned)

Usage:
  python scripts/setup_glue_athena.py --bucket YOUR-S3-BUCKET
"""
import argparse
import os
import sys

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT_DIR)

from harness.aws import RealAWS
from harness.config import load_config


def main():
    ap = argparse.ArgumentParser(description="Create Glue Data Catalog tables and load partitions via Athena")
    ap.add_argument("--bucket", required=True, help="S3 bucket name where curated Parquet files reside")
    ap.add_argument("--config", default=os.path.join(ROOT_DIR, "config.yaml"), help="Path to config.yaml")
    args = ap.parse_args()

    cfg = load_config(args.config)
    aws_cfg = cfg["aws"]
    region = aws_cfg.get("region", "us-east-1")
    db = aws_cfg.get("athena_database", "airline_analytics")
    wg = aws_cfg.get("athena_workgroup", "primary")
    bucket = args.bucket.strip().replace("s3://", "").split("/")[0]
    athena_out = aws_cfg.get("athena_output")
    if not athena_out or "YOUR-BUCKET" in athena_out:
        athena_out = f"s3://{bucket}/athena-results/"

    detail_tbl = aws_cfg["tables"]["detail"]
    metrics_tbl = aws_cfg["tables"]["metrics"]

    curated_loc = f"s3://{bucket}/curated/{detail_tbl}/"
    metrics_loc = f"s3://{bucket}/curated/{metrics_tbl}/"

    aws = RealAWS(region=region, athena_output=athena_out)

    print(f"1. Creating database `{db}` if not exists...")
    aws.athena_run(f"CREATE DATABASE IF NOT EXISTS {db}", "default", wg)

    print(f"2. Recreating table `{db}.{detail_tbl}` at {curated_loc}...")
    aws.athena_run(f"DROP TABLE IF EXISTS {db}.{detail_tbl}", db, wg)
    ddl_detail = f"""
    CREATE EXTERNAL TABLE {db}.{detail_tbl} (
        reservation_id STRING,
        flight_id STRING,
        route STRING,
        fare_class STRING,
        price_cents BIGINT,
        status STRING
    )
    PARTITIONED BY (month STRING)
    STORED AS PARQUET
    LOCATION '{curated_loc}'
    TBLPROPERTIES ('classification'='parquet', 'parquet.compression'='SNAPPY')
    """
    aws.athena_run(ddl_detail, db, wg)

    print(f"3. Running MSCK REPAIR TABLE `{db}.{detail_tbl}` to register all 24 month partitions...")
    aws.athena_run(f"MSCK REPAIR TABLE {db}.{detail_tbl}", db, wg)

    print(f"4. Recreating table `{db}.{metrics_tbl}` at {metrics_loc}...")
    aws.athena_run(f"DROP TABLE IF EXISTS {db}.{metrics_tbl}", db, wg)
    ddl_metrics = f"""
    CREATE EXTERNAL TABLE {db}.{metrics_tbl} (
        route STRING,
        month STRING,
        seats_capacity BIGINT,
        seats_sold BIGINT,
        occupancy DOUBLE,
        revenue_cents BIGINT,
        bookings BIGINT,
        cancellations BIGINT
    )
    STORED AS PARQUET
    LOCATION '{metrics_loc}'
    TBLPROPERTIES ('classification'='parquet', 'parquet.compression'='SNAPPY')
    """
    aws.athena_run(ddl_metrics, db, wg)

    part_count = aws.glue_partition_count(db, detail_tbl)
    print(f"Done! Registered partitions in {db}.{detail_tbl}: {part_count}")


if __name__ == "__main__":
    main()
