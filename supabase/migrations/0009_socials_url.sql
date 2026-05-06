-- Replace the Strava-only column with a generic "socials" URL that accepts
-- Strava, Instagram, or Garmin. Old strava columns are retained for now so
-- nothing breaks during rollout; they can be dropped once no code reads them.
alter table public.users
  add column if not exists socials_url text;

alter table public.run_participants
  add column if not exists requester_socials text;

update public.users
set socials_url = strava_url
where socials_url is null and strava_url is not null and strava_url <> '';

update public.run_participants
set requester_socials = requester_strava
where requester_socials is null and requester_strava is not null and requester_strava <> '';
