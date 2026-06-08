#!/bin/bash
# Container startup script.
#
# Problem: Chromium's DevTools HTTP server checks that connections
#          come from 127.0.0.1. On Docker Desktop (Windows/Mac), the
#          host's connection arrives via Docker's NAT gateway, which
#          is NOT 127.0.0.1 inside the container → Chromium closes it.
#
# Fix: see docs/ARCHITECTURE.md §4.1
#   Start Chromium on internal port 9223 (loopback only).
#   Run socat to proxy port 9222 → 127.0.0.1:9223.
#   From Chromium's view, all CDP clients are 127.0.0.1. ✓

set -e

# Start Xvfb (virtual display) so Chrome runs in headed mode — undetectable as headless
Xvfb :99 -screen 0 1280x720x24 -ac -nolisten tcp &
export DISPLAY=:99
sleep 0.5

# Start Chromium in background on internal port (NOT headless — uses Xvfb instead)
chromium \
  --remote-debugging-port=9223 \
  --remote-debugging-address=127.0.0.1 \
  --no-sandbox \
  --disable-dev-shm-usage \
  --disable-gpu \
  --window-size=1280,720 \
  --user-data-dir=/home/chromium/data \
  --disable-blink-features=AutomationControlled \
  --disable-features=Translate \
  --disable-infobars \
  --lang=en-US,en \
  --user-agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36" \
  --start-maximized \
  &

CHROMIUM_PID=$!
echo "Chromium PID: $CHROMIUM_PID"

# Wait for Chromium to open its debug port (loopback, no host check issue)
echo "Waiting for Chromium DevTools on 127.0.0.1:9223..."
for i in $(seq 1 20); do
  if curl -sf http://127.0.0.1:9223/json/version > /dev/null 2>&1; then
    echo "Chromium ready after ${i} attempts"
    break
  fi
  sleep 0.2
done

# socat: Listen on 0.0.0.0:9222 (the published port), forward to Chromium loopback
# All forwarded connections appear to Chromium as coming from 127.0.0.1 ✓
echo "Starting socat proxy 0.0.0.0:9222 -> 127.0.0.1:9223"
exec socat TCP-LISTEN:9222,fork,reuseaddr TCP:127.0.0.1:9223
