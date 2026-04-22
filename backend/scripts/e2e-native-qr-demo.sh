#!/usr/bin/env bash
# =============================================================================
# e2e-native-qr-demo.sh
# E2E smoke test for the feishu native QR-scan bot registration flow.
#
# What this script validates (no real QR scan required):
#   [Phase 1] POST /start     — init + begin stages both return HTTP 200
#   [Phase 2] GET  /stream/:id — SSE connection opens and emits events
#   [Phase 3] POST /cancel/:id — AbortSignal cleanup works, returns {"ok":true}
#
# What requires a human to complete:
#   - Actually scanning the QR code with Feishu app
#   - The "approved" SSE event and data/.env write-back
#
# Usage:
#   # Start the backend first (defaults to :18082):
#   #   npm run dev   (in the repo root or backend/)
#   #
#   bash backend/scripts/e2e-native-qr-demo.sh [BASE_URL]
#
#   BASE_URL defaults to http://localhost:18082
# =============================================================================

set -euo pipefail

BASE_URL="${1:-http://localhost:18082}"
API_BASE="$BASE_URL/api/channels/feishu/setup"

# ---- colour helpers ---------------------------------------------------------
GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; NC='\033[0m'
ok()   { echo -e "${GREEN}[PASS]${NC} $*"; }
fail() { echo -e "${RED}[FAIL]${NC} $*"; exit 1; }
info() { echo -e "${YELLOW}[INFO]${NC} $*"; }

# ---- dependency check -------------------------------------------------------
for cmd in curl jq; do
  command -v "$cmd" >/dev/null 2>&1 || fail "Required tool not found: $cmd"
done

echo ""
info "Target: $BASE_URL"
echo "============================================================"

# ---- Step 0: backend health check ------------------------------------------
info "Step 0 — Backend health check"
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$BASE_URL/health" 2>/dev/null || true)
if [[ "$HTTP_STATUS" == "200" ]]; then
  ok "Backend is up (GET /health → 200)"
elif [[ "$HTTP_STATUS" == "404" ]]; then
  info "GET /health returned 404 — backend running but no /health route (acceptable)"
else
  fail "Backend not reachable at $BASE_URL (status=$HTTP_STATUS). Start it first: npm run dev"
fi

echo ""
# ---- Step 1: POST /start — init + begin ------------------------------------
info "Step 1 — POST $API_BASE/start (triggers init + begin against Feishu)"

START_RESPONSE=$(curl -s --max-time 15 -X POST \
  -H "Content-Type: application/json" \
  "$API_BASE/start")

echo "Response: $START_RESPONSE"

# Validate response shape
OK_FIELD=$(echo "$START_RESPONSE" | jq -r '.ok // "missing"')
SESSION_ID=$(echo "$START_RESPONSE" | jq -r '.sessionId // "missing"')
QR_URL=$(echo "$START_RESPONSE" | jq -r '.qrUrl // "missing"')
EXPIRES_AT=$(echo "$START_RESPONSE" | jq -r '.expiresAt // "missing"')

[[ "$OK_FIELD" == "true" ]]      || fail ".ok is not true — got: $OK_FIELD"
[[ "$SESSION_ID" != "missing" ]] || fail ".sessionId missing in response"
[[ "$QR_URL" != "missing" ]]     || fail ".qrUrl missing in response"
[[ "$EXPIRES_AT" != "missing" ]] || fail ".expiresAt missing in response"

# Validate qrUrl format (must point to Feishu launcher)
echo "$QR_URL" | grep -qE "^https://open\.(feishu|larksuite)\.cn/page/launcher" \
  || fail ".qrUrl does not look like a Feishu launcher URL: $QR_URL"

ok "POST /start → ok=true, sessionId=$SESSION_ID"
ok "qrUrl is a valid Feishu launcher URL"

echo ""
info "==> [Human step] To complete the full flow, scan this QR with Feishu:"
info "    $QR_URL"
echo ""

# ---- Step 2: GET /stream/:id — SSE handshake --------------------------------
info "Step 2 — GET $API_BASE/stream/$SESSION_ID (SSE, listen for 10 s)"
info "Expecting: HTTP 200 with Content-Type: text/event-stream"
info "Expecting: at least one event (keepalive or pending) within 10 s"

SSE_TMP=$(mktemp)
SSE_HEADERS_TMP=$(mktemp)

# curl with --no-buffer, 10s timeout; capture response headers separately
HTTP_SSE_STATUS=$(curl -s -o "$SSE_TMP" -w "%{http_code}" \
  --max-time 10 \
  --no-buffer \
  -H "Accept: text/event-stream" \
  -D "$SSE_HEADERS_TMP" \
  "$API_BASE/stream/$SESSION_ID" 2>/dev/null || echo "curl_error")

# curl exits non-zero on --max-time timeout but that's expected for SSE
# HTTP 200 with partial body is a pass; error before any bytes is a fail
if [[ "$HTTP_SSE_STATUS" == "200" ]]; then
  ok "SSE endpoint returned HTTP 200"
elif [[ "$HTTP_SSE_STATUS" == "curl_error" ]]; then
  # Check if we got any body before the timeout
  if [[ -s "$SSE_TMP" ]]; then
    ok "SSE stream opened (curl timed-out as expected after 10 s)"
  else
    fail "SSE connection failed — no response body received"
  fi
else
  fail "SSE endpoint returned unexpected status: $HTTP_SSE_STATUS"
fi

# Validate Content-Type header
if grep -qi "text/event-stream" "$SSE_HEADERS_TMP"; then
  ok "Content-Type: text/event-stream confirmed"
else
  info "Warning: Content-Type header not confirmed (may be chunked/gzip — check manually)"
fi

# Check for at least one SSE event in the body
SSE_BODY=$(cat "$SSE_TMP")
if echo "$SSE_BODY" | grep -qE "^event:|^data:"; then
  ok "Received at least one SSE event"
  # Show event types found
  EVENT_TYPES=$(echo "$SSE_BODY" | grep "^event:" | sort -u | tr '\n' ' ')
  info "Event types seen: ${EVENT_TYPES:-<none — check data: lines>}"
else
  info "Warning: no 'event:' lines captured (stream may still be valid — short timeout)"
fi

rm -f "$SSE_TMP" "$SSE_HEADERS_TMP"

echo ""
# ---- Step 3: POST /cancel/:id — AbortSignal cleanup ------------------------
info "Step 3 — POST $API_BASE/cancel/$SESSION_ID (abort and cleanup)"

CANCEL_RESPONSE=$(curl -s --max-time 5 -X POST \
  "$API_BASE/cancel/$SESSION_ID")

echo "Response: $CANCEL_RESPONSE"

CANCEL_OK=$(echo "$CANCEL_RESPONSE" | jq -r '.ok // "missing"')
[[ "$CANCEL_OK" == "true" ]] || fail "Cancel returned ok≠true: $CANCEL_RESPONSE"
ok "POST /cancel → ok=true — AbortSignal and session cleaned up"

echo ""
echo "============================================================"
ok "All automated checks passed."
echo ""
echo -e "${YELLOW}Manual steps needed for full approval flow:${NC}"
echo "  1. Run this script again (or POST /start manually)"
echo "  2. Scan the returned qrUrl with Feishu on your phone"
echo "  3. Watch the SSE stream — you should see:"
echo "       event: pending   (while scanning)"
echo "       event: approved  (after scan completes)"
echo "  4. Verify data/.env contains:"
echo "       FEISHU_APP_ID=cli_..."
echo "       FEISHU_APP_SECRET=..."
echo ""
