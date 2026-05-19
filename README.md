# runion

Mobile-first running partner matching app.

This repo starts from the current production single-file mobile prototype and turns it into a Next.js + Supabase architecture:

- Next.js App Router shell with mobile-first onboarding and matched runs UI
- typed run/match contracts
- Supabase PostGIS schema and RLS
- Edge Function skeletons for matching, reminders, no-shows, expiry, and next-run prompts

## Run Locally

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000).

## Checks

```bash
npm run typecheck
npm run lint
npm run build
```

## Supabase

1. Create a Supabase project.
2. Copy `.env.example` to `.env.local`.
3. Fill `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`.
4. Apply migrations in order: `0001_initial_architecture.sql`, `0002_profile_pace_range.sql`, `0003_participant_contact_snapshot.sql`, `0004_run_lat_lng.sql`.

The Map tab now reads open runs from Supabase via `lib/api/runs.ts` (`fetchOpenRuns`, `createRun`, `requestSpot`). Posted runs persist to the `runs` table and appear on the Map for the matching city. The seed data in `lib/runs.ts` is retained only as a fallback for the Runs feed when no backend session is available.

### Test data: seed runs for BCN & SG

```bash
npm run seed:test-runs            # reset + populate 7 BCN + 7 SG runs
npm run seed:test-runs:reset      # delete seeded rows only
npm run seed:test-runs:drain      # send queued join alerts via the edge function
```

All inserted rows carry `is_seed=true`. When anyone requests a spot on a seeded run, the `notify_on_seed_join` trigger queues a `notification_jobs` row and (if `pg_net` + the `app.settings.functions_url` / `app.settings.service_role_key` Postgres GUCs are set) calls the `seed-join-notify` edge function which emails `SEED_ALERT_EMAIL` (defaults to `mzlochevskyi@gmail.com`) via Resend.

If the trigger can't reach the edge function, `npm run seed:test-runs:drain` empties the queue manually — same email, same content.

Deploy the function with `supabase functions deploy seed-join-notify`.

To make join alerts fire instantly without running `--drain`, use a Supabase **Database Webhook** (Dashboard → Database → Webhooks):

- Table: `run_participants`, Events: `INSERT`
- Type: Supabase Edge Function, target: `seed-join-notify`
- Method: POST, default auth header is fine

The function ignores joins on non-seed runs, so the webhook is safe to leave on globally.

## Onboarding Flow

Runion is positioned around matching, not browsing: "Find 2-3 runners at your pace. No random groups."

New users move through:

1. Auth with Google OAuth or Supabase email magic link.
2. Runner identity.
3. Comfortable pace, stored as `comfortable_pace_seconds_per_km`.
4. Run intent.
5. Availability.
6. Preferred group size.
7. Trust profile with name, optional Instagram, and a profile-photo placeholder.
8. Interactive matched runs map/list with "Request spot" CTAs.

Saved profile fields:

- `runner_type`
- `comfortable_pace_seconds_per_km`
- `run_intents`
- `availability`
- `preferred_group_size`
- `instagram`
- `onboarding_completed`
- `profile_photo_url` / existing `avatar_url`

Phone auth is intentionally left as a TODO until the deployed Supabase project is configured for it.

## Infrastructure Checklist

Required credentials and secrets to share/configure:

- `NEXT_PUBLIC_SUPABASE_URL`: public Supabase project URL used by the browser and server clients.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: public Supabase anon key used with RLS-protected browser requests.
- `SUPABASE_SERVICE_ROLE_KEY`: server-only key for Edge Functions and trusted backend jobs. Never expose this in the client.
- Google OAuth client ID and client secret: configure in Supabase Auth under Google provider for "Get matched with Google".
- Supabase Auth redirect URLs: local `http://localhost:3000`, production app URL, and any preview deployment URLs that should accept magic links/OAuth returns.
- Email auth SMTP settings or Supabase managed email configuration: required for production-quality magic links.
- `NEXT_PUBLIC_DEFAULT_CITY`: default city slug for seeded matching and map center, currently `bcn`.

Optional / later:

- Supabase Storage bucket and policies for profile photos. The UI currently has a placeholder until upload is enabled.
- Phone auth provider credentials if phone login becomes a priority.
- `RESEND_API_KEY` and `RESEND_FROM` for notification email jobs.
- WhatsApp provider values: `WHATSAPP_PROVIDER`, `WHATSAPP_API_KEY`, and `WHATSAPP_NAMESPACE`.
- Production database password / direct connection string for migrations, kept outside the app runtime.
- Hosting project token or deploy hook if CI/CD should deploy automatically.
