#!/usr/bin/env node
// Build the file plan for /harness-upgrade.
//
// The skill resolves a target version and shallow-clones that tag from the
// public template repo. This script answers the only question left: given
// that tree, this repo, and a variant, what should be written, created,
// deleted, skipped and never touched.
//
// It exists as a script rather than as prose in the skill because three of
// its rules are contracts a downstream user relies on and prose cannot
// prove:
//
//   1. Write-once files are never overwritten and never resurrected.
//   2. One-shot setup and bootstrap machinery is never written back into a
//      configured repo. A restored spine would sit armed in a repo that
//      must never run it again.
//   3. A downstream project's own README, LICENSE and NOTICE survive.
//      The published tree carries the template's copies at those same
//      paths. README is refused outright; LICENSE and NOTICE are
//      write-once, so a project that never received them still can.
//
// Path classification is derived from the path alone, matching the
// categorisation table in the upstream migrations/README.md (forge
// decision record 0025). Nothing here
// reads a migration file, and nothing compares variant strings: the
// variant selects a layer, and the layer is a directory.
//
// Usage:
//   harness-upgrade-plan.mjs --target <dir> --local <dir> --variant <v>
//                            [--previous <dir>] [--pretty] [--verbose]
//
//   --target    a checkout of the version being upgraded to
//   --local     the repository being upgraded
//   --variant   harness-plain | harness-railway
//   --previous  a checkout of the version currently installed. Optional.
//               Deletions are only ever proposed when it is supplied,
//               because without it a file that is absent from the target
//               is indistinguishable from a file the user wrote.
//
//   --verbose   include the full per-path `blocked` list. Off by default:
//               it runs to well over a hundred entries on a real tree and
//               `blockedSummary` is what a caller renders.
//
// Prints a JSON plan on stdout. Exit 0 on success (an empty plan is a
// success), 2 on a usage error, 3 when the target is not a rendered
// harness tree.

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";

// The railway delta ships inside the published tree at this prefix, with
// every file stored at its final repo-relative path. Applying the overlay
// is therefore a prefix strip, not a translation table.
const RAILWAY_LAYER = join(".claude", "setup", "railway");

// Never written into a configured repository, in any class, under any
// circumstance.
//
// The first three are the one-shot /setup machinery, which deletes itself
// when it has run. The next two are workflows that remove themselves after
// a single use. The sentinels are their triggers. The last is the template
// repository's own README, which the published tree carries at exactly the
// path a downstream project uses for its own. LICENSE and NOTICE sit in
// the write-once set below rather than here, because a project that never
// received them should still be able to.
const BLOCKED_PREFIXES = [
  join(".claude", "setup") + sep,
  join(".claude", "skills", "setup") + sep,
];

const BLOCKED_FILES = new Set([
  join(".claude", "scripts", "setup.sh"),
  join(".github", "workflows", "harness-preflight.yml"),
  join(".github", "workflows", "harness-railway.yml"),
  ".harness-bootstrap",
  ".harness-preflight",
  "README.md",
]);

// Write-once. Created when missing, never overwritten, and never recreated
// once the user has deleted them. Evaluated per file, so a partial docs
// tree is completed rather than replaced.
//
// server.js, package.json and .gitignore are the app scaffold; docs/ and
// scripts/ are the documentation scaffold and its checker. LICENSE and
// NOTICE are here rather than in the blocklist because a scaffold that
// never received them should still get them, while one that has adapted
// them must keep its own.
const STARTER_PREFIXES = [`docs${sep}`, `scripts${sep}`];

const STARTER_FILES = new Set([
  "server.js",
  "package.json",
  ".gitignore",
  "LICENSE",
  "NOTICE",
]);

// Configuration a project is expected to extend. Upstream ships defaults,
// the project adds to them, and replacing the file wholesale silently
// discards that: an added Dependabot ecosystem, a tuned deploy config, a
// hook the project registered itself. These are the "config" scope of the
// upstream categorisation table, and they are reported separately so the
// skill merges them instead of copying over them.
const CONFIG_FILES = new Set([
  join(".claude", "settings.json"),
  join(".github", "dependabot.yml"),
  "railway.json",
  ".env.example",
]);

// Amended in place rather than replaced: only its version line moves, so
// every other field a downstream repo carries survives the upgrade.
const STAMP = ".harness-version";

// The variant names in use before 0.4.4. A repo stamped that long ago
// still carries one, and it names the same two layers under a different
// spelling. The old skill compared these against migration metadata
// literally, so every later change classified as "does not apply" and the
// oldest repos silently got "nothing to do". Normalising here is what
// turns that silent no-op into a real plan.
const RETIRED_VARIANTS = new Map([
  ["harness-claude-github", "harness-plain"],
  ["harness-claude-github-railway", "harness-railway"],
]);

export function normaliseVariant(variant) {
  return RETIRED_VARIANTS.get(variant) ?? variant;
}

