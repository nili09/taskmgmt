export interface Env {
  DB: D1Database;
  /** Comma-separated list of the two people allowed in. A Worker secret in production, .dev.vars locally. */
  ALLOWED_EMAILS: string;
  /** https://<team>.cloudflareaccess.com. Empty means every request is refused. */
  ACCESS_TEAM_DOMAIN: string;
  /** The Access application's audience tag. */
  ACCESS_AUD: string;
  /** Local development only. Never set in a deployed Worker. */
  DEV_USER_EMAIL?: string;
}

export interface User {
  email: string;
}

export type AppEnv = { Bindings: Env; Variables: { user: User } };

export class HttpError extends Error {
  constructor(
    public status: 400 | 401 | 403 | 404 | 409,
    message: string,
  ) {
    super(message);
  }
}

export function allowedEmails(env: Env): string[] {
  return env.ALLOWED_EMAILS.split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}
