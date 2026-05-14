#!/usr/bin/env bash
# gatekeeper-scope-repro.sh
#
# Smoke test for the huckleberry-server <-> Gatekeeper integration:
#
#  1. Generate a PKCE pair, walk the operator through the authorize URL,
#     and exchange the auth code for tokens at /oauth2/token.
#  2. Decode the access token's `scope` claim so the operator can see
#     what each downstream call should have been authorized for.
#  3. Probe each downstream Domo API endpoint huckleberry-server's BFF
#     calls in production, annotated with the scope the canonical
#     endpoint-scope audit (~/Downloads/endpoint_scope_audit.xlsx)
#     assigns the path.
#
# Probes are GETs without path params or POSTs with minimal bodies so
# the script can run end-to-end without operator input after step 3.
# Each row prints `HTTP <code>  body=<first 200 chars>` — read top to
# bottom to spot which endpoints are healthy.
#
# Dependencies: bash, curl, openssl, jq, sed.

set -euo pipefail

ISSUER="${ISSUER:-https://domo-labs-dev.dev.domo.com}"
CLIENT_ID="${CLIENT_ID:-dcr-983ea7e5-0984-4c01-8062-defdb24f858e}"
REDIRECT_URI="${REDIRECT_URI:-http://localhost:3000/api/auth/domo/callback}"
SCOPES="${SCOPES:-ai:read ai:execute content:meta:read content:data:read dataset:meta:read dataset:data:read identity:read search:read}"

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
hr() { printf '%s\n' "------------------------------------------------------------"; }

# -----------------------------------------------------------------------------
# Step 1 — Generate PKCE pair
# -----------------------------------------------------------------------------
hr; bold "1. Generate PKCE verifier + challenge"
CODE_VERIFIER=$(openssl rand 32 | base64 | tr '+/' '-_' | tr -d '=' | head -c 43)
CODE_CHALLENGE=$(printf '%s' "$CODE_VERIFIER" | openssl dgst -sha256 -binary | base64 | tr '+/' '-_' | tr -d '=')
STATE=$(openssl rand 16 | base64 | tr '+/' '-_' | tr -d '=' | head -c 16)
echo "code_verifier  = $CODE_VERIFIER"
echo "code_challenge = $CODE_CHALLENGE   (= SHA-256(verifier), base64url)"
echo "state          = $STATE"

# -----------------------------------------------------------------------------
# Step 2 — Print authorize URL
# -----------------------------------------------------------------------------
hr; bold "2. Authorize URL"
SCOPES_ENC=$(printf '%s' "$SCOPES" | sed 's/ /%20/g')
REDIRECT_ENC=$(printf '%s' "$REDIRECT_URI" | sed 's|:|%3A|g; s|/|%2F|g')
AUTH_URL="${ISSUER}/oauth2/authorize?response_type=code&client_id=${CLIENT_ID}&redirect_uri=${REDIRECT_ENC}&scope=${SCOPES_ENC}&state=${STATE}&code_challenge=${CODE_CHALLENGE}&code_challenge_method=S256"
echo "$AUTH_URL"
echo
echo "Before opening this URL: STOP any process bound to localhost:3000"
echo "(your local BFF will eat the callback). After consent the browser will"
echo "show 'connection refused' on localhost:3000 — copy the ?code= value"
echo "from the URL bar."
echo

# -----------------------------------------------------------------------------
# Step 3 — Prompt for the code
# -----------------------------------------------------------------------------
hr; bold "3. Paste the auth code from the callback URL"
read -r -p "code> " AUTH_CODE_INPUT
# Accept bare code, "code=...&state=..." tail, or full callback URL.
if [[ "$AUTH_CODE_INPUT" == *"code="* ]]; then
  AUTH_CODE=$(printf '%s' "$AUTH_CODE_INPUT" | sed -E 's/.*[?&]code=([^&]*).*/\1/')
else
  AUTH_CODE="$AUTH_CODE_INPUT"
fi
AUTH_CODE="${AUTH_CODE%%&*}"
if [[ -z "$AUTH_CODE" ]]; then
  echo "No code provided. Aborting." >&2
  exit 1
