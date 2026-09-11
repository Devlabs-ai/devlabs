"""Lab 18 approach benchmark — set VARIANT env to pick strategy."""

from __future__ import annotations

import os
import sys

from pyspark.sql import SparkSession
from pyspark.sql import functions as F

TXN_INPUT_PATH = os.environ["TXN_INPUT_PATH"]
RATE_INPUT_PATH = os.environ["RATE_INPUT_PATH"]
OUTPUT_PATH = os.environ["OUTPUT_PATH"]
VARIANT = os.environ.get("VARIANT", "naive")

FACT_WINDOW_START = "2024-01-01"
FACT_WINDOW_END = "2024-12-31"
BUCKETS = 16
HOT = (
    (F.col("mcc") == "5411")
    & (F.col("country_code") == "US")
    & (F.col("entry_mode") == "chip")
)


def read_approved(spark: SparkSession):
    return (
        spark.read.parquet(TXN_INPUT_PATH)
        .filter(F.col("response_code") == "00")
        .select("txn_id", "txn_ts", "mcc", "country_code", "entry_mode", "amount")
        .withColumn("txn_date", F.to_date("txn_ts"))
    )


def read_rates(spark: SparkSession, *, filter_window: bool = True):
    rates = spark.read.parquet(RATE_INPUT_PATH).select(
        "rate_id",
        "mcc",
        "country_code",
        "entry_mode",
        "effective_from",
        "effective_to",
        "rate_bps",
        "fixed_fee",
    )
    if filter_window:
        rates = rates.filter(
            (F.col("effective_from") <= F.lit(FACT_WINDOW_END))
            & (F.col("effective_to") >= F.lit(FACT_WINDOW_START))
        )
    return rates


def price_and_write(spark: SparkSession, priced) -> None:
    (
        priced.groupBy("country_code", "entry_mode")
        .agg(
            F.count(F.lit(1)).cast("long").alias("txn_count"),
            F.round(F.sum("interchange_fee"), 2).alias("total_fee"),
            F.countDistinct("rate_id").cast("long").alias("distinct_rate_versions_used"),
        )
        .coalesce(1)
        .write.mode("overwrite")
        .option("header", "true")
        .csv(OUTPUT_PATH)
    )
    spark.stop()


def add_fee(df):
    return df.withColumn(
        "interchange_fee",
        F.round(F.col("amount") * F.col("rate_bps") / F.lit(10000) + F.col("fixed_fee"), 2),
    )


def join_naive(approved, rates):
    return add_fee(
        approved.join(rates, on=["mcc", "country_code", "entry_mode"], how="inner").filter(
            F.col("txn_date").between(F.col("effective_from"), F.col("effective_to"))
        )
    )


def join_salted(approved, rates, buckets: int = BUCKETS):
    salted_fact = approved.withColumn(
        "salt",
        F.pmod(F.crc32(F.col("txn_id").cast("binary")), F.lit(buckets)),
    )
    salted_rates = rates.withColumn(
        "salt", F.explode(F.sequence(F.lit(0), F.lit(buckets - 1)))
    )
    return add_fee(
        salted_fact.join(
            salted_rates, on=["mcc", "country_code", "entry_mode", "salt"], how="inner"
        ).filter(F.col("txn_date").between(F.col("effective_from"), F.col("effective_to")))
    )


def join_week_key(approved, rates):
    fact = approved.withColumn(
        "rate_week",
        F.expr("date_sub(next_day(txn_date, 'Mon'), 7)"),
    )
    dim = rates.withColumn("rate_week", F.col("effective_from"))
    return add_fee(
        fact.join(
            dim,
            on=["mcc", "country_code", "entry_mode", "rate_week"],
            how="inner",
        ).filter(F.col("txn_date").between(F.col("effective_from"), F.col("effective_to")))
    )


def join_hot_split(approved, rates):
    hot_fact = (
        approved.filter(HOT)
        .withColumn("salt", F.pmod(F.crc32(F.col("txn_id").cast("binary")), F.lit(BUCKETS)))
    )
    cold_fact = approved.filter(~HOT)
    hot_rates = rates.withColumn(
        "salt", F.explode(F.sequence(F.lit(0), F.lit(BUCKETS - 1)))
    )
    hot_priced = add_fee(
        hot_fact.join(
            hot_rates, on=["mcc", "country_code", "entry_mode", "salt"], how="inner"
        ).filter(F.col("txn_date").between(F.col("effective_from"), F.col("effective_to")))
    )
    cold_priced = join_naive(cold_fact, rates)
    return hot_priced.unionByName(cold_priced)


def main() -> None:
    spark = SparkSession.builder.appName(f"bench-l3ifs-{VARIANT}").getOrCreate()
    approved = read_approved(spark)
    rates = read_rates(spark, filter_window=(VARIANT != "naive_full_rates"))

    if VARIANT == "naive":
        priced = join_naive(approved, rates)
    elif VARIANT == "salted":
        priced = join_salted(approved, rates)
    elif VARIANT == "week_key":
        priced = join_week_key(approved, rates)
    elif VARIANT == "broadcast":
        priced = add_fee(
            approved.join(F.broadcast(rates), on=["mcc", "country_code", "entry_mode"], how="inner")
            .filter(F.col("txn_date").between(F.col("effective_from"), F.col("effective_to")))
        )
    elif VARIANT == "repartition":
        priced = join_naive(
            approved.repartition(BUCKETS, "mcc", "country_code", "entry_mode"), rates
        )
    elif VARIANT == "aqe_skew":
        spark.conf.set("spark.sql.adaptive.enabled", "true")
        spark.conf.set("spark.sql.adaptive.skewJoin.enabled", "true")
        spark.conf.set("spark.sql.adaptive.coalescePartitions.enabled", "true")
        priced = join_naive(approved, rates)
    elif VARIANT == "hot_split":
        priced = join_hot_split(approved, rates)
    elif VARIANT == "filtered_naive":
        priced = join_naive(approved, rates)
    elif VARIANT == "naive_full_rates":
        priced = join_naive(approved, rates)
    elif VARIANT == "salted_no_filter":
        priced = join_salted(approved, read_rates(spark, filter_window=False))
    else:
        print(f"unknown VARIANT={VARIANT}", file=sys.stderr)
        spark.stop()
        sys.exit(2)

    price_and_write(spark, priced)


if __name__ == "__main__":
    main()
