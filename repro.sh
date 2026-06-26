#!/usr/bin/env bash
# End-to-end HTTP reproduction.
#
# Runs the built app in minimal mode (what Vercel runs) and sends a PPR resume
# request (POST + `next-resume: 1` + `x-matched-path`) whose body is gzip-encoded
# — the way the body arrives on Vercel. Next reads it with body.toString("utf8")
# WITHOUT decompressing, so parsePostponedState throws "invalid postponed state".
# A second request sends the SAME state uncompressed as a control.
set -u
PORT=3123
URL="http://localhost:$PORT"
LOG="$(mktemp)"
STATE='4:null'   # a valid postponed-state string

[ -d .next ] || { echo "Run 'npm run build' first."; exit 1; }

echo "Starting server in minimal mode (NEXT_PRIVATE_MINIMAL_MODE=1)…"
NEXT_PRIVATE_MINIMAL_MODE=1 PORT=$PORT npx next start -p $PORT >"$LOG" 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null' EXIT
for i in $(seq 1 30); do curl -s -o /dev/null "$URL/" && break; sleep 1; done

printf '%s' "$STATE" | gzip >/tmp/state.gz

echo
echo "=== A) resume with GZIP body (Vercel-style) — expect the bug ==="
curl -s -o /dev/null -w "HTTP %{http_code}\n" -X POST "$URL/" \
  -H 'next-resume: 1' -H 'x-matched-path: /' -H 'content-encoding: gzip' \
  --data-binary @/tmp/state.gz

echo
echo "=== B) resume with UNCOMPRESSED body (control) — should NOT throw the gzip error ==="
curl -s -o /dev/null -w "HTTP %{http_code}\n" -X POST "$URL/" \
  -H 'next-resume: 1' -H 'x-matched-path: /' \
  --data-binary "$STATE"

sleep 1
echo
echo "=== server log: 'invalid postponed state' occurrences ==="
grep -c "invalid postponed state" "$LOG" | xargs echo "count:"
grep -m1 "invalid postponed state" "$LOG" | cut -c1-90
echo "(full server log: $LOG)"
