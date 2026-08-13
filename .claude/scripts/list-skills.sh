#!/usr/bin/env bash
set -euo pipefail

SKILLS_DIR=".claude/skills"
AGENTS_DIR=".claude/agents"

if [ ! -d "$SKILLS_DIR" ] && [ ! -d "$AGENTS_DIR" ]; then
  echo "No skills or agents directory found."
  exit 0
fi

if [ -d "$SKILLS_DIR" ]; then
  echo "Available skills:"
  echo ""

  for skill_dir in "$SKILLS_DIR"/*/; do
    [ -d "$skill_dir" ] || continue
    skill_file="$skill_dir/SKILL.md"
    [ -f "$skill_file" ] || continue

    name=$(basename "$skill_dir")
    desc=$(sed -n '/^---$/,/^---$/{ /^description:/s/^description: *//p; }' "$skill_file")
    echo "  /$name: $desc"
  done
fi

if [ -d "$AGENTS_DIR" ]; then
  echo ""
  echo "Available agents:"
  echo ""

  for agent_file in "$AGENTS_DIR"/*.md; do
    [ -f "$agent_file" ] || continue

    name=$(basename "$agent_file" .md)
    desc=$(sed -n '/^---$/,/^---$/{ /^description:/{ s/^description: *//; s/^>$//; p; }; }' "$agent_file" | head -1)
    # Handle multiline description: grab first non-empty content line after description key
    if [ -z "$desc" ]; then
      desc=$(sed -n '/^---$/,/^---$/{/^description:/,/^[a-z]/{/^  /{ s/^  *//; p; q; }}}' "$agent_file")
    fi
    echo "  @$name: $desc"
  done
fi
