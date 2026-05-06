-- Prevent a user from requesting a spot on a run they organise.
create or replace function public.block_self_request()
returns trigger
language plpgsql
as $$
declare
  host_id uuid;
begin
  select organiser_id into host_id from public.runs where id = new.run_id;
  if host_id is not null and host_id = new.user_id then
    raise exception 'You can''t request a spot on your own run.'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists block_self_request_trg on public.run_participants;
create trigger block_self_request_trg
before insert on public.run_participants
for each row execute function public.block_self_request();
