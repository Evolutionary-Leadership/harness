#!/usr/bin/env node
/**
 * retrieval.mjs: just-in-time retrieval of the specification, as a
 * deterministic answer.
 *
 * Zero dependencies. Requires Node 22+. Run from the repo root, from
 * `.claude/skills/feature/SKILL.md` phase 1:
 *
 *   node scripts/retrieval.mjs select --product=<slug> \
 *     --nodes=<product node list.json> --terms-file=<the title and why> \
 *     --dir=<work dir> [--cap=6] [--include=slug,slug] [--fault=<3|4|5>]
 *
 *   node scripts/retrieval.mjs render --dir=<work dir> [--ceiling=20480]
 *
 * Why this file exists is the retrieval section of
 * .claude/SPEC-LOOP.md. The short version: a whole-product
 * snapshot runs to tens or hundreds of kilobytes, over the tool result cap, so
 * an interview paid for a truncated document and still lacked the node it
 * needed. Three to six nodes with the fields an interview uses is 5 to 10 KB.
 *
 * The ranking is ours rather than a search endpoint's because `/v1` has one
 * proven read of a product's nodes (`GET /v1/products/<p>/nodes`, driven by
 * scripts/check-spec.mjs) and no search route a repository can verify. The
 * currency being saved is
 * MODEL CONTEXT, not network bytes: the node list is redirected to a file and
 * never enters a conversation, and only the selected nodes are rendered.
 *
 * Two reply shapes are read defensively (`readNodeList`, `normaliseEdges`),
 * because the node list and the dependency edge are the two payloads this
 * repository consumes without a local schema. A field this file cannot find is
 * omitted from the block rather than rendered as `undefined`.
 *
 * Structure: everything above the CLI section at the foot of this file is pure
 * and exported, so a project's own unit tests drive it with in-memory input and
 * need no network, no fixture tree and no running Spec Universe. Only that
 * section and `main()` read a file or exit.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// ------------------------------------------------------------------ constants

/**
 * Words carrying no retrieval signal. Deliberately short: a stopword list that
 * grows starts deciding what a change is about, which is the ranking's job.
 */
export const STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "into", "than", "then",
  "when", "what", "which", "where", "while", "not", "but", "are", "was", "were",
  "its", "his", "her", "our", "their", "have", "has", "had", "been", "being",
  "can", "could", "should", "would", "will", "shall", "may", "might", "must",
  "any", "all", "each", "every", "some", "such", "only", "also", "more", "most",
  "one", "two", "how", "why", "who", "you", "your", "they", "them", "there",
  "here", "over", "under", "about", "after", "before", "because", "does", "did",
  "get", "got", "make", "made", "use", "used", "using", "way", "thing", "things",
  "still", "just", "very", "much", "many", "own", "same", "other", "another",
  "per", "via", "onto", "upon", "off", "out", "into", "down", "back", "now",
]);

/** Shorter than this and a token is noise: an ordinal, an initial, a unit. */
export const MIN_TERM_LENGTH = 3;

/** Terms shown in the one-line summary before it says how many there were. */
export const SUMMARY_TERMS = 8;

/** Seeds kept by default. Three to six nodes is the size the change targets. */
export const SEED_CAP = 6;

/** The rendered node text a session will accept, in bytes. 20 KB. */
export const BYTE_CEILING = 20480;

/**
 * What a term is worth in the field it landed in. A term in the slug or the
 * name is what the node IS about; a term deep in a rules paragraph is what it
 * mentions, and the gap between those two is the whole ranking.
 */
export const FIELD_WEIGHTS = {
  localSlug: 8,
  shortName: 6,
  name: 6,
  purpose: 3,
  behaviour: 1,
  rulesAndEdgeCases: 1,
};

/**
 * The sentence `spec-universe.sh` prints on exit 5, repeated here word for
 * word. It belongs to an outage and to nothing else: a configuration fault
 * that wears it sends a reader to wait instead of to set a variable.
 */
export const UNREACHABLE_SENTENCE = "spec unreachable, cannot verify";

// -------------------------------------------------------------------- ranking

/**
 * The terms of a text: lowercase, split on every non-alphanumeric, stopwords
 * and short tokens dropped, each term once.
 *
 * Node fields go through this same function, so a match is a token match and
 * never a substring one: `key` cannot match `monkey`, and no regular
 * expression has to be escaped to say so.
 */
export function tokenize(text) {
  const seen = [];
  const taken = new Set();
  for (const raw of String(text ?? "").toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < MIN_TERM_LENGTH) continue;
    // A pure number names no node. A why carrying "20,480 bytes" would
    // otherwise search on 480, which matches whatever happens to hold it.
    if (!/[a-z]/.test(raw)) continue;
    if (STOPWORDS.has(raw)) continue;
    if (taken.has(raw)) continue;
    taken.add(raw);
    seen.push(raw);
  }
  return seen;
}

