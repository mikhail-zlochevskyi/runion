alter table public.users
add column if not exists comfortable_pace_min_seconds_per_km integer check (
  comfortable_pace_min_seconds_per_km is null
  or comfortable_pace_min_seconds_per_km between 270 and 420
),
add column if not exists comfortable_pace_max_seconds_per_km integer check (
  comfortable_pace_max_seconds_per_km is null
  or comfortable_pace_max_seconds_per_km between 270 and 420
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'users_pace_range_order'
  ) then
    alter table public.users
    add constraint users_pace_range_order check (
      comfortable_pace_min_seconds_per_km is null
      or comfortable_pace_max_seconds_per_km is null
      or comfortable_pace_min_seconds_per_km <= comfortable_pace_max_seconds_per_km
    );
  end if;
end $$;
