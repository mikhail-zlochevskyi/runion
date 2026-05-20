-- The notify_on_seed_join trigger originally raised whenever the
-- notification_jobs schema didn't match the INSERT, which aborted the
-- user-facing run_participants insert. The notification is best-effort
-- (it's an audit + a fire-and-forget edge-function call), so a schema
-- drift on notification_jobs must never block joining a run.
--
-- Reproduces today on the runion project where notification_jobs is
-- missing the `channel` column, surfacing as:
--   400 Bad Request, code 42703
--   column "channel" of relation "notification_jobs" does not exist
--
-- This migration rewrites the function with a SAVEPOINT-style exception
-- block around the audit insert. The HTTP block was already guarded.

create or replace function public.notify_on_seed_join()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  is_seed_run boolean;
  fn_url text;
  service_key text;
  payload jsonb;
begin
  select r.is_seed into is_seed_run
  from public.runs r
  where r.id = new.run_id;

  if not coalesce(is_seed_run, false) then
    return new;
  end if;

  -- Best-effort audit row. Schema drift on notification_jobs must not
  -- block the participant insert that triggered us.
  begin
    insert into public.notification_jobs (channel, template, user_id, run_id, scheduled_for)
    values ('email', 'seed_run_joined', new.user_id, new.run_id, now());
  exception when others then
    null;
  end;

  begin
    fn_url := current_setting('app.settings.functions_url', true);
    service_key := current_setting('app.settings.service_role_key', true);
  exception when others then
    fn_url := null;
    service_key := null;
  end;

  if fn_url is not null and service_key is not null then
    payload := jsonb_build_object('participant_id', new.id);
    begin
      perform net.http_post(
        url := fn_url || '/seed-join-notify',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || service_key
        ),
        body := payload
      );
    exception when others then
      null;
    end;
  end if;

  return new;
end;
$$;
