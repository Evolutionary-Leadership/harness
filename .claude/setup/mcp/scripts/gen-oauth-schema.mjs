/**
 * Regenerates src/lib/db/schema/oauth.ts from the Better Auth MCP plugin's own
 * schema declaration, applying the same type mapping @better-auth/cli uses for
 * the pg dialect, with this project's conventions layered on top
 * (snake_case columns, `withTimezone: true` timestamps, an index per FK).
 *
 * Run it after changing the Better Auth version or the mcp() plugin options:
 *
 *     pnpm db:oauth-schema && pnpm db:generate
 *
 * The second command turns the regenerated tables into a Drizzle migration.
 * Never hand-edit the output: the property names have to keep matching Better
 * Auth's field names, and a typo there fails at runtime, not at build time.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mcp } from "@better-auth/mcp";
import { jwt } from "better-auth/plugins";

const OUTPUT = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "lib", "db", "schema", "oauth.ts");

const snake = (s) => s.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();

/**
 * Every plugin the MCP build registers that persists anything. Keep this list
 * in step with the plugins array in src/lib/auth.ts: a plugin whose tables are
 * missing here fails at RUNTIME, on the first request that touches them, with
 * "model X was not found in the schema object".
 */
const plugins = [
  mcp({
    loginPage: "/login",
    consentPage: "/consent",
    resource: "https://example.com/api/mcp",
  }),
  jwt(),
];

const models = Object.fromEntries(
  plugins.flatMap((plugin) => Object.entries(plugin.schema ?? {})),
);
const modelNames = new Set(Object.keys(models));
const imports = new Set(["pgTable", "text", "index"]);
const CORE_MODELS = new Set(["user", "session", "account", "verification"]);

function columnFor(fieldName, f) {
  const col = snake(fieldName);
  if (f.references?.field === "id") {
    return `text("${col}")`;
  }
  const t = f.type;
  if (Array.isArray(t)) {
    return `text("${col}", { enum: [${t.map((x) => `"${x}"`).join(", ")}] })`;
  }
  switch (t) {
    case "string":
      return `text("${col}")`;
    case "boolean":
      imports.add("boolean");
      return `boolean("${col}")`;
    case "number":
      imports.add(f.bigint ? "bigint" : "integer");
      return f.bigint ? `bigint("${col}", { mode: "number" })` : `integer("${col}")`;
    case "date":
      imports.add("timestamp");
      // withTimezone matches the core auth tables in ./auth.ts.
      return `timestamp("${col}", { withTimezone: true })`;
    case "string[]":
      return `text("${col}").array()`;
    case "number[]":
      imports.add(f.bigint ? "bigint" : "integer");
      return f.bigint
        ? `bigint("${col}", { mode: "number" }).array()`
        : `integer("${col}").array()`;
    case "json":
      imports.add("jsonb");
      return `jsonb("${col}")`;
    default:
      throw new Error(`Unsupported field type ${JSON.stringify(t)} for ${fieldName}`);
  }
}

const bodies = [];
const usedCore = new Set();
for (const [modelKey, model] of Object.entries(models)) {
  const table = snake(model.modelName ?? modelKey);
  const lines = [`    id: text("id").primaryKey(),`];
  const indexes = [];
  for (const [fieldKey, f] of Object.entries(model.fields)) {
    const fieldName = f.fieldName || fieldKey;
    let expr = columnFor(fieldName, f);
    if (f.defaultValue !== null && typeof f.defaultValue !== "undefined") {
      if (typeof f.defaultValue === "function") {
        if (f.type === "date") expr += `.defaultNow()`;
      } else if (typeof f.defaultValue === "string") {
        expr += `.default("${f.defaultValue}")`;
      } else if (Array.isArray(f.defaultValue)) {
        expr += `.default([${f.defaultValue.map((v) => JSON.stringify(v)).join(", ")}])`;
      } else {
        expr += `.default(${f.defaultValue})`;
      }
    }
    if (f.required) expr += `.notNull()`;
    if (f.unique) expr += `.unique()`;
    if (f.references) {
      const target = f.references.model;
      if (!modelNames.has(target) && !CORE_MODELS.has(target)) {
        throw new Error(`Unknown reference target ${target}`);
      }
      const onDelete = f.references.onDelete || "cascade";
      if (CORE_MODELS.has(target)) usedCore.add(target);
      expr += `.references(() => ${target}.${f.references.field ?? "id"}, { onDelete: "${onDelete}" })`;
      indexes.push(`index("${table}_${snake(fieldName)}_idx").on(table.${fieldName})`);
    } else if (f.index && !f.unique) {
      indexes.push(`index("${table}_${snake(fieldName)}_idx").on(table.${fieldName})`);
    }
    lines.push(`    ${fieldName}: ${expr},`);
  }
  const idxPart = indexes.length
    ? `,\n  (table) => [\n${indexes.map((i) => `    ${i},`).join("\n")}\n  ],\n`
    : `,\n`;
  bodies.push(
    `export const ${modelKey} = pgTable(\n  "${table}",\n  {\n${lines.join("\n")}\n  }${idxPart});`,
  );
}

const coreRefs = [...usedCore].sort();
const header = `import { ${[...imports].sort().join(", ")} } from "drizzle-orm/pg-core";

import { ${coreRefs.join(", ")} } from "./auth";

/**
 * The tables the Better Auth MCP build needs, so an agent can hold a per-user,
 * resource-bound access token instead of everyone sharing one: the OAuth 2.1
 * tables from the mcp() plugin, plus the JWKS keys the jwt() plugin signs those
 * tokens with.
 *
 * GENERATED, not hand-written: produced from the plugin's own schema
 * declaration (\`mcp().schema\`) using the same pg type mapping @better-auth/cli
 * applies, with this project's conventions layered on top (snake_case columns,
 * \`withTimezone: true\` timestamps, an index per foreign key). Regenerate rather
 * than edit when the plugin version moves; the property names must keep
 * matching Better Auth's field names because the Drizzle adapter maps by
 * property, not by column.
 *
 * Do not add application columns here. See ./notes.ts for how app data lives in
 * its own table.
 */
`;

writeFileSync(OUTPUT, `${header}\n${bodies.join("\n\n")}\n`);
console.log(`generated ${Object.keys(models).length} tables`);
