"""One-shot Spark job: Card Rails copies + planted unpublished MCCs + approved + names."""
from pyspark.sql import SparkSession
from pyspark.sql import functions as F

BUCKET = "s3a://devlabs-data"
SRC_TXNS = f"{BUCKET}/datasets/payment-network/txns/50m-skew-key75/"
SRC_MCC = f"{BUCKET}/datasets/payment-network/dims/mcc/"
PREFIX = f"{BUCKET}/challenges/l1-enrich-auth-mcc"

UNPUB_RUN = ["9999", "0000", "8888"]
UNPUB_SUB = ["7777", "6666", "5555", "4444"]


def plant_unpublished(df, codes, salt):
    n = len(codes)
    h = F.abs(F.hash(F.concat(F.col("txn_id"), F.lit(str(salt)))))
    flag = (h % F.lit(10)) == 0
    pick = (h % F.lit(n)).cast("int")
    arr = F.array(*[F.lit(c) for c in codes])
    return df.withColumn("mcc", F.when(flag, arr[pick]).otherwise(F.col("mcc")))


def write_case(spark, txns, mcc, case_id, unpublished, salt, n=None):
    fact = txns
    if n is not None:
        # orderBy so the slice is stable across actions; limit() alone is not.
        fact = fact.orderBy("txn_id").limit(int(n))
    fact = plant_unpublished(fact, unpublished, salt)
    input_path = f"{PREFIX}/testcases/{case_id}/input/"
    expected_path = f"{PREFIX}/testcases/{case_id}/expected/"
    fact.write.mode("overwrite").parquet(input_path)
    # Read the written drop so expected is derived from the same bytes learners read.
    # A second action on a lazy limit() would pick a different 20k/100k slice.
    fact = spark.read.parquet(input_path)
    approved = fact.filter(F.col("response_code") == "00")
    out = approved.join(
        mcc.select("mcc", "mcc_description", "category"),
        on="mcc",
        how="left",
    )
    out.write.mode("overwrite").parquet(expected_path)
    n_in = fact.count()
    n_out = out.count()
    unpublished_n = approved.join(
        mcc.select("mcc"),
        on="mcc",
        how="left_anti",
    ).count()
    print(
        f"{case_id} input={n_in} approved={n_out} unpublished_approved={unpublished_n}",
        flush=True,
    )


def main():
    spark = SparkSession.builder.appName("gen-l1-enrich-auth-mcc").getOrCreate()
    mcc = spark.read.parquet(SRC_MCC).select("mcc", "mcc_description", "category")
    mcc.write.mode("overwrite").parquet(f"{PREFIX}/dims/mcc/")
    txns = spark.read.parquet(SRC_TXNS)
    write_case(spark, txns, mcc, "01-auth-mcc", UNPUB_RUN, 9, 20000)
    write_case(spark, txns, mcc, "02-auth-mcc", UNPUB_SUB, 11, 100000)
    spark.stop()


if __name__ == "__main__":
    main()
