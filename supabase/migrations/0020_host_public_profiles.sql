-- Attendees need to see who is hosting a run before requesting a spot, but the
-- "users read own profile" RLS policy only exposes a row to its owner. That
-- meant the host mini-profile (name, runner type, intents, socials) rendered
-- only for the host viewing their own run — exactly backwards.
--
-- This SECURITY DEFINER function returns a deliberately narrow, public subset
-- of a host's profile, and only for users who actually organise a publicly
-- visible run (mirroring the "active runs are public" policy on runs).
-- WhatsApp / email / pace / availability are intentionally never returned.
create or replace function public.host_public_profiles(ids uuid[])
returns table(id uuid, name text, runner_type text, run_intents text[], socials_url text)
language sql
stable
security definer
set search_path = public
as $$
  select u.id, u.name, u.runner_type, u.run_intents, u.socials_url
  from public.users u
  where u.id = any(ids)
    and exists (
      select 1 from public.runs r
      where r.organiser_id = u.id
        and r.status in ('active', 'full', 'completed')
    );
$$;

grant execute on function public.host_public_profiles(uuid[]) to authenticated, anon;
