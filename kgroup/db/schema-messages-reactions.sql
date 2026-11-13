-- Persistent emoji reactions on company and direct messages.
create table if not exists public.team_message_reactions (
  message_id uuid not null references public.team_messages (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  emoji text not null check (emoji in ('👍', '❤️', '😂', '😮', '😢', '🙏', '🎉', '🔥')),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);
create index if not exists idx_team_message_reactions_message
  on public.team_message_reactions (message_id, created_at);
