#!/usr/bin/env node
/**
 * judge-plan.mjs: the Spec axis judge, as a deterministic answer.
 *
 * Zero dependencies. Requires Node 22+. Run from the repo root, from
 * `.claude/skills/code-review/SKILL.md`:
 *
 *   node scripts/judge-plan.mjs prepare --diff-base=<ref> [--product=<slug>] \
 *     [--key=<change key>] [--out=/tmp/judge-inputs] [--retrieval=<dir>] \
 *     [--all=<product node list.json>] [--client=.claude/scripts/spec-universe.sh]
 *
 *   node scripts/judge-plan.mjs plan [--inputs=/tmp/judge-inputs] [--diff-base=<ref>] \
 *     [--min-lines=5] [--cap=10]
 *     (or the four inputs by name: --anchors=<changed files to nodes.json> \
 *      --governs=<node to governing requirements.json> \
 *      --criteria=<node to criterion ids.json> --index=<node to all files.json> \
 *      [--proposals=<the change's proposals.json>])
 *
 *   node scripts/judge-plan.mjs rows --tier1=<judge tables.md or a directory of them> \
 *     [--tier2=<md or directory>]
 *
 *   node scripts/judge-plan.mjs compare --audit=<rows.md> --new=<rows.md>
 *
 * Why this file exists, and what it is allowed to decide, is the judge section
 * of .claude/SPEC-LOOP.md.
 * The short version: an adversarial judge rejects correct code 26 to 88 percent
 * of the time, so the brief became a behavioural comparison; a `drifted`
 * verdict without a concrete input and the wrong result is a suspicion rather
 * than a finding, so it is downgraded here and not in the judge's own
 * self-assessment; and one judge per node re-loaded an overlapping slice once
 * per node, so nodes are grouped by the changed files that reach them.
 *
 * `prepare` builds the inputs (anchors, governs, criteria, index, nodes,
 * proposals) from the diff and the shared client, fetching only the nodes the
 * diff reaches and reusing what `retrieval.mjs` already fetched. `plan
 * --diff-base` then reads `git diff --unified=0` and drops a node reached only
 * through files whose hunks touch no block anchoring it: a hub test file that
 * anchors forty nodes and changed one string no longer summons forty judges.
 * The dropped nodes are listed under `## Not judged` with the reason, so the
 * pruning is a decision put to the reader and never a silent loss.
 *
 * The interface this file must not break is the preprod gate's. `parseVerdictTable` in
 * scripts/gate-run.mjs FAULTS on a verdict outside `matched`, `drifted` and
 * `unverifiable`, and stops at the next heading, so `suspect` rows are rendered
 * into their own section AFTER `## Spec verdicts` and never into it.
 *
 * Structure: everything above the CLI section at the foot of this file is pure
 * and exported, so a project's own unit tests drive it with in-memory input and
 * need no network, no fixture tree and no running Spec Universe. Only that
 * section and `main()` read a file or exit.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DOMAIN_ROOTS, collectFiles, findSpecLines, parseAnchor, productSlug } from "./check-spec.mjs";

// ------------------------------------------------------------------ constants

/** Where `prepare` writes and `plan` reads, unless told otherwise. */
export const INPUTS_DIR = "/tmp/judge-inputs";

/**
 * The line-count threshold that decides a node anchored only at file level
 * (no block names it): a diff of fewer changed lines than this in that file
 * does not summon its judge. Printed with every plan, so the number is never
 * a surprise.
 */
export const MIN_LINES = 5;

/** The heading a pruned node is listed under, with its reason. */
export const NOT_JUDGED_HEADING = "## Not judged";

/** The heading a provisional (tier 1 only) verdict table carries. */
export const PROVISIONAL_HEADING = "## Spec verdicts (provisional, tier 1 only)";

/** The section a provisional run adds: the rows tier 2 must re-run. */
export const RERUN_HEADING = "## Rows for tier 2";

/** The verdicts that may reach `## Spec verdicts`, and so Spec Universe. */
export const VERDICTS = ["matched", "drifted", "unverifiable"];

/** The local review state. Never a claim value, never in the verdict table. */
export const SUSPECT = "suspect";

/** Everything a judge may return. */
export const ROW_VALUES = [...VERDICTS, SUSPECT];

/**
 * The cap on one judge, counted in acceptance criteria and never in nodes.
 * Small enough that a judge returns a row per criterion rather than a summary,
 * large enough that a hub file's group collapses to a handful of judges. A
 * reasoned default until a project's own audit re-run calibrates it.
 */
export const CRITERION_CAP = 10;

/** Tier 1 is a model, not an effort: the Agent tool exposes no effort knob. */
export const TIER_ONE_MODEL = "sonnet";

/** The headings this file writes. Order matters; see the note above. */
export const VERDICT_HEADING = "## Spec verdicts";
export const SUSPECT_HEADING = "## Suspect rows";
export const DISAGREEMENT_HEADING = "## Tier disagreements";

/** The six-column shape three later readers parse. Unchanged by this file. */
export const VERDICT_COLUMNS = [
  "node",
  "criterion",
  "judged against",
  "verdict",
  "spec line",
  "where",
];

/** What a judge returns: the six columns above plus the evidence it showed. */
export const JUDGE_COLUMNS = [...VERDICT_COLUMNS, "evidence"];

