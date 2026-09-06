#!/usr/bin/env node
/**
 * check-spec.mjs: the specification anchor gate.
 *
 * Zero dependencies. Requires Node 22+. Run from the repo root:
 *
 *   node scripts/check-spec.mjs             # ERRORs exit 1, WARNs exit 0
 *   node scripts/check-spec.mjs --warn-only # never exit non-zero
 *   node scripts/check-spec.mjs --quiet     # only print problems
 *
 * Anchors are CITATIONS: ids only, never spec text. The specification lives in
 * Spec Universe and has exactly one home, which is not this repository. See
 * .claude/SPEC-LOOP.md for the convention, and its "Two red
 * gates, told apart" section for why the gate is fail closed.
 *
 * DORMANT BY DEFAULT. The `spec_product:` key in `.harness-version` names the
 * product anchors resolve against, and it is also the switch. With no such key
 * this checker prints one line, `spec loop not connected`, and exits 0 before
 * it looks at a credential or a file: a repository that has not connected a
 * specification has nothing to validate against, which is not a failure.
 *
 * What it enforces once connected:
 *
 *   ERROR  a `Spec:` line that does not parse
 *   ERROR  an anchor that does not resolve to a node of this product
 *   ERROR  a requirement with status `live` and zero anchors anywhere
 *   ERROR  a domain file with no `Spec:` line at all
 *   ERROR  Spec Universe unreachable (fail closed, by decision)
 *   ERROR  a missing credential, reported AS a missing credential
 *   WARN   a prose `fr-N` mention that resolves to no node
 *
 * Informational: requirements at status `planned` are the build backlog, never
 * an error, and `Spec: support` files are listed with a count. Coverage per
 * acceptance criterion (which criteria a criterion anchor proves, and which
 * are bare) is printed as a table and written to `.harness/spec-coverage.json`
 * (`--coverage-out=<path>` moves it). It is reported, never enforced: a bare
 * criterion changes no exit code.
 *
 * The two red gates are deliberately distinguishable. An unreachable service
 * and an unset credential have different fixes, so they never share copy.
 *
 * Structure: everything above `main()` is pure and exported, so a project's own
 * unit tests drive it with an in-memory node index and need no network, no
 * fixture tree, and no running Spec Universe.
 */

import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

// ------------------------------------------------------------------ constants

/** The one sentence a failed read is allowed to print. Pinned by a test. */
export const UNREACHABLE =
  "The specification cannot be read, so nothing can be validated against it.";

/** The one line a repository that has not connected a specification prints. */
export const DORMANT = "spec loop not connected";

/** The `.harness-version` key naming the product, and the dormancy switch. */
export const PRODUCT_KEY = "spec_product";

/**
 * The value of one `key: value` line of `.harness-version`, or `null`.
 *
 * The last whole-line occurrence wins, exactly as a YAML key would, and a key
 * present but blank reads as absent: an empty `spec_product:` is a repository
 * that has not connected one, not a product named "". Pure, so a test drives it
 * with a string.
 *
 * This is the only reader of `.harness-version` in this file, and
 * spec-test-claims.mjs imports the product from here rather than parsing the
 * file a second time. `gate-run.mjs` keeps its own `readGateModeKey`, which
 * reads a different key out of two different formats.
 */
export function readHarnessKey(text, key) {
  const pattern = new RegExp(
    `^\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:\\s*(.*?)\\s*$`,
  );
  let found = null;
  for (const line of String(text ?? "").split("\n")) {
    const m = line.match(pattern);
    if (m) found = m[1];
  }
  return found ? found : null;
}

/**
 * The product whose nodes anchors resolve against, or `null` when this
 * repository has not connected one.
 *
 * There is deliberately no `spec_url` beside it: the base URL travels with the
 * credential, as `SPEC_UNIVERSE_URL` in the environment, so a session and a
 * workflow are configured identically and a checked-in file never names a host.
 */
export function productSlug(cwd = process.cwd()) {
  try {
    return readHarnessKey(readFileSync(join(cwd, ".harness-version"), "utf8"), PRODUCT_KEY);
  } catch {
    return null;
  }
}

