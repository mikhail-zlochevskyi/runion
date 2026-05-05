# runion

Map-first running partner matching app.

This repo starts from the current production single-file mobile prototype and turns it into a Next.js + Supabase architecture:

- Next.js App Router shell with Leaflet map UI
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
4. Apply `supabase/migrations/0001_initial_architecture.sql`.

The app currently uses seed data while the Supabase read/write path is wired.
