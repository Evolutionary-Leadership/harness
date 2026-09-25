#!/usr/bin/env bash
# Print the `## Brief` block of a feature context: the guardrails, glossary
# terms, decision records and architecture docs a change should read first.
#
#   bash .claude/scripts/brief.sh --title="<title>" --why="<why>" [--path=<p>]...
#   printf '%s\n' "<title>" "<why>" | bash .claude/scripts/brief.sh --path=<p>
#
# Pure grep over the working tree; no network. Every section is one line,
# `<none>` when empty:
#
#   Guardrails: <CLAUDE.md heading or bold line>; <another>
#   Glossary: <term>; <term>
#   Decisions: <decision record title>; <another>
#   Architecture: docs/architecture/<file>.md (sources match <path>)
#
# Words of four or more letters in the title and why, lowercased, are the
# query. A heading, term or title matches when it contains one of them. The
# architecture line comes from `sources:` globs matched against the declared
# paths with the conservative rule touched-set.mjs uses: a declared path that
# is itself a glob overlaps a source glob when one literal prefix starts the
# other. False positives cost a glance; a miss costs the doc going stale.
set -euo pipefail

TITLE=""
WHY=""
PATHS=()
for arg in "$@"; do
  case "$arg" in
    --title=*) TITLE="${arg#--title=}" ;;
    --why=*) WHY="${arg#--why=}" ;;
    --path=*) PATHS+=("${arg#--path=}") ;;
    -h|--help)
      sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "brief.sh: unknown argument: $arg" >&2
      exit 2
      ;;
  esac
done
if [ -z "$TITLE" ] && [ -z "$WHY" ] && [ ! -t 0 ]; then
  TITLE="$(cat)"
fi

# Common words that would match every heading. Kept short on purpose: the
# four-letter floor already drops most of the noise.
STOP=' this that with from when have will into than then them they what which
 while where been were only also does done each other over such more most some
 your must never every after before about there their here should would could '

# The query: lowercase words of four or more letters, deduplicated.
WORDS="$(printf '%s %s' "$TITLE" "$WHY" | tr '[:upper:]' '[:lower:]' \
  | tr -c 'a-z\n' ' ' | tr ' ' '\n' | grep -E '^[a-z]{4,}$' | sort -u || true)"
QUERY=()
while IFS= read -r w; do
  [ -z "$w" ] && continue
  case "$STOP" in *" $w "*) continue ;; esac
  QUERY+=("$w")
done <<<"$WORDS"

# matches <line>: exit 0 when the lowercased line contains a query word.
matches() {
  local lower
  lower="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
  local w
  for w in "${QUERY[@]+"${QUERY[@]}"}"; do
    case "$lower" in *"$w"*) return 0 ;; esac
  done
  return 1
}

# join <item>...: the items separated by "; ", or <none>.
join() {
  if [ "$#" -eq 0 ]; then
    printf '<none>\n'
    return
  fi
  local out="" item
  for item in "$@"; do
    if [ -z "$out" ]; then out="$item"; else out="$out; $item"; fi
  done
  printf '%s\n' "$out"
}

# --- Guardrails: CLAUDE.md headings and bold lines ---------------------------
GUARD=()
if [ -f CLAUDE.md ]; then
  while IFS= read -r line; do
    text="$line"
    case "$line" in
      \#*) text="$(printf '%s' "$line" | sed -E 's/^#+[[:space:]]*//')" ;;
      \*\**) text="$(printf '%s' "$line" | sed -E 's/\*\*//g')" ;;
    esac
    text="$(printf '%s' "$text" | sed -E 's/[[:space:]]+$//')"
    [ -z "$text" ] && continue
    if matches "$text"; then GUARD+=("$text"); fi
  done < <(grep -E '^(#{1,6} |\*\*)' CLAUDE.md || true)
fi

