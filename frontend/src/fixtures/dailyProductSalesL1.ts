import type { ChallengeFull, SparkPlatformSpec } from '../types/domain';

/** In-memory project files handed to the candidate (VS Code–style workspace). */
export type SparkProjectFiles = Record<string, string>;

const MAIN_PY = `"""Spark entrypoint — expand into packages/modules as you like."""

from pyspark.sql import SparkSession
import json
import os

INPUT_PATH = os.environ["INPUT_PATH"]
OUTPUT_PATH = os.environ["OUTPUT_PATH"]
BUSINESS_DATE = os.environ.get("BUSINESS_DATE", "2026-01-15")


def write_result_json(spark: SparkSession, rows: list, output_path: str) -> None:
    """Write {"rows": [...]} to OUTPUT_PATH (s3a JSON object)."""
    payload = json.dumps({"rows": rows}, indent=2)
    hadoop_conf = spark._jsc.hadoopConfiguration()
    uri = spark._jvm.java.net.URI(output_path)
    fs = spark._jvm.org.apache.hadoop.fs.FileSystem.get(uri, hadoop_conf)
    path = spark._jvm.org.apache.hadoop.fs.Path(output_path)
    parent = path.getParent()
    if parent is not None and not fs.exists(parent):
        fs.mkdirs(parent)
    out = fs.create(path, True)
    out.write(bytearray(payload, "utf-8"))
    out.close()


def main() -> None:
    spark = SparkSession.builder.appName("daily-product-sales").getOrCreate()

    # TODO: discover INPUT_PATH parquet, validate, aggregate, then:
    # write_result_json(spark, rows, OUTPUT_PATH)
    # Each row must include the graded columns (see eval solution schema).

    spark.stop()


if __name__ == "__main__":
    main()
`;

/** Challenge catalog fixture for Daily Product Sales. Starter is src/main.py only. */
export const DAILY_PRODUCT_SALES_L1: ChallengeFull = {
  id: 'daily-product-sales-pipeline-l1',
  title: 'Daily Product Sales Pipeline',
  description: `**Acme Retail** operates **50 retail stores** across the country. Each store generates sales transactions throughout the day and exports them as a **Parquet** dataset at the end of business hours.

Every night, these datasets are uploaded to the company's central data platform. Before the start of the next business day, the Business Intelligence team expects an aggregated **Product Sales Summary**.

Your pipeline should:

- Process all incoming sales datasets
- Validate incoming records
- Ignore malformed records while continuing processing
- Compute product-level business metrics
- Publish a daily summary dataset
`,
  difficulty: 'L2',
  tags: ['spark', 'batch', 'parquet', 'minio', 'aggregation'],
  category: 'batch-processing',
  finalized: true,
  sandboxType: 'spark-platform',
  verifiedDir: null,
  problemStatement: {
    overview:
      'Build a Spark batch pipeline that reads nightly store Parquet exports, validates records, and computes a product-level daily summary.',
    symptoms: [
      'BI needs a reliable daily_product_summary ready before the next business day.',
      'Store exports can include malformed rows — reject them without failing the batch.',
    ],
    yourTaskSteps: [
      'Discover all input Parquet files for the business date.',
      'Validate each row; ignore malformed records and continue.',
      'Aggregate product-level metrics for the day.',
      'Publish daily_product_summary to the output path.',
      'Use as many project files as you need; keep src/main.py as the entrypoint.',
    ],
    yourTask:
      'Implement a Spark application that discovers input Parquet files, validates rows, aggregates product metrics, and publishes daily_product_summary.',
    hints: [
      'Cluster limits and s3a paths are in the Spec tab / platform settings.',
      'Reject nulls and non-positive quantity / unit_price; keep processing.',
      'Input is hive-partitioned by store_id — spark.read.parquet fills null store_id from the path.',
      'total_revenue = sum(quantity × unit_price); stores_sold_in = distinct store_id per product.',
    ],
    inputSchema: [
      { column: 'transaction_id', type: 'STRING' },
      { column: 'store_id', type: 'INT' },
      { column: 'product_id', type: 'INT' },
      { column: 'customer_id', type: 'INT' },
      { column: 'quantity', type: 'INT' },
      { column: 'unit_price', type: 'DECIMAL(10,2)' },
      { column: 'transaction_timestamp', type: 'TIMESTAMP' },
    ],
    expectedOutput: [
      { column: 'business_date', description: 'Processing date' },
      { column: 'product_id', description: 'Product identifier' },
      { column: 'total_units_sold', description: 'Sum of quantity sold' },
      { column: 'total_revenue', description: 'Sum of quantity × unit_price' },
      { column: 'transaction_count', description: 'Total number of transactions' },
      { column: 'stores_sold_in', description: 'Distinct stores selling the product' },
    ],
  },
  validationSpec: null,
  sparkPlatform: {
    inputPath:
      's3a://devlabs-data/challenges/daily-product-sales-pipeline-l1/input/business_date=2026-01-15/',
    /** Author golden aggregates for Submit: MinIO eval/solution.json */
    evalSolutionPath:
      's3a://devlabs-data/challenges/daily-product-sales-pipeline-l1/eval/solution.json',
    businessDate: '2026-01-15',
    language: 'python',
    starterFileName: 'src/main.py',
    limits: {
      driver: 1,
      executors: 4,
      executorCores: 1,
      executorMemory: '1g',
    },
    gradeChecks: [
      'Discovers all incoming Parquet files for the business date',
      'Validates rows and ignores malformed records without failing the batch',
      'Writes daily_product_summary with the required columns',
      'Computes correct product-level aggregates (units, revenue, counts, stores_sold_in)',
      'Runs as a Spark application within cluster resource limits',
    ],
  },
};

export function buildDailyProductSalesProject(_platform: SparkPlatformSpec): SparkProjectFiles {
  return {
    'src/main.py': MAIN_PY,
  };
}

export const SPARK_PLATFORM_FIXTURES: ChallengeFull[] = [DAILY_PRODUCT_SALES_L1];
