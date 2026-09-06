#!/usr/bin/env node
/**
 * gate-run.mjs: the preprod gate, as a deterministic answer.
 *
 * Zero dependencies. Requires Node 22+. Run from the repo root, from step 4b
 * of `.claude/skills/to-preprod/SKILL.md`:
 *
 *   node scripts/gate-run.mjs --key=<CHANGE KEY> --verdicts=<feature context.md> \
 *     --nodes=<node payloads.json> --proposals=<change proposals.json> \
 *     --head-sha=<sha> --merge-base=<sha> --work-item=<url> --branch=<name>
 *
 * The gate refuses a merge that carries drift the branch itself introduced and
 * nobody decided. It does NOT refuse drift that was already recorded before
 * the branch existed: an audit of an existing product routinely records dozens
 * of drifted criteria at once, and gating on those stops merges that never
 * touched them (the gate section of .claude/SPEC-LOOP.md).
 *
 * Two modes, `gate-mode:` in `.harness-version`, defaulting to `evaluate`.
 * Both compute the same rows and print the same words; only `enforce` stops.
 * `resolveGateMode` below owns what a mode is and who may change it, and two
 * things are exempt from it: see `wouldStop` and the caller's fail-closed rule,
 * which never reaches here.
 *
 * The baseline is not a new artifact: Spec Universe already records
 * conformance per criterion, and `/release` refreshes it at every release, so
 * the record IS the state as of the last release. The three baseline states
 * and what each does to a `drifted` row have one home, the gate section of
 * .claude/SPEC-LOOP.md; `baselineOf` below is that table in code.
 *
 * Structure: everything above the CLI section at the foot of this file is pure
 * and exported, so a project's own unit tests drive it with in-memory input and
 * need no network, no fixture tree, and no running Spec Universe. Only that
 * section and `main()` read a file or exit.
 */

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// ------------------------------------------------------------------ constants

/** The two modes. Anything else is refused naming both. */
export const MODES = ["evaluate", "enforce"];

/** What an absent `gate-mode:` key means. Permissive first, by decision. */
export const DEFAULT_MODE = "evaluate";

/** Where a run record lands. Committed, and it survives the merge. */
export const RUNS_DIR = ".harness/gate-runs";

/** The verdicts a judge may return (`/code-review`, Spec axis). */
export const VERDICTS = ["matched", "drifted", "unverifiable"];

/** The heading a blocking row is printed under, in BOTH modes. */
export const STOP_HEADING = "Rows that stop this merge:";

/** The one line `evaluate` adds, and `enforce` does not. */
export const EVALUATE_NOTE =
  "Mode is evaluate, so the merge proceeds. Record the disposition on the work item.";

/**
 * A `gate-mode:` line, and only a line that is nothing else.
 *
 * Anchored whole, and NO backticks: the feature context is markdown, and the
 * feature that introduced this key discusses it in prose, so a line wrapped in
 * a code span (`gate-mode: enforce` on its own, after a paragraph wrapped) must
 * not be read as configuration. A list marker is tolerated, because a context
 * naturally states the key as a bullet.
 */
const MODE_LINE = /^\s*(?:[-*]\s+)?gate-mode\s*:\s*([a-z][a-z-]*)\s*$/;

/** A markdown table row: leading pipe, cells, trailing pipe. */
const TABLE_ROW = /^\s*\|(.+)\|\s*$/;

/** The separator under a table header. */
const TABLE_RULE = /^[\s|:-]+$/;

// ------------------------------------------------------------------- the mode

/**
 * The `gate-mode:` value in a file's text, or null when the key is absent.
 * Only the last whole-line occurrence counts, so a later line wins over an
 * earlier one exactly as a YAML key would.
 */
export function readGateModeKey(text) {
  let found = null;
  for (const line of String(text ?? "").split("\n")) {
    const m = line.match(MODE_LINE);
    if (m) found = m[1];
  }
  return found;
}

const badMode = (value, where) => ({
  ok: false,
  message: `gate-mode "${value}" in ${where} is not a mode. The modes are ${MODES.join(" and ")}.`,
});

/**
 * The mode this run answers to, and where it came from.
 *
 * The repository default lives in `.harness-version`. A branch may TIGHTEN it
 * from its feature context and may never loosen it: a branch that can switch
 * off the gate it is failing is not a gate.
 */
