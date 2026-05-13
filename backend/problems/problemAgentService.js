'use strict';

// Problem Design Agent — a conversational guide that helps an interviewer
// shape a draft challenge. The system prompt asks Claude to:
//   1. Ask clarifying questions about the scenario, services, and broken state
//   2. Co-author a draft incrementally
//   3. Emit the latest draft inside <challenge_draft>{ ... }</challenge_draft>
//      XML so the backend can extract a structured JSON without parsing prose.
//
// The draft schema we ask for uses `sandboxSpec` (not `sandboxType`); the
// downstream build agent reads from sandboxSpec.

const llm = require('../llm/client');

const SYSTEM_PROMPT = `You are the Problem Design Agent for "System Escape Room",
a platform where interviewers author broken-infrastructure challenges that
candidates debug live inside Docker sandboxes.

Your job is to co-author a single challenge draft with the interviewer through
a friendly back-and-forth. You should:

1. Ask focused clarifying questions when the interviewer's idea is vague
   (services involved, severity, what is broken, how candidates verify a fix).
2. Once you have enough to draft, emit a draft JSON inside
   <challenge_draft>...</challenge_draft> XML tags. Always include the FULL
   current draft (not a delta) when you emit. Use the schema below.
3. After emitting a draft, briefly summarise what you set and ask for the next
   refinement.

DRAFT JSON SCHEMA:
{
  "title": "string",
  "description": "one-paragraph hook",
  "difficulty": "Easy | Medium | Hard",
  "category": "Database | Caching | Messaging | Networking | ...",
  "tags": ["postgres", "indexing", ...],
  "problemStatement": {
    "incident": "one-line headline",
    "severity": "P0 | P1 | P2 | P3",
    "situation": "2-4 sentence backstory",
    "architecture": "load-generator -> orders-service -> postgres:15",
    "tasks": ["Open psql ...", "EXPLAIN ANALYZE ..."],
    "dbAccess": ["host: postgres", "port: 5432", ...],
    "scoring": "what counts as a fix"
  },
  "sandboxSpec": {
    "description": "what the broken environment looks like (1-2 sentences)",
    "services": ["postgres", "orders-service", "load-generator"],
    "brokenState": "exactly what is broken (e.g. missing index on orders.user_id, query forces full table scan)",
    "validationApproach": "how a passing fix is detected (e.g. p50 latency < 50ms for 10 consecutive samples)"
  }
}

RULES:
- Custom services must be Python (Flask/FastAPI). Avoid Node.js services in
  sandboxSpec.services unless the interviewer insists.
- Validation must be observable from container logs or HTTP probes — no
  internal hooks.
- Keep difficulty proportional: Easy = single obvious knob, Medium = needs
  diagnosis (EXPLAIN / cache stats), Hard = multi-step + non-obvious causation.
- Do not emit a draft until you actually have a concrete brokenState. If the
  interviewer is still brainstorming, just talk.
- When you DO emit a draft, the XML block must be valid JSON. No trailing
  commas, no comments.`;

// Pull the LAST <challenge_draft>...</challenge_draft> block from a chunk of
// assistant text. We grab the last one so iterative drafts always overwrite.
function extractDraft(text) {
  const re = /<challenge_draft>([\s\S]*?)<\/challenge_draft>/g;
  let last = null;
  let m;
  while ((m = re.exec(text)) !== null) last = m[1];
  if (!last) return null;
  try {
    return JSON.parse(last.trim());
  } catch (e) {
    console.warn('[problemAgent] draft JSON parse failed:', e.message);
    return null;
  }
}

// Stream one chat turn. `onEvent` is called with SSE-shaped events:
//   { type: 'text',  delta: '...'        }
//   { type: 'draft', draft: { ...JSON... } }
//   { type: 'done' }
//   { type: 'error', message: '...' }
//
// Returns { fullText, draft } when the stream finishes.
async function streamChatTurn({ messages, onEvent }) {
  if (!llm.isConfigured()) {
    const provider = llm.getProvider();
    const keyName = provider === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY';
    const e = new Error(
      `${keyName} is not configured (LLM_PROVIDER=${provider}). Set it in backend/.env to use the chat agent. ` +
      'You can still import a draft as JSON from the Problem Setter page.',
    );
    e.code = 'LLM_NOT_CONFIGURED';
    throw e;
  }

  let fullText = '';
  try {
    fullText = await llm.streamMessage({
      system: SYSTEM_PROMPT,
      messages,
      maxTokens: 4096,
      onText: (delta) => onEvent({ type: 'text', delta }),
    });
  } catch (e) {
    onEvent({ type: 'error', message: e.message });
    throw e;
  }

  const draft = extractDraft(fullText);
  if (draft) onEvent({ type: 'draft', draft });
  onEvent({ type: 'done' });
  return { fullText, draft };
}

module.exports = {
  SYSTEM_PROMPT,
  extractDraft,
  streamChatTurn,
};
