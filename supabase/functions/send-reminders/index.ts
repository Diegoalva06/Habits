// =========================================================
// HABITS — Edge Function send-reminders
// - pg_cron la llama cada minuto (cabecera x-cron-secret): envía los
//   recordatorios que tocan según due_push_reminders().
// - Un usuario con sesión puede llamarla con { test: true } para
//   recibir una notificación de prueba en sus dispositivos.
// - La primera vez genera las llaves VAPID y las guarda en Vault.
// Se despliega con verify_jwt = false porque hace su propia verificación.
// =========================================================
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

const ORIGIN = 'https://habits-diego.netlify.app';
const cors = {
  'Access-Control-Allow-Origin': ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

type Sub = { endpoint: string; p256dh: string; auth: string };

let keys: { publicKey: string; privateKey: string } | null = null;
async function vapid() {
  if (keys) return keys;
  const read = async () => {
    const { data, error } = await sb.rpc('push_vapid_keys');
    if (error) throw error;
    const row = data?.[0];
    return row?.public_key && row?.private_key ? { publicKey: row.public_key, privateKey: row.private_key } : null;
  };
  keys = await read();
  if (!keys) {
    const fresh = webpush.generateVAPIDKeys();
    const { error } = await sb.rpc('push_set_vapid', { p_public: fresh.publicKey, p_private: fresh.privateKey });
    if (error) throw error;
    keys = await read();   // si otra ejecución las creó a la vez, gana la guardada
  }
  return keys!;
}

async function send(subs: Sub[], payload: object) {
  const k = await vapid();
  let sent = 0;
  await Promise.all(subs.map(async s => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload),
        { TTL: 900, urgency: 'high', vapidDetails: { subject: ORIGIN, publicKey: k.publicKey, privateKey: k.privateKey } },
      );
      sent++;
    } catch (err) {
      const code = (err as { statusCode?: number }).statusCode;
      // 404/410: el dispositivo quitó el permiso o desinstaló la app → olvidarlo
      if (code === 404 || code === 410) await sb.from('push_subscriptions').delete().eq('endpoint', s.endpoint);
      else console.error('[push]', code, (err as Error).message);
    }
  }));
  return sent;
}

const fmtDuration = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`);

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);

  try {
    // ---- pg_cron: recordatorios del minuto ----
    const secret = req.headers.get('x-cron-secret');
    if (secret) {
      const { data: ok } = await sb.rpc('push_cron_ok', { p_secret: secret });
      if (!ok) return json({ error: 'forbidden' }, 403);
      await vapid();   // garantiza que existan las llaves aunque aún no haya suscriptores
      const { data, error } = await sb.rpc('due_push_reminders');
      if (error) throw error;
      const rows = (data || []) as (Sub & { habit_id: string; name: string; emoji: string; at_time: string; duration: number })[];
      let sent = 0;
      for (const r of rows) {
        sent += await send([r], {
          title: `${r.emoji} ${r.name}`,
          body: `Es hora de tu hábito · ${fmtDuration(r.duration)}. ¡No rompas tu racha! 🔥`,
          tag: `habit-${r.habit_id}`,
          url: './',
        });
      }
      return json({ due: rows.length, sent });
    }

    // ---- Usuario: notificación de prueba ----
    const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const { data: { user } } = await sb.auth.getUser(jwt);
    if (!user) return json({ error: 'unauthorized' }, 401);
    const body = await req.json().catch(() => ({}));
    if (!body?.test) return json({ error: 'bad request' }, 400);
    const { data: subs, error } = await sb.from('push_subscriptions')
      .select('endpoint, p256dh, auth').eq('user_id', user.id);
    if (error) throw error;
    const sent = await send(subs || [], {
      title: '🔔 ¡Recordatorios activados!',
      body: 'Así te avisaremos a la hora de cada hábito, aunque la app esté cerrada.',
      tag: 'habits-test',
      url: './',
    });
    return json({ devices: subs?.length || 0, sent });
  } catch (err) {
    console.error('[send-reminders]', err);
    return json({ error: 'internal' }, 500);
  }
});