/** Files that must carry an anchor. */
export const DOMAIN_ROOTS = ["src", "tests"];

/** Files scanned for dangling prose mentions but never required to anchor. */
export const PROSE_ROOTS = ["src", "tests", "docs"];

/** Never read: applied migrations and dated decision records are immutable. */
export const SKIP_PATHS = ["drizzle", "docs/decisions"];

/**
 * Where the per-criterion coverage lands, unless `--coverage-out` says
 * otherwise. Gitignored. It is the seam the release step reads to decide which
 * criteria a passed test file may claim, so its shape is part of the contract
 * (.claude/SPEC-LOOP.md, "Coverage per criterion").
 */
export const COVERAGE_OUT = ".harness/spec-coverage.json";

/**
 * Exempt from the dangling-prose warning only, and by exact path.
 *
 * A file here has to print slugs that resolve nowhere in order to do its job:
 * the checker's own test names `fr-77` and `fr-999` to prove the warning
 * fires, so scanning it would report its examples as the fault they exist to
 * demonstrate. Add your own equivalents; the shipped entry names the path the
 * loop was proven at, and is one of the tree constants above that a connecting
 * project adapts.
 *
 * The convention document needs no entry: `.claude/SPEC-LOOP.md` sits outside
 * `PROSE_ROOTS`, so its table of REFUSED forms (`fr-01` and the rest) is never
 * scanned in the first place. An exempt path that is never scanned is dead
 * weight that reads like a live rule, which is why it is not listed.
 *
 * The cost is real and bounded: a genuine typo in an exempt file goes
 * unwarned. Keep the list short, and note that nothing here is exempt from the
 * anchor rules themselves.
 */
export const PROSE_EXEMPT = new Set([
  "tests/unit/check-spec.test.ts",
]);

const SKIP_DIRS = new Set([".git", "node_modules", ".next", "dist", "build", "coverage"]);

/** A `Spec:` line must sit behind a comment marker, so a string cannot be one. */
const SPEC_LINE = /^\s*(?:\/\*\*?|\*\/|\*|\/\/|#)\s*Spec:\s*(.*)$/;

/**
 * An anchor: a local slug (lowercase, starts with a letter, no underscores),
 * optionally followed by ONE acceptance criterion of that node in the product's
 * own `ac-N` form (`fr-14/ac-3`). A bare slug keeps meaning the whole node; a
 * criterion anchor says this file proves that one criterion, and it anchors
 * the node as well.
 */
const ANCHOR = /^([a-z][a-z0-9-]*)(?:\/(ac-[0-9]+))?$/;

/** Prose mentions, for the dangling-reference warning. */
const PROSE_MENTION = /\bfr-[0-9]+\b/g;

// ----------------------------------------------------------------- pure core

/**
 * Parse the value of one `Spec:` line.
 *
 * Returns a discriminated result rather than throwing, so a malformed line is
 * a finding the report can place, not a crash that hides every other finding.
 */
export function parseSpecValue(raw) {
  const value = String(raw ?? "")
    .replace(/\*\/\s*$/, "")
    .trim();

  if (value === "") return { kind: "invalid", reason: "the line names nothing" };
  if (value === "support") return { kind: "support" };

  const tokens = value.split(",").map((t) => t.trim());

  if (tokens.some((t) => t === "")) {
    return { kind: "invalid", reason: `empty entry in "${value}"` };
  }
  if (tokens.includes("support")) {
    return {
      kind: "invalid",
      reason: "`support` is a whole answer; it cannot be combined with anchors",
    };
  }
  for (const token of tokens) {
    const m = ANCHOR.exec(token);
    if (!m) {
      return {
        kind: "invalid",
        reason: token.includes("/")
          ? `"${token}" is not a local slug with one criterion suffix (\`fr-14/ac-3\`)`
          : `"${token}" is not a local slug`,
      };
    }
    if (/^fr-0[0-9]/.test(m[1]) || /^ac-0[0-9]/.test(m[2] ?? "")) {
      return {
        kind: "invalid",
        reason: `"${token}" is zero-padded; Spec Universe slugs and criterion ids are unpadded`,
      };
    }
  }
  return { kind: "anchors", anchors: tokens };
}

/** Split a parsed anchor into its node slug and its criterion id, or `null`. */
export function parseAnchor(anchor) {
  const m = ANCHOR.exec(anchor) ?? [];
  return { slug: m[1] ?? anchor, criterion: m[2] ?? null };
}

/** Every `Spec:` line in a source text, in order. The first is file level. */
export function findSpecLines(source) {
  const out = [];
  const lines = String(source ?? "").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = SPEC_LINE.exec(lines[i]);
    if (m) out.push({ line: i + 1, value: m[1], parsed: parseSpecValue(m[1]) });
  }
  return out;
}

