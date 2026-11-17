// Sign-in lives behind this one module. Today it trusts Cloudflare Access; the fallback in
// SPEC section 4 would replace `authenticate` and leave everything else alone.
import { createRemoteJWKSet, jwtVerify } from "jose";
import { allowedEmails, HttpError, type Env, type User } from "./env";

const jwksByTeam = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function keysFor(teamDomain: string) {
  let keys = jwksByTeam.get(teamDomain);
  if (!keys) {
    keys = createRemoteJWKSet(new URL(`${teamDomain}/cdn-cgi/access/certs`));
    jwksByTeam.set(teamDomain, keys);
  }
  return keys;
}

function isLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname.endsWith(".localhost");
}

/** Returns the signed-in, allow-listed user, or throws 401 / 403. */
export async function authenticate(request: Request, env: Env): Promise<User> {
  const email = await identify(request, env);
  if (!allowedEmails(env).includes(email)) throw new HttpError(403, "Not allowed");
  return { email };
}

async function identify(request: Request, env: Env): Promise<string> {
  // Dev-only path. Three independent guards: it is compiled out of production builds,
  // it needs a variable that only .dev.vars sets, and it needs a loopback host.
  if (import.meta.env.DEV) {
    if (env.DEV_USER_EMAIL && isLoopback(new URL(request.url).hostname)) {
      return env.DEV_USER_EMAIL.trim().toLowerCase();
    }
  }

  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token || !env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) throw new HttpError(401, "Sign in required");
  const team = env.ACCESS_TEAM_DOMAIN.replace(/\/+$/, "");
  try {
    const { payload } = await jwtVerify(token, keysFor(team), {
      issuer: team,
      audience: env.ACCESS_AUD,
      algorithms: ["RS256"],
    });
    if (typeof payload.email !== "string" || !payload.email) throw new Error("no email claim");
    return payload.email.trim().toLowerCase();
  } catch {
    throw new HttpError(401, "Sign in required");
  }
}
