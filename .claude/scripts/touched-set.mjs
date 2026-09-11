#!/usr/bin/env node
// The touched set: what an in-flight feature declares it will touch.
//
// One record per feature under features/ on the coordination branch, named
// by the feature slug. The coordination branch carries only what exists
// nowhere else (forge decision record 0014), and the thing that exists
// nowhere else is the DECLARATION: what a branch says it is about to touch,
// before the code exists. What a branch has already changed is derivable
// from GitHub (compare preprod against the feature branch), so it belongs to
// GitHub and never to this record. Both ids are spelled out because this
// file lands in a downstream scaffold, where a bare `ADR 0014` would name
// that project's own record and not this one.
//
// Two halves, and one is dormant. `paths` is written by every repository:
// two sessions collide over files whether or not a specification is
// connected. `nodes` is written only where .harness-version names a
// spec_product, because a node slug means nothing without a product. The
// absence is DECLARED and never silent (`spec: none`, and a connected change
// that touches no node writes the single node `none`), which is the rule the
// anchor grammar already uses for `Spec: support`.
//
// Everything here is advisory. Nothing this file computes is an exit code,
// a merge gate or a refusal: an overlap is reported to a person, who decides.
// A malformed record is named and skipped so that one bad file cannot hide
// the rest of the namespace.
//
// The pure core is above the CLI, so tests drive it with in-memory strings
// and need no network, no git and no fixture tree.

// ---------------------------------------------------------------------------
// The record
// ---------------------------------------------------------------------------

// Written in this order, so two records diff cleanly against each other.
const SCALARS = [
  "slug",
  "branch",
  "key",
  "author",
  "declared_at",
  "updated_at",
  "spec",
  "phase",
];
const LISTS = ["paths", "nodes"];
// Every scalar but this one is required. Derived rather than re-listed, so a
// field added above cannot become optional by omission.
const OPTIONAL = new Set(["key"]);
const REQUIRED = SCALARS.filter((field) => !OPTIONAL.has(field));

// The journey, in layout order: a state (a milestone reached, named in the
// past participle) then the transition leaving it (work in progress, named
// as an activity). `phase` is the position the feature is at, spelled
// exactly as the Product Cockpit's lifecycle spells it, so a reader of this
// record and a binding on that screen agree without a lookup table. A state
// means its artefact exists; a transition means a session is working on it.
// The record only ever carries the front half through `built`: from
// `verified` on, the evidence is a check run, a pull request, a merge or a
// release, which the cockpit reads from GitHub directly, and `/to-preprod`
// deletes this record at the merge. The later keys are listed so a record
// can never be refused for naming a position the journey has, and so the
// list is the whole journey rather than the half one reader uses.
export const POSITIONS = [
  "captured",
  "challenging",
  "challenged",
  "shaping",
  "shaped",
  "assessing",
  "assessed",
  "deciding",
  "committed",
  "planning",
  "planned",
  "building",
  "built",
  "verifying",
  "verified",
  "reviewing",
  "reviewed",
  "releasing",
  "released",
  "adoption",
  "used",
  "evaluating",
  "evaluated",
];

const SLUG = /^[a-z0-9][a-z0-9-]{0,40}$/;
const NODE = /^[a-z][a-z0-9-]*$/;
const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
// Unpadded, like the fr-N slugs change keys follow. A padded key is refused
// by name rather than accepted quietly, the same rule check-spec.mjs applies
// to anchors.
const KEY = /^[A-Z][A-Z0-9]{1,9}-[1-9][0-9]*$/;

export function nowStamp(date = new Date()) {
  return `${date.toISOString().slice(0, 19)}Z`;
}

// Compose a record. Field order is fixed; `key` is omitted where the
// repository mints none, and `nodes` where it is dormant.
export function renderTouchedSet(record) {
  const lines = ["---"];
  for (const field of SCALARS) {
    const value = record[field];
    if (value === undefined || value === null || value === "") continue;
    lines.push(`${field}: ${value}`);
  }
  for (const field of LISTS) {
    const value = record[field];
    if (!Array.isArray(value) || value.length === 0) continue;
    lines.push(`${field}:`);
    for (const entry of value) lines.push(`  - ${entry}`);
  }
  // Anything a newer harness version wrote is carried through untouched. A
  // refresh by an older reader must not silently drop a field it cannot name.
  for (const field of Object.keys(record).sort()) {
    if (SCALARS.includes(field) || LISTS.includes(field)) continue;
    const value = record[field];
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      lines.push(`${field}:`);
      for (const entry of value) lines.push(`  - ${entry}`);
    } else if (value !== undefined && value !== null && value !== "") {
      lines.push(`${field}: ${value}`);
    }
  }
  lines.push("---", "");
  return lines.join("\n");
}