/** Every prose `fr-N` mention in a text, with its line number. */
export function findProseMentions(source) {
  const out = [];
  const lines = String(source ?? "").split("\n");
  for (let i = 0; i < lines.length; i++) {
    for (const m of lines[i].matchAll(PROSE_MENTION)) {
      out.push({ line: i + 1, slug: m[0] });
    }
  }
  return out;
}

/** Index a node list by local slug. Accepts the /v1 payload's node shape. */
export function indexNodes(nodes) {
  const index = new Map();
  for (const node of nodes ?? []) {
    index.set(node.localSlug, {
      slug: node.localSlug,
      kind: node.kind,
      status: node.status,
      name: node.shortName || node.name || node.localSlug,
      criteria: (node.acceptanceCriteria ?? []).map((c) => c.id),
    });
  }
  return index;
}

/**
 * Read the two credentials out of an environment.
 *
 * A missing credential is its OWN result, never folded into a failed read: the
 * fix for an unset variable is not the fix for an outage, so the report must
 * never make a reader guess which one happened.
 */
export function readCredentials(env) {
  const missing = [];
  const url = (env.SPEC_UNIVERSE_URL ?? "").trim();
  const token = (env.SPEC_UNIVERSE_TOKEN ?? "").trim();
  if (url === "") missing.push("SPEC_UNIVERSE_URL");
  if (token === "") missing.push("SPEC_UNIVERSE_TOKEN");
  if (missing.length) return { ok: false, missing };
  return { ok: true, url: url.replace(/\/+$/, ""), token };
}

/** The finding a missing credential produces. Never mentions reachability. */
export function missingCredentialFinding(missing) {
  return {
    level: "error",
    code: "missing-credential",
    file: "(environment)",
    msg:
      `${missing.join(" and ")} ${missing.length > 1 ? "are" : "is"} not set, so the ` +
      "checker has no credential to read the specification with. This is a " +
      "configuration fault, not an outage: set the variable(s) and run again.",
  };
}

/**
 * The finding a REJECTED credential produces.
 *
 * A token Spec Universe refuses is the same class of fault as one that was
 * never set: someone has to go and fix a credential. Folding it into the
 * unreachable case would send a reader to look for an outage that is not
 * happening, which is exactly what keeping these codes apart is for.
 */
export function rejectedCredentialFinding(status) {
  return {
    level: "error",
    code: "rejected-credential",
    file: "(environment)",
    msg:
      `Spec Universe answered ${status} to the read. SPEC_UNIVERSE_TOKEN is set ` +
      "but not accepted, so it is expired, revoked, or for another universe. " +
      "This is a configuration fault, not an outage: replace the token.",
  };
}

/** The finding an unreachable Spec Universe produces. One sentence, pinned. */
export function unreachableFinding(detail) {
  return {
    level: "error",
    code: "spec-unreachable",
    file: "(spec universe)",
    msg: detail ? `${UNREACHABLE} (${detail})` : UNREACHABLE,
  };
}

/**
 * Evaluate parsed files against a node index.
 *
 * `domain` files must anchor; `prose` files are only scanned for dangling
 * mentions. Returns findings plus the informational lists the report prints.
 */
/** Push `value` under `key`, creating the list, without duplicates. */
const addOnce = (map, key, value) => {
  if (!map.has(key)) map.set(key, []);
  if (!map.get(key).includes(value)) map.get(key).push(value);
};

