# Tandem

A private task tracker for two people. See [SPEC.md](SPEC.md) for the brief and [CHANGELOG.md](CHANGELOG.md) for progress.

## Run it locally

```bash
npm install
cp .dev.vars.example .dev.vars   # then put your own addresses in it
npm run db:migrate:local
npm run dev
```

`.dev.vars` is git-ignored. `DEV_USER_EMAIL` signs you in on localhost only; it is compiled out of production builds and ignored on any non-loopback host.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server with the Worker running in the Workers runtime |
| `npm test` | API tests in the Workers runtime, then the offline store and a check of the production build |
| `npm run typecheck` | Type-checks the app, the Worker and the tests |
| `npm run build` | Type-checks and builds the Worker and the app |

## Configuration

| Name | Where | Purpose |
|---|---|---|
| `ALLOWED_EMAILS` | `.dev.vars` locally, Worker secret when deployed | The two people allowed in, comma separated |
| `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` | `wrangler.jsonc` vars | Cloudflare Access team domain and application audience tag. Empty refuses every request |
| `DEV_USER_EMAIL` | `.dev.vars` only | Local development user |
