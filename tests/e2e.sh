#!/usr/bin/env bash
# End-to-end smoke test driven through the real UI with playwright-cli,
# using the mock AI provider (zero cost, no keys).
#
# Usage:  bash tests/e2e.sh [base-url]     (default http://localhost:8765)
set -u
BASE_URL="${1:-http://localhost:8765}"
SESSION="photoslop-e2e"
DIR="$(cd "$(dirname "$0")" && pwd)"
PASS=0
FAIL=0

pw() { playwright-cli -s="$SESSION" "$@"; }
evalr() { pw --raw eval "$1"; }

check() { # check <name> <actual> <expected-substring>
  local name="$1" actual="$2" expected="$3"
  if [[ "$actual" == *"$expected"* ]]; then
    echo "  ok  $name"
    PASS=$((PASS+1))
  else
    echo "FAIL  $name"
    echo "      expected: *$expected*"
    echo "      actual:   $actual"
    FAIL=$((FAIL+1))
  fi
}

# Test image: 640x400 gradient with a red 100..200 square landmark.
python3 - "$DIR/fixture.png" <<'EOF'
import sys, zlib, struct
def chunk(t, d):
    c = struct.pack('>I', len(d)) + t + d
    return c + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
w, h = 640, 400
raw = b''
for y in range(h):
    raw += b'\x00'
    for x in range(w):
        raw += bytes((220, 40, 40) if 100 <= x < 200 and 100 <= y < 200
                     else (x * 255 // w, y * 255 // h, 128))
ihdr = struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)
open(sys.argv[1], 'wb').write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr)
    + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b''))
EOF

echo "== boot =="
pw open "$BASE_URL" >/dev/null 2>&1
pw localstorage-set photoslop.settings.v1 '{"openaiKey":"","geminiKey":"","mock":true}' >/dev/null 2>&1
pw reload >/dev/null 2>&1
sleep 1
pw drop "#canvas-area" --path="$DIR/fixture.png" >/dev/null 2>&1
sleep 1.2
check "open 640x400" "$(evalr 'JSON.stringify([psDoc.width, psDoc.height])')" '[640,400]'

echo "== crop + undo =="
pw press c >/dev/null 2>&1; sleep 0.3
pw click "text=Apply crop" >/dev/null 2>&1; sleep 0.8
check "crop 90%" "$(evalr 'JSON.stringify([psDoc.width, psDoc.height])')" '[576,360]'
pw press "Control+z" >/dev/null 2>&1; sleep 0.8
check "undo restores" "$(evalr 'JSON.stringify([psDoc.width, psDoc.height])')" '[640,400]'

echo "== rotate 90 =="
pw press r >/dev/null 2>&1; sleep 0.3
pw click "text=90° CW" >/dev/null 2>&1; sleep 0.8
check "rotate CW" "$(evalr 'JSON.stringify([psDoc.width, psDoc.height])')" '[400,640]'
pw press "Control+z" >/dev/null 2>&1; sleep 0.8

echo "== heal invariant (mock) =="
pw press j >/dev/null 2>&1; sleep 0.3
evalr '(() => { const c = psDoc.baseCanvas.getContext("2d"); window.__b = {out:[...c.getImageData(500,100,1,1).data]}; return "saved"; })()' >/dev/null
pw mousemove 380 300 >/dev/null 2>&1; pw mousedown >/dev/null 2>&1
pw mousemove 420 330 >/dev/null 2>&1; pw mouseup >/dev/null 2>&1; sleep 0.3
pw click "text=Generate fill" >/dev/null 2>&1; sleep 4
pw click "#candidates-body .candidate:first-child" >/dev/null 2>&1; sleep 1
check "outside mask byte-identical" "$(evalr '
(() => { const c = psDoc.baseCanvas.getContext("2d");
  return JSON.stringify([...c.getImageData(500,100,1,1).data]) === JSON.stringify(window.__b.out) ? "SAME" : "DIFFERENT"; })()')" 'SAME'
pw press "Control+z" >/dev/null 2>&1; sleep 0.8

echo "== generative expand (mock) =="
pw press x >/dev/null 2>&1; sleep 0.4
pw click "text=⇲ Expand" >/dev/null 2>&1; sleep 4
pw click "#candidates-body .candidate:first-child" >/dev/null 2>&1; sleep 1.2
check "expanded to 16:9" "$(evalr 'JSON.stringify([psDoc.width, psDoc.height])')" '[711,400]'
check "original preserved after expand" "$(evalr 'JSON.stringify([...psDoc.baseCanvas.getContext("2d").getImageData(185,150,1,1).data])')" '[220,40,40,255]'
pw press "Control+z" >/dev/null 2>&1; sleep 0.8

echo "== background removal (mock) =="
pw press k >/dev/null 2>&1; sleep 0.3
pw click "text=☒ Remove background" >/dev/null 2>&1; sleep 2.5
pw click "text=/^Apply$/" >/dev/null 2>&1; sleep 1
check "corner transparent" "$(evalr 'JSON.stringify([...psDoc.baseCanvas.getContext("2d").getImageData(20,20,1,1).data])')" '[0,0,0,0]'
check "subject original pixels" "$(evalr 'JSON.stringify([...psDoc.baseCanvas.getContext("2d").getImageData(320,200,1,1).data])')" '[127,127,128,255]'

echo "== export flatten: JPEG flattens transparency to white =="
check "jpeg white composite" "$(evalr '
(() => {
  const flat = psDoc.flatten();
  const white = document.createElement("canvas");
  white.width = flat.width; white.height = flat.height;
  const ctx = white.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0,0,white.width,white.height);
  ctx.drawImage(flat, 0, 0);
  return JSON.stringify([...ctx.getImageData(20,20,1,1).data]);
})()')" '[255,255,255,255]'

pw close >/dev/null 2>&1
echo
echo "passed: $PASS  failed: $FAIL"
[[ $FAIL -eq 0 ]]
