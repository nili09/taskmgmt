# Changelog

All notable changes to Tandem. Versions follow the phase plan in the brief: one tag per phase.

## 0.3.0 – Offline and sync

- The device keeps its own copy of the event log in IndexedDB and rebuilds current state with
  `shared/reduce.ts`, the same reducer the server is tested against. Views, sorting, search,
  unread and history are worked out on the device, so everything already synced can be read
  with no signal.
- Writes go to an outbox first and show at once. They are sent in order when there is a line,
  on reconnect, when the app returns to the foreground, and on a slow poll while visible.
  Because the mutation id is unique, a change that was already received is not applied twice.
- Ids are generated on the device, so a task created offline keeps the id it was given.
- Conflicts resolve per field in server order: both writes stay in history and neither is lost.
- The app installs to the home screen: a manifest requested with credentials, so Access does
  not block it, icons set in the app's own typeface, and a service worker that serves the app
  itself from a stored copy while never caching API answers or a sign-in redirect.
- A line appears when you are offline or have changes still to send, and the menu says the same.
- `test-node/offline.test.mjs` runs the store against a stand-in Worker and a fake IndexedDB:
  a change applies at once, waits its turn, goes up in order, survives the other person editing
  the same task, and is not applied twice on replay.
- Not yet built: attachment bytes, push sending.

## 0.2.0 – The interface

- Self-hosted Newsreader (variable, Latin subset) and a token set for paper, ink and one
  accent, which marks unread and overdue and nothing else. Dark appearance is designed, not
  inverted; both pass WCAG AA for text.
- First run asks for the name that goes on every change.
- The five views, with open tasks sorted overdue first, then by due date, then high priority,
  then most recently changed. Unread tasks and overdue dates carry the accent.
- A new task is one tap from any view, and asks only for a title.
- Task detail: title, description, owner, due date and priority edited in place; a checklist
  with tick, edit, reorder and remove; an append-only thread of notes; complete, reopen,
  archive and restore, with a short-lived undo after complete and archive.
- Checklist order uses fractional position keys, so moving an item writes one event instead
  of renumbering the list.
- History, set as a ledger: day, time, person, what changed, and before and after for edits.
  The same component renders the global activity view.
- Search across titles, descriptions, checklist items and notes.
- A menu with activity, search, both exports, the signed-in address and the app version from git.
- Opening a task marks it read. Rows are links, so the phone's back gesture works.
- Not yet built: attachment bytes, push sending, offline and sync.

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
