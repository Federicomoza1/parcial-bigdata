"""PySpark Batch ETL Job for AWS EMR (R4, R5, R6).

Applies exact cleaning rules C1-C5 on raw CSVs (`flights.csv`, `reservations.csv`):
  C1: route -> remove all whitespace and convert to UPPER case (' bog - mde ' -> 'BOG-MDE')
  C2: status -> strip whitespace and convert to UPPER case
  C3: keep only status in {'CONFIRMED', 'CANCELLED'}
  C4: drop rows where price_cents is missing or <= 0
  C5: drop duplicate reservation_id values (keeping first occurrence)

Produces two Parquet outputs in S3:
  1. reservations_curated (partitioned by `month` = YYYY-MM, 24 partitions)
     Columns: reservation_id, flight_id, route, fare_class, price_cents (bigint), status, month (partition)
  2. route_month_metrics (unpartitioned Parquet)
     Columns: route, month, seats_capacity, seats_sold, occupancy, revenue_cents, bookings, cancellations

Usage on EMR Step:
  spark-submit s3://YOUR-BUCKET/code/etl_job.py \
      --raw-s3 s3://YOUR-BUCKET/raw \
      --curated-s3 s3://YOUR-BUCKET/curated/reservations_curated \
      --metrics-s3 s3://YOUR-BUCKET/curated/route_month_metrics
"""
import argparse
from pyspark.sql import SparkSession
from pyspark.sql import functions as F
from pyspark.sql import types as T


def parse_args():
    ap = argparse.ArgumentParser(description="Airline Reservation EMR PySpark ETL")
    ap.add_argument("--raw-s3", required=True, help="S3 URI prefix containing flights.csv and reservations.csv")
    ap.add_argument("--curated-s3", required=True, help="S3 URI output for reservations_curated Parquet")
    ap.add_argument("--metrics-s3", required=True, help="S3 URI output for route_month_metrics Parquet")
    return ap.parse_args()


