#!/usr/bin/env node
/**
 * check-docs.mjs: mechanical freshness checks for the AI-native docs standard.
 *
 * Zero dependencies. Requires Node 18+. Run from the repo root:
 *
 *   node scripts/check-docs.mjs            # ERRORs exit 1, WARNs exit 0
 *   node scripts/check-docs.mjs --warn-only # never exit non-zero
 *   node scripts/check-docs.mjs --quiet     # only print problems
 *   node scripts/check-docs.mjs --strict    # surface-count drift is an ERROR
 *   node scripts/check-docs.mjs --diff <ref> # what the change since <ref>
 *                                            # means for the docs (see below)
 *
 * Wire it into `.harness-version` so broken docs block auto-merge:
 *
 *   check: node scripts/check-docs.mjs && npm test
 *
 * What it enforces (see docs/README.md for the standard itself):
 *
 *   ERROR  every docs/**\/*.md is linked from docs/README.md (the index)
 *   ERROR  relative markdown links resolve to real files
 *   ERROR  docs/architecture/*.md carry front-matter `sources:` globs, and
 *          every glob matches at least one file
 *   ERROR  "ADR NNNN" mentions in source and docs resolve to a real ADR file
 *   ERROR  docs/... paths mentioned in source files resolve
 *   ERROR  ADR files carry Status: and Date: lines
 *   ERROR  surface-count directives match the code they claim to describe
 *          (under --strict or on a pull_request CI run; a warning otherwise)
 *   WARN   docs nothing links to except the index (orphans)
 *   WARN   files over their layer's line budget
 *   WARN   anchor links whose heading is missing
 *   WARN   em dash characters (the harness writing rule)
 *
 * Add a `.checkdocsignore` at the repo root (one glob per line) to hide
 * subtrees whose markdown describes some other repo's layout.
 *
 * `--diff <ref>` runs none of the checks. It answers one question for the
 * agent that keeps the docs honest: what does the change since <ref> (the
 * working tree against the merge base of <ref> and HEAD, plus untracked
 * files) mean for the docs? One line per finding, three shapes:
 *
 *   doc: docs/architecture/<file>.md (sources: <glob>) <- <changed path>
 *   count: docs/<file>.md glob=<glob> pattern=<pattern> <old> -> <new>
 *   ref: <docs path or ADR id newly referenced in the diff>
 *
 * or the single word `nothing`. Exit 0 either way.
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, relative, dirname, resolve, sep, extname, basename } from "node:path";

const ROOT = process.cwd();
const argv = process.argv.slice(2);
// `--diff <ref>` and `--diff=<ref>` both work; the ref is not a flag.
let DIFF_REF = null;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--diff") DIFF_REF = argv[i + 1] ?? "";
  else if (argv[i].startsWith("--diff=")) DIFF_REF = argv[i].slice("--diff=".length);
}
const args = new Set(argv.filter((a, i) => !(a === "--diff" || argv[i - 1] === "--diff")));
const WARN_ONLY = args.has("--warn-only");
const QUIET = args.has("--quiet");
// A surface-count mismatch blocks a pull request and only nags a feature
// branch: the `check:` line is one command for both runs, so the checker
// reads the event name itself. `--strict` forces the blocking form anywhere.
const STRICT = args.has("--strict") || process.env.GITHUB_EVENT_NAME === "pull_request";
if (DIFF_REF === "") {
  console.error("check-docs: --diff needs a ref (a branch, tag or commit)");
  process.exit(1);
}

/** Line budgets per layer. Over budget means the content wants a new home. */
const BUDGETS = {
  "CLAUDE.md": 300,
  "docs/architecture": 400,
};

const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "out",
  "coverage",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".venv",
  "venv",
  "__pycache__",
  "vendor",
  ".claude",
  // Live feature-flow state (see .claude/HARNESS.md), not documentation:
  // a feature-context file may name an ADR that ships later with the
  // feature, which the back-reference check would read as drift.
  ".harness",
  "target",
  ".git",
  ".husky",
  ".vscode",
  ".idea",
  ".turbo",
  ".cache",
  ".yarn",
  ".pnpm-store",
]);

