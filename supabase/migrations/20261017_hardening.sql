-- =========================================================
-- HABITS — endurecimiento (2026-10-17)
-- Límites en la base de datos para que una cuenta no pueda guardar
-- datos raros ni llenar el proyecto, aunque se salte la app.
-- Es idempotente: se puede ejecutar más de una vez.
-- =========================================================

-- Emoji: corto y sin HTML, comillas ni espacios
alter table public.habits drop constraint if exists habits_emoji_check;
alter table public.habits add constraint habits_emoji_check
  check (char_length(emoji) between 1 and 16 and emoji !~ '[<>&"''`\\[:space:]]');

-- Días: solo valores 0-6
alter table public.habits drop constraint if exists habits_days_values_check;
alter table public.habits add constraint habits_days_values_check
  check (days <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]);

-- Fechas en un rango razonable
alter table public.habits drop constraint if exists habits_created_on_check;
alter table public.habits add constraint habits_created_on_check
  check (created_on between date '2000-01-01' and date '2100-01-01');

-- Perfil: ajustes y logros pequeños (hoy ocupan ~200 bytes)
alter table public.profiles drop constraint if exists profiles_size_check;
alter table public.profiles add constraint profiles_size_check
  check (pg_column_size(settings) <= 4096 and pg_column_size(unlocked) <= 4096);

-- Máximo de hábitos por usuario (igual que MAX_HABITS en core.js)
create or replace function public.habits_limit()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if (select count(*) from public.habits where user_id = new.user_id) >= 200 then
    raise exception 'Límite de 200 hábitos por usuario' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
drop trigger if exists habits_limit on public.habits;
create trigger habits_limit before insert on public.habits
  for each row execute function public.habits_limit();

-- Completados: solo dentro del historial que usa la app (~5 años; core.js usa 1830 días)
create or replace function public.completions_day_range()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.day < current_date - 1900 or new.day > current_date + 2 then
    raise exception 'Fecha fuera de rango' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
drop trigger if exists completions_day_range on public.completions;
create trigger completions_day_range before insert or update on public.completions
  for each row execute function public.completions_day_range();

-- Estas funciones solo las usan los triggers
revoke execute on function public.habits_limit() from public, anon, authenticated;
revoke execute on function public.completions_day_range() from public, anon, authenticated;
