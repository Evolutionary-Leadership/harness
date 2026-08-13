#!/usr/bin/env bash
set -euo pipefail

# PreToolUse hook: blocks Write, Edit, and Bash tool calls that contain
# em dash characters (U+2014). Stdout is shown to Claude as an error
# message so it can retry with corrected text.

INPUT=$(cat)

# Extract the text field based on which tool is being invoked.
# PreToolUse JSON has .tool_name and .tool_input.
TOOL=$(echo "$INPUT" | jq -r '.tool_name // empty')

case "$TOOL" in
  Write)
    TEXT=$(echo "$INPUT" | jq -r '.tool_input.content // empty')
    ;;
  Edit)
    TEXT=$(echo "$INPUT" | jq -r '.tool_input.new_string // empty')
    ;;
  Bash)
    TEXT=$(echo "$INPUT" | jq -r '.tool_input.command // empty')
    ;;
  *)
    exit 0
    ;;
esac

# Check for em dash (U+2014)
if printf '%s' "$TEXT" | grep -qF $'\xe2\x80\x94'; then
  echo ""
  echo "BLOCKED: Text contains an em dash character (U+2014)."
  echo "Replace each em dash with the appropriate punctuation:"
  echo "a comma, a colon, a semicolon, or parentheses."
  echo "Do not use em dashes anywhere in this repository."
  exit 1
fi

exit 0
