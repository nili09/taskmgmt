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

## Attachments and the free plan

Attachment bytes live in Workers KV, keyed by attachment id; the metadata and the history stay
in D1. Photos are resized on the device to a long edge of about 2000px before upload, and
nothing over 10 MB is accepted.

The KV free plan gives 1 GB of stored data, values up to 25 MiB, 100,000 reads and 1,000 writes
to different keys a day. One file per upload and one read per view keeps two people a long way
inside all four, and the 10 MB limit sits well under the 25 MiB ceiling.

## Configuration

| Name | Where | Purpose |
|---|---|---|
| `ALLOWED_EMAILS` | `.dev.vars` locally, Worker secret when deployed | The two people allowed in, comma separated |
| `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` | `wrangler.jsonc` vars | Cloudflare Access team domain and application audience tag. Empty refuses every request |
| `ATTACHMENTS` | `wrangler.jsonc` KV binding | Where attachment bytes are stored |
| `DEV_USER_EMAIL` | `.dev.vars` only | Local development user |
