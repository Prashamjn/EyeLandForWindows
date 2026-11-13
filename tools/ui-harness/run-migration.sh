#!/usr/bin/env bash
# Scenarios 05 and 09 need a seeded settings file (see their headers). This runs them with the documented seeds, including
# an old (Phase 1) file, a fresh install and a user-chosen offset. Usage: tools/ui-harness/run-migration.sh
cd "$(dirname "$0")/../.." || exit 1
export LI_NATIVE_MOCK=$PWD/tools/ui-harness/mock-native; CTL=$(mktemp -d); for n in audio net bt power; do : > "$CTL/$n.ctl"; done; export LI_MOCK_CTL=$CTL
fail=0
run() { out=$(LI_SCRIPT=$PWD/tools/ui-harness/scenarios/$1.js LI_OUT=/tmp/shots-m timeout 120 xvfb-run -a -s "-screen 0 1920x1080x24" npx electron --no-sandbox --disable-gpu tools/ui-harness/run.js 2>&1); echo "$out" | grep -E '\[TEST\]|SCRIPT ERROR' | cut -c1-200; grep -q 'FAIL\|SCRIPT ERROR' <<<"$out" && fail=1; }
echo "== 05 legacy settings + bottom position"; LI_SETTINGS='{"theme":"graphite","position":"bottom","offsetY":0,"eyeColor":"#ff0000","todos":[{"id":"a","text":"Buy milk","done":false},{"id":"b","text":"Call Sam","done":false}]}' run 05-legacy-settings-bottom
echo "== 09 old file (offsetY 6 migrates to 10)"; LI_SETTINGS='{"offsetY":6,"theme":"graphite"}' LI_EXPECT='{"offsetY":10,"migrated":true,"keep":{"theme":"graphite"}}' run 09-settings-migration
echo "== 09 fresh install"; LI_EXPECT='{"offsetY":10}' run 09-settings-migration
echo "== 09 user-chosen offset is kept"; LI_SETTINGS='{"offsetY":24,"settingsVersion":2}' LI_EXPECT='{"offsetY":24}' run 09-settings-migration
exit $fail
