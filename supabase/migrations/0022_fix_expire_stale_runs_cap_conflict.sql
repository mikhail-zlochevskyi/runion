-- expire_stale_runs was failing with P0001 "You can only host 3 open runs"
-- because enforce_open_runs_cap fired on the writes the cleanup performs:
--   1. the weekly-rollover clone INSERT (a system op rolling an EXISTING run
--      forward, not a user posting a new one), and
--   2. the status -> 'completed' UPDATE (if the trigger was bound to UPDATE).
-- Either aborts the whole function, so stale runs never auto-complete and
-- every Map/Runs read logged a 400. Two fixes, one per path:
--   * bind the cap trigger to INSERT only -- completing/cancelling a run must
--     never be blocked by a "can't post another run" cap;
--   * a transaction-local bypass flag that expire_stale_runs sets before it
--     writes, so its rollover clone is exempt.

-- 1) Drop the existing cap trigger name-agnostically. It was created via the
--    dashboard, not a migration, so its name isn't recorded anywhere.
do $$
declare
  trg record;
begin
  for trg in
    select t.tgname
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_proc p on p.oid = t.tgfoid
    where n.nspname = 'public'
      and c.relname = 'runs'
      and p.proname = 'enforce_open_runs_cap'
      and not t.tgisinternal
  loop
    execute format('drop trigger if exists %I on public.runs', trg.tgname);
  end loop;
end;
$$;

-- 2) Cap function: honour the bypass flag, skip seeds, and only ever enforce
--    on INSERT (defensive even though we bind INSERT-only below).
create or replace function public.enforce_open_runs_cap()
returns trigger
language plpgsql
as $$
declare
  open_count integer;
begin
  -- System functions (expire_stale_runs) set this for the duration of their
  -- transaction. missing_ok=true -> NULL (not an error) when unset.
  if current_setting('runion.bypass_cap', true) = 'on' then
    return new;
  end if;

  if TG_OP <> 'INSERT' then
    return new;
  end if;

  if coalesce(new.is_seed, false) then
    return new;
  end if;

  select count(*) into open_count
  from public.runs
  where organiser_id = new.organiser_id
    and status in ('draft', 'active', 'full')
    and coalesce(is_seed, false) = false;

  if open_count >= 3 then
    raise exception 'You can only host 3 open runs at a time. Complete or cancel one before posting another.'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

-- 3) Rebind deterministically: BEFORE INSERT only.
create trigger enforce_open_runs_cap_trg
  before insert on public.runs
  for each row
  execute function public.enforce_open_runs_cap();

-- 4) expire_stale_runs: identical to 0019 except it raises the bypass flag
--    first. set_config(..., true) is transaction-local, so it resets on
--    commit/rollback and can never leak into a user's own INSERT.
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
  perform set_config('runion.bypass_cap', 'on', true);

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
      day,
      (new_start)::date,
      (new_start)::time,
      new_start,
      pace_min, pace_max, pace_seconds, distance_km, goal, intent,
      spots_total, 0, max_group_size, 1,
      women_only, 'active'::public.run_status, club_name, strava_url, garmin_url,
      new_start + interval '48 hours', recurrence, is_seed
    from public.runs
    where id = row.id;
  end loop;

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
