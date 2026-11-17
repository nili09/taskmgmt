# Changelog

All notable changes to Tandem. Versions follow the phase plan in the brief: one tag per phase.

## 0.1.0 – Foundation

- One Worker serving a Hono API and a Vite + React app as static assets. The app is a placeholder page.
- D1 schema for users, tasks, checklist items, notes, attachment metadata, events, push subscriptions and per-user read cursors.
- `events` is append-only: database triggers reject UPDATE and DELETE.
- Every mutation writes its event in the same D1 batch as the state change, with before and after values read inside that batch. The mutation id is unique, so replaying a mutation returns the original event and changes nothing.
- `shared/reduce.ts` rebuilds current state from the event log alone; a test checks it matches the tables.
- API: one mutation endpoint, a cursor-based events feed, task views, task detail with history, activity, search, read cursors, JSON and CSV export.
- Sign-in behind one module: Cloudflare Access JWT verified against the team keys (signature, issuer, audience, expiry), plus a two-email allow-list checked in the Worker.
- Dev-only user for local development, compiled out of production builds and honoured only on a loopback host.
- Not yet built: attachment bytes, push sending, the real interface, sync and the offline store.
