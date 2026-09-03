import type { SparkPlatformSpec } from '../types/domain';
import type { SparkProjectFiles } from './dailyProductSalesL1';

/**
 * @deprecated L1 filter uses MinIO SSOT (`contentSource: minio`).
 * Starter files live in platforms/devlabs-data/challenges/l1-filter-valid-sales-rows/starter/
 * and are seeded by the backend from s3://…/starter/. Kept only as a local reference.
 */
const MAIN_PY = `"""Filter valid sales rows — Spark entrypoint."""

from pyspark.sql import SparkSession
from pyspark.sql import functions as F
import os

INPUT_PATH = os.environ["INPUT_PATH"]
OUTPUT_PATH = os.environ["OUTPUT_PATH"]


def main() -> None:
    spark = SparkSession.builder.appName("filter-valid-sales-rows").getOrCreate()

    df = spark.read.parquet(INPUT_PATH)

    # TODO: apply the column rules, then write Parquet to OUTPUT_PATH.
    _ = F

    spark.stop()


if __name__ == "__main__":
    main()
`;

export function buildFilterValidSalesRowsProject(_platform: SparkPlatformSpec): SparkProjectFiles {
  return {
    'src/main.py': MAIN_PY,
  };
}
