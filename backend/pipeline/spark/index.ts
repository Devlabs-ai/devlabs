'use strict';

/**
 * Spark authoring pipeline (parallel to compose buildPipeline).
 *
 * Agents:
 *   Design   — shape contract (caller supplies confirmed shape for now)
 *   Data     — Claude Agent SDK → gen scripts
 *   Code     — Claude Agent SDK → starter/ + solution/
 *   Validation — static + optional LLM vs shape
 *   Eval     — K8s Job data gen (MinIO) + Spark platform solution + collect golden
 *              (Claude Agent SDK only if SPARK_EVAL_REPAIR=1)
 */

const shapeContract = require('./shapeContract');
const workspace = require('./workspace');
const stageAttempt = require('./stageAttempt');
const { runSparkAuthoringPipeline } = require('./sparkPipeline');
const { runSparkDataAgent } = require('./agents/dataAgent');
const { runSparkCodeAgent } = require('./agents/codeAgent');
const { runSparkValidationAgent } = require('./agents/validationAgent');
const { runSparkEvalAgent } = require('./agents/evalAgent');
const { publishSparkChallenge } = require('./publish');
const authoringMinio = require('./authoringMinio');
const { runAuthoringDataGenJob, k8sDataGenAvailable } = require('./dataGenJob');

module.exports = {
  ...shapeContract,
  ...workspace,
  ...stageAttempt,
  ...authoringMinio,
  runSparkAuthoringPipeline,
  runSparkDataAgent,
  runSparkCodeAgent,
  runSparkValidationAgent,
  runSparkEvalAgent,
  publishSparkChallenge,
  runAuthoringDataGenJob,
  k8sDataGenAvailable,
};
