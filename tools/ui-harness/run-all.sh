#!/usr/bin/env bash
# Runs every scenario (or the ones named) under Xvfb and prints a summary. Usage: tools/ui-harness/run-all.sh [scenario-prefix ...]
cd "$(dirname "$0")/../.." || exit 1
export LI_NATIVE_MOCK=$PWD/tools/ui-harness/mock-native OUT=${OUT:-/tmp/li-shots}
CTL=$(mktemp -d); for n in audio net bt power; do : > "$CTL/$n.ctl"; done; export LI_MOCK_CTL=$CTL
want=("$@"); [ ${#want[@]} -eq 0 ] && want=("")
pass=0; fail=0
for f in tools/ui-harness/scenarios/*.js; do
  b=$(basename "$f"); ok=0; for w in "${want[@]}"; do [[ "$b" == $w* ]] && ok=1; done; [ $ok -eq 0 ] && continue
  out=$(LI_SCRIPT=$PWD/$f LI_OUT=$OUT/${b%.js} timeout 180 xvfb-run -a -s "-screen 0 1280x800x24" npx electron --no-sandbox --disable-gpu tools/ui-harness/run.js 2>&1)
  p=$(grep -c '\[TEST\] PASS' <<<"$out"); x=$(grep -c '\[TEST\] FAIL' <<<"$out"); e=$(grep -c 'SCRIPT ERROR' <<<"$out")
  pass=$((pass+p)); fail=$((fail+x+e)); printf '%-44s pass=%-3s fail=%-3s err=%s\n' "$b" "$p" "$x" "$e"
  grep -E '\[TEST\] FAIL|SCRIPT ERROR|\[renderer:[23]\]' <<<"$out" | head -30 | sed 's/^/    /'
done
echo "TOTAL pass=$pass fail=$fail"; [ $fail -eq 0 ]
