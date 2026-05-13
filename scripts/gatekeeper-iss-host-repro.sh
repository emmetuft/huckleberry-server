#!/usr/bin/env bash
# gatekeeper-iss-host-repro.sh
#
# Self-contained reproducer for the Gatekeeper team showing that:
#
#  1. A PKCE auth-code exchange against `domo-labs-dev.dev.domo.com` succeeds
#     and returns a well-formed access token with `iss=<that same host>`.
#  2. Presenting that token — minted seconds ago by the same host — to any
#     endpoint on that host returns 401 `iss.host does not match request host`,
#     including Gatekeeper's own `/oauth2/userinfo` (the canonical OIDC route
#     that runs RequestScopedIssuerValidator directly, no Heimdall in front).
#
# Endpoint sources:
#  - /oauth2/* and /oauth2/userinfo: Spring AS in Gatekeeper
#    (oauth-app/src/main/kotlin/.../OAuth2AuthorizationServerSecurityConfig.kt;
#     userinfo mount at line 654, validator at line 600).
#  - /api/content/v3/users/me, /api/identity/v1/users: huckleberry-server's
#    real BFF calls — src/identity/identity.service.ts L26, src/people/people.service.ts L10.
#  - /api/data/v3/datasources: huckleberry-server src/datasources/datasources.service.ts L20.
#  - /api/content/v1/cards/render: the canonical "protected resource call" in
#    ~/dev/gatekeeper/docs/PostmanCollection.json (item 7).
#
# The check we're tripping:
#  RequestScopedIssuerValidator.kt:49 compares URI(token.iss).host (case-insensitive)
#  against request.serverName. XDomoHostRequestFilter promotes heimdall's X-Domo-Host
#  header into serverName *inside Gatekeeper*. Heimdall is expected to do the equivalent
#  at the edge so it sees the public host instead of the internal pod hostname.
#
# Dependencies: bash, curl, openssl, jq, sed, awk.

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
# Accept bare code, "code=...&state=..." tail, or full callback URL — extract
# just the code value so the user doesn't have to be careful about copying.
if [[ "$AUTH_CODE_INPUT" == *"code="* ]]; then
  AUTH_CODE=$(printf '%s' "$AUTH_CODE_INPUT" | sed -E 's/.*[?&]code=([^&]*).*/\1/')
else
  AUTH_CODE="$AUTH_CODE_INPUT"
fi
# Strip anything past an unescaped & (defensive — covers raw paste of "code&state").
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
REFRESH_TOKEN=$(jq -r .refresh_token "$TOKEN_RESP")
EXPIRES_IN=$(jq -r .expires_in "$TOKEN_RESP")
SCOPE_GRANTED=$(jq -r .scope "$TOKEN_RESP")
echo "access_token   length=${#ACCESS_TOKEN} chars"
echo "refresh_token  length=${#REFRESH_TOKEN} chars"
echo "expires_in     ${EXPIRES_IN}s"
echo "scope          ${SCOPE_GRANTED}"

