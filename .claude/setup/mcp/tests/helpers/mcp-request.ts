/**
 * Building and reading MCP requests the way a 2026-07-28 client does.
 *
 * Shared by the integration tier and the end-to-end tier so both speak the same
 * protocol as a real client. Living here rather than in either tier is
 * deliberate: when the two drifted, the integration tests were quietly served by
 * the legacy fallback while the endpoint they describe is modern-only.
 */

/**
 * The protocol revision this server speaks, and the only one it accepts
 * (ADR 0007).
 *
 * A literal, because the SDK exports no constant for it: its
 * LATEST_PROTOCOL_VERSION and SUPPORTED_PROTOCOL_VERSIONS still describe the
 * legacy era. If a request omits this the endpoint answers "Unsupported
 * protocol version", which is the correct behaviour and an easy thing to
 * mistake for a broken endpoint.
 */
export const MCP_PROTOCOL_VERSION = "2026-07-28";

const PROTOCOL_VERSION_KEY = "io.modelcontextprotocol/protocolVersion";
const CLIENT_INFO_KEY = "io.modelcontextprotocol/clientInfo";
const CLIENT_CAPABILITIES_KEY = "io.modelcontextprotocol/clientCapabilities";

/**
 * A modern MCP request body.
 *
 * Under this revision there is no handshake, so every request carries its own
 * protocol version, client identity AND client capabilities in `params._meta`.
 * All three keys are required; omitting any one is rejected with "Invalid _meta
 * envelope".
 */
export function mcpRequestBody(
  method: string,
  params: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method,
    params: {
      ...params,
      _meta: {
        [PROTOCOL_VERSION_KEY]: MCP_PROTOCOL_VERSION,
        [CLIENT_INFO_KEY]: { name: "harness-tests", version: "1.0.0" },
        [CLIENT_CAPABILITIES_KEY]: {},
      },
    },
  });
}

/**
 * The routing headers this revision requires on Streamable HTTP.
 *
 * `Mcp-Method` mirrors the body's method, and `Mcp-Name` mirrors `params.name`
 * whenever the body carries one, so a gateway can route and authorize without
 * parsing the payload. The server checks that headers and body AGREE and
 * rejects the request when either is missing, so these are not optional
 * decoration.
 */
export function mcpRoutingHeaders(method: string, name?: string): Record<string, string> {
  return {
    "Mcp-Method": method,
    ...(name ? { "Mcp-Name": name } : {}),
  };
}

/** A `tools/call` request for one tool, addressed to `url`. */
export function toolCallRequest(
  url: string,
  tool: string,
  args: Record<string, unknown> = {},
  token?: string,
): Request {
  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...mcpRoutingHeaders("tools/call", tool),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: mcpRequestBody("tools/call", { name: tool, arguments: args }),
  });
}

export type ToolResult = {
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

/**
 * Reads a JSON-RPC result from either response shape the transport may use.
 *
 * The handler answers with a single JSON body by default and upgrades to an SSE
 * stream when it has anything to emit before the result. A real client accepts
 * both, so a test that assumed one would fail on a detail no client depends on.
 */
export async function readToolResult(response: Response): Promise<ToolResult> {
  const contentType = response.headers.get("content-type") ?? "";
  const raw = await response.text();

  const payload = contentType.includes("text/event-stream")
    ? raw
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice("data:".length).trim())
        .join("") || "{}"
    : raw;

  const message = JSON.parse(payload) as { result?: ToolResult };
  return message.result ?? {};
}
