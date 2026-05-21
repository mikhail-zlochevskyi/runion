-- Recurring runs: a runs row can mark itself as repeating (weekly only
-- for now). The lazy expire_stale_runs hook (called on every Map/Runs
-- read) clones the row forward 7 days when it goes 4h past its start
-- time, so each weekly instance gets fresh participants.

alter table public.runs
  add column if not exists recurrence text;

do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
    where table_schema = 'public'
      and table_name = 'runs'
      and constraint_name = 'runs_recurrence_check'
  ) then
    alter table public.runs
      add constraint runs_recurrence_check
      check (recurrence is null or recurrence in ('weekly'));
  end if;
end;
$$;

create or replace function public.expire_stale_runs()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer := 0;
  row record;
  new_start timestamptz;
begin
  -- For each stale recurring run, clone forward to the next future
  -- weekly slot before we mark the current instance complete. The clone
  -- inherits everything (location, pace, intent, recurrence flag, …)
  -- so it will continue rolling indefinitely.
  for row in
    select id, start_time
    from public.runs
    where status in ('active', 'full')
      and start_time is not null
      and start_time < now() - interval '4 hours'
      and recurrence = 'weekly'
  loop
    new_start := row.start_time + interval '7 days';
    while new_start < now() loop
      new_start := new_start + interval '7 days';
    end loop;

    insert into public.runs (
      title, description, organiser_id, created_by, city, location_name,
      location, day, run_date, time, start_time,
      pace_min, pace_max, pace_seconds, distance_km, goal, intent,
      spots_total, spots_taken, max_group_size, current_spots,
      women_only, status, club_name, strava_url, garmin_url,
      expires_at, recurrence, is_seed
    )
    select
      title, description, organiser_id, created_by, city, location_name,
      location,
      day,                                 -- weekday is invariant under +7d
      (new_start)::date,                   -- session TZ; matches start_time
      (new_start)::time,
      new_start,
      pace_min, pace_max, pace_seconds, distance_km, goal, intent,
      spots_total, 0, max_group_size, 1,
      women_only, 'active'::public.run_status, club_name, strava_url, garmin_url,
      new_start + interval '48 hours', recurrence, is_seed
    from public.runs
    where id = row.id;
  end loop;

  -- Mark every stale run (recurring or not) as completed.
  update public.runs
  set status = 'completed'::public.run_status
  where status in ('active', 'full')
    and start_time is not null
    and start_time < now() - interval '4 hours';
  get diagnostics affected = row_count;
  return affected;
end;
$$;

grant execute on function public.expire_stale_runs() to authenticated, anon;