// Read a record back. Returns {ok: true, record} or {ok: false, reason}.
// Never throws: a reader that dies on one bad file has hidden the namespace.
//
// An UNKNOWN scalar key is ignored rather than refused, so a record written
// by a newer harness version stays readable by an older one. A MISSING
// required key is still an error, so a misspelt `path:` is caught by the
// absence of `paths` rather than passing as an unknown extra.
export function parseTouchedSet(text) {
  if (typeof text !== "string" || text.trim() === "") {
    return { ok: false, reason: "the record is empty" };
  }
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  if (lines[0].trim() !== "---") {
    return { ok: false, reason: "the record does not open with ---" };
  }
  const end = lines.indexOf("---", 1);
  if (end === -1) {
    return { ok: false, reason: "the front matter is not closed with ---" };
  }

  const record = {};
  let list = null;
  for (let i = 1; i < end; i += 1) {
    const line = lines[i];
    if (line.trim() === "") continue;
    const item = /^ {2}- (.+)$/.exec(line);
    if (item) {
      if (list === null) {
        return { ok: false, reason: `a list entry with no key: ${line.trim()}` };
      }
      record[list].push(item[1].trim());
      continue;
    }
    const field = /^([a-z_]+):[ \t]*(.*)$/.exec(line);
    if (!field) return { ok: false, reason: `unreadable line: ${line.trim()}` };
    const [, name, value] = field;
    if (value === "") {
      // A known scalar with no value is a fault worth naming. An unknown key
      // with none is a list this version does not know about: collected, and
      // written back out untouched.
      if (SCALARS.includes(name)) {
        return { ok: false, reason: `${name} has no value` };
      }
      record[name] = [];
      list = name;
      continue;
    }
    if (LISTS.includes(name)) {
      return { ok: false, reason: `${name} must be a list, one entry per line` };
    }
    record[name] = value.trim();
    list = null;
  }

  const fault = validate(record);
  if (fault) return { ok: false, reason: fault };
  return { ok: true, record };
}

