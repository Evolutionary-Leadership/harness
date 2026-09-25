#!/usr/bin/env bash
# Replaces every em dash (U+2014) in stdin with ", " and writes the result
# to stdout, collapsing the double spaces that leaves behind. Pipe generated
# text (issue bodies, ticket lists, release notes) through it before the
# write, so the em-dash hook never has to block it.
#
#   printf '%s' "$BODY" | bash scripts/strip-em-dash.sh
set -uo pipefail
LC_ALL=C sed -e 's/ *\xe2\x80\x94 */, /g' -e 's/,  */, /g'
