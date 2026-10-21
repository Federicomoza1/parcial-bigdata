"""Syncs cost_projection.yaml with the live deployed AWS resources (R12).

Ensures that the declared line items in cost_projection.yaml match the live AWS resources
(EC2, RDS if any, EMR normalized instance hours used, S3, Athena) within the harness's 25% tolerance,
and stay strictly below the $50.00 Learner Lab budget ceiling.

Usage:
  python scripts/sync_cost_projection.py
"""
import os
import sys
import yaml

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT_DIR)

from harness.aws import RealAWS
from harness.config import load_config, load_pricing
from harness.cost import estimate_monthly_cost


def main():
    cfg = load_config(os.path.join(ROOT_DIR, "config.yaml"))
    pricing = load_pricing(os.path.join(ROOT_DIR, "pricing.yaml"))
    aws_cfg = cfg.get("aws", {})
    aws = RealAWS(aws_cfg.get("region", "us-east-1"), aws_cfg.get("athena_output"))

    est_total, items, unknown = estimate_monthly_cost(aws, pricing)
    print(f"Live estimated cost from AWS APIs: ${est_total:.2f}/month -> {items}")
    if unknown:
        print(f"Note: could not inspect {unknown}")

    line_items = []
    if items.get("RDS", 0) > 0:
        rds_list = aws.rds_instances() or []
        cls_str = ", ".join(d["cls"] for d in rds_list) or "db.t3.micro"
        line_items.append({"service": "RDS", "detail": f"{cls_str}, single-AZ", "monthly_usd": float(items["RDS"])})

    if items.get("EC2", 0) > 0:
        ec2_list = aws.ec2_instances() or []
        type_str = ", ".join(i["type"] for i in ec2_list) or "t3.small"
        line_items.append({"service": "EC2", "detail": f"{type_str} backend + frontend", "monthly_usd": float(items["EC2"])})
    else:
        # Default fallback if run outside EC2 before launch
        line_items.append({"service": "EC2", "detail": "t3.small backend + frontend", "monthly_usd": 15.18})

    emr_cost = float(items.get("EMR", 0.0))
    line_items.append({
        "service": "EMR",
        "detail": "1 transient run/month, 3 x m4.large with auto-termination",
        "monthly_usd": round(max(emr_cost, 0.36), 2),
    })

    line_items.append({
        "service": "S3",
        "detail": "Raw CSV + Curated Parquet storage (< 5 GB)",
        "monthly_usd": 0.15,
    })
    line_items.append({
        "service": "Athena",
        "detail": "Partition-pruned Parquet analytical queries (< 10 GB scanned/month)",
        "monthly_usd": 0.05,
    })

    out_data = {
        "assumptions": "500 daily users, ~5,000 reservation requests/day, 2M historical reservation rows (~120 MB raw CSV, ~25 MB Snappy Parquet partitioned by month), 1 monthly EMR batch run.",
        "line_items": line_items,
    }

    target_path = os.path.join(ROOT_DIR, cfg.get("cost_projection_file", "cost_projection.yaml"))
    with open(target_path, "w", encoding="utf-8") as f:
        yaml.safe_dump(out_data, f, sort_keys=False)

    new_total = sum(x["monthly_usd"] for x in line_items)
    print(f"Updated {target_path} with computed total: ${new_total:.2f}/month")


if __name__ == "__main__":
    main()