function validate(record) {
  for (const field of REQUIRED) {
    if (!record[field]) return `${field} is missing`;
  }
  if (!SLUG.test(record.slug)) return `slug is not a feature slug: ${record.slug}`;
  if (!STAMP.test(record.declared_at)) {
    return `declared_at is not an ISO 8601 UTC stamp: ${record.declared_at}`;
  }
  if (!STAMP.test(record.updated_at)) {
    return `updated_at is not an ISO 8601 UTC stamp: ${record.updated_at}`;
  }
  if (record.key !== undefined && !KEY.test(record.key)) {
    return `change keys are unpadded, like the fr-N slugs they follow: ${record.key}`;
  }
  if (!POSITIONS.includes(record.phase)) {
    return `phase is not a journey position: ${record.phase}`;
  }
  if (!Array.isArray(record.paths) || record.paths.length === 0) {
    return "paths is missing or empty";
  }
  for (const entry of record.paths) {
    if (entry.startsWith("/") || entry.split("/").includes("..")) {
      return `a path is not repository-relative: ${entry}`;
    }
  }
  const dormant = record.spec === "none";
  if (dormant && record.nodes !== undefined) {
    return "a dormant record declares no nodes; it says spec: none and stops";
  }
  if (!dormant) {
    if (!Array.isArray(record.nodes) || record.nodes.length === 0) {
      return "a connected record declares nodes, or the single node `none`";
    }
    if (record.nodes.includes("none") && record.nodes.length > 1) {
      return "`none` is a whole answer and cannot be combined";
    }
    for (const node of record.nodes) {
      if (!NODE.test(node)) return `a node is not a local slug: ${node}`;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Overlap
// ---------------------------------------------------------------------------

// The leading literal segments of a path entry. Everything from the first
// segment carrying a wildcard is dropped, so `.claude/skills/*/SKILL.md`
// compares as `.claude/skills`.
export function literalPrefix(entry) {
  const segments = [];
  // `.` and empty segments carry no meaning in a path and must not defeat the
  // comparison: `./src/a.js` names exactly what `src/a.js` names.
  for (const segment of entry.split("/").filter((s) => s !== "" && s !== ".")) {
    if (segment.includes("*")) break;
    segments.push(segment);
  }
  return segments;
}

// Conservative by design: two entries overlap when one's literal prefix is a
// prefix of the other's. It reports overlaps a finer reading would rule out,
// and never misses one. For a warning a reader dismisses in a second, a false
// positive costs a glance and a miss costs the thing this exists to prevent.
export function pathsOverlap(mine, theirs) {
  const a = literalPrefix(mine);
  const b = literalPrefix(theirs);
  const shorter = Math.min(a.length, b.length);
  for (let i = 0; i < shorter; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

export function overlap(mine, theirs) {
  const paths = [];
  for (const entry of mine.paths ?? []) {
    for (const other of theirs.paths ?? []) {
      if (!pathsOverlap(entry, other)) continue;
      paths.push(entry === other ? entry : `${entry} against ${other}`);
    }
  }
  // Exact slug equality, and `none` overlaps nothing: it is the declaration
  // that this change touches no node at all.
  const theirNodes = new Set((theirs.nodes ?? []).filter((n) => n !== "none"));
  const nodes = (mine.nodes ?? []).filter((n) => n !== "none" && theirNodes.has(n));
  return { paths, nodes: [...new Set(nodes)] };
}

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

// A record is only swept once it has had time to be wrong. `/feature` writes
// the declaration BEFORE `feature/<slug>` exists: `set-feature-name.sh` pushes
// and the branch is created by a workflow moments later, so a reader inside
// that window sees a branch list that succeeded and does not name the new
// branch. Without this guard the sweep would delete the record of a branch
// that has pushed nothing yet, which is the exact case the namespace exists
// for. A day is far longer than that window and far shorter than a stale
// record matters for: the cost of sweeping late is one false collision
// warning, and the cost of sweeping early is deleting live work.
export const SWEEP_AFTER_MS = 24 * 60 * 60 * 1000;

// `others` is a list of {slug, text}: whatever the namespace held, unparsed.
// `liveBranches` is the branch list read from the remote, and an EMPTY list
// means "could not read", never "nothing is live": a sweep is only ever
// proposed for a record whose branch is provably gone, which is the rule
// claims/adr already uses before it releases a number.
export function report(mine, others, liveBranches = [], now = Date.now()) {
  const live = new Set(liveBranches);
  const collisions = [];
  const stale = [];
  const malformed = [];

  for (const { slug, text } of others) {
    if (slug === mine.slug) continue;
    const read = parseTouchedSet(text);
    if (!read.ok) {
      malformed.push({ slug, reason: read.reason });
      continue;
    }
    const theirs = read.record;
    // The filename is the identity: it is what makes one writer per file true.
    // A record filed under another slug is misfiled, and reading it as its own
    // would let one feature hold two records.
    if (theirs.slug !== slug) {
      malformed.push({ slug, reason: `the record calls itself ${theirs.slug}` });
      continue;
    }
    const age = now - Date.parse(theirs.updated_at);
    if (live.size > 0 && !live.has(theirs.branch) && age > SWEEP_AFTER_MS) {
      stale.push({ slug, branch: theirs.branch });
      continue;
    }
    const found = overlap(mine, theirs);
    if (found.paths.length > 0 || found.nodes.length > 0) {
      collisions.push({ slug, branch: theirs.branch, phase: theirs.phase, ...found });
    }
  }
  return { collisions, stale, malformed };
}

export function renderReport(result) {
  const lines = [];
  if (result.collisions.length === 0) {
    lines.push("No in-flight feature overlaps this declaration.");
  }
  for (const hit of result.collisions) {
    lines.push(`${hit.slug} (${hit.branch}, at ${hit.phase}) overlaps:`);
    for (const path of hit.paths) lines.push(`  path  ${path}`);
    for (const node of hit.nodes) lines.push(`  node  ${node}`);
  }
  for (const gone of result.stale) {
    lines.push(`stale: ${gone.slug}, whose ${gone.branch} is gone from the remote`);
  }
  for (const bad of result.malformed) {
    lines.push(`skipped ${bad.slug}: ${bad.reason}`);
  }
  lines.push("Advisory. Nothing here blocks a merge.");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const USAGE = `usage: touched-set.mjs <command> [flags]

  render    Compose a record. --slug --branch --author --spec --phase are
            required; --key, --path (repeatable) and --node (repeatable) are
            optional. Prints the record on stdout.

  refresh   Read a record from --from, add any --path and --node given, move
            --phase when one is given, and bump updated_at. Prints the record
            on stdout.

  overlap   Read --mine and every *.md in --dir, and print the report.
            --branches-file holds the live branch names, one per line; an
            absent or empty list means no record is ever called stale, and
            neither is a record touched in the last day. --now overrides the
            clock the age is measured against.

Every command exits 0. This namespace is advisory.`;

function flags(argv) {
  const single = {};
  const many = { path: [], node: [] };
  for (const arg of argv) {
    const match = /^--([a-z-]+)=(.*)$/.exec(arg);
    if (!match) continue;
    const [, name, value] = match;
    if (name === "path" || name === "node") many[name].push(value);
    else single[name] = value;
  }
  return { ...single, paths: many.path, nodes: many.node };
}

async function main(argv) {
  const [command, ...rest] = argv;
  const flag = flags(rest);
  const { readFileSync, readdirSync } = await import("node:fs");
  const { join, basename } = await import("node:path");

  if (command === "render") {
    const stamp = flag["declared-at"] || nowStamp();
    const record = {
      slug: flag.slug,
      branch: flag.branch,
      key: flag.key,
      author: flag.author,
      declared_at: stamp,
      updated_at: flag["updated-at"] || stamp,
      spec: flag.spec || "none",
      phase: flag.phase,
      paths: flag.paths,
      nodes: flag.nodes.length > 0 ? flag.nodes : undefined,
    };
    const text = renderTouchedSet(record);
    const read = parseTouchedSet(text);
    if (!read.ok) {
      process.stderr.write(`touched set not written: ${read.reason}\n`);
      return;
    }
    process.stdout.write(text);
    return;
  }

  if (command === "refresh") {
    // A record written before the journey position existed has no `phase`
    // line and cannot be parsed. A refresh that BRINGS a phase is the one
    // reader allowed to complete such a record, because the alternative is
    // an in-flight feature that can never be refreshed again after an
    // upgrade. Any other fault still refuses. The line goes in after `spec`,
    // which every record has, where `renderTouchedSet` would put it. This
    // shim has the same lifetime as the optional `key`: one release, until
    // no record from before the field can be in flight.
    let text = readFileSync(flag.from, "utf8");
    if (flag.phase && !/^phase:/m.test(text)) {
      text = text.replace(/^(spec: .*)$/m, `$1\nphase: ${flag.phase}`);
    }
    const read = parseTouchedSet(text);
    if (!read.ok) {
      process.stderr.write(`touched set not refreshed: ${read.reason}\n`);
      return;
    }
    const record = read.record;
    record.paths = [...new Set([...record.paths, ...flag.paths])].sort();
    if (record.spec !== "none") {
      const nodes = [...new Set([...(record.nodes ?? []), ...flag.nodes])];
      record.nodes = nodes.filter((n) => n !== "none" || nodes.length === 1).sort();
    }
    if (flag.phase) record.phase = flag.phase;
    record.updated_at = flag["updated-at"] || nowStamp();
    const text2 = renderTouchedSet(record);
    const back = parseTouchedSet(text2);
    if (!back.ok) {
      process.stderr.write(`touched set not refreshed: ${back.reason}\n`);
      return;
    }
    process.stdout.write(text2);
    return;
  }

  if (command === "overlap") {
    const read = parseTouchedSet(readFileSync(flag.mine, "utf8"));
    if (!read.ok) {
      process.stderr.write(`own touched set unreadable: ${read.reason}\n`);
      return;
    }
    let others = [];
    try {
      others = readdirSync(flag.dir)
        .filter((name) => name.endsWith(".md") && name !== "README.md")
        .map((name) => ({
          slug: basename(name, ".md"),
          text: readFileSync(join(flag.dir, name), "utf8"),
        }));
    } catch {
      // An unreadable directory is an empty namespace, not a fault.
    }
    let branches = [];
    if (flag["branches-file"]) {
      try {
        branches = readFileSync(flag["branches-file"], "utf8")
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean);
      } catch {
        // Unread branches mean nothing is called stale, by the rule above.
      }
    }
    const now = flag.now ? Date.parse(flag.now) : Date.now();
    process.stdout.write(
      `${renderReport(report(read.record, others, branches, now))}\n`,
    );
    return;
  }

  process.stderr.write(`${USAGE}\n`);
}

const invoked = process.argv[1] && process.argv[1].endsWith("touched-set.mjs");
if (invoked) await main(process.argv.slice(2));
