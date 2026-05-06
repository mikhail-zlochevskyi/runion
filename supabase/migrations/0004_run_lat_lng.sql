-- Expose lat/lng from runs.location as ordinary columns so clients can read
-- them directly without parsing the geography binary representation.
alter table public.runs
  add column if not exists location_lat double precision
    generated always as (st_y(location::geometry)) stored,
  add column if not exists location_lng double precision
    generated always as (st_x(location::geometry)) stored;