export function resolveGateMode({ harnessVersion = "", featureContext = "" } = {}) {
  const repoKey = readGateModeKey(harnessVersion);
  if (repoKey !== null && !MODES.includes(repoKey)) return badMode(repoKey, ".harness-version");
  const repo = repoKey ?? DEFAULT_MODE;
  const repoSource = repoKey === null ? "default (no gate-mode key)" : ".harness-version";

  const branchKey = readGateModeKey(featureContext);
  if (branchKey === null) return { ok: true, mode: repo, source: repoSource };
  if (!MODES.includes(branchKey)) return badMode(branchKey, "the feature context");

  if (branchKey === "enforce" && repo === "evaluate") {
    return { ok: true, mode: "enforce", source: "the feature context (tightened)" };
  }
  if (branchKey === "evaluate" && repo === "enforce") {
    return {
      ok: false,
      message:
        "the feature context asks for gate-mode evaluate where .harness-version says enforce. " +
        "A branch may tighten the gate and may never loosen it.",
    };
  }
  return { ok: true, mode: repo, source: `the feature context (agrees with ${repoSource})` };
}

// ---------------------------------------------------------- the verdict table

const cells = (line) =>
  line
    .match(TABLE_ROW)[1]
    .split("|")
    .map((c) => c.trim());

