#!/usr/bin/env node
/**
 * spec-test-claims.mjs: which acceptance criteria a passed test proves.
 *
 * Zero dependencies. Requires Node 22+. Called by `/release` step 10b, from a
 * temporary worktree checked out at the release commit:
 *
 *   node scripts/spec-test-claims.mjs \
 *     --coverage=.harness/spec-coverage.json \   # written by check:spec in that worktree
 *     --report=<the run report, in the Vitest JSON shape> \  # at the release commit
 *     --root=<the worktree> --version=v1.2.3 --sha=<release sha> \
 *     --evidence=<URL of the comment posted on the release PR>
 *
 * stdout: one shared-client call per claim, ready to run.
 * stderr: the evidence, as markdown, for the comment on the release PR.
 *
 * A test-basis claim comes from a run at the release commit that the releasing
 * session performs itself, never from CI, which the harness does not ask to run
 * a suite. Only a file the run reports PASSED claims anything, and it
 * claims `matched` with basis `test`; a failed, skipped or unrun file claims
 * nothing and is listed, because a session without a database fails the
 * integration tier for want of one, and that is not drift.
 *
 * Structure: everything above `main()` is pure and exported, so a project's own
 * unit tests drive it with in-memory inputs.
 */

import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { pathToFileURL } from "node:url";
import { plural, productSlug } from "./check-spec.mjs";

/** Only a test file can pass a run. Source anchors are the judge's territory. */
const isTest = (file) => file.startsWith("tests/");

/**
 * Intersect the coverage artifact with the run report.
 *
 * Returns the claims (one per criterion with at least one passed anchoring
 * test file, carrying only those files), the criteria whose anchoring tests
 * all failed, were skipped or never ran (with each file's status), and every
 * anchored test file once with its status. A criterion with no anchoring test
 * file appears nowhere: there is nothing to say about it here.
 */
export function testClaims({ coverage, report, root }) {
  const status = new Map();
  for (const t of report?.testResults ?? []) {
    status.set(relative(root, t.name).split("\\").join("/"), t.status);
  }
  const statusOf = (file) => status.get(file) ?? "not run";

  const claims = [];
  const unclaimed = [];
  const files = [];
  const seen = new Set();
  for (const requirement of coverage?.requirements ?? []) {
    for (const criterion of requirement.criteria ?? []) {
      const tests = (criterion.files ?? []).filter(isTest);
      if (tests.length === 0) continue;
      for (const file of tests) {
        if (seen.has(file)) continue;
        seen.add(file);
        files.push({ file, status: statusOf(file) });
      }
      const passed = tests.filter((file) => statusOf(file) === "passed");
      if (passed.length) {
        claims.push({ node: requirement.slug, criterion: criterion.id, files: passed });
      } else {
        unclaimed.push({
          node: requirement.slug,
          criterion: criterion.id,
          files: tests.map((file) => ({ file, status: statusOf(file) })),
        });
      }
    }
  }
  return { claims, unclaimed, files };
}

/** One bash word, single-quoted, so a quote or a `$` in a value cannot break or inject the line. */
const shellWord = (value) => `'${String(value).replace(/'/g, `'\\''`)}'`;

/**
 * One shared-client call per claim. The idempotency key ends in `-test` so it
 * never collides with the `source-code` claim's key for the same criterion:
 * the idempotency layer would otherwise answer the second basis with the
 * first claim. `release` names the version, the sha and the evidence URL.
 */
export function claimCommands(claims, release, product) {
  return claims.map(
    (c) =>
      `IDEMPOTENCY_KEY=${shellWord(`release-${release.version}-${c.node}-${c.criterion}-test`)} ` +
      `bash .claude/scripts/spec-universe.sh claim ${product}.${c.node} matched test ${c.criterion} ${shellWord(release.evidence)}`,
  );
}

/** The comment for the release PR: the run, file by file, and what it proved. */
export function evidenceMarkdown({ claims, unclaimed, files }, { sha, version }) {
  const lines = [
    `## Conformance by test, ${version} at \`${sha}\``,
    "",
    "The suite ran at the release commit in a worktree of the releasing session. " +
      "Only a file reported passed claims; a failed, skipped or unrun file claims nothing.",
    "",
    "| Anchored test file | Result |",
    "|---|---|",
    ...files.map((f) => `| ${f.file} | ${f.status} |`),
    "",
    `**${plural(claims.length, "criterion", "criteria")} claimed** \`matched\` with basis \`test\`:`,
    ...claims.map((c) => `- \`${c.node}/${c.criterion}\` by ${c.files.join(", ")}`),
    "",
    `**${plural(unclaimed.length, "criterion", "criteria")} not claimed**, their anchoring tests did not pass:`,
    ...unclaimed.map(
      (c) => `- \`${c.node}/${c.criterion}\`: ${c.files.map((f) => `${f.file} (${f.status})`).join(", ")}`,
    ),
    "",
  ];
  return lines.join("\n");
}

// ---------------------------------------------------------------------- main

function arg(argv, name) {
  return argv.map((a) => new RegExp(`^--${name}=(.+)$`).exec(a)?.[1]).find(Boolean);
}

export function main(argv = process.argv.slice(2)) {
  const need = (name) => {
    const value = arg(argv, name);
    if (!value) {
      console.error(`--${name}=<value> is required`);
      return null;
    }
    return value;
  };
  const coveragePath = need("coverage");
  const reportPath = need("report");
  const version = need("version");
  const sha = need("sha");
  const evidence = need("evidence");
  if (!coveragePath || !reportPath || !version || !sha || !evidence) return 2;
  const root = arg(argv, "root") ?? process.cwd();

  const coverage = JSON.parse(readFileSync(coveragePath, "utf8"));
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  const result = testClaims({ coverage, report, root });
  const release = { version, sha, evidence };
  // The coverage artifact names the product it was written for, so a run over a
  // worktree claims for that worktree's product rather than for whatever the
  // checkout this command runs in happens to be connected to.
  const product = coverage?.product ?? productSlug(root);
  if (!product) {
    console.error("the coverage artifact names no product, and no spec_product is set");
    return 2;
  }

  for (const line of claimCommands(result.claims, release, product)) console.log(line);
  console.error(evidenceMarkdown(result, release));
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}