/**
 * One node's score against a term list, plus the distinct terms it matched.
 *
 * A term counts once per field however often it repeats there: a node is not
 * more about slugs because its rules paragraph is long.
 */
export function scoreNode(node, terms) {
  let score = 0;
  const matched = new Set();
  for (const [field, weight] of Object.entries(FIELD_WEIGHTS)) {
    const tokens = new Set(tokenize(node?.[field]));
    if (tokens.size === 0) continue;
    for (const term of terms) {
      if (!tokens.has(term)) continue;
      score += weight;
      matched.add(term);
    }
  }
  return {
    slug: node?.localSlug ?? "",
    name: node?.shortName || node?.name || node?.localSlug || "",
    kind: node?.kind ?? "",
    score,
    matched: terms.filter((t) => matched.has(t)),
  };
}

/**
 * Every node a term reaches, best first.
 *
 * Distinct terms matched leads, because a node answering to two of the
 * change's words is more likely to be about it than one answering loudly to
 * one. Score breaks that tie and the slug breaks the last one, so the order is
 * total and a rerun is identical.
 */
export function rankNodes(nodes, terms) {
  return nodes
    .map((node) => scoreNode(node, terms))
    .filter((scored) => scored.score > 0)
    .sort(
      (a, b) =>
        b.matched.length - a.matched.length || b.score - a.score || a.slug.localeCompare(b.slug),
    );
}

/**
 * The seeds this retrieval will fetch in full.
 *
 * An included slug is always kept, even one no term reaches, because a session
 * that knows the vocabulary does not match must be able to say so in the open
 * rather than by widening the default. Include beyond the cap RAISES the cap
 * and reports that it did; it never silently drops what was asked for.
 */
export function selectSeeds(nodes, terms, { cap = SEED_CAP, include = [] } = {}) {
  const bySlug = new Map(nodes.map((n) => [n?.localSlug, n]));
  const wanted = include.filter((slug) => bySlug.has(slug));
  const unknown = include.filter((slug) => !bySlug.has(slug));

  const effectiveCap = Math.max(cap, wanted.length);
  const seeds = wanted.map((slug) => scoreNode(bySlug.get(slug), terms));
  const taken = new Set(wanted);

  for (const scored of rankNodes(nodes, terms)) {
    if (seeds.length >= effectiveCap) break;
    if (taken.has(scored.slug)) continue;
    taken.add(scored.slug);
    seeds.push(scored);
  }

  return { seeds, forced: wanted, unknown, capRaised: effectiveCap > cap };
}

// ------------------------------------------------------------------ rendering

/** A dependency edge, however the reply spelled it. */
export function normaliseEdges(raw) {
  const list = Array.isArray(raw) ? raw : (raw?.dependencies ?? raw?.edges ?? []);
  return list.map((edge) => {
    const target = edge?.target ?? edge?.to ?? edge?.node ?? {};
    return {
      type: edge?.type ?? edge?.edgeType ?? edge?.kind ?? "depends-on",
      slug: target?.localSlug ?? target?.slug ?? "",
      name: target?.shortName || target?.name || "",
    };
  });
}

const paragraph = (label, value) =>
  String(value ?? "").trim() === "" ? [] : [`**${label}.** ${String(value).trim()}`, ""];

const rollUp = (label, entries) => {
  if (!Array.isArray(entries)) return [];
  if (entries.length === 0) return [`**${label}.** none`, ""];
  const named = entries.map((e) => {
    const slug = e?.localSlug ?? e?.slug ?? e?.system?.slug ?? "?";
    const value = e?.conformance?.value ?? e?.conformance ?? "";
    return value ? `\`${slug}\` (${value})` : `\`${slug}\``;
  });
  return [`**${label}.** ${named.join(", ")}`, ""];
};

/**
 * One seed as the block a reader gets. Empty fields are omitted, so a thin
 * node renders thin and the ceiling is spent on nodes that have something to
 * say.
 */
