# Runion Architecture

Runion is a map-first matching app: `Map View -> Run Detail -> Join Flow -> Post Flow -> Post-Run Loop`.

The current production HTML has been split into a Next.js App Router shell while preserving the mobile visual system: dark Leaflet map, olive bottom sheet, terracotta actions, Fraunces display type, DM Sans UI type, and compact bottom navigation.

## Components

| Layer | Responsibility | Current files |
| --- | --- | --- |
| Frontend | Map, run detail, post flow, joined-runs view | `app/page.tsx`, `components/runion-mobile-app.tsx` |
| Data contract | Typed run/match concepts and seed fallback | `lib/types.ts`, `lib/runs.ts` |
| Supabase | Postgres schema, RLS, geospatial query, match lifecycle | `supabase/migrations/0001_initial_architecture.sql` |
| Edge functions | Notification and reliability jobs | `supabase/functions/*` |
| Notifications | Queue table first, provider sender second | `notification_jobs` |

## Product Modules

**Matching**

- `runs` stores geocoded meeting points as PostGIS `geography(point, 4326)`.
- `runs_nearby(lat, lng, radius_m, city)` powers the map query.
- `matches.status` moves through `pending -> confirmed -> completed`, with terminal `cancelled` and `no_show` states.
- `sync_run_spots()` keeps `spots_taken` and `status = full` in sync with active matches.

**Reliability**

- Cancels and no-shows are recorded on `matches`.
- `no-show-flag` lowers `users.reliability_score`.
- A later manual-review queue can be built from `reports`, repeat no-shows, and low reliability scores.

**Post-Run Loop**

- `reviews` captures `showed_up`, `rating`, and `run_again`.
- `next-run-prompt` queues the 48-hour return email.
- A dedicated post-run review function should be added when the first review UI lands.

**Coordination**

- The UI should only write runs after a Nominatim result has `lat/lng`.
- WhatsApp should be template-driven from `notification_jobs`, not free-form chat.
- Profile photo can become required at join time once Supabase Storage is wired.

**Safety**

- `reports` and `blocks` are first-class tables.
- `runs.women_only` is stored on the run and should be enforced in the join mutation.
- RLS currently protects ownership and participant visibility; join eligibility logic belongs in a Postgres RPC before public launch.

## Build Order

1. Wire Supabase project env vars and run the migration.
2. Replace `seedRuns` with `runs_nearby` reads.
3. Add magic-link auth and profile creation.
4. Turn the Post form into a server action/RPC that geocodes with Nominatim before insert.
5. Turn Join into a transaction/RPC that checks capacity, blocks, women-only eligibility, and pace range.
6. Connect `notification_jobs` to Resend and WhatsApp Business.
7. Add post-run review prompts and reliability score UI.

## Provider Boundary

Edge functions currently queue notification jobs instead of calling providers directly. This keeps provider code isolated:

- `notification_jobs.template = match_created_plan`
- `notification_jobs.channel = whatsapp`
- provider sender maps that to 360dialog templates

That lets the app test lifecycle behavior without sending real messages.
