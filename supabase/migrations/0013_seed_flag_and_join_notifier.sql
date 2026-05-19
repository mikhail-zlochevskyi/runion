-- Flag for runs created by the seed script (so we can reset cleanly and
-- only fire alert emails for these synthetic runs, not real ones).
alter table public.runs
  add column if not exists is_seed boolean not null default false;

create index if not exists runs_is_seed_idx on public.runs(is_seed) where is_seed = true;

-- Best-effort: enable pg_net so the trigger can POST to the edge function
-- on each join. If pg_net isn't available the trigger still queues a
-- notification_jobs row that scripts/seed-test-runs.cjs --drain can
-- process out-of-band.
create extension if not exists pg_net with schema extensions;

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

  -- Always queue an audit row.
  insert into public.notification_jobs (channel, template, user_id, run_id, scheduled_for)
  values ('email', 'seed_run_joined', new.user_id, new.run_id, now());

  -- Best-effort immediate fire. The Supabase dashboard exposes the project
  -- URL and service role key as DB settings under the `app.settings`
  -- namespace once configured (Project Settings → Database → Custom
  -- Postgres Config). If unset, this block silently skips.
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
      -- Swallow: the notification_jobs row is the source of truth.
      null;
    end;
  end if;

  return new;
end;
$$;

drop trigger if exists notify_on_seed_join_trg on public.run_participants;
create trigger notify_on_seed_join_trg
after insert on public.run_participants
for each row execute function public.notify_on_seed_join();
