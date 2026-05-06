-- One-shot top-up: creates everything from 0001 that isn't already there.
-- Safe to run on a partial schema. Does NOT touch existing public.users data.
-- After this succeeds, run 0003 and 0004, then `supabase migration repair`
-- to mark 0001/0002/0003/0004 as applied.

create extension if not exists postgis;
create extension if not exists pgcrypto;

-- Enum types (idempotent via DO blocks since CREATE TYPE has no IF NOT EXISTS).
do $$ begin
  create type public.run_status as enum ('draft', 'active', 'full', 'completed', 'expired');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.match_status as enum ('pending', 'confirmed', 'completed', 'cancelled', 'no_show');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.notification_channel as enum ('email', 'whatsapp', 'web_push');
exception when duplicate_object then null; end $$;

-- Tables (skip users — already exists with full 0001+0002 schema).

create table if not exists public.runs (
  id uuid primary key default gen_random_uuid(),
  title text,
  description text,
  organiser_id uuid not null references public.users(id) on delete cascade,
  created_by uuid references public.users(id) on delete cascade,
  city text not null,
  location_name text not null,
  location geography(point, 4326) not null,
  day text not null,
  run_date date not null,
  time time not null,
  start_time timestamptz,
  pace_min interval not null,
  pace_max interval not null,
  pace_seconds integer,
  distance_km numeric(5, 2) not null check (distance_km > 0),
  goal text not null default 'Steady',
  intent text,
  spots_total integer not null default 1 check (spots_total between 1 and 8),
  spots_taken integer not null default 0 check (spots_taken >= 0),
  max_group_size integer not null default 3 check (max_group_size between 1 and 8),
  current_spots integer not null default 1 check (current_spots >= 0),
  women_only boolean not null default false,
  status public.run_status not null default 'draft',
  club_name text,
  strava_url text,
  garmin_url text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '48 hours'),
  constraint spots_taken_lte_total check (spots_taken <= spots_total),
  constraint pace_range_order check (pace_min <= pace_max)
);

create index if not exists runs_location_idx on public.runs using gist(location);
create index if not exists runs_city_status_date_idx on public.runs(city, status, run_date, time);
create index if not exists runs_start_time_idx on public.runs(start_time);
create index if not exists runs_organiser_idx on public.runs(organiser_id);

create table if not exists public.run_participants (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.runs(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  status text not null default 'requested',
  created_at timestamptz not null default now(),
  unique(run_id, user_id)
);

create index if not exists run_participants_run_idx on public.run_participants(run_id);
create index if not exists run_participants_user_idx on public.run_participants(user_id);

-- 0003 columns
alter table public.run_participants
  add column if not exists requester_name text,
  add column if not exists requester_whatsapp text;

create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.runs(id) on delete cascade,
  joiner_id uuid not null references public.users(id) on delete cascade,
  status public.match_status not null default 'pending',
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  created_at timestamptz not null default now(),
  unique(run_id, joiner_id)
);

create index if not exists matches_run_idx on public.matches(run_id);
create index if not exists matches_joiner_idx on public.matches(joiner_id);
create index if not exists matches_status_idx on public.matches(status);

create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  reviewer_id uuid not null references public.users(id) on delete cascade,
  reviewee_id uuid not null references public.users(id) on delete cascade,
  showed_up boolean not null,
  run_again boolean,
  rating integer check (rating between 1 and 5),
  created_at timestamptz not null default now(),
  unique(match_id, reviewer_id)
);

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.users(id) on delete cascade,
  reported_id uuid not null references public.users(id) on delete cascade,
  run_id uuid references public.runs(id) on delete set null,
  reason text not null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.blocks (
  id uuid primary key default gen_random_uuid(),
  blocker_id uuid not null references public.users(id) on delete cascade,
  blocked_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(blocker_id, blocked_id),
  constraint no_self_block check (blocker_id <> blocked_id)
);

create table if not exists public.notification_jobs (
  id uuid primary key default gen_random_uuid(),
  channel public.notification_channel not null,
  template text not null,
  user_id uuid references public.users(id) on delete cascade,
  run_id uuid references public.runs(id) on delete cascade,
  match_id uuid references public.matches(id) on delete cascade,
  scheduled_for timestamptz not null,
  sent_at timestamptz,
  failed_at timestamptz,
  error text,
  created_at timestamptz not null default now()
);

create index if not exists notification_jobs_due_idx
  on public.notification_jobs(scheduled_for)
  where sent_at is null and failed_at is null;

-- Functions (CREATE OR REPLACE is idempotent).
create or replace function public.runs_nearby(
  user_lat double precision,
  user_lng double precision,
  radius_m integer default 6000,
  requested_city text default null
)
returns setof public.runs
language sql
stable
as $$
  select r.*
  from public.runs r
  where r.status in ('active', 'full')
    and (requested_city is null or r.city = requested_city)
    and st_dwithin(r.location, st_makepoint(user_lng, user_lat)::geography, radius_m)
  order by r.run_date asc, r.time asc;
$$;

