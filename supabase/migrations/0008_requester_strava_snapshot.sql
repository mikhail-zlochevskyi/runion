-- Snapshot the requester's Strava URL on the participant row so hosts can
-- vet incoming requests without an extra round-trip to public.users.
alter table public.run_participants
  add column if not exists requester_strava text;