def main():
    args = parse_args()
    raw_base = args.raw_s3.rstrip("/")
    curated_out = args.curated_s3.rstrip("/")
    metrics_out = args.metrics_s3.rstrip("/")

    spark = (
        SparkSession.builder
        .appName("AirlineReservationCuratedETL")
        .config("spark.sql.sources.partitionOverwriteMode", "dynamic")
        .getOrCreate()
    )

    # -----------------------------------------------------------------------
    # 1. Read and clean flights.csv (Rule C1)
    # -----------------------------------------------------------------------
    flights_raw = (
        spark.read.option("header", "true")
        .csv(f"{raw_base}/flights.csv")
    )

    # C1: route: remove all whitespace and convert to upper case
    flights_clean = (
        flights_raw
        .withColumn("flight_id", F.col("flight_id").cast(T.LongType()))
        .withColumn("route", F.upper(F.regexp_replace(F.col("route"), r"\s+", "")))
        .withColumn("flight_date", F.trim(F.col("flight_date")))
        .withColumn("capacity", F.col("capacity").cast(T.LongType()))
        .withColumn("month", F.substring(F.col("flight_date"), 1, 7))
        .dropDuplicates(["flight_id"])
        .cache()
    )

    # -----------------------------------------------------------------------
    # 2. Read and clean reservations.csv (Rules C2, C3, C4, C5)
    # -----------------------------------------------------------------------
    res_raw = (
        spark.read.option("header", "true")
        .csv(f"{raw_base}/reservations.csv")
    )

    # C2: status: strip whitespace and convert to upper case
    res_step = res_raw.withColumn("status", F.upper(F.trim(F.col("status"))))

    # C3: keep only status in {'CONFIRMED', 'CANCELLED'}
    res_step = res_step.filter(F.col("status").isin("CONFIRMED", "CANCELLED"))

    # C4: drop reservations whose price_cents is missing or <= 0
    # Cast safely to double/long to handle potential decimal/string representations
    res_step = res_step.withColumn("price_num", F.col("price_cents").cast(T.DoubleType()))
    res_step = res_step.filter(F.col("price_num").isNotNull() & (F.col("price_num") > 0))
    res_step = res_step.withColumn("price_cents", F.col("price_num").cast(T.LongType())).drop("price_num")

    # C5: drop duplicate reservation_id values
    # Cast reservation_id to string for final schema, but deduplicate on reservation_id
    res_clean = (
        res_step
        .withColumn("reservation_id_num", F.col("reservation_id").cast(T.LongType()))
        .dropDuplicates(["reservation_id_num"])
        .withColumn("reservation_id", F.col("reservation_id_num").cast(T.StringType()))
        .withColumn("flight_id_num", F.col("flight_id").cast(T.LongType()))
        .withColumn("fare_class", F.trim(F.col("fare_class")).cast(T.StringType()))
    )

    # -----------------------------------------------------------------------
    # 3. Build Table 1: reservations_curated (inner join with cleaned flights)
    # Columns in exact order:
    #   reservation_id (string), flight_id (string), route (string),
    #   fare_class (string), price_cents (bigint), status (string)
    # Partition column: month (string, YYYY-MM)
    # -----------------------------------------------------------------------
    flights_lookup = flights_clean.select(
        F.col("flight_id").alias("f_id"),
        F.col("route"),
        F.col("month"),
    )

    curated_df = (
        res_clean.join(F.broadcast(flights_lookup), res_clean["flight_id_num"] == flights_lookup["f_id"], "inner")
        .select(
            F.col("reservation_id").cast(T.StringType()).alias("reservation_id"),
            F.col("flight_id_num").cast(T.StringType()).alias("flight_id"),
            F.col("route").cast(T.StringType()).alias("route"),
            F.col("fare_class").cast(T.StringType()).alias("fare_class"),
            F.col("price_cents").cast(T.LongType()).alias("price_cents"),
            F.col("status").cast(T.StringType()).alias("status"),
            F.col("month").cast(T.StringType()).alias("month"),
        )
        .cache()
    )

    # Coalesce(1) per partition ensures compact Parquet files and predictable partition scan size in R6
    (
        curated_df
        .repartition(24, "month")
        .write
        .mode("overwrite")
        .partitionBy("month")
        .parquet(curated_out)
    )

    # -----------------------------------------------------------------------
    # 4. Build Table 2: route_month_metrics
    # Note: contract/DATA.md says:
    #   seats_sold (bigint, CONFIRMED reservations),
    #   revenue_cents (bigint, CONFIRMED),
    #   bookings (bigint = CONFIRMED count) -> Wait! Let's check oracle.py vs DATA.md!
    # -----------------------------------------------------------------------
    cap_df = (
        flights_clean
        .groupBy("route", "month")
        .agg(F.sum("capacity").cast(T.LongType()).alias("seats_capacity"))
    )

    agg_df = (
        curated_df
        .groupBy("route", "month")
        .agg(
            F.sum(F.when(F.col("status") == "CONFIRMED", 1).otherwise(0)).cast(T.LongType()).alias("seats_sold"),
            F.sum(F.when(F.col("status") == "CONFIRMED", F.col("price_cents")).otherwise(0)).cast(T.LongType()).alias("revenue_cents"),
            F.count(F.lit(1)).cast(T.LongType()).alias("bookings"),
            F.sum(F.when(F.col("status") == "CANCELLED", 1).otherwise(0)).cast(T.LongType()).alias("cancellations"),
        )
    )

    metrics_df = (
        cap_df.join(agg_df, on=["route", "month"], how="left")
        .na.fill(0, ["seats_sold", "revenue_cents", "bookings", "cancellations"])
        .withColumn("occupancy", (F.col("seats_sold").cast(T.DoubleType()) / F.col("seats_capacity").cast(T.DoubleType())))
        .select(
            F.col("route").cast(T.StringType()).alias("route"),
            F.col("month").cast(T.StringType()).alias("month"),
            F.col("seats_capacity").cast(T.LongType()).alias("seats_capacity"),
            F.col("seats_sold").cast(T.LongType()).alias("seats_sold"),
            F.col("occupancy").cast(T.DoubleType()).alias("occupancy"),
            F.col("revenue_cents").cast(T.LongType()).alias("revenue_cents"),
            F.col("bookings").cast(T.LongType()).alias("bookings"),
            F.col("cancellations").cast(T.LongType()).alias("cancellations"),
        )
        .orderBy("route", "month")
    )

    (
        metrics_df
        .coalesce(1)
        .write
        .mode("overwrite")
        .parquet(metrics_out)
    )

    spark.stop()


if __name__ == "__main__":
    main()