export function evaluate({ domain = [], prose = [], index, product = "" }) {
  const findings = [];
  const anchored = new Map(); // slug -> [file, ...]
  const proven = new Map(); // slug -> Map(criterion -> [file, ...])
  const support = [];

  for (const { path, source } of domain) {
    const specLines = findSpecLines(source);

    if (specLines.length === 0) {
      findings.push({
        level: "error",
        code: "file-unanchored",
        file: path,
        msg: "no `Spec:` line. Every domain file names the node it serves, or says `Spec: support`.",
      });
      continue;
    }

    let isSupport = false;
    for (const { line, value, parsed } of specLines) {
      if (parsed.kind === "invalid") {
        findings.push({
          level: "error",
          code: "spec-line-unparsable",
          file: `${path}:${line}`,
          msg: `\`Spec: ${value.trim()}\` does not parse: ${parsed.reason}.`,
        });
        continue;
      }
      if (parsed.kind === "support") {
        isSupport = true;
        continue;
      }
      for (const anchor of parsed.anchors) {
        const { slug, criterion } = parseAnchor(anchor);
        const node = index.get(slug);
        if (!node) {
          findings.push({
            level: "error",
            code: "anchor-unresolved",
            file: `${path}:${line}`,
            msg: `\`${slug}\` is not a node of the ${product} product.`,
          });
          continue;
        }
        if (criterion && !node.criteria.includes(criterion)) {
          findings.push({
            level: "error",
            code: "anchor-unresolved",
            file: `${path}:${line}`,
            msg:
              `\`${criterion}\` is not a criterion of \`${slug}\`, which holds ` +
              (node.criteria.length ? node.criteria.join(", ") : "no criteria") +
              ".",
          });
          continue;
        }
        // A criterion anchor anchors its node too, and one file counts once.
        addOnce(anchored, slug, path);
        if (criterion) {
          if (!proven.has(slug)) proven.set(slug, new Map());
          addOnce(proven.get(slug), criterion, path);
        }
      }
    }
    if (isSupport) support.push(path);
  }

  // Coverage. A requirement that has gone live with nothing behind it is the
  // one case where silence is a lie, so it errors. `planned` is the backlog.
  const requirements = [...index.values()].filter((n) => n.kind === "requirement");
  const backlog = [];
  const awaitingFlip = [];
  for (const node of requirements) {
    const hits = anchored.get(node.slug);
    if (node.status === "live" && !hits) {
      findings.push({
        level: "error",
        code: "requirement-uncovered",
        file: `(${node.slug})`,
        msg: `"${node.name}" is live in Spec Universe and anchored nowhere in this repository.`,
      });
      continue;
    }
    if (node.status === "planned") (hits ? awaitingFlip : backlog).push(node);
  }

  // Coverage per criterion, for every requirement that carries criteria.
  // Reported, never enforced: nothing here produces a finding.
  const coverage = requirements
    .filter((n) => n.criteria.length > 0)
    .sort((a, b) => Number(a.slug.replace(/^fr-/, "")) - Number(b.slug.replace(/^fr-/, "")))
    .map((n) => ({
      slug: n.slug,
      name: n.name,
      status: n.status,
      criteria: n.criteria.map((id) => ({ id, files: proven.get(n.slug)?.get(id) ?? [] })),
    }));

  // Dangling prose. A warning, not an error: discussing a requirement that
  // does not exist yet is legitimate, citing one that never will is not.
  for (const { path, source } of prose) {
    if (PROSE_EXEMPT.has(path)) continue;
    const seen = new Set();
    for (const { line, slug } of findProseMentions(source)) {
      if (index.has(slug) || seen.has(slug)) continue;
      seen.add(slug);
      findings.push({
        level: "warn",
        code: "prose-dangling",
        file: `${path}:${line}`,
        msg: `\`${slug}\` resolves to no node of the ${product} product.`,
      });
    }
  }

  return {
    findings,
    errors: findings.filter((f) => f.level === "error"),
    warnings: findings.filter((f) => f.level === "warn"),
    anchored,
    coverage,
    support,
    backlog,
    awaitingFlip,
    requirementCount: requirements.length,
  };
}

/**
 * The coverage table, one line per requirement, as printed lines. File paths
 * stay in the artifact: the table says WHICH criteria are proven and which are
 * bare, which is the question a reader of the run has.
 */