# --- Glossary: **term**, ### term, or a `| term |` table row -----------------
GLOSS=()
if [ -f docs/GLOSSARY.md ]; then
  while IFS= read -r line; do
    term=""
    case "$line" in
      '### '*) term="${line#\#\#\# }" ;;
      '**'*'**'*) term="$(printf '%s' "$line" | sed -E 's/^\*\*([^*]+)\*\*.*$/\1/')" ;;
      '|'*)
        term="$(printf '%s' "$line" | sed -E 's/^\|[[:space:]]*([^|]*[^|[:space:]])[[:space:]]*\|.*$/\1/')"
        # Header and separator rows, and placeholders, are not terms.
        case "$term" in Term|'Old term'|'-'*|':'*|'_('*|'|'*) term="" ;; esac
        ;;
    esac
    [ -z "$term" ] && continue
    if matches "$term"; then GLOSS+=("$term"); fi
  done < <(grep -E '^(### |\*\*|\|)' docs/GLOSSARY.md || true)
fi

# --- Decisions: the first heading of every docs/decisions/*.md ---------------
DECIDE=()
for f in docs/decisions/*.md; do
  [ -f "$f" ] || continue
  case "$(basename "$f")" in TEMPLATE.md|README.md) continue ;; esac
  title="$(grep -m1 -E '^# ' "$f" | sed -E 's/^# +//; s/[[:space:]]+$//' || true)"
  [ -z "$title" ] && continue
  if matches "$title"; then DECIDE+=("$title"); fi
done

# --- Architecture: sources: globs against the declared paths -----------------

# glob_to_ere <glob>: the ERE the checker's globToRegExp would build.
glob_to_ere() {
  printf '%s' "$1" | sed -E \
    -e 's/[][+.^$()|\\]/\\&/g' \
    -e 's#\*\*/#\x01#g' -e 's/\*\*/\x02/g' \
    -e 's#\*#[^/]*#g' -e 's#\?#[^/]#g' \
    -e 's#\x01#(.*/)?#g' -e 's#\x02#.*#g'
}

# literal_prefix <path>: the leading segments up to the first wildcard, as a
# slash-joined string (touched-set.mjs's literalPrefix).
literal_prefix() {
  local out="" seg
  IFS='/' read -r -a segs <<<"$1"
  for seg in "${segs[@]}"; do
    [ -z "$seg" ] || [ "$seg" = "." ] && continue
    case "$seg" in *\**) break ;; esac
    if [ -z "$out" ]; then out="$seg"; else out="$out/$seg"; fi
  done
  printf '%s' "$out"
}

# overlaps <glob> <declared path>
overlaps() {
  local glob="$1" path="$2"
  case "$path" in
    *\**)
      local a b
      a="$(literal_prefix "$glob")"
      b="$(literal_prefix "$path")"
      [ "$a" = "$b" ] && return 0
      case "$a" in "$b"/*) return 0 ;; esac
      case "$b" in "$a"/*) return 0 ;; esac
      return 1
      ;;
    *)
      printf '%s\n' "$path" | grep -Eq "^$(glob_to_ere "$glob")\$"
      ;;
  esac
}

ARCH=()
for f in docs/architecture/*.md; do
  [ -f "$f" ] || continue
  case "$(basename "$f")" in TEMPLATE.md|README.md) continue ;; esac
  [ "${#PATHS[@]}" -eq 0 ] && break
  # The front-matter list items between the first two `---` lines.
  hit=""
  while IFS= read -r glob; do
    [ -z "$glob" ] && continue
    for p in "${PATHS[@]}"; do
      if overlaps "$glob" "$p"; then
        hit="$p"
        break 2
      fi
    done
  done < <(awk 'NR==1 && $0!="---"{exit} NR>1 && $0=="---"{exit} NR>1' "$f" \
    | sed -nE 's/^[[:space:]]*-[[:space:]]*["'"'"']?([^"'"'"']+)["'"'"']?[[:space:]]*$/\1/p')
  [ -n "$hit" ] && ARCH+=("$f (sources match $hit)")
done

printf 'Guardrails: '
join "${GUARD[@]+"${GUARD[@]}"}"
printf 'Glossary: '
join "${GLOSS[@]+"${GLOSS[@]}"}"
printf 'Decisions: '
join "${DECIDE[@]+"${DECIDE[@]}"}"
printf 'Architecture: '
join "${ARCH[@]+"${ARCH[@]}"}"
