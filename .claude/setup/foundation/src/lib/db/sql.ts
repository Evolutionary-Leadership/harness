import { sql, type SQL } from "drizzle-orm";

/**
 * Shared fragments for the two postgres-js traps that are easy to hit and hard
 * to debug. Every query that needs an IN list or a count goes through here.
 */

/**
 * A parameterized `IN (...)` list.
 *
 * The trap: postgres-js binds a JS array as ONE parameter, so
 * `sql`col = ANY(${ids})`` reaches Postgres as a single text value and throws
 * "malformed array literal". This builds N placeholders joined by commas
 * instead, which is what the driver can actually bind.
 *
 * The empty case returns a TRUE fragment, so composing it into a WHERE clause
 * never produces invalid SQL. That means an empty list matches EVERYTHING, not
 * nothing. A caller whose semantics are "match nothing when the list is empty"
 * MUST short circuit before calling: return [] without touching the database.
 * tests/unit/db-sql.test.ts proves both branches.
 */
export function idList(values: readonly string[]): SQL {
  if (values.length === 0) return sql`TRUE`;
  return sql`(${sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  )})`;
}

/**
 * Same as idList, for text values. Kept as a separate name so a call site reads
 * as its intent rather than as a coincidence of both being strings.
 */
export function textList(values: readonly string[]): SQL {
  return idList(values);
}

/**
 * `count(*)` cast to int.
 *
 * The trap: Postgres `count(*)` is a bigint, and postgres-js hands bigint back
 * as a STRING to avoid precision loss. Assigning it to a `number` typed field
 * type checks fine and then poisons arithmetic silently ("12" + 1 === "121").
 * Always go through these helpers.
 */
export const countAll: SQL<number> = sql<number>`count(*)::int`;

/** Window-function total, for a paginated query that also needs the full count. */
export const countOverAll: SQL<number> = sql<number>`(count(*) OVER ())::int`;