/**
 * The evidence a `drifted` verdict must carry: a concrete input and the wrong
 * result, both named, in that order. The judge is told this exact form, so the
 * test for it is a match and not a judgement.
 */
export const EVIDENCE_SHAPE = /input:\s*(\S[^;]*?)\s*;\s*result:\s*(\S.*)$/i;

/** What a downgraded row says it was downgraded for. One copy, one home. */
export const NO_EVIDENCE =
  "drifted without a concrete input and the wrong result, so it is a suspicion";

/** A markdown table row: leading pipe, cells, trailing pipe. */
const TABLE_ROW = /^\s*\|(.+)\|\s*$/;

/** The separator under a table header. */
const TABLE_RULE = /^[\s|:-]+$/;

// -------------------------------------------------------------- the judge plan

const sortedUnique = (values) => [...new Set(values)].sort();

/**
 * `node -> the sorted changed files that REACH it`.
 *
 * A node is reached directly, by a changed file whose `Spec:` line names it,
 * and indirectly, through a capability or interface that cites it: the
 * governing requirements are where the acceptance criteria live, so the
 * fan-out is kept and the grouping collapses its result instead.
 * The walk is transitive with a cycle guard, so a governance chain longer than
 * one hop cannot silently drop a requirement.
 */
export function reachSets({ anchors = {}, governs = {} } = {}) {
  const reach = new Map();
  const add = (node, file) => {
    if (!reach.has(node)) reach.set(node, new Set());
    reach.get(node).add(file);
  };

  for (const [file, nodes] of Object.entries(anchors)) {
    const seen = new Set();
    const queue = [...(nodes ?? [])];
    while (queue.length) {
      const node = queue.shift();
      if (!node || seen.has(node)) continue;
      seen.add(node);
      add(node, file);
      for (const target of governs[node] ?? []) queue.push(target);
    }
  }

  return new Map([...reach].map(([node, files]) => [node, sortedUnique([...files])]));
}

/**
 * The judge groups: nodes sharing a reach set, split so no judge holds more
 * than `cap` acceptance criteria.
 *
 * Every node lands in exactly ONE group, which is the whole point of keying by
 * the reach set rather than by the anchor set: one criterion yields one row,
 * and no reconciliation rule has to be invented for two judges answering the
 * same criterion. Within a group nodes are taken in slug order and filled
 * greedily; a node whose own criteria exceed the cap is its own judge rather
 * than being split, because a node split across judges is the thing being
 * avoided.
 */
export function groupNodes({ reach = new Map(), criteria = {}, cap = CRITERION_CAP } = {}) {
  const byKey = new Map();
  for (const [node, files] of reach) {
    const key = files.join("\n");
    if (!byKey.has(key)) byKey.set(key, { files, nodes: [] });
    byKey.get(key).nodes.push(node);
  }

  const groups = [];
  for (const key of [...byKey.keys()].sort()) {
    const { files, nodes } = byKey.get(key);
    let current = null;
    for (const node of [...nodes].sort()) {
      const ids = criteria[node] ?? [];
      const count = ids.length || 1; // a node with no criteria is judged whole
      if (current && current.criterionCount + count > cap) current = null;
      if (!current) {
        current = { files, nodes: [], criterionCount: 0 };
        groups.push(current);
      }
      current.nodes.push({ slug: node, criteria: ids });
      current.criterionCount += count;
      if (current.criterionCount >= cap) current = null;
    }
  }

  return groups.map((g, i) => ({ id: `g${i + 1}`, ...g }));
}

/**
 * One judge per group, with what it loads and what it may read.
 *
 * `load` is the group's changed files, in full, and is the whole of the 86k
 * reduction: every OTHER file anchoring a node in the group is listed in
 * `onDemand` by path and read by the sub-agent itself when it needs it. The
 * judge is told it must read what it needs before returning `unverifiable`, so
 * nothing is withheld, only unloaded.
 *
 * `always` is the set of nodes the change's own proposals implicate: a
 * proposal implicates its node on its own, so a node nothing in the diff
 * reaches (or that the diff-aware pruning let go) is still judged, with the
 * proposal named as what reached it. A node the diff also reaches keeps its
 * file reach and is judged once.
 */
export function planJudges({
  anchors = {},
  governs = {},
  criteria = {},
  index = {},
  cap = CRITERION_CAP,
  always = {},
} = {}) {
  const reach = reachSets({ anchors, governs });
  for (const [node, via] of Object.entries(always)) {
    if (!node || reach.has(node)) continue;
    reach.set(node, [`(proposal ${via})`]);
  }
  const groups = groupNodes({ reach, criteria, cap });
  return groups.map((group) => {
    const load = group.files;
    const loaded = new Set(load);
    const onDemand = sortedUnique(
      group.nodes.flatMap((n) => index[n.slug] ?? []).filter((f) => !loaded.has(f))
    );
    return {
      id: group.id,
      model: TIER_ONE_MODEL,
      nodes: group.nodes,
      criterionCount: group.criterionCount,
      load,
      onDemand,
    };
  });
}

// ------------------------------------------------------- the diff-aware plan

/** The client envelopes, unwrapped here so a raw redirect into a file works. */
export const unwrapProposals = (body) =>
  Array.isArray(body) ? body : (body?.proposals ?? body?.items ?? []);
