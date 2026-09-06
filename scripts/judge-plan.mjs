#!/usr/bin/env node
/**
 * judge-plan.mjs: the Spec axis judge, as a deterministic answer.
 *
 * Zero dependencies. Requires Node 22+. Run from the repo root, from
 * `.claude/skills/code-review/SKILL.md`:
 *
 *   node scripts/judge-plan.mjs plan --anchors=<changed files to nodes.json> \
 *     --governs=<node to governing requirements.json> \
 *     --criteria=<node to criterion ids.json> --index=<node to all files.json>
 *
 *   node scripts/judge-plan.mjs rows --tier1=<judge tables.md> [--tier2=<md>]
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

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// ------------------------------------------------------------------ constants

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
 */
export function planJudges({
  anchors = {},
  governs = {},
  criteria = {},
  index = {},
  cap = CRITERION_CAP,
} = {}) {
  const reach = reachSets({ anchors, governs });
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

const flag = (argv, name) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};

function main(argv) {
  const command = argv[0];

  if (command === "plan") {
    const judges = planJudges({
      anchors: readJson(flag(argv, "anchors")),
      governs: flag(argv, "governs") ? readJson(flag(argv, "governs")) : {},
      criteria: flag(argv, "criteria") ? readJson(flag(argv, "criteria")) : {},
      index: flag(argv, "index") ? readJson(flag(argv, "index")) : {},
      cap: Number(flag(argv, "cap") ?? CRITERION_CAP),
    });
    process.stdout.write(`${JSON.stringify({ judges }, null, 2)}\n`);
    return 0;
  }

  if (command === "rows") {
    const one = parseJudgeTables(readFileSync(flag(argv, "tier1"), "utf8"));
    const two = flag(argv, "tier2")
      ? parseJudgeTables(readFileSync(flag(argv, "tier2"), "utf8"))
      : { rows: [], faults: [] };
    const faults = [...one.faults, ...two.faults];

    const first = applyEvidenceRule(one.rows);
    const second = applyEvidenceRule(two.rows);
    const { rows, disagreements } = reconcileTiers(first.rows, second.rows);

    const out = [
      VERDICT_HEADING,
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
    if (faults.length > 0) {
      out.push("Rows that could not be read:", "");
      for (const f of faults) out.push(`- line ${f.line}: ${f.why}. \`${f.text}\``);
      out.push("");
    }
    process.stdout.write(out.join("\n"));
    process.stderr.write(`${JSON.stringify(summarise(rows))}\n`);
    return faults.length > 0 ? 1 : 0;
  }

  if (command === "compare") {
    const audit = parseJudgeTables(readFileSync(flag(argv, "audit"), "utf8")).rows;
    const fresh = parseJudgeTables(readFileSync(flag(argv, "new"), "utf8")).rows;
    const result = compareToAudit(audit, fresh);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result.lostDrift.length > 0 || result.missing.length > 0 ? 1 : 0;
  }

  process.stderr.write("usage: judge-plan.mjs <plan|rows|compare> [--flags]\n");
  return 2;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exit(main(process.argv.slice(2)));
}
