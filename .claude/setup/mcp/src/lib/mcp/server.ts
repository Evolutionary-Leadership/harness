import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import { logger } from "@/lib/logger";

/**
 * Everything the tools are allowed to know about their caller.
 *
 * Deliberately narrow. Tool code receives this, never the raw access token or
 * the full JWT payload, so a tool cannot forward the caller's credential to an
 * upstream service. That forwarding is the confused deputy problem, and the
 * cheapest defence is not handing the token to the code that could misuse it.
 */
export type McpCaller = {
  /** The authenticated user's stable id (the token's `sub` claim). */
  userId: string;
  /** The OAuth client that obtained the token. */
  clientId?: string;
  /** Scopes the token actually carries. */
  scopes: string[];
};

/**
 * NO PROFILE FIELDS HERE, deliberately. An OAuth access token carries
 * authorization, not identity: name and email live in the ID token and at the
 * UserInfo endpoint, not in the access token this endpoint verifies. A tool
 * that wants the caller's profile should read it through the service layer, the
 * same way a Server Action would. See .claude/skills/mcp-tool/SKILL.md.
 */

/**
 * Wraps a tool handler so EVERY invocation is audited, not just the ones that
 * succeed.
 *
 * A log line written inside a handler's happy path is a promise the next tool
 * author has to remember to keep, and a tool that throws would then leave no
 * record of who called what. Wrapping is the structural version of that
 * promise: register a tool through this and the audit line cannot be forgotten.
 *
 * Two rules it enforces that prose cannot:
 *
 * - **Arguments are never logged.** They are not passed to the logger at any
 *   point here, so there is no path by which user content reaches log storage.
 * - **A failure logs the error's TYPE, not its message.** A message can quote
 *   the input that caused it; the name cannot. The error still propagates
 *   unchanged, so the caller gets the real diagnosis.
 */
function audited<Args extends unknown[], Result>(
  caller: McpCaller,
  tool: string,
  handler: (...args: Args) => Promise<Result>,
): (...args: Args) => Promise<Result> {
  return async (...args: Args): Promise<Result> => {
    const line = { mcpTool: tool, userId: caller.userId, clientId: caller.clientId };
    try {
      const result = await handler(...args);
      logger.info({ ...line, outcome: "ok" }, "mcp tool call");
      return result;
    } catch (error) {
      logger.warn(
        { ...line, outcome: "error", err: error instanceof Error ? error.name : "unknown" },
        "mcp tool call",
      );
      throw error;
    }
  };
}

/**
 * Builds a fresh MCP server for one request.
 *
 * A new instance per request is the SDK's model under the 2026-07-28 revision:
 * the protocol is stateless, so there is no session to keep and nothing to
 * share between callers. Keep this function cheap and free of I/O at
 * construction time; do the work inside a tool handler instead.
 *
 * WHERE TOOLS MAY REACH. A tool calls the service layer in src/server/services/
 * and nothing below it, the same boundary Server Actions enter through. It must
 * never touch a repository or the database directly: the service layer is where
 * authorization and invariants live, and a tool that bypasses it bypasses them
 * too. See .claude/skills/mcp-tool/SKILL.md before adding one.
 */
export function buildMcpServer(caller: McpCaller): McpServer {
  const server = new McpServer({
    name: "notes",
    version: "1.0.0",
  });

  server.registerTool(
    "whoami",
    {
      title: "Who am I",
      // Written as an instruction to a new teammate, because that is what a
      // tool description is: the model reads it to decide whether to call this.
      description:
        "Report which user account this connection is authenticated as, and " +
        "what it is allowed to do. Call it to confirm the connection works " +
        "and to find out whose data you are acting on before taking any " +
        "action on their behalf. Returns the account's stable identifier " +
        "rather than a name or email: an access token carries authorization, " +
        "not profile details. Takes no arguments and changes nothing.",
      inputSchema: z.object({}),
      outputSchema: z.object({
        userId: z.string().describe("Stable identifier for the authenticated account"),
        clientId: z
          .string()
          .optional()
          .describe("Identifier of the application that was authorized"),
        scopes: z.array(z.string()).describe("Permissions this connection holds"),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    audited(caller, "whoami", async () => {
      const output = {
        userId: caller.userId,
        ...(caller.clientId ? { clientId: caller.clientId } : {}),
        scopes: caller.scopes,
      };

      return {
        // Human-readable content and machine-readable structuredContent are
        // both required: the first is what a model reads, the second is what a
        // client can parse without guessing.
        content: [
          {
            type: "text" as const,
            text:
              `Authenticated as account ${caller.userId}` +
              `${caller.clientId ? `, via client ${caller.clientId}` : ""}. ` +
              `Permissions: ${caller.scopes.join(", ") || "none"}.`,
          },
        ],
        structuredContent: output,
      };
    }),
  );

  return server;
}
