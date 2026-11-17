# SPEC.md — Tandem

## 1. What this is
A private task tracker for exactly two people: a senior strategy lead and his CTO.
They use it mostly on their phones, installed from the browser to the home screen /
app drawer, and occasionally on a laptop. It replaces tasks scattered across chat
threads. It is not a team tool and must never grow team-tool features (no projects,
no roles, no boards, no settings pages full of toggles).

The product promise is trust in the record: who asked for what, who changed what,
and when. Nothing is ever silently overwritten or deleted.

## 2. Features (this list is the scope; do not add to it)
- First run: the person confirms their name. Their email comes from sign-in and is
  shown but not editable. Name + email is their identity on every change they make.
- Either person can create a task: title (required), description, owner (me / the
  other person), due date, priority (normal / high). Only the title is asked for
  up front; the rest is optional and editable later.
- Each task has a checklist of items (add, tick, untick, edit, reorder, remove) and
  a thread of notes (append-only: a note cannot be edited or removed once posted).
- Each task can carry attachments: photos and documents.
- Either person can mark a task complete, reopen it, or archive it. There is no
  delete anywhere in the product. Archive is the only way to put something away,
  and archived tasks stay searchable and restorable.
- Every task has a history both people can read: every change ever made, who made
  it, the exact time, and for edits the before and after values.
- A global activity view: the same history across all tasks, newest first.
- Unread state: a task the other person has changed since I last opened it is
  marked, and the app icon shows a badge count where the platform supports it.
- Views: Open (default), Mine, Theirs, Done, Archived. Open tasks sort overdue
  first, then by due date, then high priority, then most recently changed.
- Search across titles, descriptions, checklist items and notes.
- Push notification to the other person when a task is created, completed,
  reopened, reassigned, or gets a new note. Never notify people of their own
  actions. Checklist ticks do not notify (too noisy); they show as unread instead.
- Works offline: read everything already synced, create and edit with no signal,
  and sync when the connection returns.
- Undo: a short-lived undo after complete and archive.
- Export: one button that downloads everything (tasks, items, notes, full history)
  as JSON, plus a CSV of tasks. This is the backup.
- Light and dark appearance, following the device.
- The app version (from git) is visible at the bottom of the menu.

## 3. Architecture
- One Cloudflare Worker serving both the API and the built front end as static
  assets. Free plan only. No R2, no Durable Objects, no paid add-ons, no services
  that need a credit card.
- API: Hono on the Worker, TypeScript.
- Data: Cloudflare D1.
- Attachment bytes: Workers KV (see section 7). Metadata lives in D1.
- Front end: Vite + React + TypeScript, a single-page app, installable as a PWA.
- Local store on the device: IndexedDB.
- Tests: Vitest with the Cloudflare Workers test pool for the API; Playwright for
  the offline and install flows.
- Cloudflare's tooling changes often. Before writing wrangler config, static asset
  config, D1 migrations or KV bindings, read the current Cloudflare docs rather
  than relying on memory.

### The event log is the source of truth
Every mutation appends one row to an `events` table in the same D1 batch as the
state change it describes. An event records: a server-assigned sequence number,
the task, the actor, the event type, a JSON payload holding before and after
values, the time the person did it on their device (`client_at`), the time the
server recorded it (`server_at`, always set by the server, UTC), and the
client-generated mutation id.

- The events table is append-only. Enforce it in the database with triggers that
  reject UPDATE and DELETE, not just by convention.
- The mutation id is unique. Replaying the same mutation must be a no-op that
  returns the original result. This is what makes offline replay safe.
- The current-state tables (tasks, items, notes, attachments) exist for fast
  reads. A test must prove they can be rebuilt from the event log alone.
- Timestamps are stored in UTC and displayed in the viewer's local time zone.

### Sync
- The client pulls with a cursor: "give me every event after sequence N". It pulls
  on launch, on return to foreground, on reconnect, after a push arrives, and on a
  slow interval while visible. No websockets.
- Writes go into a local outbox first, are applied to the local store immediately,
  and are sent in order when online. Ids are generated on the client (UUID v7 or
  similar sortable id) so offline-created tasks keep their id.
- Conflicts: last write wins per field, ordered by server sequence. Both writes
  remain in history, so nothing is lost and either person can see what happened.
  Completing a task that the other person has archived (or similar) must resolve
  to a sane state without an error dialog.

