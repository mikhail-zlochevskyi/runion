-- Seed runs are admin-driven; the 3-open-runs spam cap shouldn't fight
-- the seeder. Skip the trigger logic entirely when new.is_seed = true.
create or replace function public.enforce_open_runs_cap()
returns trigger
language plpgsql
as $$
declare
  open_count integer;
begin
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