const SOURCE_EXT = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go", ".rs",
  ".java", ".kt", ".rb", ".php", ".cs", ".sh", ".sql", ".yml", ".yaml",
  ".svelte", ".vue", ".astro",
]);

/** Files exempt from "must be indexed" and from front-matter checks. */
const TEMPLATE_BASENAMES = new Set(["TEMPLATE.md"]);

const errors = [];
const warnings = [];
const error = (file, msg) => errors.push({ file, msg });
const warn = (file, msg) => warnings.push({ file, msg });

// ---------------------------------------------------------------- utilities

function walk(dir, acc = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      // Only the denylist is skipped. `.github/` stays visible on purpose: an
      // architecture doc describing CI must be able to name it in `sources:`.
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(full, acc);
    } else if (entry.isFile()) {
      acc.push(full);
    }
  }
  return acc;
}

const rel = (abs) => relative(ROOT, abs).split(sep).join("/");
const read = (abs) => readFileSync(abs, "utf8");

/** Minimal glob to RegExp. Supports **, *, ?, and {a,b} alternation. */
function globToRegExp(glob) {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        // ** matches across path separators; **/ also matches zero segments
        if (glob[i + 2] === "/") {
          out += "(?:.*/)?";
          i += 2;
        } else {
          out += ".*";
          i += 1;
        }
      } else {
        out += "[^/]*";
      }
    } else if (c === "?") {
      out += "[^/]";
    } else if (c === "{") {
      const close = glob.indexOf("}", i);
      if (close === -1) {
        out += "\\{";
      } else {
        const alts = glob.slice(i + 1, close).split(",");
        out += `(?:${alts.map((a) => a.replace(/[.+^${}()|[\]\\]/g, "\\$&")).join("|")})`;
        i = close;
      }
    } else if (".+^$()|[]\\".includes(c)) {
      out += `\\${c}`;
    } else {
      out += c;
    }
  }
  return new RegExp(`^${out}$`);
}