## 4. Sign-in and access
Primary: Cloudflare Access sits in front of the whole Worker with a one-time PIN
sent by email. Only two email addresses are allowed. There are no passwords in the
product, the repo or the config.
- The Worker verifies the Access JWT (signature against the team's public keys,
  audience, expiry) on every API request and takes the email from it. Do not trust
  a bare email header.
- The two allowed emails are also checked in the Worker (a plain config variable,
  not a secret), so a misconfigured Access policy cannot let a third person in.
- Session length: the longest Access allows, so the PIN is a rare event.
- Known traps to handle: the web manifest must be requested with credentials or
  Access blocks it and the app will not install; an expired session makes API
  calls fail with a redirect, which the app must detect and answer with a full
  page reload into sign-in, keeping the outbox intact; an installed iPhone app has
  its own cookie jar, separate from Safari.
- Local development uses a dev-only variable to name the current user. It must be
  impossible for that path to be active in a deployed Worker, and a test proves it.

Fallback (only if the owner says Cloudflare Access is unavailable to him): the app
runs its own email one-time-code sign-in. Six-digit code, ten-minute expiry, rate
limited, sent through an email API with a free tier that needs no card; a
long-lived HttpOnly, Secure, SameSite=Lax session cookie; same two-email allowlist.
The rest of the system is identical, so keep sign-in behind one small module.

## 5. Design direction
The brief is the standard of a top identity studio: a tool that looks designed by
people who care about typography, not a themed component library. It should feel
like a well-made ledger shared by two people, calm and exact.

- Typography carries the design. One typeface family with real character,
  self-hosted so it works offline, open licence. Not Inter, not Roboto, not system
  UI. A clear, large type scale with confident size jumps; task titles are set
  big. Timestamps and counts use tabular figures.
- A strict grid and generous, consistent spacing. Alignment does the organising
  work that boxes usually do: prefer rules and whitespace over cards, and no
  shadows.
- Near-monochrome: paper and ink, one accent colour used sparingly and with a
  fixed meaning (it marks what needs my attention: unread and overdue). Dark
  appearance is designed, not inverted.
- No gradients, no glass effects, no emoji, no illustrations, no decorative icons.
  Icons only where a word would not fit, drawn as one consistent set.
- No small uppercase or monospace "eyebrow" labels above headings. The owner reads
  them as machine-made filler.
- History is the signature element. Set it like a ledger: time, person, what
  changed, with before and after for edits. Quiet, dense, beautifully aligned.
- Motion is brief and functional: a completed task settles, a sheet slides. Honour
  reduced-motion.
- Phone first. One-handed use: primary actions within thumb reach, new task one
  tap from anywhere, touch targets at least 44px, safe-area insets respected.
  On a laptop the same design opens into a list and detail pane.
- Words in the interface are plain and short. Sentence case. Buttons name the
  action. No exclamation marks, no cheerfulness, no jargon like "sync conflict".
  Empty states say what to do next in one line.
- Accessibility is part of the standard: WCAG AA contrast in both appearances,
  visible focus, everything reachable by keyboard and screen reader.

## 6. Notifications
Standard Web Push with VAPID. The key pair is generated once on the owner's
machine and stored as Worker secrets; it never enters the repo. Ask for permission
only after a deliberate tap on a clearly worded control, never on first load. On
iPhone, push works only once the app is installed to the home screen, so the app
explains that at the right moment. Sending happens after the response is returned
so a slow push service never slows a save. Expired subscriptions are cleaned up.
Tapping a notification opens that task.

## 7. Attachments
Stored in Workers KV because the owner has no R2 and will not add a card. Photos
are resized and compressed on the device before upload (long edge about 2000px).
Hard limit 10 MB per file after compression, with a clear message above that.
Files are served only through an authenticated Worker route, never from a public
URL. An attachment added offline waits in the outbox with its bytes and uploads on
reconnect. Removing an attachment hides it and records the event; the history
still shows that it existed. Stay well inside free-plan limits and say so in the
README.

## 8. Ways of working
- Git from the first commit. Small commits with clear messages, one phase per
  branch merged to main, a tag at the end of each phase (v0.1.0 ... v1.0.0), and a
  CHANGELOG.md kept current.
- No secrets, keys, emails or passwords committed. `.dev.vars` is git-ignored and
  an example file documents the variable names.
- Build the minimum that satisfies this spec. No speculative options, no
  abstractions for one caller, no features that are not listed in section 2. If
  something in the spec looks wrong or contradictory, stop and ask rather than
  choosing silently.
- State your plan and assumptions before coding each phase. Finish each phase by
  running the checks and reporting what was verified and what was not.
