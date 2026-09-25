#!/usr/bin/env bash
set -uo pipefail

# PreToolUse hook (Write, Edit): a doc whose row in docs/README.md's frozen
# table says Yes may only grow. The hook allows the call when the file's
# current content is a prefix of what the file will hold afterwards, and
# blocks anything else with one sentence. Exit 2 is the blocking exit code.
#
# The frozen table in the manifest has the columns `| Doc | Date | Frozen |`;
# a row is frozen when its Frozen cell reads `Yes`. A row written as
# `Frozen: Yes` in any cell counts too.
#
# Allowed:
#   Write  tool_input.content starts with the file's current content
#   Edit   old_string is empty, or old_string is the file's tail and
#          new_string starts with old_string (an append at the end)
# Blocked: everything else on a frozen path.
# Exit 0 (allow) when docs/README.md is absent, when the path is not in the
# table, when the file does not exist yet, or when the input is unreadable.

INPUT=$(cat)

ROOT=$(printf '%s' "$INPUT" | jq -r '.cwd // empty' 2>/dev/null)
[ -n "$ROOT" ] || ROOT=$PWD
MANIFEST="$ROOT/docs/README.md"
[ -f "$MANIFEST" ] || exit 0

TOOL=$(printf '%s' "$INPUT" | jq -r '.tool_name // empty' 2>/dev/null)
case "$TOOL" in Write|Edit) ;; *) exit 0 ;; esac

TARGET=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null)
[ -n "$TARGET" ] || exit 0

# The manifest names paths relative to the repo (docs/x.md) or to docs/ (x.md).
REL=${TARGET#"$ROOT"/}
REL=${REL#./}
SHORT=${REL#docs/}

frozen=$(awk -v rel="$REL" -v short="$SHORT" '
  function trim(s) { gsub(/^[ \t]+|[ \t]+$/, "", s); return s }
  /^\|/ {
    n = split($0, cells, "|")
    if (col == 0) {
      for (i = 1; i <= n; i++) if (tolower(trim(cells[i])) == "frozen") { col = i; break }
      if (col > 0) { next }
    }
    if (index($0, rel) == 0 && index($0, short) == 0) next
    if (col > 0 && tolower(trim(cells[col])) == "yes") { print "yes"; exit }
    if ($0 ~ /[Ff]rozen: *[Yy]es/) { print "yes"; exit }
    next
  }
  # A blank line ends the table; look for the next header.
  /^[ \t]*$/ { col = 0 }
' "$MANIFEST")
[ "$frozen" = "yes" ] || exit 0

FILE="$TARGET"
case "$FILE" in /*) ;; *) FILE="$ROOT/$FILE" ;; esac
[ -f "$FILE" ] || exit 0

block() {
  MSG="BLOCKED: $REL is a frozen record; append a dated correction instead."
  printf '%s\n' "$MSG"
  printf '%s\n' "$MSG" >&2
  exit 2
}

TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT

case "$TOOL" in
  Write)
    printf '%s' "$INPUT" | jq -j '.tool_input.content // ""' > "$TMP"
    SIZE=$(wc -c < "$FILE")
    NEW=$(wc -c < "$TMP")
    [ "$NEW" -ge "$SIZE" ] || block
    head -c "$SIZE" "$TMP" | cmp -s - "$FILE" || block
    ;;
  Edit)
    OLD=$(printf '%s' "$INPUT" | jq -r '.tool_input.old_string // ""')
    [ -n "$OLD" ] || exit 0
    ALL=$(printf '%s' "$INPUT" | jq -r '.tool_input.replace_all // false')
    [ "$ALL" = "true" ] && block
    printf '%s' "$INPUT" | jq -j '.tool_input.old_string // ""' > "$TMP"
    OLDSIZE=$(wc -c < "$TMP")
    tail -c "$OLDSIZE" "$FILE" | cmp -s - "$TMP" || block
    printf '%s' "$INPUT" | jq -j '.tool_input.new_string // ""' | head -c "$OLDSIZE" | cmp -s - "$TMP" || block
    ;;
esac

exit 0
