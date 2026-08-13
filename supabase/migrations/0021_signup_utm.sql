-- Signup attribution: capture the utm_source/medium/campaign that brought a
-- user in, stamped once (first-touch) when they complete onboarding. Nullable
-- so existing rows and organic signups are simply left empty.

alter table public.users
  add column if not exists signup_utm_source text,
  add column if not exists signup_utm_medium text,
  add column if not exists signup_utm_campaign text;

-- Handy for "which poster/campaign converted" queries.
create index if not exists users_signup_utm_source_idx
  on public.users (signup_utm_source)
  where signup_utm_source is not null;
