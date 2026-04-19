#!/usr/bin/env bash
# Full-stack bootstrap for AC-BOOT-00. Per docs/script-specs.md §9.
#
# 1. Verifies prereqs (pnpm, node, podman or docker)
# 2. Creates .env.local from .env.example (with generated secrets) if absent
# 3. Creates .env (mirrors .env.local) so compose.yaml var-substitution works
# 4. Runs `pnpm install` (which also runs `lefthook install` via prepare)
# 5. Brings the compose stack up and waits for /healthz to be green
#
# Exit codes: 0 = stack is up, 2 = prereq missing, 1 = other failure.

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "${REPO_ROOT}"

CONTAINER_CLI="${CONTAINER_CLI:-$(command -v podman 2>/dev/null || command -v docker 2>/dev/null)}"
if [ -z "${CONTAINER_CLI}" ]; then
  echo "dev-bootstrap: podman or docker is required but neither was found in PATH." >&2
  exit 2
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "dev-bootstrap: pnpm is required (install via corepack enable)." >&2
  exit 2
fi

if ! command -v node >/dev/null 2>&1; then
  echo "dev-bootstrap: node is required." >&2
  exit 2
fi

# Determine the right inline-edit flag for the local sed (GNU vs BSD).
if sed --version >/dev/null 2>&1; then
  SED_INPLACE=(-i)
else
  SED_INPLACE=(-i "")
fi

if [ ! -f .env.local ]; then
  echo "dev-bootstrap: creating .env.local from .env.example with fresh secrets"
  cp .env.example .env.local
  SESSION_SECRET=$(pnpm dlx tsx scripts/generate-secret.ts --bytes 32 --format hex 2>/dev/null || true)
  CSRF_SECRET=$(pnpm dlx tsx scripts/generate-secret.ts --bytes 32 --format hex 2>/dev/null || true)
  if [ -n "${SESSION_SECRET}" ]; then
    sed "${SED_INPLACE[@]}" "s#^SESSION_SECRET=.*#SESSION_SECRET=${SESSION_SECRET}#" .env.local
  fi
  if [ -n "${CSRF_SECRET}" ]; then
    sed "${SED_INPLACE[@]}" "s#^CSRF_SECRET=.*#CSRF_SECRET=${CSRF_SECRET}#" .env.local
  fi
fi

# compose.yaml uses ${VAR:?} substitution and reads variables from .env by
# default. Mirror .env.local into .env so the substitution succeeds.
if [ ! -f .env ]; then
  cp .env.local .env
fi

echo "dev-bootstrap: installing dependencies"
pnpm install

echo "dev-bootstrap: bringing up compose stack with ${CONTAINER_CLI}"
"${CONTAINER_CLI}" compose up -d --wait

echo "dev-bootstrap: waiting for /healthz (up to 60s)"
DEADLINE=$(( $(date +%s) + 60 ))
while true; do
  if curl -sf http://localhost:3000/healthz >/dev/null 2>&1; then
    echo "dev-bootstrap: healthz green"
    break
  fi
  if [ "$(date +%s)" -ge "${DEADLINE}" ]; then
    echo "dev-bootstrap: timeout waiting for /healthz" >&2
    exit 1
  fi
  sleep 2
done

cat <<EOF
dev-bootstrap: stack is up
  api:     http://localhost:3000   (GET /healthz)
  web:     http://localhost:5173
  mailpit: http://localhost:8025

To tear down: ${CONTAINER_CLI} compose down -v
EOF
