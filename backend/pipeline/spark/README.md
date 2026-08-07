# Spark authoring pipeline
#
# After Design confirms a spark shape contract:
#   Data ∥ Code (Claude Agent SDK) → Validation → Eval (run gen + solution)
#
# Retries carry the previous stage failure into Data/Code prompts.
# Eval tags details.repairOwner (DATA | CODE | EVAL | PLATFORM); the orchestrator then
# re-runs only the owning agent(s) on the next iteration:
#   DATA      → Data Agent only (skip Code)
#   CODE      → Code Agent only (skip Data)
#   PLATFORM  → skip agents; re-run Eval only (K8s/API/infra — not a codegen bug)
#   BOTH / VALIDATION / collect → Data + Code
#
# Workspace: sandbox/spark-authoring/<draftSessionId>/
#   gen/ starter/ solution/ input/ eval/ shape.json
#
# ---------------------------------------------------------------------------
# Standalone agent triggers (manual test loop — same agents as full Build)
# Auth: Bearer token (POST /api/auth/login-email)
# SSE: each POST streams events; final event is type=done|error with workspaceId
#
# Body fields (Data + Code):
#   workspaceId | draftId | folder   — same sandbox/spark-authoring/<id>/ folder
#   mode: scaffold | repair          — repair requires error context (or eval-failure.json)
#   error | errorMessage             — short failure message
#   context | stderr | stdout        — traceback / detail for the prompt
#   previousAttempt | attempt        — full Eval attempt object from /eval error event
#   shape | sparkShape | contract    — optional if shape.json already in workspace
#
#   # 1) Data Agent — omit workspaceId to create a NEW folder; pass it to reuse / repair
#   curl -N -X POST http://localhost:4000/api/spark/agents/data \
#     -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
#     --data-binary @shape.json
#
#   # Data repair in-place (after Eval failed on DATA_GEN)
#   curl -N -X POST http://localhost:4000/api/spark/agents/data \
#     -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
#     -d "{\"workspaceId\":\"$WID\",\"mode\":\"repair\"}"
#   # → loads eval/eval-failure.json automatically if no error field passed
#
#   # Or pass the failure explicitly:
#   curl -N -X POST http://localhost:4000/api/spark/agents/data \
#     -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
#     -d "{\"workspaceId\":\"$WID\",\"mode\":\"repair\",\"error\":\"ArrowInvalid nan→int32\",\"context\":\"…traceback…\"}"
#
#   # 2) Code Agent — MUST pass workspaceId; same mode/error fields for repair
#   curl -N -X POST http://localhost:4000/api/spark/agents/code \
#     -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
#     -d "{\"workspaceId\":\"$WID\",\"mode\":\"repair\",\"previousAttempt\":{…from eval…}}"
#
#   # 3) Eval — execute only (does not edit gen/solution)
#   curl -N -X POST http://localhost:4000/api/spark/agents/eval \
#     -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
#     -d "{\"workspaceId\":\"$WID\"}"
#
#   GET /api/spark/agents/workspace/:workspaceId  — list files / shape
# ---------------------------------------------------------------------------
#
# Env:
#   ANTHROPIC_API_KEY          required for Data/Code (Claude Agent SDK)
#   SPARK_PIPELINE_MAX_ITERATIONS=2
#   SPARK_DATA_MAX_TURNS=40
#   SPARK_CODE_MAX_TURNS=60
#   SPARK_EVAL_PYTHON=python3
#   SPARK_EVAL_SOLUTION_CMD=   optional shell to submit solution on Spark platform
#   SPARK_EVAL_REPAIR=1        optional Claude repair pass inside Eval on failure
#   SPARK_AUTHORING_DIR=       override workspace root
#   LLM_MODEL_SPARK_DATA=anthropic:claude-haiku-4-5
#   LLM_MODEL_SPARK_CODE=anthropic:claude-haiku-4-5
#
# Eval SDK choice:
#   - Primary Eval path is execution (spawn gen + solution), not an LLM SDK.
#   - Claude Agent SDK is used for Data/Code generation and optional Eval repair.
#   - Wire SPARK_EVAL_SOLUTION_CMD to the Spark platform submit when ready.