export function renderSeed({ slug, matched, node, boundSystems, citingNodes, edges }) {
  const name = node?.shortName || node?.name || slug;
  const meta = [
    `kind ${node?.kind ?? "?"}`,
    `status ${node?.status ?? "?"}`,
    `version ${node?.version ?? "?"}`,
    `strictness ${node?.effectiveStrictness?.value ?? node?.strictness ?? "?"}`,
    `criticality ${node?.criticality ?? "?"}`,
  ];
  const conformance = node?.conformance?.value;
  if (conformance) meta.push(`conformance ${conformance}`);

  const lines = [`### \`${slug}\` ${name}`, "", meta.join(" | "), ""];
  if (matched?.length) lines.push(`matched: ${matched.join(", ")}`, "");

  lines.push(...paragraph("Purpose", node?.purpose));
  lines.push(...paragraph("Behaviour", node?.behaviour));
  lines.push(...paragraph("Rules and edge cases", node?.rulesAndEdgeCases));
  lines.push(...paragraph("Outside the boundary", node?.outsideBoundary));

  const criteria = node?.acceptanceCriteria ?? [];
  if (criteria.length > 0) {
    lines.push("**Acceptance criteria.**", "");
    for (const c of criteria) lines.push(`- \`${c?.id ?? "?"}\` ${c?.text ?? ""}`);
    lines.push("");
  }

  // Both roll-ups are one hop and arrive free on a requirement, so an empty one
  // is printed rather than skipped: "nothing answers to this rule" must never
  // look like "this is not a rule".
  lines.push(...rollUp("Bound systems", boundSystems));
  lines.push(...rollUp("Citing nodes", citingNodes));

  const list = normaliseEdges(edges);
  if (list.length > 0) {
    lines.push("**Depends on.**", "");
    for (const e of list) {
      lines.push(`- ${e.type} to \`${e.slug}\`${e.name ? ` (${e.name})` : ""}`);
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

/**
 * The whole block, under the ceiling.
 *
 * Whole seeds are kept in rank order, and the FIRST one that does not fit ends
 * the set: a smaller lower-ranked node is never let jump over a bigger
 * higher-ranked one, because a set whose order depends on node length is not a
 * ranking. Every drop is named, with the flag that brings one back, so a
 * truncated set is a decision put to the reader and never a silent loss.
 */
export function renderRetrieved({
  product,
  readAt,
  terms = [],
  seeds = [],
  ceiling = BYTE_CEILING,
  fault = null,
}) {
  const header = [
    "## Retrieved specification",
    "",
    `Product \`${product}\`, read at ${readAt}. Terms: ${terms.join(", ") || "(none)"}.`,
    "",
    "Interview context, never the text a write is built from: `/to-spec` re-reads",
    "live the node it is about to propose against. Dies with this file at the merge.",
    "",
    "",
  ].join("\n");

  if (fault !== null) {
    const markdown = `${header}${faultBlock(fault)}\n`;
    return { markdown, bytes: Buffer.byteLength(markdown, "utf8"), kept: [], dropped: [] };
  }

  if (seeds.length === 0) {
    const markdown = `${header}No node matched these terms. Nothing was retrieved, and nothing is\nassumed: the interview proceeds on what touches no existing node.\n`;
    return { markdown, bytes: Buffer.byteLength(markdown, "utf8"), kept: [], dropped: [] };
  }

  const kept = [];
  const dropped = [];
  const blocks = [];
  let used = Buffer.byteLength(header, "utf8");
  let full = false;

  for (const seed of seeds) {
    if (full) {
      dropped.push(seed.slug);
      continue;
    }
    const block = renderSeed(seed);
    const size = Buffer.byteLength(block, "utf8");
    if (used + size > ceiling) {
      full = true;
      dropped.push(seed.slug);
      continue;
    }
    used += size;
    blocks.push(block);
    kept.push(seed.slug);
  }

  let markdown = header + blocks.join("\n");
  if (dropped.length > 0) {
    markdown += [
      "",
      `**Dropped for the ${ceiling}-byte ceiling**, lowest rank first: ${dropped
        .map((s) => `\`${s}\``)
        .join(", ")}.`,
      "",
      `Name one to keep it: \`--include=${dropped[0]}\`. The set is truncated, not`,
      "the specification: a feature that genuinely touches more nodes says so.",
      "",
    ].join("\n");
  }

  return { markdown, bytes: Buffer.byteLength(markdown, "utf8"), kept, dropped };
}

/**
 * What the block says when the client could not read the specification.
 *
 * The three exits have three fixes, so they never share copy. A check still
 * fails closed; an interview degrades in the open, which is what
 * this block is.
 */
export function faultBlock(exit) {
  if (exit === 3) {
    return [
      "Nothing was retrieved: `missing-credential` (exit 3). `SPEC_UNIVERSE_URL` or",
      "`SPEC_UNIVERSE_TOKEN` is unset or blank. This is a configuration fault, not an",
      "outage: set the variable and run retrieval again. The interview proceeded",
      "blind, so treat every statement about an existing node as unverified.",
    ].join("\n");
  }
  if (exit === 4) {
    return [
      "Nothing was retrieved: `rejected-credential` (exit 4). The token is set and",
      "Spec Universe refused it, so it is expired, revoked, or for another universe.",
      "This is a configuration fault, not an outage: replace the token and run",
      "retrieval again. The interview proceeded blind.",
    ].join("\n");
  }
  if (exit === 5) {
    return [
      `Nothing was retrieved: \`spec-unreachable\` (exit 5). ${UNREACHABLE_SENTENCE}.`,
      "The interview proceeded blind, and grilled only what touches no existing node.",
    ].join("\n");
  }
  return `Nothing was retrieved: the client exited ${exit}, which is not one of its three faults.`;
}

/** The one line phase 1 prints, so the cost of the load is visible at the load. */
export function summarise({ kept = [], dropped = [], bytes = 0, terms = [] }) {
  const parts = [`${kept.length} nodes`, `${bytes} bytes`];
  if (dropped.length > 0) parts.push(`${dropped.length} dropped`);
  // The full term list is the block's business; a summary line carrying thirty
  // of them is a line nobody reads, and an unread summary reports nothing.
  const shown = terms.slice(0, SUMMARY_TERMS).join(", ") || "(none)";
  parts.push(
    terms.length > SUMMARY_TERMS
      ? `terms: ${shown} (${terms.length} terms)`
      : `terms: ${shown}`,
  );
  return `retrieval: ${parts.join(", ")}`;
}

/** The product node list, however the reply wrapped it. */
export function readNodeList(body) {
  if (Array.isArray(body)) return body;
  return body?.nodes ?? [];
}

// -------------------------------------------------------------------- the CLI

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

const flag = (argv, name) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};

