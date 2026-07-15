-- Cottage Color — Fase 1 (login + sincronização)
-- Cole isto no Supabase: SQL Editor → New query → cole → Run.
-- Cria uma tabela com UMA linha por usuário (um blob JSON com gamificação +
-- progresso) e políticas de segurança para cada pessoa ver/editar só o que é seu.

create table if not exists public.profiles (
  id uuid references auth.users on delete cascade primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "own select" on public.profiles;
drop policy if exists "own insert" on public.profiles;
drop policy if exists "own update" on public.profiles;

create policy "own select" on public.profiles
  for select using (auth.uid() = id);
create policy "own insert" on public.profiles
  for insert with check (auth.uid() = id);
create policy "own update" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);
