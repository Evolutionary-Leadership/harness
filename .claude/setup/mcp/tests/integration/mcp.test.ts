import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cimd } from "@better-auth/cimd";
import { fetchClientMetadataResource } from "@better-auth/cimd/node";
import { mcp } from "@better-auth/mcp";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { jwt } from "better-auth/plugins";
import * as schema from "@/lib/db/schema";
import { createMcpEndpoint } from "@/lib/mcp/endpoint";
import { MCP_SCOPE } from "@/lib/mcp/resource";
import { type McpCaller, buildMcpServer } from "@/lib/mcp/server";
import { hashPassword, verifyPassword } from "@/lib/password";
import { setupIntegrationDb, type IntegrationDb } from "./helpers/database";
import {
  MCP_PROTOCOL_VERSION,
  mcpRequestBody,
  mcpRoutingHeaders,
  readToolResult,
  toolCallRequest as buildToolCall,
} from "../helpers/mcp-request";

/**
 * The MCP endpoint's observable behaviour at the HTTP boundary.
 *
 * These tests assert what an MCP CLIENT sees: status codes, challenge headers,
 * discovery documents, and tool results. Nothing here asserts how the handler is
 * built or which SDK function it calls, because none of that is a promise to
 * anyone. See docs/TESTING.md.
 *
 * As in auth.test.ts, the auth instance is constructed here rather than imported
 * from src/lib/auth.ts, so the test controls the origin instead of depending on
 * the ambient environment.
 */

const ORIGIN = "http://localhost:3000";
const RESOURCE = `${ORIGIN}/api/mcp`;

let ctx!: IntegrationDb;

function makeAuth() {
  return betterAuth({
    secret: "integration-test-secret-that-is-long-enough",
    baseURL: ORIGIN,
    database: drizzleAdapter(ctx.db, {
      provider: "pg",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
        oauthClient: schema.oauthClient,
        oauthResource: schema.oauthResource,
        oauthClientResource: schema.oauthClientResource,
        oauthRefreshToken: schema.oauthRefreshToken,
        oauthAccessToken: schema.oauthAccessToken,
        oauthConsent: schema.oauthConsent,
        oauthClientAssertion: schema.oauthClientAssertion,
        jwks: schema.jwks,
      },
    }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
      minPasswordLength: 8,
      password: {
        hash: hashPassword,
        verify: ({ hash, password }) => verifyPassword(hash, password),
      },
    },
    session: { cookieCache: { enabled: false, maxAge: 0 } },
    plugins: [
      jwt(),
      mcp({
        loginPage: "/login",
        consentPage: "/consent",
        resource: RESOURCE,
        scopes: ["openid", "profile", "email", "offline_access", MCP_SCOPE],
      }),
      cimd({ fetchClientMetadataResource, metadataProfile: "mcp-2026-07-28" }),
    ],
  });
}

/**
 * The endpoint under test is the SAME function the route calls.
 *
 * Only the resource is pinned, so the test controls the origin instead of
 * depending on the ambient environment. Everything else, the protocol posture,
 * the scope enforcement, the claim parsing, comes from the shipped code, which
 * is the point: a test that rebuilt the wiring would be asserting its own copy.
 */
const makeEndpoint = (auth: ReturnType<typeof makeAuth>) => createMcpEndpoint(auth, RESOURCE);

/** A modern tools/call for whoami against this server's resource URL. */
const toolCallRequest = (token?: string): Request =>
  buildToolCall(RESOURCE, "whoami", {}, token);

beforeAll(async () => {
  ctx = await setupIntegrationDb();

  // The tool writes an audit line, and the logger resolves its level through
  // the app's environment schema on first use. That schema requires the two
  // variables every deployed environment sets; supply them here so a tool call
  // fails for a tool reason or not at all, rather than for a missing variable.
  // Nothing here connects through these: the tests drive the auth instance and
  // the handler directly, against the database the harness already opened.
  process.env.DATABASE_URL ??= "postgresql://unused:unused@127.0.0.1:1/unused";
  process.env.BETTER_AUTH_SECRET ??= "integration-test-secret-that-is-long-enough";
});

afterAll(async () => {
  await ctx?.teardown();
});

beforeEach(async () => {
  await ctx.reset();
});

