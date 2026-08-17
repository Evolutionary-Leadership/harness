import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { countAll, countOverAll, idList, textList } from "@/lib/db/sql";
import { queryKeys, parseNotesListKey } from "@/lib/query-keys";

/**
 * The two postgres-js traps, pinned as tests so a refactor cannot quietly
 * reintroduce them, plus the query-key contract the cache helpers depend on.
 *
 * Assertions go through the real PgDialect compiler rather than poking at
 * Drizzle's internal chunk representation, so they check the SQL and parameters
 * that would actually reach the driver.
 */

const dialect = new PgDialect();
const compile = (fragment: SQL): { sql: string; params: unknown[] } => {
  const query = dialect.sqlToQuery(fragment);
  return { sql: query.sql, params: query.params };
};

describe("idList", () => {
  it("emits one placeholder per value, not one array parameter", () => {
    // This is the whole trap. `col = ANY(${array})` would compile to a SINGLE
    // parameter carrying a JS array, which postgres-js sends as one value and
    // Postgres rejects with "malformed array literal".
    const { sql, params } = compile(idList(["a", "b", "c"]));
    expect(sql).toBe("($1, $2, $3)");
    expect(params).toEqual(["a", "b", "c"]);
  });

  it("handles a single value", () => {
    const { sql, params } = compile(idList(["only"]));
    expect(sql).toBe("($1)");
    expect(params).toEqual(["only"]);
  });

  it("returns a bare TRUE fragment for an empty list, binding nothing", () => {
    // TRUE keeps a composed WHERE clause syntactically valid, which also means it
    // matches EVERYTHING. Callers whose semantics are "match nothing when the
    // list is empty" MUST short circuit before calling; the repository does, and
    // tests/integration/notes-repository.test.ts proves it against real rows.
    const { sql, params } = compile(idList([]));
    expect(sql).toBe("TRUE");
    expect(params).toEqual([]);
  });

  it("does not interpolate values into the SQL text", () => {
    const { sql, params } = compile(idList(["'; drop table notes; --"]));
    expect(sql).toBe("($1)");
    expect(params).toEqual(["'; drop table notes; --"]);
    expect(sql).not.toContain("drop table");
  });

  it("textList compiles identically", () => {
    expect(compile(textList(["x", "y"]))).toEqual(compile(idList(["x", "y"])));
  });
});

describe("count casts", () => {
  it("casts count(*) to int, because bigint arrives as a string", () => {
    // Without ::int, postgres-js hands back "12" and a number-typed field is
    // silently poisoned: "12" + 1 === "121".
    expect(compile(countAll).sql).toBe("count(*)::int");
  });

  it("casts the window count too", () => {
    expect(compile(countOverAll).sql).toBe("(count(*) OVER ())::int");
  });
});

describe("query keys", () => {
  it("scopes a list key by notebook and scope", () => {
    expect(queryKeys.notes.list("nb1", "active")).toEqual(["notes", "list", "nb1", "active"]);
  });

  it("nests list and detail keys under the notes prefix, so prefix invalidation reaches them", () => {
    const prefix = queryKeys.notes.all();
    expect(queryKeys.notes.list("nb1", "archived").slice(0, prefix.length)).toEqual([...prefix]);
    expect(queryKeys.notes.detail("n1").slice(0, prefix.length)).toEqual([...prefix]);
    expect(queryKeys.notes.byNotebook("nb1").slice(0, prefix.length)).toEqual([...prefix]);
  });

  it("round-trips a list key through parseNotesListKey", () => {
    expect(parseNotesListKey(queryKeys.notes.list("nb9", "archived"))).toEqual({
      notebookId: "nb9",
      scope: "archived",
    });
  });

  it("rejects keys that are not notes list keys", () => {
    expect(parseNotesListKey(queryKeys.notes.detail("n1"))).toBeNull();
    expect(parseNotesListKey(queryKeys.notes.all())).toBeNull();
    expect(parseNotesListKey(queryKeys.notes.byNotebook("nb1"))).toBeNull();
    expect(parseNotesListKey(queryKeys.notebooks.list())).toBeNull();
    expect(parseNotesListKey(["notes", "list", "nb1", "bogus-scope"])).toBeNull();
    expect(parseNotesListKey(["notes", "list", 42, "active"])).toBeNull();
  });
});