fi
echo "parsed code: $AUTH_CODE"

# -----------------------------------------------------------------------------
# Step 4 — Exchange code for token
# -----------------------------------------------------------------------------
hr; bold "4. POST ${ISSUER}/oauth2/token"
TOKEN_RESP=$(mktemp)
HTTP_CODE=$(curl -sS -o "$TOKEN_RESP" -w "%{http_code}" --http1.1 \
  -X POST "${ISSUER}/oauth2/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "grant_type=authorization_code" \
  --data-urlencode "code=${AUTH_CODE}" \
  --data-urlencode "redirect_uri=${REDIRECT_URI}" \
  --data-urlencode "client_id=${CLIENT_ID}" \
  --data-urlencode "code_verifier=${CODE_VERIFIER}")
echo "HTTP $HTTP_CODE"
if [[ "$HTTP_CODE" != "200" ]]; then
  echo "Exchange failed:"; cat "$TOKEN_RESP"; echo
  rm -f "$TOKEN_RESP"; exit 1
fi
ACCESS_TOKEN=$(jq -r .access_token "$TOKEN_RESP")
EXPIRES_IN=$(jq -r .expires_in "$TOKEN_RESP")
SCOPE_GRANTED=$(jq -r .scope "$TOKEN_RESP")
echo "access_token   length=${#ACCESS_TOKEN} chars"
echo "expires_in     ${EXPIRES_IN}s"
echo "scope (granted, space-separated)"
echo "  ${SCOPE_GRANTED}"

# -----------------------------------------------------------------------------
# Step 5 — Decode token's scope claim (the value the server enforces)
# -----------------------------------------------------------------------------
hr; bold "5. Decoded scope claim from the access token"
b64url_decode() {
  local s="$1"
  local m=$((${#s} % 4))
  case "$m" in
    2) s="${s}==" ;;
    3) s="${s}=" ;;
  esac
  printf '%s' "$s" | tr '_-' '/+' | openssl base64 -d -A 2>/dev/null
}
PAYLOAD_JSON=$(b64url_decode "$(printf '%s' "$ACCESS_TOKEN" | cut -d. -f2)")
echo "$PAYLOAD_JSON" | jq '{sub, cid, aud, iss, scope, exp}'

# -----------------------------------------------------------------------------
# Step 6 — Probe endpoints
# -----------------------------------------------------------------------------
hr; bold "6. Endpoint smoke test (scopes per endpoint_scope_audit.xlsx)"

probe() {
  local label="$1"
  local method="$2"
  local path="$3"
  local url="${ISSUER}${path}"
  local out; out=$(mktemp)
  local code
  code=$(curl -sS -o "$out" -w "%{http_code}" --http1.1 \
    -X "$method" "$url" -H "Authorization: Bearer ${ACCESS_TOKEN}")
  local body; body=$(head -c 200 "$out"); rm -f "$out"
  printf '  %-50s  %s %s  HTTP %s  body=%s\n' \
    "$label" "$method" "$path" "$code" "$body"
}

# Endpoints are sourced from the canonical scope audit
# (~/Downloads/endpoint_scope_audit.xlsx) — each call below is annotated
# with the scope the audit assigns the path. Entries marked "(not in
# audit)" are paths the BFF code calls today but which don't appear in
# the audit at all — these are the ones most likely to need a Gatekeeper-
# side route mapping or a BFF-side path correction.

# Identity / users
probe "identity.service           content:meta:read"  GET "/api/content/v3/users/me"
probe "people.service.getUsers    (not in audit)   "  GET "/api/identity/v1/users"

# Groups (identity-domain data on a content-domain URL — content:meta:read per audit)
probe "people.service.getGroups   content:meta:read"  GET "/api/content/v2/groups/grouplist?ascending=true&limit=1"

# Datasets
probe "datasources.service.list   dataset:meta:read"  GET "/api/data/v3/datasources?offset=0&limit=1"

# AI / agents / toolkits / sessions
probe "toolkits.service           ai:read          "  GET "/api/ai/v1/toolkits"

rm -f "$TOKEN_RESP"
hr
bold "Done."
