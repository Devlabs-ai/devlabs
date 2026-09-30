#!/usr/bin/env bash
set -euo pipefail
: "${LEARNER_NS:?}"
echo "setup ok: ${CHALLENGE_ID:-lab} in ${LEARNER_NS}"
