create table if not exists public.learning_states (
  user_id uuid primary key references auth.users (id) on delete cascade,
  state jsonb not null,
  updated_at timestamptz not null default now()
);

revoke all on table public.learning_states from anon;
grant select, insert, update on table public.learning_states to authenticated;

alter table public.learning_states enable row level security;

create policy "Users can read their own learning state"
  on public.learning_states for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can create their own learning state"
  on public.learning_states for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can update their own learning state"
  on public.learning_states for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
