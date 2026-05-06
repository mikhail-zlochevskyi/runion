-- Defense-in-depth: if the client posts a run_participants row without
-- requester_name / whatsapp / socials, fall back to the live values on
-- public.users. Stale client state then can't strip a requester's profile
-- info from the row the host sees.
create or replace function public.autofill_requester_snapshots()
returns trigger
language plpgsql
as $$
declare
  u record;
begin
  if (new.requester_socials is null or new.requester_socials = '')
     or (new.requester_whatsapp is null or new.requester_whatsapp = '')
     or (new.requester_name is null or new.requester_name = '') then
    select name, whatsapp, socials_url into u from public.users where id = new.user_id;
    if u is not null then
      if new.requester_name is null or new.requester_name = '' then
        new.requester_name := coalesce(u.name, 'Runner');
      end if;
      if new.requester_whatsapp is null or new.requester_whatsapp = '' then
        new.requester_whatsapp := nullif(u.whatsapp, '');
      end if;
      if new.requester_socials is null or new.requester_socials = '' then
        new.requester_socials := nullif(u.socials_url, '');
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists autofill_requester_snapshots_trg on public.run_participants;
create trigger autofill_requester_snapshots_trg
before insert on public.run_participants
for each row execute function public.autofill_requester_snapshots();

-- Backfill existing rows.
update public.run_participants rp
set
  requester_socials = nullif(u.socials_url, ''),
  requester_whatsapp = case when rp.requester_whatsapp is null or rp.requester_whatsapp = ''
                            then nullif(u.whatsapp, '') else rp.requester_whatsapp end,
  requester_name = case when rp.requester_name is null or rp.requester_name = ''
                        then coalesce(u.name, 'Runner') else rp.requester_name end
from public.users u
where rp.user_id = u.id
  and (rp.requester_socials is null or rp.requester_socials = '');
