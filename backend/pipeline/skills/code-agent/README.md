# CODE agent pipeline skills

These are **Devlabs build-pipeline skills** (not Cursor IDE skills). They instruct the
LLM inside `codeAgent.ts` during CODE → SPIN → VALIDATE.

## How skill selection works

The LLM **does not choose** a skill. Selection is deterministic:

```
buildPipeline.runBuildLoop()
  → codeMode = 'scaffold' | 'repair'   (heuristic: failures / attempt / compose exists)
  → codeAgent.runCodePhase({ mode: codeMode })
  → buildCodeAgentSystemPrompt(mode)     ← loads one skill + invariants
  → runCodeAgentHarness({ systemPrompt, prompt, cwd: buildDir })   ← Claude Agent SDK (Read/Write/Edit/Glob/Grep)
```

| Signal | Mode | Skill file |
|--------|------|------------|
| First iteration, no SPIN/VALIDATE failure | `scaffold` | `scaffold/SKILL.md` |
| `previousAttempt` (phase SPIN / VALIDATE / CODE) or retry | `repair` | `repair/SKILL.md` |

The **system prompt** includes:

1. **ACTIVE SKILL** — workflow for the current mode  
2. **DEVLABS INVARIANTS** — challenge.json, compose, graphs (always)

The **user message** is JSON: `mode`, `draft`, `previousAttempt`, `failureContext`, `workspaceTree`, `lessonsBlock`.

## Files

| File | Purpose |
|------|---------|
| `invariants.md` | Shared contracts (graphs, compose, checklist) |
| `scaffold/SKILL.md` | First-build workflow |
| `repair/SKILL.md` | Patch workflow after failures |
| `../codeAgentSkills.ts` | Loader + `buildCodeAgentSystemPrompt(mode)` |
| `../../helpers/codeAgentHarness.ts` | Claude Agent SDK `query()` wrapper |

## Editing

Change skill markdown here; restart dev server (skills are cached in-process until restart).
Production `npm run build` copies `code-agent/` into `dist/pipeline/skills/`.
