-- Enable Postgres logical replication for the tables Map and Runs subscribe to.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

alter publication supabase_realtime add table public.runs;
alter publication supabase_realtime add table public.run_participants;
