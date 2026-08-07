'use strict';

/**
 * Manual challenge catalog (v2). Disk seed from sandbox/verified is disabled
 * while we redesign schema; insert curated rows here.
 */

const pool = require('../db/pool');

const DAILY_PRODUCT_SALES_L1 = {
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
  difficulty: 'Medium',
  tags: ['spark', 'batch', 'parquet', 'minio', 'aggregation'],
  category: 'batch-processing',
  sandboxType: 'spark-platform',
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
      'Cluster limits and s3a paths are in README.md.',
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
  platformSpec: {
    inputPath:
      's3a://devlabs-data/challenges/daily-product-sales-pipeline-l1/input/business_date=2026-01-15/',
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

async function seedManualCatalog(): Promise<void> {
  const now = Date.now();
  const c = DAILY_PRODUCT_SALES_L1;
  await pool.query(
    `INSERT INTO challenges
       (id, title, description, difficulty, tags, category,
        finalized, sandbox_type, verified_dir,
        problem_statement, validation_spec, platform_spec,
        created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,true,$7,NULL,$8,NULL,$9,$10,$10)
     ON CONFLICT (id) DO UPDATE SET
       title = EXCLUDED.title,
       description = EXCLUDED.description,
       difficulty = EXCLUDED.difficulty,
       tags = EXCLUDED.tags,
       category = EXCLUDED.category,
       finalized = EXCLUDED.finalized,
       sandbox_type = EXCLUDED.sandbox_type,
       problem_statement = EXCLUDED.problem_statement,
       platform_spec = EXCLUDED.platform_spec,
       updated_at = EXCLUDED.updated_at`,
    [
      c.id,
      c.title,
      c.description,
      c.difficulty,
      JSON.stringify(c.tags),
      c.category,
      c.sandboxType,
      JSON.stringify(c.problemStatement),
      JSON.stringify(c.platformSpec),
      now,
    ],
  );
  console.log(`[challenges] manual catalog upserted "${c.id}"`);
}

module.exports = { seedManualCatalog, DAILY_PRODUCT_SALES_L1 };
