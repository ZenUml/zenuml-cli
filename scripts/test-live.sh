#!/bin/bash
set -euo pipefail

# Read-only verification helper for the Confluence diagram CLI.
#
# Credentials default to ~/.atlassian_auth.json, and env vars override file values.
# Expected auth file shape:
# {
#   "email": "you@example.com",
#   "apiToken": "your-api-token",
#   "site": "https://whimet4.atlassian.net"
# }
#
# Optional environment variables:
#   ZENUML_CLI_SITE        (default: https://whimet4.atlassian.net)
#   ZENUML_CLI_EMAIL       (overrides auth file)
#   ZENUML_CLI_API_TOKEN   (overrides auth file)
#   ATLASSIAN_AUTH_FILE    (default: ~/.atlassian_auth.json)
#   CLI_TEST_VARIANTS      (default: "auto")
#   CLI_TEST_ADDON_KEY     (optional, skips auto-detection)
#   RUN_WRITE_TESTS        (set to 1 to enable create/update/delete flow)
#   CLI_TEST_PAGE_ID       (required only when RUN_WRITE_TESTS=1)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
AUTH_FILE="${ATLASSIAN_AUTH_FILE:-$HOME/.atlassian_auth.json}"

load_auth_field() {
  local field="$1"
  python3 - <<'PY' "$AUTH_FILE" "$field"
import json
import sys
from pathlib import Path

path = Path(sys.argv[1]).expanduser()
field = sys.argv[2]

if not path.exists():
    print("")
    raise SystemExit(0)

with path.open("r", encoding="utf-8") as handle:
    data = json.load(handle)

value = data.get(field, "")
print("" if value is None else value)
PY
}

if [ -z "${ZENUML_CLI_EMAIL:-}" ]; then
  export ZENUML_CLI_EMAIL="$(load_auth_field email)"
fi

if [ -z "${ZENUML_CLI_API_TOKEN:-}" ]; then
  export ZENUML_CLI_API_TOKEN="$(load_auth_field apiToken)"
fi

if [ -z "${ZENUML_CLI_SITE:-}" ]; then
  export ZENUML_CLI_SITE="$(load_auth_field site)"
fi

export ZENUML_CLI_SITE="${ZENUML_CLI_SITE:-https://whimet4.atlassian.net}"

if [ -z "${ZENUML_CLI_EMAIL:-}" ]; then
  echo "Missing ZENUML_CLI_EMAIL. Set it directly or add \"email\" to $AUTH_FILE"
  exit 1
fi

if [ -z "${ZENUML_CLI_API_TOKEN:-}" ]; then
  echo "Missing ZENUML_CLI_API_TOKEN. Set it directly or add \"apiToken\" to $AUTH_FILE"
  exit 1
fi

VARIANTS="${CLI_TEST_VARIANTS:-auto}"
CLI_CMD=(node "$REPO_ROOT/dist/index.js")

run_cli() {
  echo ""
  echo "+ ${CLI_CMD[*]} $*"
  "${CLI_CMD[@]}" "$@"
}

echo "Building CLI..."
(
  cd "$REPO_ROOT"
  pnpm build
)

echo ""
echo "=== Auth check ==="
run_cli auth whoami

echo ""
echo "=== Read-only diagram listing ==="
for variant in $VARIANTS; do
  echo ""
  echo "--- Variant: $variant ---"
  if [ -n "${CLI_TEST_ADDON_KEY:-}" ]; then
    run_cli diagram list --format json --limit 10 --addon-key "$CLI_TEST_ADDON_KEY"
  else
    run_cli diagram list --format json --limit 10
  fi
done

if [ "${RUN_WRITE_TESTS:-0}" != "1" ]; then
  echo ""
  echo "Skipping write tests. Set RUN_WRITE_TESTS=1 and CLI_TEST_PAGE_ID=<page id> to test create/update/delete."
  exit 0
fi

if [ -z "${CLI_TEST_PAGE_ID:-}" ]; then
  echo "RUN_WRITE_TESTS=1 requires CLI_TEST_PAGE_ID"
  exit 1
fi

TEMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$TEMP_DIR"
}
trap cleanup EXIT

CREATE_FILE="$TEMP_DIR/create-sequence.txt"
UPDATE_FILE="$TEMP_DIR/update-sequence.txt"
CREATE_OUTPUT="$TEMP_DIR/create-output.json"

cat >"$CREATE_FILE" <<'EOF'
Alice->Bob: CLI smoke test
EOF

cat >"$UPDATE_FILE" <<'EOF'
Alice->Bob: CLI smoke test updated
EOF

echo ""
echo "=== Write tests ==="
if [ -n "${CLI_TEST_ADDON_KEY:-}" ]; then
  run_cli diagram create \
    --page "$CLI_TEST_PAGE_ID" \
    --type sequence \
    --title "CLI smoke test $(date +%s)" \
    --file "$CREATE_FILE" \
    --addon-key "$CLI_TEST_ADDON_KEY" >"$CREATE_OUTPUT"
else
  run_cli diagram create \
    --page "$CLI_TEST_PAGE_ID" \
    --type sequence \
    --title "CLI smoke test $(date +%s)" \
    --file "$CREATE_FILE" >"$CREATE_OUTPUT"
fi

CREATED_ID="$(python - <<'PY' "$CREATE_OUTPUT"
import json
import sys
with open(sys.argv[1], "r", encoding="utf-8") as handle:
    data = json.load(handle)
print(data["id"])
PY
)"

echo "Created diagram id: $CREATED_ID"

if [ -n "${CLI_TEST_ADDON_KEY:-}" ]; then
  run_cli diagram update "$CREATED_ID" \
    --type sequence \
    --title "CLI smoke test updated" \
    --file "$UPDATE_FILE" \
    --addon-key "$CLI_TEST_ADDON_KEY"
  run_cli diagram export "$CREATED_ID" --format raw --addon-key "$CLI_TEST_ADDON_KEY"
else
  run_cli diagram update "$CREATED_ID" \
    --type sequence \
    --title "CLI smoke test updated" \
    --file "$UPDATE_FILE"
  run_cli diagram export "$CREATED_ID" --format raw
fi

run_cli diagram delete "$CREATED_ID" --force

echo ""
echo "Write tests completed."
