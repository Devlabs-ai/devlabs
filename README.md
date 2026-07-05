# Devlabs

> *Ladies and Gentlemen, You are not ready for this!!*

A technical interview platform built for new age candidate evaluation. Interviewers author production-style incidents — broken infrastructure, live metrics, real Docker stacks using existing Agentic pipelines — and candidates debug them inside live sandboxes. Not toy puzzles. Not whiteboard hypotheticals. The same kind of ambiguity, signals, and blast radius you get when something is actually on fire.

---

## What Devlabs is

Devlabs has two sides:

**Authoring** — shape a challenge from intent to verified sandbox: design the incident, materialize the stack, build and validate that it breaks (and recovers) the way you intended.

**Play** — run a candidate through that challenge: incident brief, live terminal and metrics, observable session.

The product promise is realism end to end. Authoring produces trustworthy incidents. Play proves whether a candidate can run one.

---

## Roadmap

**Currently in development: V0.1**

### Devlabs V0.1 — Authoring *(current)*

Make challenge creation stable, efficient, and operator-flexible.

Authoring is treated as a complete, independent capability on the platform — not an afterthought bolted onto Play. An operator can run it **HITL** (human in the loop): shape the design, approve the contract, review the build, sign off before promote. Or **AITL** (agent in the loop): agents drive design, schema, and build with human gates only where you want them.

Focus for this phase:

- Reliable design → build → review → promote loop
- Token-aware pipeline — fast, predictable builds without sacrificing correctness
- Clear failure visibility for operators
- Ready for both human-led and agent-led authoring workflows

### Devlabs V0.2 — Evaluation & Play *(planned)*

Define what good looks like when a candidate takes a challenge — and how AI assistance fits in.

Play already delivers live sandboxes and recovery signals. V0.2 adds the evaluation layer: criteria scoped to each challenge, observable candidate behavior, and explicit policies for AI tool access (none, scoped, or full — per challenge or invite).

Focus for this phase:

- Evaluation criteria aligned with how challenges are authored (symptoms, recovery, process)
- Session artifacts interviewers can actually use — not just elapsed time
- Play experience consistent with the incident brief and metrics the author defined
- Fair assessment under chosen AI-assistance rules

V0.2 builds on V0.1. You can't evaluate fairly on challenges that aren't trustworthy.