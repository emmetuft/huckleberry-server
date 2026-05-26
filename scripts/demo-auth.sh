#!/usr/bin/env bash
#
# Walks the Layer A auth flow against a running BFF — fully automated.
#
# Prereqs:
#   - BFF is running on http://localhost:3000 (pnpm start:dev)
#   - .env has SESSION_SIGNING_KEY + ADMIN_API_KEY set
#
# Usage:
#   ./scripts/demo-auth.sh [email]     (default: demo@huckleberry.ai)
#
# What it does:
#   1. POST /api/admin/users to seed a user — response includes magicLinkUrl in dev
#   2. GETs the magic-link URL → captures hb_session + csrf_token cookies
#   3. Calls /api/auth/me → prints the principal
#   4. Logs out (with CSRF) → confirms revocation

set -euo pipefail

EMAIL="${1:-demo@huckleberry.ai}"
BFF="${BFF_URL:-http://localhost:3000}"
COOKIE_JAR="$(mktemp -t hb_demo_cookies.XXXXXX)"
trap 'rm -f "$COOKIE_JAR"' EXIT

# Pull only the values we actually need out of .env. Sourcing the whole
# file blows up when values have unquoted spaces (e.g. multi-word scope
# strings like `ai:read ai:execute`).
read_env() {
  local key="$1"
  [ -f .env ] || return 0
  grep -E "^${key}=" .env | head -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'
}

ADMIN_API_KEY="${ADMIN_API_KEY:-$(read_env ADMIN_API_KEY)}"
if [ -z "${ADMIN_API_KEY:-}" ]; then
  echo "error: ADMIN_API_KEY not set in .env" >&2
  exit 1
fi

color() { printf "\033[%sm%s\033[0m" "$1" "$2"; }
step() { color "1;36" "==> $1"; echo; }
ok() { color "32" "✓ $1"; echo; }
fail() { color "31" "✗ $1"; echo; exit 1; }
json_pick() { node -e "const v = JSON.parse(require('fs').readFileSync(0,'utf8'))$1; process.stdout.write(v === undefined || v === null ? '' : String(v));"; }

step "Seeding user $EMAIL"
SEED_RESP=$(curl -sS -X POST "$BFF/api/admin/users" \
  -H "Content-Type: application/json" \
  -H "x-admin-api-key: $ADMIN_API_KEY" \
  -d "{\"email\":\"$EMAIL\",\"issuerUrl\":\"http://domo-labs-dev.dev.domo.com:443\",\"customerId\":\"labs\"}")
echo "    $SEED_RESP"
USER_ID=$(echo "$SEED_RESP" | json_pick ".data.userId")
MAGIC_URL=$(echo "$SEED_RESP" | json_pick ".data.magicLinkUrl")
[ -n "$USER_ID" ] || fail "no userId in response"
[ -n "$MAGIC_URL" ] || fail "no magicLinkUrl in response (BFF must be in dev mode)"
ok "user $USER_ID seeded"
ok "magic-link URL: $MAGIC_URL"

# The magic-link URL points at the SPA (which calls the BFF via fetch).
# This script bypasses the SPA — extract the token and hit the BFF directly.
TOKEN=$(echo "$MAGIC_URL" | sed -E 's/.*[?&]token=([^&]+).*/\1/')
[ -n "$TOKEN" ] || fail "could not extract token from magic-link URL"
CONSUME_URL="$BFF/api/auth/signin?token=$TOKEN"

step "Consuming magic link (BFF direct, bypassing SPA)"
CONSUME_RESP=$(curl -sS -c "$COOKIE_JAR" "$CONSUME_URL")
echo "    $CONSUME_RESP"
NEEDS_LINK=$(echo "$CONSUME_RESP" | json_pick ".data.needsLinkage")
ok "session issued, needsLinkage=$NEEDS_LINK"

CSRF_TOKEN=$(awk '$6 == "csrf_token" { print $7 }' "$COOKIE_JAR")
[ -n "$CSRF_TOKEN" ] || fail "no csrf_token in cookie jar"

step "Calling /api/auth/me"
ME_RESP=$(curl -sS -b "$COOKIE_JAR" "$BFF/api/auth/me")
echo "    $ME_RESP"
ok "session works"

step "Logging out"
LOGOUT_STATUS=$(curl -sS -b "$COOKIE_JAR" -X POST "$BFF/api/auth/logout" \
  -H "x-csrf-token: $CSRF_TOKEN" -o /dev/null -w "%{http_code}")
[ "$LOGOUT_STATUS" = "204" ] || fail "expected 204, got $LOGOUT_STATUS"
ok "logged out (204)"

step "Confirming revocation"
STATUS=$(curl -sS -b "$COOKIE_JAR" -o /dev/null -w "%{http_code}" "$BFF/api/auth/me")
[ "$STATUS" = "401" ] || fail "expected 401, got $STATUS"
ok "post-logout 401 confirmed"

echo
color "1;32" "All steps green. End-to-end auth flow works."
echo