export function coverageTable(coverage) {
  const rows = coverage.map((r) => ({
    slug: r.slug,
    total: r.criteria.length,
    anchored: r.criteria.filter((c) => c.files.length).map((c) => c.id),
    bare: r.criteria.filter((c) => !c.files.length).map((c) => c.id),
  }));
  const total = rows.reduce((n, r) => n + r.total, 0);
  const proven = rows.reduce((n, r) => n + r.anchored.length, 0);
  const lines = [`Coverage per criterion: ${proven} of ${total} criteria anchored by a file`];
  for (const r of rows) {
    const parts = [];
    if (r.anchored.length) parts.push(`anchored: ${r.anchored.join(", ")}`);
    if (r.bare.length) parts.push(`bare: ${r.bare.join(", ")}`);
    lines.push(`  ${r.slug}  ${r.anchored.length}/${r.total}  ${parts.join("; ")}`);
  }
  return lines;
}

/** The artifact the release step reads. Written whole, never merged. */
export function coverageArtifact(coverage, product, writtenAt = new Date()) {
  return { product, writtenAt: writtenAt.toISOString(), requirements: coverage };
}

// ---------------------------------------------------------------- file system

const isSkipped = (rel) =>
  SKIP_PATHS.some((p) => rel === p || rel.startsWith(`${p}/`));

/** Walk a root, returning repo-relative paths of every readable file. */
export function collectFiles(root, cwd = process.cwd()) {
  const out = [];
  const walk = (rel) => {
    let entries;
    try {
      entries = readdirSync(join(cwd, rel));
    } catch {
      return;
    }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry)) continue;
      const child = `${rel}/${entry}`;
      if (isSkipped(child)) continue;
      let stat;
      try {
        stat = statSync(join(cwd, child));
      } catch {
        continue; // a broken symlink must not take the whole gate down
      }
      if (stat.isDirectory()) walk(child);
      else if (stat.isFile()) out.push(child);
    }
  };
  if (isSkipped(root)) return out;
  try {
    if (statSync(join(cwd, root)).isDirectory()) walk(root);
  } catch {
    return out;
  }
  return out;
}

const read = (path, cwd = process.cwd()) => {
  try {
    return readFileSync(join(cwd, path), "utf8");
  } catch {
    return "";
  }
};

/** Load the domain and prose file sets from disk. */
export function loadTree(cwd = process.cwd()) {
  const domainPaths = DOMAIN_ROOTS.flatMap((r) => collectFiles(r, cwd));
  const prosePaths = PROSE_ROOTS.flatMap((r) => collectFiles(r, cwd));
  return {
    domain: domainPaths.map((path) => ({ path, source: read(path, cwd) })),
    prose: prosePaths.map((path) => ({ path, source: read(path, cwd) })),
  };
}

// ------------------------------------------------------------------- the read

/**
 * Read the product's nodes from Spec Universe.
 *
 * Every failure shape (network, non-2xx, unparsable body) collapses to the one
 * unreachable result, because from this checker's seat they are the same fact:
 * the specification could not be read.
 */
export const READ_TIMEOUT_MS = 20_000;

export async function fetchNodes({ url, token, product }, fetchImpl = globalThis.fetch) {
  const endpoint = `${url}/v1/products/${product}/nodes`;
  let response;
  try {
    response = await fetchImpl(endpoint, {
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
      // A hang is an outage too. Without this the gate waits for the CI job
      // limit instead of failing closed with a sentence anyone can read.
      signal: AbortSignal.timeout(READ_TIMEOUT_MS),
    });
  } catch (cause) {
    const detail =
      cause?.name === "TimeoutError"
        ? `no answer within ${READ_TIMEOUT_MS / 1000}s`
        : (cause?.message ?? "network error");
    return { ok: false, detail };
  }
  if (response.status === 401 || response.status === 403) {
    return { ok: false, rejected: response.status };
  }
  if (!response.ok) {
    return { ok: false, detail: `${endpoint} answered ${response.status}` };
  }
  let body;
  try {
    body = await response.json();
  } catch {
    return { ok: false, detail: "the response was not JSON" };
  }
  if (!Array.isArray(body?.nodes)) {
    return { ok: false, detail: "the response carried no node list" };
  }
  return { ok: true, nodes: body.nodes };
}

