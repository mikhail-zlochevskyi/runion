-- Per-joiner recap snapshot the host fills in on Wrap up.
alter table public.run_participants
  add column if not exists host_outcome text
    check (host_outcome is null or host_outcome in ('showed_up', 'no_show', 'skipped')),
  add column if not exists host_run_again boolean,
  add column if not exists host_reviewed_at timestamptz;

-- Run-level lifecycle fields.
alter table public.runs
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancel_reason text,
  add column if not exists completed_at timestamptz;