export const unwrapNode = (body) => (body && body.node ? body.node : body);
export const unwrapEdges = (body) =>
  Array.isArray(body) ? body : (body?.dependencies ?? body?.edges ?? []);

/** `product.slug` and `slug` both read as the local slug. */
export const localSlug = (id) => String(id ?? "").split(".").pop();

/**
 * `{ slug: proposal id }` for every node the change's draft or accepted
 * proposals implicate. A declined, withdrawn or superseded proposal implicates
 * nothing; it is listed in the report as a fact, not judged.
 */
export function proposalNodes(proposals = []) {
  const out = {};
  for (const p of unwrapProposals(proposals)) {
    if (!["draft", "accepted"].includes(p?.state)) continue;
    const slug = localSlug(p?.node ?? p?.nodeId ?? p?.node_id);
    if (slug && !out[slug]) out[slug] = p?.id ?? "?";
  }
  return out;
}

/** A `Spec:` comment line, in the grammar `check-spec.mjs` enforces. */
const SPEC_COMMENT = /^\s*(?:\/\*\*?|\*\/|\*|\/\/|#)\s*Spec:\s*(.*)$/;

/** A test block opener: `describe("title", ...)`, `it(`, `test(`, with modifiers. */
const TEST_CALL = /^\s*(?:describe|it|test|context|suite)(?:\.\w+)*\s*\(\s*(["'`])((?:\\.|(?!\1).)*)\1/;

/** `@@ -a[,b] +c[,d] @@`, the only line of a unified diff this file reads. */
const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * `git diff --unified=0` as `Map<file, { status, hunks, changedLines }>`.
 *
 * `status` is `A` (added), `D` (deleted) or `M`; a rename is `M` under its
 * new path. `changedLines` counts every `+` and `-` line, which is the number
 * the threshold compares. Each hunk keeps its new-side range and the text of
 * its changed lines, because a changed `Spec:` line is recognised from the
 * text and not from a position.
 */
export function parseUnifiedDiff(text) {
  const files = new Map();
  let current = null;
  for (const line of String(text ?? "").split("\n")) {
    const header = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (header) {
      current = { status: "M", hunks: [], changedLines: 0 };
      files.set(header[2], current);
      continue;
    }
    if (!current) continue;
    if (/^new file mode/.test(line)) current.status = "A";
    else if (/^deleted file mode/.test(line)) current.status = "D";
    else if (line.startsWith("+++ ") || line.startsWith("--- ")) continue;
    else if (HUNK.test(line)) {
      const [, oldStart, oldCount, newStart, newCount] = line.match(HUNK);
      current.hunks.push({
        oldStart: Number(oldStart),
        oldCount: oldCount === undefined ? 1 : Number(oldCount),
        newStart: Number(newStart),
        newCount: newCount === undefined ? 1 : Number(newCount),
        lines: [],
      });
    } else if ((line.startsWith("+") || line.startsWith("-")) && current.hunks.length) {
      current.hunks[current.hunks.length - 1].lines.push(line);
      current.changedLines += 1;
    }
  }
  return files;
}

/** The new-side lines a hunk touches. A pure deletion touches its two neighbours. */
export function hunkRange(hunk) {
  if (hunk.newCount === 0) return [Math.max(1, hunk.newStart), hunk.newStart + 1];
  return [hunk.newStart, hunk.newStart + hunk.newCount - 1];
}

const namesSlug = (text, slug) =>
  new RegExp(`(^|[^a-z0-9-])${slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z0-9-])`).test(text);

/**
 * Where a block that starts at `start` ends: the line on which the braces
 * opened since `start` close again. A start line with no brace within its
 * first three lines is a one-statement anchor (`// Spec: fr-3` above a
 * `const`), which ends at the next blank line. A block that never closes runs
 * to the end of the file, which errs towards judging.
 */
export function blockEnd(lines, start) {
  let depth = 0;
  let opened = false;
  for (let i = start; i < lines.length; i += 1) {
    if (!opened && i - start >= 3) break;
    const text = lines[i];
    for (const ch of text) {
      if (ch === "{") {
        depth += 1;
        opened = true;
      } else if (ch === "}") depth -= 1;
    }
    if (opened && depth <= 0) return i;
  }
  if (!opened) {
    for (let i = start + 1; i < lines.length; i += 1) if (lines[i].trim() === "") return i - 1;
  }
  return lines.length - 1;
}

/**
 * The anchored blocks of one source text, 1-based inclusive line ranges, each
 * with the slugs it anchors.
 *
 * A block is a `describe`/`it`/`test` whose title names a slug, or the block
 * a `Spec:` comment anchors: the enclosing test call when the comment sits
 * inside one, else the symbol that follows it. The FIRST `Spec:` line is the
 * file-level anchor and names no block: it anchors the whole file, which is
 * what the line-count threshold exists for.
 */
export function anchoredBlocks(source, slugs = []) {
  const lines = String(source ?? "").split("\n");
  const calls = [];
  lines.forEach((text, i) => {
    const m = text.match(TEST_CALL);
    if (m) calls.push({ start: i, end: blockEnd(lines, i), title: m[2] });
  });

  const blocks = [];
  for (const call of calls) {
    const named = slugs.filter((s) => namesSlug(call.title, s));
    if (named.length) blocks.push({ start: call.start + 1, end: call.end + 1, slugs: named });
  }

  const specLines = findSpecLines(source);
  for (const spec of specLines.slice(1)) {
    if (spec.parsed.kind !== "anchors") continue;
    const named = sortedUnique(spec.parsed.anchors.map((a) => parseAnchor(a).slug));
    const at = spec.line - 1;
    const enclosing = calls
      .filter((c) => c.start < at && at <= c.end)
      .sort((a, b) => b.start - a.start)[0];
    const start = enclosing ? enclosing.start : at;
    const end = enclosing ? enclosing.end : blockEnd(lines, at);
    blocks.push({ start: start + 1, end: end + 1, slugs: named });
  }
  return blocks;
}

/**
 * Which of a changed file's nodes its hunks reach.
 *
 * Every node is judged when the file is new or deleted, or when any changed
 * line is a `Spec:` line: an anchor that moved is a change to what the file
 * claims, and that claim is judged whole. Otherwise a node anchored by a
 * block is judged only when a hunk touches that block, and a node anchored
 * at file level only is judged when the diff has at least `minLines` changed
 * lines. `reason` is one sentence fragment for the whole file, used when a
 * node ends up reached by nothing.
 */
export function touchedNodes({ source = "", slugs = [], diff, minLines = MIN_LINES } = {}) {
  const all = sortedUnique(slugs);
  const everything = (why) => ({ judged: new Set(all), why, reason: null });
  if (!diff) return everything("not in the diff, so kept");
  if (diff.status === "A") return everything("new file");
  if (diff.status === "D") return everything("deleted file");
  if (diff.hunks.some((h) => h.lines.some((l) => SPEC_COMMENT.test(l.slice(1))))) {
    return everything("a Spec: line changed");
  }

  const blocks = anchoredBlocks(source, all);
  const blockAnchored = new Set(blocks.flatMap((b) => b.slugs));
  const judged = new Set();
  for (const hunk of diff.hunks) {
    const [from, to] = hunkRange(hunk);
    for (const block of blocks) {
      if (block.end < from || block.start > to) continue;
      for (const s of block.slugs) judged.add(s);
    }
  }
  const fileLevelOnly = all.filter((s) => !blockAnchored.has(s));
  const overThreshold = diff.changedLines >= minLines;
  if (overThreshold) for (const s of fileLevelOnly) judged.add(s);

  const n = diff.changedLines;
  const reason =
    fileLevelOnly.length && !overThreshold
      ? blockAnchored.size
        ? `whose ${n}-line diff touches no anchored block and is under the ${minLines}-line threshold`
        : `whose ${n}-line diff is under the ${minLines}-line threshold (no block anchors a node here)`
      : `whose ${n}-line diff touches no anchored block`;
  return { judged, why: null, reason };
}

/**
 * The anchors a diff-aware plan runs on, and the nodes it let go.
 *
 * `sources(file)` returns the HEAD-side text of a file (or "" when it has
 * none). A node is dropped only when NOTHING reaches it after pruning: a
 * node one hub file's hunks miss is still judged when another changed file
 * reaches it, and so is a governing requirement any judged node answers to.
 */
export function pruneAnchors({
  anchors = {},
  governs = {},
  diff = new Map(),
  sources = () => "",
  minLines = MIN_LINES,
} = {}) {
  const pruned = {};
  const reasons = {};
  for (const [file, slugs] of Object.entries(anchors)) {
    const result = touchedNodes({
      source: sources(file),
      slugs: slugs ?? [],
      diff: diff.get(file),
      minLines,
    });
    pruned[file] = [...result.judged].sort();
    if (result.reason) reasons[file] = result.reason;
  }

  const before = reachSets({ anchors, governs });
  const after = reachSets({ anchors: pruned, governs });
  const notJudged = [];
  for (const [node, files] of before) {
    if (after.has(node)) continue;
    const because = files.map((f) => `${f}, ${reasons[f] ?? "whose diff reaches nothing here"}`);
    notJudged.push({ node, reason: `reached only by ${because.join("; ")}` });
  }
  return { anchors: pruned, notJudged: notJudged.sort((a, b) => a.node.localeCompare(b.node)) };
}

/** The `## Not judged` block a plan prints beside its JSON. */
export function renderNotJudged(notJudged = [], minLines = MIN_LINES) {
  const out = [NOT_JUDGED_HEADING, "", `min-lines threshold: ${minLines}`, ""];
  if (notJudged.length === 0) out.push("Every reached node is judged.");
  else for (const n of notJudged) out.push(`- \`${n.node}\`: ${n.reason}`);
  return `${out.join("\n")}\n`;
}

// ------------------------------------------------------------- the judge table

const cells = (line) =>
  line
    .match(TABLE_ROW)[1]
    .split("|")
    .map((c) => c.trim());

const plain = (raw) => String(raw ?? "").replace(/[`*]/g, "").trim();

/** Strip the `**strict**` flag from a node cell, keeping the flag as a fact. */
const cleanNode = (raw) => {
  const strict = /\*\*strict\*\*/i.test(raw);
  return { slug: plain(String(raw).replace(/\*\*strict\*\*/gi, "")), strict };
};

/**
 * Every judge table in a markdown blob, in the seven-column shape a judge
 * returns.
 *
 * A malformed row is RETURNED as a fault rather than dropped, for the reason
 * `parseVerdictTable` gives: an aggregation that silently skips the row it
 * could not read is an aggregation that reports on nothing. The evidence cell
 * is optional in the parse and mandatory in the rule, so a judge that omitted
 * the column is downgraded rather than being read as malformed.
 */
export function parseJudgeTables(markdown) {
  const rows = [];
  const faults = [];
  const lines = String(markdown ?? "").split("\n");

  lines.forEach((line, i) => {
    if (!TABLE_ROW.test(line)) return;
    if (TABLE_RULE.test(line)) return;
    const c = cells(line);
    if (/^node$/i.test(c[0] ?? "")) return; // the header

    if (c.length < 6 || c.length > 7) {
      faults.push({ line: i + 1, text: line.trim(), why: `${c.length} cells, expected 6 or 7` });
      return;
    }
    const verdict = plain(c[3]).toLowerCase();
    if (!ROW_VALUES.includes(verdict)) {
      faults.push({ line: i + 1, text: line.trim(), why: `"${c[3]}" is not a verdict` });
      return;
    }
    const { slug, strict } = cleanNode(c[0]);
    rows.push({
      node: slug,
      strict,
      criterion: plain(c[1]),
      judgedAgainst: plain(c[2]),
      verdict,
      specLine: c[4].trim(),
      where: c[5].trim(),
      evidence: (c[6] ?? "").trim(),
    });
  });

  return { rows, faults };
}

// ----------------------------------------------------------- the evidence rule

/**
 * Whether an evidence cell names a concrete input AND the wrong result.
 *
 * The judge is told the exact form, so this is a match and never a reading of
 * intent. A cell that is empty, `n/a`, a dash, or prose without both halves
 * fails, and a `drifted` row that fails becomes a `suspect`.
 */
export function hasEvidence(evidence) {
  const m = String(evidence ?? "").match(EVIDENCE_SHAPE);
  if (!m) return false;
  const [, input, result] = m;
  return input.trim().length > 0 && result.trim().length > 0;
}

/**
 * Downgrade every `drifted` row that shows no evidence to `suspect`.
 *
 * `matched` and `unverifiable` are untouched: the rule exists to stop a
 * suspicion being CLAIMED as drift, not to raise the bar on conformance.
 */
export function applyEvidenceRule(rows = []) {
  const downgraded = [];
  const out = rows.map((row) => {
    if (row.verdict !== "drifted" || hasEvidence(row.evidence)) return row;
    const next = { ...row, verdict: SUSPECT, downgradedFrom: "drifted", why: NO_EVIDENCE };
    downgraded.push(next);
    return next;
  });
  return { rows: out, downgraded };
}

/** The rows tier 2 re-runs: exactly the ones the measurement calls unreliable. */
export function rowsForRerun(rows = []) {
  return rows.filter((r) => r.verdict === "drifted" || r.verdict === SUSPECT);
}

const rowKey = (row) => `${row.node} ${row.criterion}`;

/**
 * Tier 2 wins where it spoke; a disagreement is recorded and never hidden.
 *
 * Only `drifted` and `suspect` rows are re-run, so a tier-2 row always has a
 * tier-1 row behind it. One that does not is kept anyway rather than dropped:
 * an unexplained row is a fact about the run.
 */
export function reconcileTiers(tierOne = [], tierTwo = []) {
  const second = new Map(tierTwo.map((r) => [rowKey(r), r]));
  const disagreements = [];
  const rows = tierOne.map((first) => {
    const later = second.get(rowKey(first));
    if (!later) return first;
    second.delete(rowKey(first));
    if (later.verdict !== first.verdict) {
      disagreements.push({
        node: first.node,
        criterion: first.criterion,
        tierOne: first.verdict,
        tierTwo: later.verdict,
      });
    }
    return { ...later, tierOneVerdict: first.verdict };
  });
  return { rows: [...rows, ...second.values()], disagreements };
}

// -------------------------------------------------------------- the rendering

const row = (values) => `| ${values.join(" | ")} |`;

const table = (columns, body) =>
  [row(columns), row(columns.map(() => "---")), ...body].join("\n");

const nodeCell = (r) => (r.strict ? `${r.node} **strict**` : r.node);

/**
 * The six-column `## Spec verdicts` table, carrying only the three claimable
 * verdicts. A `suspect` row is not written here, and the heading is not
 * emitted by this function: the caller places it, because `## Suspect rows`
 * must follow it.
 */
export function renderVerdictTable(rows = []) {
  const keep = rows.filter((r) => VERDICTS.includes(r.verdict));
  return table(
    VERDICT_COLUMNS,
    keep.map((r) => row([nodeCell(r), r.criterion, r.judgedAgainst, r.verdict, r.specLine, r.where]))
  );
}

/**
 * The `## Suspect rows` table. Empty is said in words, never as a bare header.
 *
 * It carries the judge's OWN words alongside the spec line, because a suspect
 * row exists to be read by a person and the criterion alone does not say what
 * was suspected. The evidence cell of a suspect row is by definition whatever
 * failed `EVIDENCE_SHAPE`, which is usually the prose the judge wrote.
 */
export function renderSuspectTable(rows = []) {
  const keep = rows.filter((r) => r.verdict === SUSPECT);
  if (keep.length === 0) return "No suspect row: every drifted verdict showed its evidence.";
  return table(
    ["node", "criterion", "spec line", "what the judge wrote", "why it is not drift", "where"],
    keep.map((r) =>
      row([
        nodeCell(r),
        r.criterion,
        r.specLine,
        r.evidence?.trim() ? r.evidence : "nothing in the evidence cell",
        r.why ?? NO_EVIDENCE,
        r.where,
      ])
    )
  );
}

/** The `## Tier disagreements` table. Nothing parses it; it is calibration. */
export function renderDisagreements(disagreements = []) {
  if (disagreements.length === 0) return "No row changed verdict between the two tiers.";
  return table(
    ["node", "criterion", `tier 1 (${TIER_ONE_MODEL})`, "tier 2 (default)"],
    disagreements.map((d) => row([d.node, d.criterion, d.tierOne, d.tierTwo]))
  );
}

/** Counts by value, for the one-line summary the skill ends on. */
export function summarise(rows = []) {
  const counts = Object.fromEntries(ROW_VALUES.map((v) => [v, 0]));
  for (const r of rows) if (counts[r.verdict] !== undefined) counts[r.verdict] += 1;
  return { total: rows.length, ...counts };
}

// ------------------------------------------------------- the audit comparison

/**
 * The old shape's rows against the new shape's, row by row.
 *
 * This is the regression test that must run before the cap, the tier
 * split or the evidence rule is tuned any further: a shape that misses a row
 * the old one caught is worse and not quieter. It compares by (node,
 * criterion), so a row that only moved between groups is not a difference.
 */
export function compareToAudit(auditRows = [], newRows = []) {
  const before = new Map(auditRows.map((r) => [rowKey(r), r]));
  const after = new Map(newRows.map((r) => [rowKey(r), r]));

  const agreed = [];
  const changed = [];
  const missing = [];
  const added = [];

  for (const [key, was] of before) {
    const now = after.get(key);
    if (!now) {
      missing.push(was);
      continue;
    }
    (was.verdict === now.verdict ? agreed : changed).push({
      node: was.node,
      criterion: was.criterion,
      was: was.verdict,
      now: now.verdict,
    });
  }
  for (const [key, now] of after) if (!before.has(key)) added.push(now);

  // A drifted row the new shape no longer calls drifted is the regression this
  // comparison exists to surface, so it is counted apart from every other
  // difference rather than being one line of `changed`.
  const lostDrift = changed.filter((c) => c.was === "drifted" && c.now !== "drifted");

  return {
    agreed,
    changed,
    missing,
    added,
    lostDrift,
    summary: {
      audit: before.size,
      judged: after.size,
      agreed: agreed.length,
      changed: changed.length,
      missing: missing.length,
      added: added.length,
      lostDrift: lostDrift.length,
    },
  };
}

// -------------------------------------------------------------------- the CLI

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

const readJsonIf = (path, fallback) => (path && existsSync(path) ? readJson(path) : fallback);

const flag = (argv, name) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};

/** A judge-table path, or a directory of them (`/tmp/judges/<id>.md`), as one text. */
export function readTables(path) {
  if (statSync(path).isDirectory()) {
    return readdirSync(path)
      .filter((f) => f.endsWith(".md"))
      .sort()
      .map((f) => readFileSync(join(path, f), "utf8"))
      .join("\n\n");
  }
  return readFileSync(path, "utf8");
}

const git = (args, cwd) => {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return { ok: r.status === 0, out: r.stdout ?? "", err: r.stderr ?? "" };
};

/** The commit the diff is taken from: the merge base with HEAD, or the ref itself. */
export function diffBaseCommit(ref, cwd) {
  const mb = git(["merge-base", ref, "HEAD"], cwd);
  if (mb.ok && mb.out.trim()) return mb.out.trim();
  const direct = git(["rev-parse", "--verify", `${ref}^{commit}`], cwd);
  return direct.ok ? direct.out.trim() : null;
}

/** `git diff --unified=0 <base> -- <files>` against the working tree, parsed. */
function diffAgainst(base, files, cwd) {
  const args = ["diff", "--unified=0", "--no-color", "--no-ext-diff", base, "--", ...files];
  const r = git(args, cwd);
  if (!r.ok) throw new Error(`git diff failed: ${r.err.trim()}`);
  return parseUnifiedDiff(r.out);
}

const readSource = (cwd) => (file) => {
  try {
    return readFileSync(resolve(cwd, file), "utf8");
  } catch {
    return "";
  }
};

/** The `Spec:` slugs of one text, `support` contributing nothing. */
const slugsOf = (text) =>
  sortedUnique(
    findSpecLines(text)
      .filter((s) => s.parsed.kind === "anchors")
      .flatMap((s) => s.parsed.anchors.map((a) => parseAnchor(a).slug)),
  );

/**
 * The shared client, as a function. Every non-zero exit stops `prepare` with
 * the client's own exit code and its own words, because a plan built on a
 * specification that could not be read is a plan that judges against memory.
 */
function clientFor(script, cwd) {
  return (...args) => {
    const r = spawnSync("bash", [script, ...args], { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    if (r.status !== 0) {
      process.stderr.write(r.stderr ?? "");
      process.stderr.write(`judge-plan prepare: the client exited ${r.status} on \`${args.join(" ")}\`\n`);
      process.exit(r.status || 5);
    }
    try {
      return JSON.parse(r.stdout);
    } catch {
      process.stderr.write(`judge-plan prepare: the client answered \`${args.join(" ")}\` with something that is not JSON\n`);
      process.exit(5);
    }
  };
}

function prepare(argv, cwd) {
  const ref = flag(argv, "diff-base");
  if (!ref) {
    process.stderr.write("prepare needs --diff-base=<ref>\n");
    return 2;
  }
  // Dormancy first, before any credential or client is touched: with no
  // product there is nothing to prepare and nothing about the loop to say.
  const product = flag(argv, "product") ?? productSlug(cwd);
  if (!product) {
    process.stderr.write("spec loop not connected: no spec_product in .harness-version and no --product\n");
    return 2;
  }
  const base = diffBaseCommit(ref, cwd);
  if (!base) {
    process.stderr.write(`prepare: ${ref} is not a commit this repository knows\n`);
    return 2;
  }
  const out = resolve(cwd, flag(argv, "out") ?? INPUTS_DIR);
  const retrieval = flag(argv, "retrieval");
  const allPath = flag(argv, "all") ?? (retrieval ? join(retrieval, "all.json") : null);
  const client = clientFor(flag(argv, "client") ?? ".claude/scripts/spec-universe.sh", cwd);
  const key = flag(argv, "key");
  const minLines = Number(flag(argv, "min-lines") ?? MIN_LINES);

  // 1. The changed files and their anchors, from BOTH sides of the diff, so a
  //    deleted or moved file still fans out to the nodes it served.
  const status = git(["diff", "--name-status", base], cwd);
  if (!status.ok) {
    process.stderr.write(`prepare: git diff failed: ${status.err.trim()}\n`);
    return 2;
  }
  const changed = [];
  for (const line of status.out.split("\n")) {
    const [code, ...paths] = line.split("\t");
    if (!code || paths.length === 0) continue;
    changed.push({ status: code[0], path: paths[paths.length - 1], from: paths.length > 1 ? paths[0] : null });
  }
  const anchors = {};
  const source = readSource(cwd);
  for (const c of changed) {
    const before = git(["show", `${base}:${c.from ?? c.path}`], cwd);
    const slugs = sortedUnique([...slugsOf(before.ok ? before.out : ""), ...slugsOf(source(c.path))]);
    if (slugs.length) anchors[c.path] = slugs;
  }

  // 2. The change's own proposals, which implicate their nodes on their own.
  const proposals = key ? unwrapProposals(client("change-proposals", key)) : [];
  const always = proposalNodes(proposals);

  // 3. What the diff reaches, fetched once each, reusing what retrieval already
  //    holds; governing requirements are followed transitively.
  const known = new Map();
  const all = readJsonIf(allPath, null);
  const allNodes = Array.isArray(all) ? all : (all?.nodes ?? null);
  if (allNodes) for (const n of allNodes) if (n?.localSlug) known.set(n.localSlug, n);

  const nodes = [];
  const governs = {};
  const criteria = {};
  const unresolved = [];
  const seen = new Set();
  const queue = sortedUnique([...Object.values(anchors).flat(), ...Object.keys(always)]);
  while (queue.length) {
    const slug = queue.shift();
    if (seen.has(slug)) continue;
    seen.add(slug);
    if (allNodes && !known.has(slug)) {
      unresolved.push(slug);
      continue;
    }
    const id = `${product}.${slug}`;
    const cachedNode = retrieval ? join(retrieval, `${slug}.node.json`) : null;
    const cachedDeps = retrieval ? join(retrieval, `${slug}.deps.json`) : null;
    const payload = readJsonIf(cachedNode, null) ?? client("node", id);
    const node = unwrapNode(payload);
    nodes.push(payload);
    criteria[slug] = (node?.acceptanceCriteria ?? known.get(slug)?.acceptanceCriteria ?? []).map((c) => c.id);
    const edges = unwrapEdges(readJsonIf(cachedDeps, null) ?? client("dependencies", id, "out"));
    const targets = [];
    for (const edge of edges) {
      const type = edge?.type ?? edge?.edgeType ?? edge?.kind ?? "";
      const target = edge?.target ?? edge?.to ?? edge?.node ?? {};
      const t = localSlug(target?.localSlug ?? target?.slug ?? target?.id ?? "");
      if (!t) continue;
      // Governance is what gets judged with criteria; a proposal's node also
      // pulls in what it declares it depends on, whole-node.
      if (type === "is-governed-by" || always[slug]) targets.push(t);
    }
    governs[slug] = sortedUnique(targets);
    queue.push(...governs[slug]);
  }

  // 4. Every file anchoring a reached node, for the on-demand list.
  const index = {};
  for (const root of DOMAIN_ROOTS) {
    for (const file of collectFiles(root, cwd)) {
      for (const slug of slugsOf(source(file))) {
        if (!seen.has(slug)) continue;
        (index[slug] ??= []).push(file);
      }
    }
  }
  for (const slug of Object.keys(index)) index[slug] = sortedUnique(index[slug]);

  mkdirSync(out, { recursive: true });
  const write = (name, value) => writeFileSync(join(out, name), `${JSON.stringify(value, null, 2)}\n`);
  write("anchors.json", anchors);
  write("governs.json", governs);
  write("criteria.json", criteria);
  write("index.json", index);
  write("nodes.json", nodes);
  write("proposals.json", proposals);
  write("prepare.json", { product, key, diffBase: ref, base, minLines, changed, unresolved, proposalNodes: always });

  process.stderr.write(
    `judge-plan prepare: ${changed.length} changed files, ${Object.keys(anchors).length} anchoring, ` +
      `${nodes.length} nodes fetched, ${proposals.length} proposals, ${unresolved.length} unresolved` +
      `${unresolved.length ? ` (${unresolved.join(", ")})` : ""}; inputs in ${out}\n`,
  );
  return 0;
}

function plan(argv, cwd) {
  const inputs = resolve(cwd, flag(argv, "inputs") ?? INPUTS_DIR);
  const pick = (name) => flag(argv, name) ?? join(inputs, `${name}.json`);
  const explicit = flag(argv, "anchors");
  if (!explicit && !existsSync(join(inputs, "anchors.json"))) {
    process.stderr.write(`plan: no anchors.json in ${inputs} and no --anchors; run prepare first\n`);
    return 2;
  }
  let anchors = readJson(pick("anchors"));
  const governs = readJsonIf(pick("governs"), {});
  const criteria = readJsonIf(pick("criteria"), {});
  const index = readJsonIf(pick("index"), {});
  const always = proposalNodes(readJsonIf(pick("proposals"), []));
  const minLines = Number(flag(argv, "min-lines") ?? MIN_LINES);

  let notJudged = [];
  let base = null;
  const ref = flag(argv, "diff-base");
  if (ref) {
    base = diffBaseCommit(ref, cwd);
    if (!base) {
      process.stderr.write(`plan: ${ref} is not a commit this repository knows\n`);
      return 2;
    }
    const diff = diffAgainst(base, Object.keys(anchors), cwd);
    const pruned = pruneAnchors({ anchors, governs, diff, sources: readSource(cwd), minLines });
    anchors = pruned.anchors;
    notJudged = pruned.notJudged.filter((n) => !always[n.node]);
  }

  const judges = planJudges({
    anchors,
    governs,
    criteria,
    index,
    cap: Number(flag(argv, "cap") ?? CRITERION_CAP),
    always,
  });
  process.stdout.write(`${JSON.stringify({ judges, notJudged, minLines, diffBase: base }, null, 2)}\n`);
  if (ref) process.stderr.write(renderNotJudged(notJudged, minLines));
  return 0;
}

function rows(argv) {
  const one = parseJudgeTables(readTables(flag(argv, "tier1")));
  const two = flag(argv, "tier2")
    ? parseJudgeTables(readTables(flag(argv, "tier2")))
    : { rows: [], faults: [] };
  const faults = [...one.faults, ...two.faults];

  const first = applyEvidenceRule(one.rows);
  const second = applyEvidenceRule(two.rows);
  const { rows, disagreements } = reconcileTiers(first.rows, second.rows);

  // A tier-1 drifted row is INPUT to tier 2, never a finding. Until the
  // tier-2 row exists the table is provisional, and it says so in its
  // heading, which the gate's parser does not read as a verdict table.
  const rerun = flag(argv, "tier2") ? [] : rowsForRerun(rows);
  const provisional = rerun.length > 0;

  const out = [
    provisional ? PROVISIONAL_HEADING : VERDICT_HEADING,
    "",
    renderVerdictTable(rows),
    "",
    SUSPECT_HEADING,
    "",
    renderSuspectTable(rows),
    "",
    DISAGREEMENT_HEADING,
    "",
    renderDisagreements(disagreements),
    "",
  ];
  if (provisional) {
    out.push(RERUN_HEADING, "");
    for (const r of rerun) out.push(`- ${r.node} ${r.criterion} (${r.verdict})`);
    out.push("");
  }
  if (faults.length > 0) {
    out.push("Rows that could not be read:", "");
    for (const f of faults) out.push(`- line ${f.line}: ${f.why}. \`${f.text}\``);
    out.push("");
  }
  process.stdout.write(out.join("\n"));
  process.stderr.write(`${JSON.stringify({ ...summarise(rows), provisional })}\n`);
  return faults.length > 0 ? 1 : 0;
}

function main(argv) {
  const command = argv[0];
  const cwd = process.cwd();

  if (command === "prepare") return prepare(argv, cwd);
  if (command === "plan") return plan(argv, cwd);
  if (command === "rows") return rows(argv);

  if (command === "compare") {
    const audit = parseJudgeTables(readFileSync(flag(argv, "audit"), "utf8")).rows;
    const fresh = parseJudgeTables(readFileSync(flag(argv, "new"), "utf8")).rows;
    const result = compareToAudit(audit, fresh);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result.lostDrift.length > 0 || result.missing.length > 0 ? 1 : 0;
  }

  process.stderr.write("usage: judge-plan.mjs <prepare|plan|rows|compare> [--flags]\n");
  return 2;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exit(main(process.argv.slice(2)));
}