// ---------------------------------------------------------------------- main

/** `1 file`, `2 files`; an irregular plural is given explicitly. */
export const plural = (n, noun, many = `${noun}s`) => `${n} ${n === 1 ? noun : many}`;

/**
 * Read the specification, evaluate the tree against it, report, exit.
 *
 * The only impure function in the file. Nothing above it reads an environment,
 * opens a socket, or ends a process.
 */
export async function main(argv = process.argv.slice(2), env = process.env) {
  const args = new Set(argv);
  const warnOnly = args.has("--warn-only");
  const quiet = args.has("--quiet");
  const coverageOut =
    argv.map((a) => /^--coverage-out=(.+)$/.exec(a)?.[1]).find(Boolean) ?? COVERAGE_OUT;

  const fail = (finding) => {
    console.log(`\n1 error(s):\n  ERROR ${finding.file}: ${finding.msg}`);
    return warnOnly ? 0 : 1;
  };

  // Dormancy comes FIRST, before any credential is read and before the tree is
  // walked. A repository that has not connected a specification has nothing to
  // validate against, which is not a failure and must not report as one: a
  // missing credential here would send a reader to set a variable that this
  // repository has no use for.
  const product = productSlug();
  if (!product) {
    console.log(DORMANT);
    return 0;
  }

  const credentials = readCredentials(env);
  if (!credentials.ok) return fail(missingCredentialFinding(credentials.missing));

  const read = await fetchNodes({ ...credentials, product });
  if (!read.ok) {
    return fail(
      read.rejected ? rejectedCredentialFinding(read.rejected) : unreachableFinding(read.detail),
    );
  }

  const index = indexNodes(read.nodes);
  const tree = loadTree();
  const result = evaluate({ domain: tree.domain, prose: tree.prose, index, product });

  // Written before any report, so a red run still leaves the artifact behind:
  // the release step reads it from a worktree whose run may be red for want
  // of a database, and that is not this gate's business.
  mkdirSync(dirname(coverageOut), { recursive: true });
  writeFileSync(
    coverageOut,
    JSON.stringify(coverageArtifact(result.coverage, product), null, 2) + "\n",
  );

  if (!quiet || result.errors.length || result.warnings.length) {
    console.log(
      `check-spec: ${plural(tree.domain.length, "domain file")}, ` +
        `${plural(index.size, "node")} read from Spec Universe`,
    );
  }

  if (!quiet) {
    console.log(
      `check-spec: ${plural(result.support.length, "support file")} ` +
        `(serving no node): ${result.support.join(", ") || "none"}`,
    );
    if (result.backlog.length) {
      console.log(`\nBuild backlog, ${plural(result.backlog.length, "planned requirement")} with no anchor:`);
      for (const node of result.backlog) console.log(`  ${node.slug}  ${node.name}`);
    } else {
      console.log("check-spec: build backlog is empty; every planned requirement is anchored");
    }
    if (result.awaitingFlip.length) {
      console.log(
        `check-spec: ${plural(result.awaitingFlip.length, "planned requirement")} ` +
          "already anchored here, awaiting a status flip in Spec Universe",
      );
    }
    console.log("");
    for (const line of coverageTable(result.coverage)) console.log(line);
    console.log(`check-spec: coverage written to ${coverageOut}`);
  }

  if (result.warnings.length) {
    console.log(`\n${plural(result.warnings.length, "warning")}:`);
    for (const w of result.warnings) console.log(`  WARN  ${w.file}: ${w.msg}`);
  }
  if (result.errors.length) {
    console.log(`\n${plural(result.errors.length, "error")}:`);
    for (const e of result.errors) console.log(`  ERROR ${e.file}: ${e.msg}`);
    console.log("\nThe code and the specification disagree. Fix the errors above, or see .claude/SPEC-LOOP.md.");
    return warnOnly ? 0 : 1;
  }
  if (!quiet) console.log("check-spec: OK");
  return 0;
}

// Run only when invoked directly, so importing the core in a test is inert.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main());
}
