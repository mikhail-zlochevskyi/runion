-- Widen the comfortable-pace CHECK constraints from 270..420 s/km (4:30..7:00)
-- to 180..480 s/km (3:00..8:00) so fast and slow runners can both onboard.
-- The runs table only enforces ordering (pace_min <= pace_max), which is
-- unchanged.

alter table public.users
  drop constraint if exists users_comfortable_pace_seconds_per_km_check;

alter table public.users
  add constraint users_comfortable_pace_seconds_per_km_check check (
    comfortable_pace_seconds_per_km is null
    or comfortable_pace_seconds_per_km between 180 and 480
  );

alter table public.users
  drop constraint if exists users_comfortable_pace_min_seconds_per_km_check;

alter table public.users
  add constraint users_comfortable_pace_min_seconds_per_km_check check (
    comfortable_pace_min_seconds_per_km is null
    or comfortable_pace_min_seconds_per_km between 180 and 480
  );

alter table public.users
  drop constraint if exists users_comfortable_pace_max_seconds_per_km_check;

alter table public.users
  add constraint users_comfortable_pace_max_seconds_per_km_check check (
    comfortable_pace_max_seconds_per_km is null
    or comfortable_pace_max_seconds_per_km between 180 and 480
  );