// Directories the harness owns outright. A deletion is only ever proposed
// for a path under one of these, so a retired harness file can be retired
// while a file the user added elsewhere is never touched.
const MANAGED_TREES = [
  join(".github", "workflows") + sep,
  join(".claude", "hooks") + sep,
  join(".claude", "skills") + sep,
  join(".claude", "scripts") + sep,
  join(".claude", "agents") + sep,
];

// Which blocklist entry refused a path. Returned so the plan can group a
// whole refused payload under one line instead of listing every file in it.
export function blockingRule(path) {
  if (BLOCKED_FILES.has(path)) return path;
  return BLOCKED_PREFIXES.find((prefix) => path.startsWith(prefix)) ?? null;
}

export function isBlocked(path) {
  return blockingRule(path) !== null;
}

export function isStarter(path) {
  return (
    STARTER_FILES.has(path) ||
    STARTER_PREFIXES.some((prefix) => path.startsWith(prefix))
  );
}

export function inManagedTree(path) {
  return MANAGED_TREES.some((prefix) => path.startsWith(prefix));
}

// The three classes plus the stamp. Order matters: the blocklist wins over
// everything, so a path that is both blocked and starter-shaped (a docs
// file inside a quarantine, say) is still refused.
export function classify(path) {
  if (isBlocked(path)) return "blocked";
  if (path === STAMP) return "stamp";
  if (CONFIG_FILES.has(path)) return "config";
  if (isStarter(path)) return "starter";
  return "managed";
}

// Walk a tree into a map of repo-relative path to absolute source file.
// .git is skipped because a checkout carries one and it is never content.
function walk(root) {
  const found = new Map();
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const absolute = join(dir, entry.name);
      const path = relative(root, absolute);
      if (entry.name === ".git") continue;
      // isFile() is false for a symlink, so symlinks in the published tree
      // are skipped rather than followed. No template file is one today,
      // and refusing to plan a link out of a downloaded tree is the safe
      // default if one ever appears.
      if (entry.isDirectory()) {
        stack.push(absolute);
      } else if (entry.isFile()) {
        found.set(path, absolute);
      }
    }
  }
  return found;
}

// The published tree composed for one variant. The root is the plain
// layout; for railway the quarantine is overlaid on top of it, and the
// overlay wins on a colliding path.
//
// The quarantine is deliberately NOT skipped while walking the root. Its
// paths are caught by the blocklist instead, so they are reported as
// refused rather than silently unreachable, and the guarantee survives
// someone later changing how the walk works.
export function composeLayers(targetRoot, variant) {
  const composed = walk(targetRoot);
  if (variant !== "harness-railway") return composed;

  const overlayRoot = join(targetRoot, RAILWAY_LAYER);
  if (!existsSync(overlayRoot)) return composed;
  for (const [path, absolute] of walk(overlayRoot)) {
    composed.set(path, absolute);
  }
  return composed;
}

function sameContent(a, b) {
  try {
    return readFileSync(a).equals(readFileSync(b));
  } catch {
    return false;
  }
}

function isFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

// A tree is only safe to plan against if it is a RENDERED scaffold, not
// the repo that authors one.
//
// Nothing upstream guarantees this: `repo:` is user configuration, and a
// stale one points at the authoring repo. An external user gets a 404 and
// stops, but anyone who can read the authoring repo instead gets a
// plausible and badly wrong plan, proposing to write that repo's CLAUDE.md,
// VERSION, CHANGELOG.md and publishing workflows into their project.
//
// The authoring repo is recognised by carrying the template cell it
// renders from. A rendered scaffold never does.
export function assertRenderedTree(root) {
  if (existsSync(join(root, "templates", "harness"))) {
    throw new Error(
      "the target tree carries templates/harness/, so it is the repo that authors the harness rather than a rendered scaffold. Planning against it would write authoring files into this project. Check the repo: line in .harness-version, which should name the published template repo.",
    );
  }
  if (!existsSync(join(root, ".claude", "HARNESS.md"))) {
    throw new Error(
      "the target tree has no .claude/HARNESS.md, so it does not look like a harness release. Check the repo: line in .harness-version and the tag being targeted.",
    );
  }
}

