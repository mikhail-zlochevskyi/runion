-- Allow a user to cancel (delete) their own pending request.
-- Confirmed/declined rows remain immutable to non-hosts so history is preserved.
drop policy if exists "users cancel own pending requests" on public.run_participants;
create policy "users cancel own pending requests" on public.run_participants
for delete using (auth.uid() = user_id and status = 'requested');
