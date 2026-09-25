#!/usr/bin/env bash
set -uo pipefail

# PreToolUse hook: blocks tool calls whose text carries an em dash (U+2014).
# Exit 2 is the blocking exit code; the message goes to stderr, which Claude
# reads, and to stdout for older runtimes that show stdout.
#
# What is scanned, per tool:
#   Write            tool_input.content
#   Edit             tool_input.new_string
#   Bash             tool_input.command, but only when the command carries
#                    text that ends up in a file or on GitHub: a heredoc
#                    (`<<`), or a `-m`, `--message`, `--body`, `--title` or
#                    `--notes` flag. A plain command line (grep, sed, cat,
#                    a path) is never scanned, so the hook costs nothing on
#                    the calls that make up most of a session.
#   mcp__github__*   every string value in tool_input, recursively: an issue
#                    body, a comment, a PR title, a pushed file's content.
#   anything else    not scanned.
#
# One jq invocation does the selection and the test. Malformed input is
# allowed through: a hook that cannot read its input must not block work.

INPUT=$(cat)

printf '%s' "$INPUT" | jq -e '
  (.tool_name // "") as $tool
  | (.tool_input // {}) as $in
  | (
      if $tool == "Write" then ($in.content // "")
      elif $tool == "Edit" then ($in.new_string // "")
      elif $tool == "Bash" then
        (($in.command // "") | if test("<<|(^|\\s)-m\\s|--message|--body|--title|--notes") then . else "" end)
      elif ($tool | startswith("mcp__github__")) then
        ([$in | .. | strings] | join("\n"))
      else ""
      end
    )
  | contains("\u2014")
' >/dev/null 2>&1
RC=$?

if [ "$RC" -eq 0 ]; then
  MSG="
BLOCKED: Text contains an em dash character (U+2014).
Replace each em dash with the appropriate punctuation:
a comma, a colon, a semicolon, or parentheses.
Do not use em dashes anywhere in this repository."
  # Print to both streams without tee: /dev/stderr is not always openable
  # (a sandbox without a controlling terminal), and a hook must never fail
  # to say why it blocked.
  printf '%s\n' "$MSG"
  printf '%s\n' "$MSG" >&2
  exit 2
fi

# jq exit 1 is "false" (no em dash); any other code is unreadable input.
exit 0