/** GitHub-style heading slug. */
function slugify(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[`*_~]/g, "")
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-");
}

/** Strip fenced code blocks so examples do not trip the reference checks. */
function stripFences(text) {
  return text.replace(/^```[\s\S]*?^```/gm, "");
}

function parseFrontMatter(text) {
  if (!text.startsWith("---")) return null;
  const end = text.indexOf("\n---", 3);
  if (end === -1) return null;
  return text.slice(text.indexOf("\n") + 1, end + 1);
}

/** The `sources:` globs of an architecture doc's front-matter. */
function sourceGlobs(fm) {
  return [...fm.matchAll(/^\s*-\s*(.+?)\s*$/gm)].map((m) => m[1].replace(/^["']|["']$/g, ""));
}

const ADR_MENTION = /\bADR[ -]?(\d{4})\b/g;
// Lookbehind so `other-repo/docs/x.md` is not read as a path in THIS repo.
const DOC_PATH = /(?<![\w/-])(docs\/[A-Za-z0-9._\-/]+\.md)/g;
const isDocPathClaim = (p) => !(p.includes("*") || p.includes("<") || p.includes("NNNN"));

/**
 * The surface-count directives in a markdown file, each with the number of
 * body rows in the table that follows it. Declared directly above the table
 * it governs:
 *
 *   <!-- surface-count: glob=src/routes/**\/*.ts pattern=app\.(get|post)\( -->
 *
 * Patterns compile with the "m" flag so ^ and $ anchor per line; without it a
 * ^-anchored directive silently matches nothing and reports zero instead of
 * failing loudly. An invalid pattern comes back with `re: null`.
 */
function surfaceDirectives(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const directive = lines[i].match(/<!--\s*surface-count:\s*glob=(\S+)\s+pattern=(.+?)\s*-->/);
    if (!directive) continue;
    const [, glob, patternSrc] = directive;
    let re = null;
    try {
      re = new RegExp(patternSrc, "gm");
    } catch {
      // reported by the caller
    }
    let j = i + 1;
    while (j < lines.length && !lines[j].trim().startsWith("|")) j++;
    let rows = 0;
    let sawSeparator = false;
    for (; j < lines.length && lines[j].trim().startsWith("|"); j++) {
      if (/^\s*\|[\s|:-]+\|\s*$/.test(lines[j])) {
        sawSeparator = true;
        continue;
      }
      if (sawSeparator) rows++;
    }
    out.push({ glob, patternSrc, re, rows });
  }
  return out;
}

/** Regex matches of `re` summed over `files`, each read through `readFile`. */
function countMatches(re, files, readFile) {
  let n = 0;
  for (const f of files) n += (readFile(f).match(re) || []).length;
  return n;
}

// -------------------------------------------------------------- collect data

/**
 * Optional `.checkdocsignore` at the repo root: one glob per line, `#` for
 * comments. Matching paths are invisible to every check. Use it for subtrees
 * that contain markdown describing some *other* repo's layout (template
 * sources, vendored examples, fixtures), where a `docs/...` path is not a
 * claim about this repo.
 */
const ignoreGlobs = existsSync(join(ROOT, ".checkdocsignore"))
  ? read(join(ROOT, ".checkdocsignore"))
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"))
      .map(globToRegExp)
  : [];

const allFiles = walk(ROOT)
  .map(rel)
  .filter((f) => !ignoreGlobs.some((re) => re.test(f)));
const fileSet = new Set(allFiles);

const docFiles = allFiles.filter((f) => f.startsWith("docs/") && f.endsWith(".md"));
const markdownFiles = allFiles.filter((f) => f.endsWith(".md"));
const sourceFiles = allFiles.filter((f) => SOURCE_EXT.has(extname(f)) && !f.startsWith("docs/"));

const INDEX = "docs/README.md";
const hasDocsDir = docFiles.length > 0;

if (!hasDocsDir) {
  if (DIFF_REF !== null) console.log("nothing");
  else if (!QUIET) console.log("check-docs: no docs/ directory found, nothing to check.");
  process.exit(0);
}

// ------------------------------------------------- --diff <ref>: what changed
//
// The docs agent used to read the whole diff and decide for itself what the
// docs had to say about it. This mode does the mechanical half of that
// reading: which architecture docs claim a changed path in `sources:`, which
// surface tables count differently now, and which docs paths and ADR ids the
// diff starts mentioning. The agent gets the list as its whole scope, and
// runs only when the list is not `nothing`.

if (DIFF_REF !== null) {
  const gitOut = (...gitArgs) =>
    execFileSync("git", gitArgs, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  // The merge base is what `<ref>...HEAD` compares against, and comparing the
  // working tree to it counts uncommitted work too.
  let base;
  try {
    base = gitOut("merge-base", DIFF_REF, "HEAD").trim();
  } catch {
    try {
      base = gitOut("rev-parse", "--verify", "--quiet", `${DIFF_REF}^{commit}`).trim();
    } catch {
      console.error(`check-docs: --diff ${DIFF_REF}: not a commit in this repository`);
      process.exit(1);
    }
  }
  const splitLines = (text) => text.split("\n").map((l) => l.trim()).filter(Boolean);
  const untracked = splitLines(gitOut("ls-files", "--others", "--exclude-standard"));
  const changed = [...new Set([...splitLines(gitOut("diff", "--name-only", base)), ...untracked])].sort();
  const findings = [];

  // doc: an architecture doc whose `sources:` glob claims a changed path.
  for (const f of docFiles.filter((d) => d.startsWith("docs/architecture/"))) {
    if (TEMPLATE_BASENAMES.has(basename(f))) continue;
    const fm = parseFrontMatter(read(join(ROOT, f)));
    if (!fm) continue;
    for (const g of sourceGlobs(fm)) {
      const re = globToRegExp(g);
      for (const p of changed) if (re.test(p)) findings.push(`doc: ${f} (sources: ${g}) <- ${p}`);
    }
  }

  // count: a surface-count directive whose code count moved. The old side is
  // the base commit's tree, read through `git show`, under the same ignore
  // globs the live side uses.
  const oldTree = splitLines(gitOut("ls-tree", "-r", "--name-only", base)).filter(
    (f) => !ignoreGlobs.some((re) => re.test(f))
  );
  const readOld = (p) => {
    try {
      return gitOut("show", `${base}:${p}`);
    } catch {
      return "";
    }
  };
  for (const f of markdownFiles) {
    if (TEMPLATE_BASENAMES.has(basename(f))) continue;
    for (const { glob, patternSrc, re } of surfaceDirectives(read(join(ROOT, f)).split("\n"))) {
      if (!re) continue;
      const globRe = globToRegExp(glob);
      const now = countMatches(re, allFiles.filter((c) => globRe.test(c)), (c) => read(join(ROOT, c)));
      const before = countMatches(re, oldTree.filter((c) => globRe.test(c)), readOld);
      if (before !== now) findings.push(`count: ${f} glob=${glob} pattern=${patternSrc} ${before} -> ${now}`);
    }
  }

  // ref: a docs path or ADR id the added lines mention and the removed lines
  // do not. A reference that only moved is not news.
  const collect = (text, into) => {
    for (const m of text.matchAll(ADR_MENTION)) into.add(`ADR ${m[1]}`);
    for (const m of text.matchAll(DOC_PATH)) if (isDocPathClaim(m[1])) into.add(m[1]);
  };
  const added = new Set();
  const removed = new Set();
  for (const line of gitOut("diff", base).split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) collect(line.slice(1), added);
    else if (line.startsWith("-")) collect(line.slice(1), removed);
  }
  for (const p of untracked) {
    if (!(p.endsWith(".md") || SOURCE_EXT.has(extname(p)))) continue;
    try {
      collect(read(join(ROOT, p)), added);
    } catch {
      // unreadable untracked file: nothing to reference
    }
  }
  for (const r of [...added].sort()) if (!removed.has(r)) findings.push(`ref: ${r}`);

  console.log(findings.length ? findings.join("\n") : "nothing");
  process.exit(0);
}

if (!fileSet.has(INDEX)) {
  error(INDEX, "missing: docs/README.md is the mandatory index-manifest for the docs standard");
}

const adrFiles = docFiles.filter(
  (f) => f.startsWith("docs/decisions/") && /\/\d{4}-/.test(f)
);
// A number is claimed on the coordination branch before the ADR
// is written, which prevents most collisions. This check refuses the ones
// that get through anyway, including a hand-written ADR that never claimed.
// Keying a Map by number without this guard silently drops the first entry.
const adrNumbers = new Map(); // "0007" -> path
for (const f of adrFiles) {
  const m = basename(f).match(/^(\d{4})-/);
  if (!m) continue;
  const claimed = adrNumbers.get(m[1]);
  if (claimed) {
    error(
      f,
      `shares ADR number ${m[1]} with ${claimed}; ADR numbers are never reused`
    );
    continue;
  }
  adrNumbers.set(m[1], f);
}

const headingsByFile = new Map();
for (const f of markdownFiles) {
  const set = new Set();
  for (const line of read(join(ROOT, f)).split("\n")) {
    const m = line.match(/^#{1,6}\s+(.*)$/);
    if (m) set.add(slugify(m[1]));
  }
  headingsByFile.set(f, set);
}

// ------------------------------------------------- ERROR: index completeness

const indexText = fileSet.has(INDEX) ? read(join(ROOT, INDEX)) : "";
const indexLinks = new Set();
for (const m of indexText.matchAll(/\]\(([^)]+)\)/g)) {
  const target = m[1].split("#")[0].trim();
  if (!target || /^[a-z]+:\/\//i.test(target)) continue;
  indexLinks.add(rel(resolve(ROOT, "docs", target)));
}
// Also accept bare repo-relative paths written in backticks.
for (const m of indexText.matchAll(/`(docs\/[^`\s]+\.md)`/g)) indexLinks.add(m[1]);

for (const f of docFiles) {
  if (f === INDEX) continue;
  if (TEMPLATE_BASENAMES.has(basename(f))) continue;
  if (!indexLinks.has(f)) {
    error(INDEX, `${f} is not listed in the index. Every doc needs an index row (one home per fact).`);
  }
}

// --------------------------------------------- ERROR: relative link integrity

const linkedFrom = new Map(); // doc path -> Set of files linking to it

for (const f of markdownFiles) {
  const text = stripFences(read(join(ROOT, f)));
  for (const m of text.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const raw = m[1].trim();
    if (!raw || /^[a-z]+:\/\//i.test(raw) || raw.startsWith("mailto:")) continue;
    const [pathPart, anchor] = raw.split("#");
    if (!pathPart) {
      // pure in-page anchor
      if (anchor && !headingsByFile.get(f)?.has(slugify(anchor))) {
        warn(f, `anchor #${anchor} has no matching heading in this file`);
      }
      continue;
    }
    const target = rel(resolve(dirname(join(ROOT, f)), pathPart));
    if (!fileSet.has(target) && !existsSync(join(ROOT, target))) {
      error(f, `broken link: ${raw} (resolved to ${target})`);
      continue;
    }
    if (target.endsWith(".md")) {
      if (!linkedFrom.has(target)) linkedFrom.set(target, new Set());
      linkedFrom.get(target).add(f);
      if (anchor && headingsByFile.has(target) && !headingsByFile.get(target).has(slugify(anchor))) {
        warn(f, `anchor #${anchor} not found in ${target}`);
      }
    }
  }
}