/** Strip backticks, bold markers and the `**strict**` flag from a node cell. */
const cleanNode = (raw) => {
  const strict = /\*\*strict\*\*/i.test(raw);
  const slug = raw
    .replace(/\*\*strict\*\*/gi, "")
    .replace(/[`*]/g, "")
    .trim();
  return { slug, strict };
};

/**
 * The `## Spec verdicts` table, in `/code-review`'s fixed six-column shape
 * (`node | criterion | judged against | verdict | spec line | where`).
 *
 * A malformed row is RETURNED as a fault rather than dropped: a gate that
 * silently skips the row it could not read is a gate that passes on nothing.
 * A context with no table at all yields no rows and no faults, which is the
 * vacuous pass the caller reports as "no node implicated".
 */
export function parseVerdictTable(markdown) {
  const lines = String(markdown ?? "").split("\n");
  const start = lines.findIndex((l) => /^#{1,6}\s+Spec verdicts\s*$/i.test(l));
  const rows = [];
  const faults = [];
  if (start === -1) return { rows, faults };

  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^#{1,6}\s+/.test(line)) break;
    if (!TABLE_ROW.test(line)) continue;
    if (TABLE_RULE.test(line)) continue;

    const c = cells(line);
    if (/^node$/i.test(c[0] ?? "")) continue; // the header

    if (c.length !== 6) {
      faults.push({ line: i + 1, text: line.trim(), why: `${c.length} cells, expected 6` });
      continue;
    }
    const [rawNode, criterion, judgedAgainst, verdict, specLine, where] = c;
    const { slug, strict } = cleanNode(rawNode);
    const v = verdict.replace(/[`*]/g, "").trim().toLowerCase();
    if (!VERDICTS.includes(v)) {
      faults.push({ line: i + 1, text: line.trim(), why: `"${verdict}" is not a verdict` });
      continue;
    }
    rows.push({
      node: slug,
      strict,
      criterion: criterion.replace(/[`*]/g, "").trim(),
      judgedAgainst: judgedAgainst.replace(/[`*]/g, "").trim(),
      verdict: v,
      specLine: specLine.trim(),
      where: where.trim(),
    });
  }
  return { rows, faults };
}

// ---------------------------------------------------------------- the baseline

const unwrapNode = (payload) => (payload && payload.node ? payload.node : payload);

const localPart = (slug) => String(slug ?? "").split(".").pop();

/**
 * `slug -> { node, criteria }` from what `spec-universe.sh node <id>` returns.
 *
 * Both the bare node object and a `{ node: ... }` envelope are accepted, and
 * every node is indexed under its full slug AND its local part, because a
 * verdict table may name either.
 */
export function baselineIndex(payloads = []) {
  const index = new Map();
  for (const payload of payloads) {
    const node = unwrapNode(payload);
    if (!node || !node.slug) continue;
    const criteria = {};
    for (const c of node.conformance?.criteria ?? []) criteria[c.id] = c.value ?? null;
    const entry = { slug: node.slug, node: node.conformance?.value ?? null, criteria };
    index.set(node.slug, entry);
    index.set(localPart(node.slug), entry);
  }
  return index;
}

/** The recorded conformance behind one verdict row, or null when nothing is. */
export function recordedFor(index, row) {
  // baselineIndex indexes every node under both spellings, so one lookup is
  // the whole lookup.
  const entry = index.get(row.node) ?? null;
  if (!entry) return null;
  const isCriterion = /^ac-\d+$/.test(row.criterion);
  return (isCriterion ? entry.criteria[row.criterion] : entry.node) ?? null;
}

/**
 * The three baseline states. Anything recorded that is neither `matched` nor
 * `drifted` (never claimed, `unverified`, `spec-ahead`, `retired`) reads
 * `pending`: an absence is not a regression, and it never blocks. The raw
 * recorded value travels into the run record, so nothing is hidden by the
 * mapping.
 */
export function baselineOf(recorded) {
  if (recorded === "matched") return "matched";
  if (recorded === "drifted") return "known";
  return "pending";
}

// ------------------------------------------------------------- the gate table

const STRICT = ["legal", "contractual"];

/**
 * Which proposal under the change key covers a row's node, and what that
 * means. Matching is by node: whether a proposal's `fields` touch what drifted
 * is a judgement, and this is the mechanical half.
 */
export function coverageFor(row, proposals = []) {
  const candidates = proposals.filter(
    (p) => localPart(p.node) === localPart(row.node)
  );
  // Deterministic, so a node carrying several proposals does not get a
  // different answer from a different array order. An accepted proposal is
  // the one that covers; only when none exists does a draft or a decline get
  // to speak.
  const governing =
    candidates.find((p) => ["accepted", "promoted"].includes(p.state)) ??
    candidates.find((p) => p.state === "draft") ??
    candidates.find((p) => p.state === "declined") ??
    null;
  if (!governing) return { status: "none", proposal: null };

  if (governing.state === "draft") return { status: "draft", proposal: governing };
  if (governing.state === "declined") return { status: "declined", proposal: governing };

  // Two spellings, because `spec-universe.sh change-proposals` could not be
  // run in the session that wrote this: the client's own docs record that the
  // /v1 dialect and the MCP schema disagree about key names elsewhere.
  const strictness = governing.nodeStrictness ?? governing.effectiveStrictness ?? "";
  const strict = row.strict || STRICT.includes(strictness);
  if (strict && governing.acceptedByKind !== "user") {
    return { status: "strict-not-user", proposal: governing };
  }
  return { status: "covered", proposal: governing };
}

const REASONS = {
  none: (row, key) =>
    `no proposal under ${key} covers \`${row.node}\` (${row.criterion}): draft the amendment (A), retire the node (B), or fix the code (C)`,
  draft: (row, _key, p) =>
    `\`${p.id}\` on \`${row.node}\` is drafted and not accepted; accept it before this merges`,
  declined: (row, _key, p) =>
    `\`${p.id}\` on \`${row.node}\` was declined: ${p.declineReason ?? "no reason recorded"}. Rework it, retire the node, or conform the code`,
  "strict-not-user": (row, _key, p) =>
    `the acceptance of \`${p.id}\` on \`${row.node}\` was not a person's act; a strict node is accepted on its own page only`,
};

/**
 * One classified row per verdict row.
 *
 * `blocking` means "would stop the merge under enforce". `alwaysBlocking`
 * means "stops in both modes", and only the strict-acceptance row is that: it
 * is a security control, not drift.
 *
 * A row is NEW drift when it is judged against `current` and its baseline is
 * `matched`, or when it is judged against a proposal, whose text has no prior
 * conformance record to have drifted from.
 */
export function classify({ rows = [], index = new Map(), proposals = [], changeKey = "" } = {}) {
  return rows.map((row) => {
    const againstCurrent = /^current$/i.test(row.judgedAgainst);
    const recorded = againstCurrent ? recordedFor(index, row) : null;
    const baseline = againstCurrent ? baselineOf(recorded) : "n/a (judged against a proposal)";
    const coverage = coverageFor(row, proposals);
    const isNew = row.verdict === "drifted" && (againstCurrent ? baseline === "matched" : true);

    // Both stops are scoped to a `drifted` verdict, because that is what the
    // gate table has always judged: a `matched` row is code that conforms, and
    // an `unverifiable` row is a wrong anchor. Whether an illegitimately
    // accepted proposal should stop a merge on a node that did NOT drift is a
    // separate control with a separate design, not a side effect of this one.
    const drifted = row.verdict === "drifted";
    const alwaysBlocking = drifted && coverage.status === "strict-not-user";
    const blocking =
      !alwaysBlocking && isNew && ["none", "draft", "declined"].includes(coverage.status);

    const reason = alwaysBlocking || blocking
      ? REASONS[coverage.status](row, changeKey, coverage.proposal)
      : null;

    return {
      ...row,
      recorded,
      baseline,
      isNew,
      coverage: coverage.status,
      proposalId: coverage.proposal?.id ?? null,
      alwaysBlocking,
      blocking,
      reason,
    };
  });
}

/**
 * Would this row stop the merge under `enforce`? The ONE definition, because
 * The gate's invariant is that the report and the record cannot disagree about
 * which rows those are.
 */
export const wouldStop = (r) => Boolean(r.alwaysBlocking || r.blocking);

/** Rows by verdict, and the drifted rows split three ways. */
export function summarise(classified = []) {
  const count = (fn) => classified.filter(fn).length;
  const drifted = classified.filter((r) => r.verdict === "drifted");
  return {
    rows: classified.length,
    matched: count((r) => r.verdict === "matched"),
    drifted: drifted.length,
    unverifiable: count((r) => r.verdict === "unverifiable"),
    driftedNew: drifted.filter((r) => r.isNew).length,
    driftedKnown: drifted.filter((r) => r.baseline === "known").length,
    driftedPending: drifted.filter((r) => r.baseline === "pending").length,
    blocking: count((r) => r.blocking),
    alwaysBlocking: count((r) => r.alwaysBlocking),
  };
}

/** The rows that actually stop THIS run, given the mode. */
export function stoppingRows(classified = [], mode = DEFAULT_MODE) {
  return classified.filter((r) => r.alwaysBlocking || (mode === "enforce" && r.blocking));
}

// --------------------------------------------------------------- the report

/**
 * One report, and the blocking rows read the same in both modes. A quieter
 * report is a different instrument, not a safer one, so `evaluate` adds a line
 * and changes nothing else.
 */
export function renderReport({ mode, modeSource, changeKey, classified = [], faults = [] } = {}) {
  const s = summarise(classified);
  const out = [
    `Preprod gate: ${mode} (from ${modeSource}), change ${changeKey}`,
    `  ${s.rows} verdict rows: ${s.matched} matched, ${s.drifted} drifted, ${s.unverifiable} unverifiable`,
    `  drifted: ${s.driftedNew} new, ${s.driftedKnown} known, ${s.driftedPending} pending`,
  ];

  const stops = classified.filter(wouldStop);
  if (stops.length) {
    out.push("", STOP_HEADING);
    for (const r of stops) {
      const flag = r.alwaysBlocking ? " [stops in both modes]" : "";
      out.push(`  ${r.node} ${r.criterion}: ${r.reason}${flag}`);
      out.push(`    spec line: ${r.specLine}`);
      out.push(`    where: ${r.where}  (baseline: ${r.baseline})`);
    }
  } else {
    out.push("", "Nothing would have stopped this merge.");
  }

  const unverifiable = classified.filter((r) => r.verdict === "unverifiable");
  if (unverifiable.length) {
    out.push("", "Anchors to repair (never blocking):");
    for (const r of unverifiable) out.push(`  ${r.node} ${r.criterion}: ${r.where}`);
  }

  if (faults.length) {
    out.push("", "Verdict rows that could not be read:");
    for (const f of faults) out.push(`  line ${f.line}: ${f.why} :: ${f.text}`);
  }

  if (mode === "evaluate" && stops.some((r) => !r.alwaysBlocking)) out.push("", EVALUATE_NOTE);
  return out;
}

// ------------------------------------------------------------- the run record

/**
 * The ledger entry. It is committed and it survives the merge, because a
 * record that dies with the feature context can never make a false-drift rate
 * over ten features. `disposition` is written later by a person, on the work
 * item the `dispositionUrl` points at.
 */
export function runRecord({
  changeKey,
  workItem = null,
  branch = null,
  mode,
  modeSource,
  headSha = null,
  mergeBase = null,
  classified = [],
  faults = [],
  ranAt = new Date(),
  dispositionUrl = null,
} = {}) {
  const s = summarise(classified);
  const stops = classified.filter(wouldStop);
  const stopped = stoppingRows(classified, mode).length > 0;
  return {
    changeKey,
    workItem,
    branch,
    ranAt: ranAt.toISOString(),
    mode,
    modeSource,
    headSha,
    mergeBase,
    rows: { matched: s.matched, drifted: s.drifted, unverifiable: s.unverifiable, total: s.rows },
    drifted: { new: s.driftedNew, known: s.driftedKnown, pending: s.driftedPending },
    blocking: stops.map((r) => ({
      node: r.node,
      criterion: r.criterion,
      judgedAgainst: r.judgedAgainst,
      baseline: r.baseline,
      recorded: r.recorded,
      coverage: r.coverage,
      proposalId: r.proposalId,
      stopsInBothModes: r.alwaysBlocking,
      reason: r.reason,
    })),
    unreadableRows: faults,
    outcome: stopped ? "stopped" : stops.length ? "merged-under-evaluate" : "merged-clean",
    disposition: null,
    dispositionUrl,
  };
}

/** The next free run number for a change key, so records never overwrite. */
export function nextRunNumber(existing = [], changeKey = "") {
  const prefix = `${changeKey}-`;
  const used = existing
    .filter((f) => f.startsWith(prefix) && f.endsWith(".json"))
    .map((f) => Number.parseInt(f.slice(prefix.length, -".json".length), 10))
    .filter((n) => Number.isInteger(n));
  return (used.length ? Math.max(...used) : 0) + 1;
}

// ------------------------------------------------------------------- the CLI

const flag = (argv, name, fallback = null) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const readIf = (path, fallback = "") => {
  if (!path) return fallback;
  try {
    return readFileSync(path, "utf8");
  } catch {
    return fallback;
  }
};

const readJson = (path, fallback) => {
  if (!path) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
};

export async function main(argv = process.argv.slice(2), cwd = process.cwd()) {
  const changeKey = flag(argv, "key");
  if (!changeKey) {
    console.error("gate-run: --key=<CHANGE KEY> is required.");
    return 2;
  }

  const resolved = resolveGateMode({
    harnessVersion: readIf(resolve(cwd, flag(argv, "harness-version", ".harness-version"))),
    featureContext: readIf(flag(argv, "verdicts")),
  });
  if (!resolved.ok) {
    console.error(`gate-run: ${resolved.message}`);
    return 2;
  }

  const { rows, faults } = parseVerdictTable(readIf(flag(argv, "verdicts")));
  const index = baselineIndex(readJson(flag(argv, "nodes"), []));
  const proposals = readJson(flag(argv, "proposals"), []);
  const classified = classify({ rows, index, proposals, changeKey });

  const record = runRecord({
    changeKey,
    workItem: flag(argv, "work-item"),
    branch: flag(argv, "branch"),
    mode: resolved.mode,
    modeSource: resolved.source,
    headSha: flag(argv, "head-sha"),
    mergeBase: flag(argv, "merge-base"),
    classified,
    faults,
    dispositionUrl: flag(argv, "disposition-url"),
  });

  const dir = resolve(cwd, flag(argv, "out", RUNS_DIR));
  mkdirSync(dir, { recursive: true });
  let existing = [];
  try {
    existing = readdirSync(dir);
  } catch {
    existing = [];
  }
  const path = join(dir, `${changeKey}-${nextRunNumber(existing, changeKey)}.json`);
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`);

  const report = renderReport({
    mode: resolved.mode,
    modeSource: resolved.source,
    changeKey,
    classified,
    faults,
  });
  console.log(report.join("\n"));
  console.log(`\nRun record: ${path.replace(`${cwd}/`, "")}`);

  if (argv.includes("--json")) console.log(JSON.stringify(record));

  return stoppingRows(classified, resolved.mode).length ? 1 : 0;
}

// Run only when invoked directly, so importing the core in a test is inert.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main());
}
