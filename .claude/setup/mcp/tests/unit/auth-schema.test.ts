import { describe, expect, it } from "vitest";
import { cimd } from "@better-auth/cimd";
import { fetchClientMetadataResource } from "@better-auth/cimd/node";
import { mcp } from "@better-auth/mcp";
import { getAuthTables } from "better-auth/db";
import { jwt } from "better-auth/plugins";
import * as schema from "@/lib/db/schema";

/**
 * Every model Better Auth expects has a table, and the Drizzle adapter is told
 * about it.
 *
 * This exists because the failure it catches is invisible until runtime. The
 * adapter resolves models lazily, so a missing table does not break the build,
 * the typecheck, or any test that avoids the code path; it surfaces as a 500 on
 * whichever request first touches it. The jwt() plugin's `jwks` table reached
 * the end-to-end tier exactly that way.
 *
 * If this fails: run `pnpm db:oauth-schema && pnpm db:generate`, then add the
 * new model to the adapter's schema map in src/lib/auth.ts.
 */

/**
 * Reads a plugin's declared models.
 *
 * Takes `unknown` because a plugin that persists nothing (cimd today) has no
 * `schema` property on its type at all, and the point of this list is to keep
 * every registered plugin in it, including the ones that currently declare
 * nothing. If one of those grows a table later, this notices.
 */
function modelsOf(plugin: unknown): string[] {
  const schema = (plugin as { schema?: Record<string, unknown> }).schema;
  return schema ? Object.keys(schema) : [];
}

const PLUGINS: unknown[] = [
  mcp({
    loginPage: "/login",
    consentPage: "/consent",
    resource: "https://example.com/api/mcp",
  }),
  jwt(),
  cimd({ fetchClientMetadataResource, metadataProfile: "mcp-2026-07-28" }),
];

describe("the auth database schema", () => {
  it("declares a table for every core Better Auth model", () => {
    for (const model of Object.keys(getAuthTables({}))) {
      expect(schema, `core model "${model}" has no table`).toHaveProperty(model);
    }
  });

  it("declares a table for every model the registered plugins persist", () => {
    const models = PLUGINS.flatMap(modelsOf);

    // A guard on the guard: if this ever reads zero models, the plugins stopped
    // exposing their schema and the test above is silently passing on nothing.
    expect(models.length).toBeGreaterThan(0);

    for (const model of models) {
      expect(schema, `plugin model "${model}" has no table`).toHaveProperty(model);
    }
  });

  it("declares every core field Better Auth writes, including ones added by upgrades", () => {
    for (const [model, definition] of Object.entries(getAuthTables({}))) {
      const table = (schema as Record<string, unknown>)[model] as Record<string, unknown>;
      for (const [fieldKey, field] of Object.entries(definition.fields)) {
        const property = (field as { fieldName?: string }).fieldName ?? fieldKey;
        expect(table, `${model}.${property} is missing`).toHaveProperty(property);
      }
    }
  });
});
