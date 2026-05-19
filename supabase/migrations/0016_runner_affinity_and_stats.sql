-- Joiner side of the recap.
alter table public.run_participants
  add column if not exists joiner_run_again boolean,
  add column if not exists joiner_reviewed_at timestamptz;

-- Joiners can update their own joiner_* fields (but not status or anyone
-- else's row). With-check restricts status changes — if they try to swap
-- status they'll fail. Postgres policies stack permissively: this row
-- becomes updatable when either the existing 'hosts update run requests'
-- policy OR this one matches.
drop policy if exists "joiner reviews own confirmation" on public.run_participants;
create policy "joiner reviews own confirmation" on public.run_participants
for update using (auth.uid() = user_id)
with check (auth.uid() = user_id and status in ('requested', 'confirmed'));

-- Mutual-affinity ledger: one canonical row per pair per run, only when
-- both sides ticked "run again". user_a is always the smaller uuid so the
-- unique constraint works regardless of who reviewed first.
create table if not exists public.runner_affinity (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references public.users(id) on delete cascade,
  user_b uuid not null references public.users(id) on delete cascade,
  run_id uuid not null references public.runs(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(user_a, user_b, run_id),
  constraint affinity_pair_order check (user_a < user_b)
);

create index if not exists runner_affinity_a_idx on public.runner_affinity(user_a);
create index if not exists runner_affinity_b_idx on public.runner_affinity(user_b);

alter table public.runner_affinity enable row level security;
drop policy if exists "users read affinity involving them" on public.runner_affinity;
create policy "users read affinity involving them" on public.runner_affinity
for select using (auth.uid() = user_a or auth.uid() = user_b);

-- Drop the affinity row when either side becomes false again. Idempotent.
create or replace function public.sync_runner_affinity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  organiser uuid;
  joiner uuid;
  pair_a uuid;
  pair_b uuid;
  both boolean;
begin
  select organiser_id into organiser from public.runs where id = new.run_id;
  joiner := new.user_id;
  if organiser is null or joiner is null or organiser = joiner then
    return new;
  end if;
  pair_a := least(organiser, joiner);
  pair_b := greatest(organiser, joiner);
  both := coalesce(new.host_run_again, false) and coalesce(new.joiner_run_again, false);

  if both then
    insert into public.runner_affinity (user_a, user_b, run_id)
    values (pair_a, pair_b, new.run_id)
    on conflict do nothing;
  else
    delete from public.runner_affinity
    where user_a = pair_a and user_b = pair_b and run_id = new.run_id;
  end if;
  return new;
end;
$$;

drop trigger if exists sync_runner_affinity_trg on public.run_participants;
create trigger sync_runner_affinity_trg
after insert or update of host_run_again, joiner_run_again on public.run_participants
for each row execute function public.sync_runner_affinity();

-- Stats for a user: completed runs (hosted or joined) + mutual affinity count.
create or replace function public.user_stats(uid uuid)
returns table(completed_runs integer, mutual_affinity integer)
language sql
stable
security definer
set search_path = public
as $$
  select
    (
      (select count(*) from public.runs where organiser_id = uid and status = 'completed')
      +
      (select count(*) from public.run_participants rp
        join public.runs r on r.id = rp.run_id
        where rp.user_id = uid and rp.status = 'confirmed' and r.status = 'completed')
    )::int as completed_runs,
    (select count(*) from public.runner_affinity where user_a = uid or user_b = uid)::int as mutual_affinity;
$$;

grant execute on function public.user_stats(uuid) to authenticated, anon;

-- Batch variant so the client can grab stats for everyone visible in one
-- round-trip instead of N RPCs per render.
create or replace function public.user_stats_batch(ids uuid[])
returns table(user_id uuid, completed_runs integer, mutual_affinity integer)
language sql
stable
security definer
set search_path = public
as $$
  select
    u.id as user_id,
    (
      (select count(*) from public.runs where organiser_id = u.id and status = 'completed')
      +
      (select count(*) from public.run_participants rp
        join public.runs r on r.id = rp.run_id
        where rp.user_id = u.id and rp.status = 'confirmed' and r.status = 'completed')
    )::int as completed_runs,
    (select count(*) from public.runner_affinity where user_a = u.id or user_b = u.id)::int as mutual_affinity
  from public.users u
  where u.id = any(ids);
$$;

grant execute on function public.user_stats_batch(uuid[]) to authenticated, anon;