const list = (value) =>
  (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

function main(argv) {
  const command = argv[0];
  const dir = flag(argv, "dir");

  if (command === "select") {
    if (!dir) {
      process.stderr.write("select needs --dir=<work dir>\n");
      return 2;
    }
    const product = flag(argv, "product");
    if (!product) {
      // Defaulting it would label one product's block with another product's
      // name, which is a wrong provenance line rather than a missing one.
      process.stderr.write("select needs --product=<slug>\n");
      return 2;
    }
    // One way in, so the terms a run searched on are always a file a reader can
    // open. An inline --terms would be the second way, and untested.
    const terms = tokenize(readFileSync(flag(argv, "terms-file"), "utf8"));

    const fault = flag(argv, "fault");
    if (fault) {
      writeFileSync(
        join(dir, "seeds.json"),
        `${JSON.stringify({ product, terms, fault: Number(fault) }, null, 2)}\n`,
      );
      return 0;
    }

    const picked = selectSeeds(readNodeList(readJson(flag(argv, "nodes"))), terms, {
      cap: Number(flag(argv, "cap") ?? SEED_CAP),
      include: list(flag(argv, "include")),
    });

    writeFileSync(
      join(dir, "seeds.json"),
      `${JSON.stringify({ product, terms, ...picked }, null, 2)}\n`,
    );
    for (const seed of picked.seeds) process.stdout.write(`${seed.slug}\n`);
    if (picked.unknown.length > 0) {
      process.stderr.write(`not in this product, so not retrieved: ${picked.unknown.join(", ")}\n`);
    }
    if (picked.capRaised) {
      process.stderr.write("cap raised to fit every included slug\n");
    }
    return 0;
  }

  if (command === "render") {
    if (!dir) {
      process.stderr.write("render needs --dir=<work dir>\n");
      return 2;
    }
    const seedsPath = join(dir, "seeds.json");
    if (!existsSync(seedsPath)) {
      process.stderr.write(`no seeds.json in ${dir}: run select first\n`);
      return 2;
    }
    const plan = readJson(seedsPath);

    if (plan.fault) {
      const out = renderRetrieved({
        product: plan.product,
        readAt: new Date().toISOString(),
        terms: plan.terms,
        fault: plan.fault,
      });
      process.stdout.write(out.markdown);
      process.stderr.write(`${summarise({ ...out, terms: plan.terms })}\n`);
      return plan.fault;
    }

    let readAt = plan.readAt ?? null;
    const seeds = [];
    for (const seed of plan.seeds ?? []) {
      const nodePath = join(dir, `${seed.slug}.node.json`);
      if (!existsSync(nodePath)) continue;
      const reply = readJson(nodePath);
      readAt ??= reply?.readAt ?? null;
      const depsPath = join(dir, `${seed.slug}.deps.json`);
      seeds.push({
        slug: seed.slug,
        matched: seed.matched ?? [],
        node: reply?.node ?? reply,
        boundSystems: reply?.boundSystems ?? null,
        citingNodes: reply?.citingNodes ?? null,
        edges: existsSync(depsPath) ? readJson(depsPath) : [],
      });
    }

    const out = renderRetrieved({
      product: plan.product,
      readAt: readAt ?? new Date().toISOString(),
      terms: plan.terms ?? [],
      seeds,
      ceiling: Number(flag(argv, "ceiling") ?? BYTE_CEILING),
    });
    process.stdout.write(out.markdown);
    process.stderr.write(`${summarise({ ...out, terms: plan.terms ?? [] })}\n`);
    return 0;
  }

  process.stderr.write("usage: retrieval.mjs <select|render> --dir=<work dir> [--flags]\n");
  return 2;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exit(main(process.argv.slice(2)));
}
