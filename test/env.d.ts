import type { D1Migration } from "cloudflare:test";

declare global {
  namespace Cloudflare {
    interface Env {
      DB: D1Database;
      ALLOWED_EMAILS: string;
      ACCESS_TEAM_DOMAIN: string;
      ACCESS_AUD: string;
      ATTACHMENTS: KVNamespace;
      VAPID_PUBLIC_KEY?: string;
      VAPID_PRIVATE_JWK?: string;
      VAPID_SUBJECT?: string;
      DEV_USER_EMAIL?: string;
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