// Build the plan. `previous` is optional; without it no deletion is ever
// proposed, because a file absent from the target cannot be told apart
// from a file the user wrote.
export function buildPlan({ targetRoot, localRoot, variant, previousRoot }) {
  assertRenderedTree(targetRoot);
  if (previousRoot) assertRenderedTree(previousRoot);
  variant = normaliseVariant(variant);
  const plan = {
    variant,
    update: [],
    create: [],
    delete: [],
    skipped: [],
    blocked: [],
    stamp: null,
    blockedSummary: [],
    deletionsDetected: Boolean(previousRoot),
  };

  const target = composeLayers(targetRoot, variant);

  // The installed version's tree, when it was available. It is what makes
  // "the user deleted this" distinguishable from "this was never
  // installed", which the write-once contract turns on.
  const previous = previousRoot ? composeLayers(previousRoot, variant) : null;

  for (const path of [...target.keys()].sort()) {
    const source = target.get(path);
    const local = join(localRoot, path);
    const present = isFile(local);

    switch (classify(path)) {
      case "blocked":
        plan.blocked.push({ path, rule: blockingRule(path) });
        break;

      case "stamp":
        // Never replaced wholesale. The skill rewrites one line.
        plan.stamp = { path, action: "amend-version-line" };
        break;

      case "starter":
        // Write-once cuts both ways: never overwritten, and never
        // recreated once the user has removed it. Both halves are the
        // contract (upstream migrations/README.md, decision record 0001),
        // and only the second needs the previous tree to see.
        if (present) {
          plan.skipped.push({ path, reason: "write-once, already present" });
        } else if (previous?.has(path)) {
          plan.skipped.push({ path, reason: "write-once, removed by the user" });
        } else if (previous) {
          plan.create.push({ path, source, class: "starter" });
        } else {
          // No previous tree, so a file the user deleted looks exactly
          // like one that was never installed. Offer it, and say that the
          // distinction could not be made rather than implying it was.
          plan.create.push({ path, source, class: "starter", unverified: true });
        }
        break;

      case "config":
        // Never a straight copy. Missing is a plain create; present and
        // different is a merge the skill has to perform by hand, and
        // saying so is what stops the project's own entries being
        // silently dropped.
        if (!present) {
          plan.create.push({ path, source, class: "config" });
        } else if (!sameContent(source, local)) {
          plan.update.push({ path, source, class: "config", merge: true });
        }
        break;

      default:
        if (!present) {
          plan.create.push({ path, source, class: "managed" });
        } else if (!sameContent(source, local)) {
          plan.update.push({ path, source, class: "managed" });
        }
        break;
    }
  }

  if (previous) {
    // A path the installed version shipped, the target no longer ships,
    // and that sits in a tree the harness owns outright. Anything else,
    // including a skill the user added themselves, is left alone.
    for (const path of [...previous.keys()].sort()) {
      if (target.has(path)) continue;
      if (classify(path) !== "managed") continue;
      if (!inManagedTree(path)) continue;
      if (!isFile(join(localRoot, path))) continue;
      plan.delete.push({ path, reason: "retired by the harness" });
    }
  }

  // The refused set is dominated by the setup payloads, which run to
  // hundreds of files. Group it so the skill can report one line per rule
  // rather than an unreadable wall, while the per-path list stays available
  // for anything that needs to prove a specific path was refused.
  plan.blockedSummary = [...plan.blocked
    .reduce((acc, entry) => acc.set(entry.rule, (acc.get(entry.rule) ?? 0) + 1), new Map())]
    .map(([rule, count]) => ({ rule, count }))
    .sort((a, b) => a.rule.localeCompare(b.rule));

  return plan;
}

function parseArgs(argv) {
  const args = { pretty: false, verbose: false };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--pretty") {
      args.pretty = true;
      continue;
    }
    if (flag === "--verbose") {
      args.verbose = true;
      continue;
    }
    // Reject an unknown flag before asking for its value, so a typo
    // reports the typo rather than a confusing "needs a value".
    const takesValue = {
      "--target": "targetRoot",
      "--local": "localRoot",
      "--variant": "variant",
      "--previous": "previousRoot",
    };
    if (!(flag in takesValue)) throw new Error(`unknown option ${flag}`);
    const value = argv[i + 1];
    if (value === undefined) throw new Error(`${flag} needs a value`);
    i += 1;
    args[takesValue[flag]] = value;
  }
  return args;
}

function main(argv) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    return 2;
  }
  for (const required of ["targetRoot", "localRoot", "variant"]) {
    if (!args[required]) {
      process.stderr.write("usage: harness-upgrade-plan.mjs --target <dir> --local <dir> --variant <v> [--previous <dir>] [--pretty] [--verbose]\n");
      return 2;
    }
  }
  // buildPlan normalises too; this is the CLI's own rejection of a name
  // that maps to no layer, which buildPlan deliberately does not make.
  const variant = normaliseVariant(args.variant);
  if (variant !== "harness-plain" && variant !== "harness-railway") {
    process.stderr.write(`unknown variant ${args.variant}; expected harness-plain or harness-railway\n`);
    return 2;
  }
  let plan;
  try {
    plan = buildPlan(args);
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    return 3;
  }
  // The refused set runs to well over a hundred entries on a real tree,
  // dominated by the setup payloads, and the caller renders the grouped
  // summary rather than the list. Emitting both by default would put
  // thousands of tokens of noise in front of whoever reads this.
  const emitted = args.verbose ? plan : { ...plan, blocked: undefined };
  process.stdout.write(JSON.stringify(emitted, null, args.pretty ? 2 : 0) + "\n");
  return 0;
}

// Importable for tests, runnable as a script.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2)));
}
