'use strict';

// Re-exports for backwards compatibility. Shape flow is split:
//   descriptionAgent — Phase 1 problem statement
//   schemaAgent      — Phase 2 catalogue-backed v1 JSON

const descriptionAgent = require('./descriptionAgent');
const schemaAgent = require('./schemaAgent');

module.exports = {
  streamDescriptionTurn: descriptionAgent.streamDescriptionTurn,
  generateSchema: schemaAgent.generateSchema,
  extractDescriptionPayload: descriptionAgent.extractDescriptionPayload,
  // legacy alias
  streamChatTurn: descriptionAgent.streamDescriptionTurn,
};
