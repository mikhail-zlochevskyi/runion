create extension if not exists postgis;
create extension if not exists pgcrypto;

create type public.run_status as enum ('draft', 'active', 'full', 'completed', 'expired');
create type public.match_status as enum ('pending', 'confirmed', 'completed', 'cancelled', 'no_show');
create type public.notification_channel as enum ('email', 'whatsapp', 'web_push');

create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  name text not null,
  whatsapp text,
  avatar_url text,
  strava_url text,
  garmin_url text,
  reliability_score integer not null default 100 check (reliability_score between 0 and 100),
  verified_at timestamptz,
  gender text,
  women_only_preference boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.runs (
  id uuid primary key default gen_random_uuid(),
  organiser_id uuid not null references public.users(id) on delete cascade,
  city text not null,
  location_name text not null,
  location geography(point, 4326) not null,
  day text not null,
  run_date date not null,
  time time not null,
  pace_min interval not null,
  pace_max interval not null,
  distance_km numeric(5, 2) not null check (distance_km > 0),
  goal text not null default 'Steady',
  spots_total integer not null default 1 check (spots_total between 1 and 8),
  spots_taken integer not null default 0 check (spots_taken >= 0),
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

create index runs_location_idx on public.runs using gist(location);
create index runs_city_status_date_idx on public.runs(city, status, run_date, time);
create index runs_organiser_idx on public.runs(organiser_id);

create table public.matches (
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

create index matches_run_idx on public.matches(run_id);
create index matches_joiner_idx on public.matches(joiner_id);
create index matches_status_idx on public.matches(status);

create table public.reviews (
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

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.users(id) on delete cascade,
  reported_id uuid not null references public.users(id) on delete cascade,
  run_id uuid references public.runs(id) on delete set null,
  reason text not null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.blocks (
  id uuid primary key default gen_random_uuid(),
  blocker_id uuid not null references public.users(id) on delete cascade,
  blocked_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(blocker_id, blocked_id),
  constraint no_self_block check (blocker_id <> blocked_id)
);

create table public.notification_jobs (
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

create index notification_jobs_due_idx on public.notification_jobs(scheduled_for) where sent_at is null and failed_at is null;

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

create trigger sync_run_spots_after_match
after insert or update of status or delete on public.matches
for each row execute function public.sync_run_spots();

alter table public.users enable row level security;
alter table public.runs enable row level security;
alter table public.matches enable row level security;
alter table public.reviews enable row level security;
alter table public.reports enable row level security;
alter table public.blocks enable row level security;
alter table public.notification_jobs enable row level security;

create policy "active runs are public" on public.runs
for select using (status in ('active', 'full', 'completed'));

create policy "organisers manage their runs" on public.runs
for all using (auth.uid() = organiser_id) with check (auth.uid() = organiser_id);

create policy "users read own profile" on public.users
for select using (auth.uid() = id);

create policy "users update own profile" on public.users
for update using (auth.uid() = id) with check (auth.uid() = id);

create policy "users insert own profile" on public.users
for insert with check (auth.uid() = id);

create policy "participants read matches" on public.matches
for select using (
  auth.uid() = joiner_id
  or exists (select 1 from public.runs where runs.id = matches.run_id and runs.organiser_id = auth.uid())
);

create policy "joiners create matches" on public.matches
for insert with check (auth.uid() = joiner_id);

create policy "participants update matches" on public.matches
for update using (
  auth.uid() = joiner_id
  or exists (select 1 from public.runs where runs.id = matches.run_id and runs.organiser_id = auth.uid())
);

create policy "review participants create reviews" on public.reviews
for insert with check (auth.uid() = reviewer_id);

create policy "users create reports" on public.reports
for insert with check (auth.uid() = reporter_id);

create policy "users manage own blocks" on public.blocks
for all using (auth.uid() = blocker_id) with check (auth.uid() = blocker_id);
