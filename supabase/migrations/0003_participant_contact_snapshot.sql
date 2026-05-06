alter table public.run_participants
add column if not exists requester_name text,
add column if not exists requester_whatsapp text;