// ------------------------------------ ERROR: architecture front-matter sources

for (const f of docFiles.filter((d) => d.startsWith("docs/architecture/"))) {
  if (TEMPLATE_BASENAMES.has(basename(f))) continue;
  const text = read(join(ROOT, f));
  const fm = parseFrontMatter(text);
  if (!fm || !/^sources:/m.test(fm)) {
    error(f, "architecture docs need YAML front-matter with a `sources:` list of globs so drift is detectable");
    continue;
  }
  const globs = sourceGlobs(fm);
  if (globs.length === 0) {
    error(f, "`sources:` is empty; list the globs this doc describes");
    continue;
  }
  for (const g of globs) {
    const re = globToRegExp(g);
    if (!allFiles.some((candidate) => re.test(candidate))) {
      error(f, `sources glob "${g}" matches no files. The code moved or the doc is stale.`);
    }
  }
}

// --------------------------------------------------- ERROR: ADR back-references

for (const f of [...sourceFiles, ...markdownFiles]) {
  // TEMPLATE.md files are scaffolding: their examples are illustrations, not
  // claims about this repo. This script names doc paths to implement the
  // rules, so it does not audit itself either.
  if (TEMPLATE_BASENAMES.has(basename(f))) continue;
  if (f === "scripts/check-docs.mjs" || f === "scripts/check-docs.py") continue;
  let text;
  try {
    text = read(join(ROOT, f));
  } catch {
    continue;
  }
  if (f.endsWith(".md")) text = stripFences(text);
  const scanned = text;

  for (const m of scanned.matchAll(ADR_MENTION)) {
    const num = m[1];
    if (!adrNumbers.has(num)) {
      error(f, `references ADR ${num} but docs/decisions/${num}-*.md does not exist`);
    }
  }
  for (const m of scanned.matchAll(DOC_PATH)) {
    const target = m[1];
    if (!isDocPathClaim(target)) continue;
    if (!fileSet.has(target)) {
      error(f, `references ${target}, which does not exist`);
    }
  }
}

