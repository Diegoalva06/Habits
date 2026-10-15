-- =========================================================
-- HABITS — esquema de base de datos para Supabase
-- Ejecuta este archivo completo en: Supabase → SQL Editor → New query → Run
-- =========================================================

-- ---------- Perfil: ajustes y logros de cada usuario ----------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  settings    jsonb not null default '{}'::jsonb,
  unlocked    jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

-- ---------- Hábitos ----------
create table if not exists public.habits (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 40),
  emoji       text not null,
  color       text not null check (color ~ '^#[0-9a-fA-F]{6}$'),
  at_time     text not null check (at_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  duration    int  not null default 15 check (duration between 1 and 600),
  days        smallint[] not null check (cardinality(days) between 1 and 7),
  category    text not null default 'Otro' check (char_length(category) <= 30),
  note        text not null default '' check (char_length(note) <= 60),
  created_on  date not null default current_date,
  inserted_at timestamptz not null default now()
);
create index if not exists habits_user_idx on public.habits (user_id);

-- ---------- Días completados (historial para las rachas) ----------
create table if not exists public.completions (
  habit_id  uuid not null references public.habits (id) on delete cascade,
  user_id   uuid not null default auth.uid() references auth.users (id) on delete cascade,
  day       date not null,
  primary key (habit_id, day)
);
create index if not exists completions_user_idx on public.completions (user_id);

-- =========================================================
-- Seguridad (RLS): cada usuario solo puede ver y tocar SUS filas.
-- Por esto la "anon key" puede ir en el frontend sin riesgo.
-- =========================================================
alter table public.profiles    enable row level security;
alter table public.habits      enable row level security;
alter table public.completions enable row level security;

drop policy if exists "profiles: dueño" on public.profiles;
create policy "profiles: dueño" on public.profiles
  for all to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

drop policy if exists "habits: dueño" on public.habits;
create policy "habits: dueño" on public.habits
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "completions: dueño" on public.completions;
create policy "completions: dueño" on public.completions
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.habits h where h.id = habit_id and h.user_id = (select auth.uid()))
  );
