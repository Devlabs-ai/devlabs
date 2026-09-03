import type { ChallengeFull, SparkPlatformSpec } from '../types/domain';
import type { SparkProjectFiles } from './dailyProductSalesL1';
import {
  PLAYGROUND_PATH_CONSTANTS,
  SPARK_PLAYGROUND_CHALLENGE_ID,
} from '../constants/playgroundDatasets';

const P = PLAYGROUND_PATH_CONSTANTS;

const MAIN_PY = `"""Spark Playground — experiment bench.

Try ideas + trail resources here; promote a sweet spot into a challenge later.
Clusters: Card Rails (transactional), NovaMart (clickstream), Vesper Markets (retail POS).
MinIO: datasets/payment-network/, datasets/novamart/, and datasets/vesper/
Nothing is pre-selected: pick TXNS_* / EVENTS_* / VESPER_* / DIM_* yourself, set Resources, then Run.

Paths injected on Run:
  OUTPUT_PATH — per-job folder (results/<jobId>/)
  DUMP_PATH   — stable scratch dump for this playground session (…/dump/)
Use DUMP_PATH with subfolders for named experiments, e.g. DUMP_PATH + "approved_gmv_mcc/".
"""

from __future__ import annotations

import os

from pyspark.sql import SparkSession

OUTPUT_PATH = os.environ["OUTPUT_PATH"]
DUMP_PATH = os.environ.get("DUMP_PATH", OUTPUT_PATH)

# ── Facts ────────────────────────────────────────────────────────────────────
TXNS_50M_SKEW_KEY75 = "${P.TXNS_50M_SKEW_KEY75}"
TXNS_100M_SKEW_KEY75 = "${P.TXNS_100M_SKEW_KEY75}"

# ── Dims / opcode tables ─────────────────────────────────────────────────────
DIM_COUNTRY = "${P.DIM_COUNTRY}"
DIM_MCC = "${P.DIM_MCC}"
DIM_INTERCHANGE_RATE = "${P.DIM_INTERCHANGE_RATE}"
DIM_CURRENCY = "${P.DIM_CURRENCY}"
DIM_RESPONSE_CODE = "${P.DIM_RESPONSE_CODE}"
DIM_ENTRY_MODE = "${P.DIM_ENTRY_MODE}"
DIM_ACQUIRER = "${P.DIM_ACQUIRER}"

# ── NovaMart clickstream ─────────────────────────────────────────────────────
EVENTS_20K = "${P.EVENTS_20K}"
EVENTS_200K = "${P.EVENTS_200K}"
EVENTS_1M = "${P.EVENTS_1M}"
DIM_CATALOG_CURRENT = "${P.DIM_CATALOG_CURRENT}"
DIM_CATALOG_SCD_SMALL = "${P.DIM_CATALOG_SCD_SMALL}"
DIM_CATALOG_SCD = "${P.DIM_CATALOG_SCD}"

# ── Vesper Markets overnight sales ───────────────────────────────────────────
VESPER_SALES_100K = "${P.VESPER_SALES_100K}"


def main() -> None:
    spark = (
        SparkSession.builder
        .appName("spark-playground-card-rails")
        .getOrCreate()
    )

    # Choose paths explicitly, e.g.:
    # from pyspark.sql import functions as F
    # txns = spark.read.parquet(TXNS_50M_SKEW_KEY75)
    # country = spark.read.parquet(DIM_COUNTRY)
    # mcc = spark.read.parquet(DIM_MCC)
    #
    # enriched = (
    #     txns.alias("t")
    #     .join(mcc.alias("m"), F.col("t.mcc") == F.col("m.mcc"), "left")
    #     .join(country.alias("c"), F.col("t.country_code") == F.col("c.country_code"), "left")
    # )
    # enriched.show(20, truncate=40)
    # enriched.write.mode("overwrite").parquet(OUTPUT_PATH)
    # or a named dump for this trail:
    # enriched.write.mode("overwrite").parquet(DUMP_PATH + "approved_gmv_mcc/")
    #
    # NovaMart clickstream:
    # events = spark.read.parquet(EVENTS_20K)
    # catalog = spark.read.parquet(DIM_CATALOG_CURRENT)
    #
    # Vesper overnight sales:
    # sales = spark.read.parquet(VESPER_SALES_100K)

    spark.stop()


if __name__ == "__main__":
    main()
`;

export function buildSparkPlaygroundStarter(): SparkProjectFiles {
  return { 'src/main.py': MAIN_PY };
}

export function buildSparkPlaygroundPlatform(): SparkPlatformSpec {
  return {
    inputPath: '',
    evalSolutionPath: '',
    outputFormat: 'parquet',
    language: 'python',
    starterFileName: 'src/main.py',
    limits: {
      driver: 1,
      driverMemory: '1g',
      executors: 2,
      executorCores: 1,
      executorMemory: '1g',
    },
    gradeChecks: [
      'Experiment bench — set Resources, Save, then Run. Promote a sweet spot into a challenge later.',
      'Run-only — no Submit / grading.',
      'No default INPUT_PATH — pick cluster paths in src/main.py (cross-cluster OK).',
      'OUTPUT_PATH = per-job results/<jobId>/; DUMP_PATH = stable …/dump/ for named experiment writes.',
    ],
  };
}

export function buildSparkPlaygroundChallenge(): ChallengeFull {
  return {
    id: SPARK_PLAYGROUND_CHALLENGE_ID,
    number: null,
    title: 'Spark Playground',
    description:
      'Spark experiment bench — try ideas and trail resources against data clusters, then promote winners into challenges.',
    difficulty: 'Practice',
    tags: ['spark', 'playground', 'practice', 'transactional', 'card-rails', 'clickstream', 'novamart', 'vesper'],
    category: 'batch-processing',
    finalized: true,
    sandboxType: 'spark-platform',
    verifiedDir: null,
    validationSpec: null,
    problemStatement: {},
    sparkPlatform: buildSparkPlaygroundPlatform(),
  };
}
