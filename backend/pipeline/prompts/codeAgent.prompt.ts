'use strict';

/**
 * CODE agent prompts — invariants + mode skills live under pipeline/skills/code-agent/.
 * System prompt is composed at runtime by buildCodeAgentSystemPrompt(mode).
 */
const {
  buildCodeAgentSystemPrompt,
  SCAFFOLD_USER_HINT,
  REPAIR_USER_HINT,
} = require('../skills/codeAgentSkills');

/** @deprecated use buildCodeAgentSystemPrompt('scaffold' | 'repair') */
const SYSTEM_PROMPT = buildCodeAgentSystemPrompt('scaffold');

/** @deprecated use buildCodeAgentSystemPrompt(mode) */
const SYSTEM_PROMPT_STATIC = SYSTEM_PROMPT;

/** @deprecated mode skill is injected via buildCodeAgentSystemPrompt */
const SYSTEM_PROMPT_DYNAMIC = '';

module.exports = {
  buildCodeAgentSystemPrompt,
  SYSTEM_PROMPT,
  SYSTEM_PROMPT_STATIC,
  SYSTEM_PROMPT_DYNAMIC,
  SCAFFOLD_USER_HINT,
  REPAIR_USER_HINT,
};