// -------------------------------------------------------- ERROR: ADR hygiene

for (const f of adrFiles) {
  const text = read(join(ROOT, f));
  if (!/^\s*(-\s*)?\*{0,2}Status\*{0,2}:/m.test(text)) {
    error(f, "ADR is missing a `Status:` line (Proposed / Accepted / Superseded by ADR NNNN)");
  }
  if (!/^\s*(-\s*)?\*{0,2}Date\*{0,2}:/m.test(text)) {
    error(f, "ADR is missing a `Date:` line (YYYY-MM-DD)");
  }
}

// ------------------------------------ ERROR or WARN: surface-table counts
//
// The checker counts regex matches across the directive's glob (see
// surfaceDirectives) and compares against the number of body rows in the
// next markdown table. A malformed directive is always an error. A mismatch
// is an error only under STRICT: on a feature branch the table is allowed to
// lag the code until the pull request, where it blocks.

const surfaceMismatch = (file, msg) =>
  STRICT ? error(file, msg) : warnings.push({ file, msg, label: "warning:" });

for (const f of markdownFiles) {
  if (TEMPLATE_BASENAMES.has(basename(f))) continue;
  for (const { glob, patternSrc, re, rows } of surfaceDirectives(read(join(ROOT, f)).split("\n"))) {
    if (!re) {
      error(f, `surface-count directive has an invalid pattern: ${patternSrc}`);
      continue;
    }
    const globRe = globToRegExp(glob);
    const matched = allFiles.filter((c) => globRe.test(c));
    if (matched.length === 0) {
      error(f, `surface-count glob "${glob}" matches no files`);
      continue;
    }
    const codeCount = countMatches(re, matched, (c) => read(join(ROOT, c)));
    if (rows !== codeCount) {
      surfaceMismatch(
        f,
        `surface table has ${rows} row(s) but the code has ${codeCount} match(es) for /${patternSrc}/ in ${glob}`
      );
    }
  }
}

