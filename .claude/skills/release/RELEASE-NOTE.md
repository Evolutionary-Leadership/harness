# Release: the downstream release note (step 7b)

Read this only from `/release` step 7b, and only where `release-notes/` and
`scripts/release-notes-brief.mjs` exist: the authoring repo, which publishes
to a template repo. A downstream project has neither, and never reads this.

The note is **required**: `release.yml` fails the release when
`release-notes/$NEW_VERSION.md` is missing, because a release that publishes
no note leaves the template repo carrying new content under the previous
release (a forge decision record).

## Draft, then validate, then accept

Two commands, in this order:

    node scripts/release-notes-brief.mjs --version <version without the leading v> --draft \
      > release-notes/<version>.md
    node scripts/compose-release-notes.mjs --notes release-notes/$NEW_VERSION.md

The draft is a complete five-section note written for a downstream reader:
the brief spans every bump since the last published note, drops the versions
whose migrations touched nothing under `templates/`, drops bullets about the
factory (the checkers, this repo's own docs and decisions), prefixes a
railway-only range with `**Railway only:** `, and strips the issue
references, repo names and em dashes the composer rejects. The composer is
the same check `release.yml` and the sync run.

**When the composer accepts the draft, ship the draft.** Rewrite a bullet
only when one of two things is true of it:

- the composer rejected it (fix exactly what it reports), or
- it fails the reader test: **does a downstream reader know what changed for
  them, and what they must do?** A bullet that names which file moved, or
  describes the change from the maintainer's side, fails; rewrite that one
  for someone who runs a scaffolded project and has never seen this
  repository, and leave its neighbours as drafted.

Keep the five sections in order and omit a section rather than padding it;
`release-notes/README.md` holds the rules. The brief without `--draft` prints
the same material as a report, which explains every bullet it dropped and
its two markers: `factory only, omit from the note` (that version changed
nothing under `templates/`, so its prose stays out) and `railway only`
(those bullets carry the prefix).

## When the draft could not be written

**A non-zero exit from `--draft` means it could not write the note.** The
release changes something a downstream project can act on, but no prose was
found to write it from, so the file it just wrote carries one
`RELEASE NOTE UNWRITTEN` line instead of a claim about the release. Do not
ship it and do not delete the marker on its own: read the report, write the
note by hand from it, and replace the marker line. The report's `prose read
from:` line names the cause:

- `origin/preprod is not readable here`: the ref is missing or unfetched, so
  `git fetch origin preprod` and run the brief again. It reads the
  remote-tracking ref and never fetches for you, so a stale one answers as if
  it were current.
- `the accumulator is empty locally and on origin/preprod`: no prose exists
  yet, and the note has to be written from the file list.

A named ref with a placeholder draft means every bullet was dropped as
factory prose: the report lists them, and those are the bullets to rewrite
for a downstream reader.

Validate the hand-written note with the composer before going further. Step
9 carries the file in the release commit.
