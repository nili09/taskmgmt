import { generateKeyPair } from "jose";
import { describe, expect, it } from "vitest";
import app from "../worker/index";
import { accessToken, ALEX, request, SAM, testEnv } from "./helpers";

const withToken = async (email: string | null, opts?: Parameters<typeof accessToken>[1]) => ({
  "cf-access-jwt-assertion": await accessToken(email, opts),
});

describe("sign-in", () => {
  it("accepts either allowed person and takes the email from the verified token", async () => {
    for (const email of [ALEX, SAM]) {
      const res = await request("/api/me", { headers: await withToken(email.toUpperCase()) });
      expect(res.status).toBe(200);
      expect((await res.json<any>()).email).toBe(email);
    }
  });

  it("refuses a valid sign-in from an email that is not allowed", async () => {
    const res = await request("/api/me", { headers: await withToken("stranger@example.test") });
    expect(res.status).toBe(403);
  });

  it("refuses requests without a usable token", async () => {
    const other = await generateKeyPair("RS256");
    const cases: Array<[string, Record<string, string>]> = [
      ["no token", {}],
      ["a bare email header", { "cf-access-authenticated-user-email": ALEX }],
      ["wrong audience", await withToken(ALEX, { aud: "someone-else" })],
      ["wrong issuer", await withToken(ALEX, { iss: "https://evil.cloudflareaccess.com" })],
      ["expired", await withToken(ALEX, { expiresIn: "-1m" })],
      ["signed by another key", await withToken(ALEX, { key: other.privateKey })],
      ["no email claim", await withToken(null)],
      ["garbage", { "cf-access-jwt-assertion": "not.a.jwt" }],
    ];
    for (const [name, headers] of cases) {
      const res = await request("/api/me", { headers });
      expect(res.status, name).toBe(401);
    }
  });

  it("refuses everything when Access is not configured", async () => {
    const res = await request("/api/me", { headers: await withToken(ALEX) }, { ACCESS_TEAM_DOMAIN: "", ACCESS_AUD: "" });
    expect(res.status).toBe(401);
  });

  it("refuses every API route without sign-in", async () => {
    for (const path of ["/api/tasks", "/api/events", "/api/activity", "/api/search?q=a", "/api/export.json", "/api/export.csv", "/api/read-cursors"]) {
      expect((await request(path)).status, path).toBe(401);
    }
    expect((await request("/api/mutations", { body: {} })).status).toBe(401);
  });
});

describe("dev-only user", () => {
  const dev = { DEV_USER_EMAIL: ALEX };

  it("works on a loopback host when the variable is set (dev server and tests only)", async () => {
    const res = await fetchAt("http://localhost:5173/api/me", dev);
    expect(res.status).toBe(200);
    expect((await res.json<any>()).email).toBe(ALEX);
  });

  it("is not honoured on any other host, even with the variable set", async () => {
    for (const host of ["https://tandem.example.com", "https://tandem.someone.workers.dev", "https://localhost.example.com", "http://192.168.1.5:8787"]) {
      const res = await fetchAt(`${host}/api/me`, dev);
      expect(res.status, host).toBe(401);
    }
  });

  it("is not honoured when the variable names someone who is not allowed", async () => {
    const res = await fetchAt("http://localhost:5173/api/me", { DEV_USER_EMAIL: "stranger@example.test" });
    expect(res.status).toBe(403);
  });
});

async function fetchAt(url: string, overrides: Record<string, string>) {
  return app.fetch(new Request(url), { ...testEnv, ...overrides });
}
