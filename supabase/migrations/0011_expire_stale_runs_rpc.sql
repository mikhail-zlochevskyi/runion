-- Lazy completion: any run more than 4 hours past its start_time gets
-- flipped from active/full to completed. The client calls this before
-- fetching the Map / Runs tab so stale rows don't pile up; a cron sweep
-- can be added later if read traffic ever drops to zero.
create or replace function public.expire_stale_runs()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer;
begin
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