# -----------------------------------------------------------------------------
# Step 5 — Decode token claims
# -----------------------------------------------------------------------------
hr; bold "5. Decoded access-token claims (no signature verification)"
b64url_decode() {
  local s="$1"
  local m=$((${#s} % 4))
  case "$m" in
    2) s="${s}==" ;;
    3) s="${s}=" ;;
  esac
  printf '%s' "$s" | tr '_-' '/+' | openssl base64 -d -A 2>/dev/null
}
HEADER_JSON=$(b64url_decode "$(printf '%s' "$ACCESS_TOKEN" | cut -d. -f1)")
PAYLOAD_JSON=$(b64url_decode "$(printf '%s' "$ACCESS_TOKEN" | cut -d. -f2)")
echo "header  : $HEADER_JSON"
echo
echo "payload (selected claims):"
echo "$PAYLOAD_JSON" | jq '{iss, aud, sub, cid, iid, scope, iat, exp, jti}'

TOKEN_ISS=$(echo "$PAYLOAD_JSON" | jq -r .iss)
TOKEN_HOST=$(printf '%s' "$TOKEN_ISS" | sed -E 's|^https?://||; s|/.*$||')

# -----------------------------------------------------------------------------
# Step 6 — Host comparison
# -----------------------------------------------------------------------------
hr; bold "6. Hostname comparison (the value RequestScopedIssuerValidator checks)"
ISSUER_HOST=$(printf '%s' "$ISSUER" | sed -E 's|^https?://||; s|/.*$||')
echo "token.iss                  = $TOKEN_ISS"
echo "URI(token.iss).host        = $TOKEN_HOST"
echo "request URL scheme+host    = $ISSUER"
echo "request URL host (sent)    = $ISSUER_HOST"
if [[ "$TOKEN_HOST" == "$ISSUER_HOST" ]]; then
  echo "→ token.iss.host == request URL host (byte-equal, case-insensitive ✓)"
else
  echo "→ MISMATCH at the URL level — would explain the rejection"
fi
echo
echo "Notes:"
echo "  - Gatekeeper compares against request.serverName, which is normally promoted"
echo "    from X-Domo-Host by XDomoHostRequestFilter (HIGHEST_PRECEDENCE)."
echo "  - For /oauth2/userinfo: filter runs inside Gatekeeper → serverName should match."
echo "  - For /api/*: Heimdall runs the same check at the edge — if Heimdall doesn't"
echo "    honor X-Domo-Host (or sees a different Host header), the check fails."
echo

# -----------------------------------------------------------------------------
# Step 7 — Endpoint probes (no extra headers)
# -----------------------------------------------------------------------------
hr; bold "7. Probe endpoints with bare Authorization: Bearer header"

probe() {
  local label="$1"
  local path="$2"
  shift 2
  local url="${ISSUER}${path}"
  local out; out=$(mktemp)
  local code
  code=$(curl -sS -o "$out" -w "%{http_code}" --http1.1 \
    "$url" -H "Authorization: Bearer ${ACCESS_TOKEN}" "$@")
  local body; body=$(head -c 300 "$out"); rm -f "$out"
  printf '  %-44s  HTTP %s  body=%s\n' "$label $path" "$code" "$body"
}

# Gatekeeper-served (runs RequestScopedIssuerValidator directly)
# Note: /oauth2/userinfo requires the `openid` scope (OIDC). The client used
# here (dcr-983ea7e5-...) isn't registered with openid, so we skip it. Add
# openid to the client's allowed scopes if you want to include this probe.

# Heimdall-routed BFF calls (real paths used in huckleberry-server)
probe "[BFF identity.service     GET]" "/api/content/v3/users/me"
probe "[BFF people.service       GET]" "/api/identity/v1/users"
probe "[BFF datasources.service  GET]" "/api/data/v3/datasources?offset=0&limit=1"

# Postman collection canonical sample (PostmanCollection.json item 7)
probe "[Postman canonical sample GET]" "/api/content/v1/cards/render"

# -----------------------------------------------------------------------------
# Step 8 — Same probes WITH explicit X-Domo-Host header
# -----------------------------------------------------------------------------
hr; bold "8. Same probes with X-Domo-Host: ${ISSUER_HOST}"
echo "(Tests whether sending the header that XDomoHostRequestFilter promotes"
echo " changes anything — Magma normally sets this between proxy and Gatekeeper.)"
echo

probe "[BFF identity.service     GET]" "/api/content/v3/users/me"      -H "X-Domo-Host: ${ISSUER_HOST}"
probe "[BFF people.service       GET]" "/api/identity/v1/users"        -H "X-Domo-Host: ${ISSUER_HOST}"
probe "[BFF datasources.service  GET]" "/api/data/v3/datasources?offset=0&limit=1" -H "X-Domo-Host: ${ISSUER_HOST}"

rm -f "$TOKEN_RESP"
hr
bold "Done."
echo "Every endpoint should fail with the same iss.host rejection even though"
echo "token.iss.host and the public request URL host are byte-equal. The check"
echo "that's failing is RequestScopedIssuerValidator.kt:49 comparing"
echo "URI(token.iss).host vs request.serverName — and request.serverName is"
echo "the internal pod hostname because something between the edge and"
echo "Gatekeeper isn't promoting X-Domo-Host the way XDomoHostRequestFilter expects."
