import { createHash, randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import { readToolResult, toolCallRequest } from "../helpers/mcp-request";

/**
 * ONE journey, covering the whole authorization chain an agent actually walks:
 * register a client, ask for authorization, sign the user's consent, exchange
 * the code for a token, and call a tool with it.
 *
 * This is the tier that proves the pieces are wired to each other. Everything
 * cheaper (the challenge headers, the discovery documents, the tool's own
 * output) is asserted a tier down in tests/integration/mcp.test.ts; what cannot
 * be tested there is that a real browser redirect chain carries the signed
 * authorization query from page to page, which is precisely what breaks when
 * the consent page or the login form loses it.
 */

const base64url = (input: Buffer): string =>
  input.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** PKCE S256, mandatory for any internet-reachable MCP server. */
function pkce(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32));
  return { verifier, challenge: base64url(createHash("sha256").update(verifier).digest()) };
}

test("an agent authorizes and calls a tool, end to end", async ({ page, baseURL }) => {
  const origin = baseURL ?? "http://localhost:3210";
  const resource = `${origin}/api/mcp`;
  // A path the app does not serve. The browser still lands on it with the
  // authorization code on the query string, which is all a client needs.
  const redirectUri = `${origin}/e2e-oauth-callback`;

  // ---------------------------------------------------------------- sign in
  await page.goto("/login");
  await page.getByTestId("demo-login").click();
  await expect(page).toHaveURL(/\/notes/);

  // ------------------------------------------------------- register a client
  // Through the browser context, so the call carries the session cookie the
  // endpoint requires. This stands in for whatever registers a real client.
  const registration = await page.request.post("/api/auth/oauth2/create-client", {
    // Better Auth rejects a state-changing call with no Origin, and the API
    // request context does not send one by default.
    headers: { origin },
    data: {
      client_name: "E2E probe client",
      // "native" is what a desktop or CLI MCP client registers as, and it is
      // the application_type the 2026-07-28 revision added so such a client can
      // use a loopback http redirect. A "web" client is held to https.
      application_type: "native",
      redirect_uris: [redirectUri],
      scope: "openid profile email mcp",
      // A public client: no secret, PKCE only.
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code"],
      response_types: ["code"],
    },
  });
  expect(
    registration.ok(),
    `client registration failed: ${await registration.text()}`,
  ).toBeTruthy();
  const client = (await registration.json()) as { client_id: string };
  expect(client.client_id).toBeTruthy();

  // ----------------------------------------------------------- authorization
  const { verifier, challenge } = pkce();
  const state = base64url(randomBytes(16));
  const authorizeUrl = `/api/auth/oauth2/authorize?${new URLSearchParams({
    response_type: "code",
    client_id: client.client_id,
    redirect_uri: redirectUri,
    scope: "openid profile email mcp",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    // RFC 8707. This is what binds the issued token to the MCP endpoint; without
    // it the token is not accepted there.
    resource,
  }).toString()}`;

  await page.goto(authorizeUrl);

  // ---------------------------------------------------------------- consent
  // The consent screen has to name what is being granted, in words. If this
  // heading never appears, the signed authorization query was lost on the way.
  await expect(page.getByRole("heading", { name: "Authorize access" })).toBeVisible();
  await expect(page.getByText("Use this application's tools on your behalf")).toBeVisible();

  await page.getByRole("button", { name: "Approve" }).click();

  // The browser is handed back to the client's redirect_uri with a code.
  await page.waitForURL((url) => url.pathname === "/e2e-oauth-callback");
  const callback = new URL(page.url());
  expect(callback.searchParams.get("state")).toBe(state);
  const code = callback.searchParams.get("code");
  expect(code).toBeTruthy();

  // ----------------------------------------------------------- token exchange
  // Deliberately NOT through the browser context: a token exchange is a
  // back-channel call that must succeed on the PKCE verifier alone, with no
  // session cookie involved.
  const tokenResponse = await fetch(`${origin}/api/auth/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: code ?? "",
      redirect_uri: redirectUri,
      client_id: client.client_id,
      code_verifier: verifier,
      resource,
    }),
  });
  expect(tokenResponse.status).toBe(200);
  const tokens = (await tokenResponse.json()) as { access_token?: string; scope?: string };
  expect(tokens.access_token).toBeTruthy();
  expect(tokens.scope ?? "").toContain("mcp");

  // -------------------------------------------------------------- call a tool
  // Built by the same helper the integration tier uses, so both tiers speak the
  // protocol a real client speaks: the per-request _meta envelope AND the
  // Mcp-Method / Mcp-Name routing headers this revision requires.
  const toolRequest = toolCallRequest(resource, "whoami", {}, tokens.access_token);
  const toolResponse = await fetch(toolRequest);

  expect(
    toolResponse.status,
    `tool call rejected: ${toolResponse.headers.get("www-authenticate") ?? ""}`,
  ).toBe(200);

  const result = await readToolResult(toolResponse);

  expect(result.isError).toBeFalsy();

  // The tool must report the account the TOKEN was minted for, not some ambient
  // identity: the subject claim carried by the token and the user id the tool
  // reports have to be the same account.
  const subject = JSON.parse(
    Buffer.from((tokens.access_token ?? "").split(".")[1] ?? "", "base64url").toString("utf8"),
  ) as { sub?: string };
  expect(subject.sub).toBeTruthy();
  expect(result.structuredContent?.userId).toBe(subject.sub);
  expect(result.structuredContent?.scopes).toContain("mcp");
});
