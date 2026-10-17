-- =========================================================
-- HABITS — notificaciones push (2026-10-18)
-- Avisa a la hora de cada hábito aunque la app esté cerrada.
--   1. Cada dispositivo que activa "Recordatorios" se guarda en push_subscriptions.
--   2. pg_cron llama cada minuto a la Edge Function send-reminders.
--   3. La función pide a due_push_reminders() los avisos que tocan y los envía.
-- Las llaves VAPID las genera la Edge Function la primera vez y quedan en Vault
-- (cifradas); la privada nunca sale de Supabase.
-- Es idempotente: se puede ejecutar más de una vez.
-- =========================================================

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- ---------- Dispositivos suscritos ----------
create table if not exists public.push_subscriptions (
  endpoint   text primary key check (endpoint ~ '^https://' and char_length(endpoint) <= 1000),
  user_id    uuid not null references auth.users (id) on delete cascade,
  p256dh     text not null check (char_length(p256dh) <= 200),
  auth       text not null check (char_length(auth) <= 100),
  tz         text not null default 'UTC' check (char_length(tz) <= 64),
  updated_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;

-- Solo lectura de lo propio; las escrituras pasan por push_register / push_unregister
drop policy if exists "push: dueño lee" on public.push_subscriptions;
create policy "push: dueño lee" on public.push_subscriptions
  for select to authenticated
  using (user_id = (select auth.uid()));

-- ---------- Avisos ya enviados (para no repetir) ----------
create table if not exists public.push_sent (
  habit_id uuid not null references public.habits (id) on delete cascade,
  day      date not null,
  sent_at  timestamptz not null default now(),
  primary key (habit_id, day)
);
alter table public.push_sent enable row level security;   -- sin políticas: solo el servidor

-- ---------- Registrar / quitar este dispositivo ----------
-- El endpoint lo genera el navegador; quien lo tiene es ese dispositivo. Si otra cuenta
-- inicia sesión en el mismo navegador, el dispositivo pasa a esa cuenta.
create or replace function public.push_register(p_endpoint text, p_p256dh text, p_auth text, p_tz text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  zone text := coalesce((select name from pg_catalog.pg_timezone_names where name = p_tz), 'UTC');
begin
  if uid is null then raise exception 'No autenticado' using errcode = '42501'; end if;
  insert into public.push_subscriptions (endpoint, user_id, p256dh, auth, tz, updated_at)
  values (p_endpoint, uid, p_p256dh, p_auth, zone, now())
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
        tz = excluded.tz, updated_at = now();
  -- Máximo 10 dispositivos por cuenta: se quitan los más viejos
  delete from public.push_subscriptions
  where user_id = uid and endpoint not in (
    select endpoint from public.push_subscriptions where user_id = uid order by updated_at desc limit 10);
end;
$$;

create or replace function public.push_unregister(p_endpoint text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
$$;

-- ---------- Llaves VAPID (en Vault) ----------
-- Pública: la necesita el navegador para suscribirse
create or replace function public.push_public_key()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'habits_vapid_public';
$$;

-- Solo el servidor: leer y guardar el par completo
create or replace function public.push_vapid_keys()
returns table (public_key text, private_key text)
language sql
stable
security definer
set search_path = ''
as $$
  select (select decrypted_secret from vault.decrypted_secrets where name = 'habits_vapid_public'),
         (select decrypted_secret from vault.decrypted_secrets where name = 'habits_vapid_private');
$$;

create or replace function public.push_set_vapid(p_public text, p_private text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from vault.secrets where name = 'habits_vapid_public') then return; end if;
  perform vault.create_secret(p_public, 'habits_vapid_public', 'Habits: llave pública VAPID');
  perform vault.create_secret(p_private, 'habits_vapid_private', 'Habits: llave privada VAPID');
end;
$$;

-- Secreto para que solo pg_cron pueda disparar el envío
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'habits_cron_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'habits_cron_secret',
                                'Habits: autoriza a pg_cron a llamar send-reminders');
  end if;
end $$;

create or replace function public.push_cron_ok(p_secret text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from vault.decrypted_secrets where name = 'habits_cron_secret' and decrypted_secret = p_secret);
$$;

-- ---------- Qué avisos tocan ahora ----------
-- Hábitos programados hoy (en la zona horaria del usuario), cuya hora llegó hace
-- menos de 5 minutos, sin completar y sin avisar todavía. Los marca como enviados.
create or replace function public.due_push_reminders()
returns table (endpoint text, p256dh text, auth text, habit_id uuid, name text, emoji text, at_time text, duration int)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  delete from public.push_sent where day < current_date - 3;
  return query
  with zones as (   -- zona del dispositivo usado más recientemente
    select distinct on (s.user_id) s.user_id, s.tz
    from public.push_subscriptions s
    order by s.user_id, s.updated_at desc
  ), hits as (
    select h.id, h.user_id, h.name, h.emoji, h.at_time, h.duration, (now() at time zone z.tz)::date as day
    from zones z
    join public.profiles p on p.id = z.user_id and coalesce((p.settings ->> 'notifications')::boolean, false)
    join public.habits h on h.user_id = z.user_id
    where ((now() at time zone z.tz)::time - h.at_time::time) between interval '0' and interval '4 minutes 59 seconds'
      and extract(dow from (now() at time zone z.tz))::smallint = any (h.days)
      and h.created_on <= (now() at time zone z.tz)::date
      and not exists (select 1 from public.completions c
                      where c.habit_id = h.id and c.day = (now() at time zone z.tz)::date)
  ), fresh as (
    insert into public.push_sent (habit_id, day)
    select hits.id, hits.day from hits
    on conflict do nothing
    returning push_sent.habit_id
  )
  select s.endpoint, s.p256dh, s.auth, hits.id, hits.name, hits.emoji, hits.at_time, hits.duration
  from fresh
  join hits on hits.id = fresh.habit_id
  join public.push_subscriptions s on s.user_id = hits.user_id;
end;
$$;

-- Permisos: el usuario solo registra/quita su dispositivo y lee la llave pública
revoke execute on function public.push_register(text, text, text, text) from public, anon;
revoke execute on function public.push_unregister(text) from public, anon;
revoke execute on function public.push_public_key() from public;
revoke execute on function public.push_vapid_keys() from public, anon, authenticated;
revoke execute on function public.push_set_vapid(text, text) from public, anon, authenticated;
revoke execute on function public.push_cron_ok(text) from public, anon, authenticated;
revoke execute on function public.due_push_reminders() from public, anon, authenticated;
grant execute on function public.push_register(text, text, text, text) to authenticated;
grant execute on function public.push_unregister(text) to authenticated;
grant execute on function public.push_public_key() to anon, authenticated;
grant execute on function public.push_vapid_keys() to service_role;
grant execute on function public.push_set_vapid(text, text) to service_role;
grant execute on function public.push_cron_ok(text) to service_role;
grant execute on function public.due_push_reminders() to service_role;

-- ---------- Cada minuto: disparar el envío ----------
select cron.unschedule(jobid) from cron.job where jobname = 'habits-push-reminders';
select cron.schedule('habits-push-reminders', '* * * * *', $cron$
  select net.http_post(
    url := 'https://hqsjczlpagfbyqzlxbrr.supabase.co/functions/v1/send-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'habits_cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 25000
  );
$cron$);