describe("the MCP endpoint's authorization gate", () => {
  it("rejects an unauthenticated tool call instead of running the tool", async () => {
    const endpoint = makeEndpoint(makeAuth());

    const response = await endpoint(toolCallRequest());

    expect(response.status).toBe(401);
    // The challenge is what lets a client START the authorization flow. A bare
    // 401 with no WWW-Authenticate is a dead end, and a 500 is a bug.
    const challenge = response.headers.get("www-authenticate");
    expect(challenge).toBeTruthy();
    // RFC 9728: the challenge names where the protected resource metadata lives.
    expect(challenge).toContain("resource_metadata");
  });

  it("rejects a bearer token it cannot verify", async () => {
    const endpoint = makeEndpoint(makeAuth());

    const response = await endpoint(toolCallRequest("not-a-real-token"));

    expect(response.status).toBe(401);
  });
});

describe("the MCP endpoint's discovery documents", () => {
  it("publishes protected resource metadata naming this resource", async () => {
    const auth = makeAuth();

    // The exact URL the 401 challenge names: the origin ROOT, with the
    // resource's own path inserted per RFC 9728.
    const response = await auth.handler(
      new Request(`${ORIGIN}/.well-known/oauth-protected-resource/api/mcp`),
    );

    expect(response.status).toBe(200);
    const metadata = (await response.json()) as {
      resource?: string;
      authorization_servers?: string[];
    };
    // Tokens are audience-bound to this exact string, so a client that reads a
    // different one here asks for a token this endpoint will refuse.
    expect(metadata.resource).toBe(RESOURCE);
    expect(metadata.authorization_servers?.length ?? 0).toBeGreaterThan(0);
  });

  it("publishes authorization server metadata a client can start a flow from", async () => {
    const auth = makeAuth();

    // This server's issuer carries a path, so RFC 8414 inserts that path after
    // the well-known segment rather than appending it.
    const response = await auth.handler(
      new Request(`${ORIGIN}/.well-known/oauth-authorization-server/api/auth`),
    );

    expect(response.status).toBe(200);
    const metadata = (await response.json()) as {
      authorization_endpoint?: string;
      token_endpoint?: string;
      code_challenge_methods_supported?: string[];
    };
    expect(metadata.authorization_endpoint).toBeTruthy();
    expect(metadata.token_endpoint).toBeTruthy();
    // PKCE with S256 is mandatory for any internet-reachable MCP server.
    expect(metadata.code_challenge_methods_supported).toContain("S256");
  });
});

describe("the endpoint's protocol era", () => {
  /** The same handler configuration the route uses, without the auth guard. */
  const modernOnlyHandler = () =>
    createMcpHandler(() => buildMcpServer({ userId: "u", scopes: [MCP_SCOPE] }), {
      legacy: "reject",
    });

  it("refuses a request that names no protocol version", async () => {
    // A 2025-era client sends no per-request envelope. This is what it gets.
    const response = await modernOnlyHandler().fetch(
      new Request(RESOURCE, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "whoami", arguments: {} },
        }),
      }),
      { authInfo: { token: "", clientId: "c", scopes: [MCP_SCOPE] } },
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as {
      error?: { message?: string; data?: { supported?: string[] } };
    };
    // The error has to name what IS supported, so a version mismatch reads as a
    // mismatch rather than as a broken endpoint.
    expect(body.error?.data?.supported).toContain(MCP_PROTOCOL_VERSION);
  });

  it("serves a request that carries the modern envelope", async () => {
    const response = await modernOnlyHandler().fetch(
      new Request(RESOURCE, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          ...mcpRoutingHeaders("tools/list"),
        },
        body: mcpRequestBody("tools/list"),
      }),
      { authInfo: { token: "", clientId: "c", scopes: [MCP_SCOPE] } },
    );

    expect(response.status).toBe(200);
  });
});

describe("the whoami tool", () => {
  it("reports the identity the token was issued for", async () => {
    const caller = {
      userId: "user-under-test",
      clientId: "client-under-test",
      scopes: [MCP_SCOPE],
    };

    // Modern-only, exactly as the endpoint is configured. Without `legacy:
    // "reject"` the request would fall through to the legacy fallback and this
    // test would pass while describing a path the endpoint does not serve.
    const handler = createMcpHandler(({ authInfo }) => buildMcpServer(authInfo?.extra?.caller as McpCaller), {
      legacy: "reject",
    });

    const response = await handler.fetch(toolCallRequest(), {
      authInfo: {
        token: "",
        clientId: caller.clientId,
        scopes: caller.scopes,
        extra: { caller },
      },
    });

    expect(response.status).toBe(200);
    const result = await readToolResult(response);
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      userId: caller.userId,
      clientId: caller.clientId,
      scopes: [MCP_SCOPE],
    });
  });
});