// ----------------------------------------------------------------- WARN checks

// Fixtures of the standard and files reached by other means (ADR ids from
// code, runbook names from an incident) are never "orphans".
const ORPHAN_EXEMPT = new Set(["docs/GLOSSARY.md", "docs/SECURITY.md", "docs/TESTING.md"]);
for (const f of docFiles) {
  if (f === INDEX || TEMPLATE_BASENAMES.has(basename(f))) continue;
  if (ORPHAN_EXEMPT.has(f)) continue;
  if (f.startsWith("docs/decisions/") || f.startsWith("docs/runbooks/")) continue;
  const from = linkedFrom.get(f);
  if (!from || (from.size === 1 && from.has(INDEX))) {
    warn(f, "only the index links here. Add a pointer from CLAUDE.md or the doc that needs it, or delete the file.");
  }
}

for (const [prefix, budget] of Object.entries(BUDGETS)) {
  const targets = prefix.endsWith(".md")
    ? fileSet.has(prefix)
      ? [prefix]
      : []
    : markdownFiles.filter((f) => f.startsWith(`${prefix}/`) && !TEMPLATE_BASENAMES.has(basename(f)));
  for (const f of targets) {
    const count = read(join(ROOT, f)).split("\n").length;
    if (count > budget) {
      warn(f, `${count} lines, over the ${budget}-line budget. Move catalog content into docs/architecture/.`);
    }
  }
}

const EM_DASH = "\u2014"; // written as an escape so this file obeys its own rule
for (const f of markdownFiles) {
  if (read(join(ROOT, f)).includes(EM_DASH)) {
    warn(f, "contains an em dash (U+2014). The harness writing rule bans them.");
  }
}

// --------------------------------------------------------------------- report

const fmt = (list, label) =>
  list.map((item) => `  ${item.label ?? label} ${item.file}: ${item.msg}`).join("\n");

if (!QUIET || errors.length || warnings.length) {
  console.log(`check-docs: scanned ${docFiles.length} doc(s), ${sourceFiles.length} source file(s)`);
}
if (warnings.length) {
  console.log(`\n${warnings.length} warning(s):`);
  console.log(fmt(warnings, "WARN "));
}
if (errors.length) {
  console.log(`\n${errors.length} error(s):`);
  console.log(fmt(errors, "ERROR"));
  console.log("\nDocs are out of sync with the codebase. Fix the errors above or run /document check.");
  process.exit(WARN_ONLY ? 0 : 1);
}
if (!QUIET) console.log("check-docs: OK");
