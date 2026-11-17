import { env } from "cloudflare:workers";
import { exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import { vi } from "vitest";
import app from "../worker/index";
import type { EventRecord } from "../shared/model";

export const ALEX = "alex@example.test";
export const SAM = "sam@example.test";
export const TEAM = "https://tandem-test.cloudflareaccess.com";
export const AUD = "test-audience-tag";

const kid = "test-key-1";
const keys = await generateKeyPair("RS256", { extractable: true });
const publicJwk: JWK = { ...(await exportJWK(keys.publicKey)), kid, alg: "RS256", use: "sig" };

// Serve the team's public keys from a stubbed fetch, so the real verification path runs.
const realFetch = globalThis.fetch;
vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url === `${TEAM}/cdn-cgi/access/certs`) return Response.json({ keys: [publicJwk] });
  return realFetch(input, init);
});

export async function accessToken(
  email: string | null,
  opts: { aud?: string; iss?: string; expiresIn?: string; key?: CryptoKey } = {},
) {
  const jwt = new SignJWT(email ? { email } : {})
    .setProtectedHeader({ alg: "RS256", kid })
    .setIssuer(opts.iss ?? TEAM)
    .setAudience(opts.aud ?? AUD)
    .setIssuedAt()
    .setExpirationTime(opts.expiresIn ?? "1h");
  return jwt.sign(opts.key ?? keys.privateKey);
}

export const testEnv = {
  ...env,
  ALLOWED_EMAILS: `${ALEX},${SAM}`,
  ACCESS_TEAM_DOMAIN: TEAM,
  ACCESS_AUD: AUD,
  DEV_USER_EMAIL: undefined,
} as typeof env;

export async function request(
  path: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
  overrides: Partial<typeof env> = {},
) {
  const res = await app.fetch(
    new Request(`https://tandem.example.com${path}`, {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      headers: { "content-type": "application/json", ...init.headers },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    }),
    { ...testEnv, ...overrides },
  );
  return res;
}

/** A signed-in person. */
export function as(email: string) {
  const call = async (path: string, init: { method?: string; body?: unknown } = {}, overrides: Partial<typeof env> = {}) =>
    request(path, { ...init, headers: { "cf-access-jwt-assertion": await accessToken(email) } }, overrides);
  return {
    email,
    get: async (path: string) => {
      const res = await call(path);
      return { status: res.status, body: (await res.json()) as any };
    },
    post: async (path: string, body: unknown) => {
      const res = await call(path, { body });
      return { status: res.status, body: (await res.json()) as any };
    },
    mutate: async (type: string, payload: Record<string, unknown>, extra: { id?: string; client_at?: string } = {}, overrides: Partial<typeof env> = {}) => {
      const res = await call(
        "/api/mutations",
        { body: { id: extra.id ?? crypto.randomUUID(), type, client_at: extra.client_at ?? new Date().toISOString(), payload } },
        overrides,
      );
      return { status: res.status, body: (await res.json()) as any };
    },
  };
}

export const uid = () => crypto.randomUUID();

export async function allEvents(): Promise<EventRecord[]> {
  const { results } = await env.DB.prepare("SELECT * FROM events ORDER BY seq").all<any>();
  return results.map((r) => ({ ...r, payload: JSON.parse(r.payload) }));
}

export async function count(table: string): Promise<number> {
  return (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())!.n;
}