create or replace function public.sync_run_spots()
returns trigger
language plpgsql
as $$
declare
  target_run_id uuid;
  active_match_count integer;
begin
  target_run_id := case when tg_op = 'DELETE' then old.run_id else new.run_id end;

  select count(*)
  into active_match_count
  from public.matches
  where run_id = target_run_id
    and status in ('pending', 'confirmed');

  update public.runs
  set
    spots_taken = active_match_count,
    status = case
      when active_match_count >= spots_total then 'full'::public.run_status
      when status = 'full' then 'active'::public.run_status
      else status
    end
  where id = target_run_id;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

drop trigger if exists sync_run_spots_after_match on public.matches;
create trigger sync_run_spots_after_match
after insert or update of status or delete on public.matches
for each row execute function public.sync_run_spots();

create or replace function public.sync_run_participant_spots()
returns trigger
language plpgsql
as $$
declare
  target_run_id uuid;
  requested_count integer;
begin
  target_run_id := case when tg_op = 'DELETE' then old.run_id else new.run_id end;

  select count(*)
  into requested_count
  from public.run_participants
  where run_id = target_run_id
    and status in ('requested', 'confirmed');

  update public.runs
  set
    current_spots = greatest(1, requested_count),
    status = case
      when greatest(1, requested_count) >= max_group_size then 'full'::public.run_status
      when status = 'full' then 'active'::public.run_status
      else status
    end
  where id = target_run_id;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

drop trigger if exists sync_run_spots_after_participant on public.run_participants;
create trigger sync_run_spots_after_participant
after insert or update of status or delete on public.run_participants
for each row execute function public.sync_run_participant_spots();

-- RLS (alter table is idempotent).
alter table public.users enable row level security;
alter table public.runs enable row level security;
alter table public.run_participants enable row level security;
alter table public.matches enable row level security;
alter table public.reviews enable row level security;
alter table public.reports enable row level security;
alter table public.blocks enable row level security;
alter table public.notification_jobs enable row level security;

-- Policies (drop+create so this script is rerunnable).
drop policy if exists "active runs are public" on public.runs;
create policy "active runs are public" on public.runs
for select using (status in ('active', 'full', 'completed'));

drop policy if exists "organisers manage their runs" on public.runs;
create policy "organisers manage their runs" on public.runs
for all using (auth.uid() = organiser_id) with check (auth.uid() = organiser_id);

drop policy if exists "run participants read own requests" on public.run_participants;
create policy "run participants read own requests" on public.run_participants
for select using (
  auth.uid() = user_id
  or exists (select 1 from public.runs where runs.id = run_participants.run_id and (runs.organiser_id = auth.uid() or runs.created_by = auth.uid()))
);

drop policy if exists "users request run spots" on public.run_participants;
create policy "users request run spots" on public.run_participants
for insert with check (auth.uid() = user_id and status = 'requested');

drop policy if exists "hosts update run requests" on public.run_participants;
create policy "hosts update run requests" on public.run_participants
for update using (
  exists (select 1 from public.runs where runs.id = run_participants.run_id and (runs.organiser_id = auth.uid() or runs.created_by = auth.uid()))
) with check (
  exists (select 1 from public.runs where runs.id = run_participants.run_id and (runs.organiser_id = auth.uid() or runs.created_by = auth.uid()))
  and status in ('requested', 'confirmed', 'declined')
);

drop policy if exists "users read own profile" on public.users;
create policy "users read own profile" on public.users
for select using (auth.uid() = id);

drop policy if exists "users update own profile" on public.users;
create policy "users update own profile" on public.users
for update using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "users insert own profile" on public.users;
create policy "users insert own profile" on public.users
for insert with check (auth.uid() = id);

drop policy if exists "participants read matches" on public.matches;
create policy "participants read matches" on public.matches
for select using (
  auth.uid() = joiner_id
  or exists (select 1 from public.runs where runs.id = matches.run_id and runs.organiser_id = auth.uid())
);

drop policy if exists "joiners create matches" on public.matches;
create policy "joiners create matches" on public.matches
for insert with check (auth.uid() = joiner_id);

drop policy if exists "participants update matches" on public.matches;
create policy "participants update matches" on public.matches
for update using (
  auth.uid() = joiner_id
  or exists (select 1 from public.runs where runs.id = matches.run_id and runs.organiser_id = auth.uid())
);

drop policy if exists "review participants create reviews" on public.reviews;
create policy "review participants create reviews" on public.reviews
for insert with check (auth.uid() = reviewer_id);

drop policy if exists "users create reports" on public.reports;
create policy "users create reports" on public.reports
for insert with check (auth.uid() = reporter_id);

drop policy if exists "users manage own blocks" on public.blocks;
create policy "users manage own blocks" on public.blocks
for all using (auth.uid() = blocker_id) with check (auth.uid() = blocker_id);

-- 0004: lat/lng generated columns
alter table public.runs
  add column if not exists location_lat double precision
    generated always as (st_y(location::geometry)) stored,
  add column if not exists location_lng double precision
    generated always as (st_x(location::geometry)) stored;
