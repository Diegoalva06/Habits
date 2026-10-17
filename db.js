'use strict';

/* =========================================================
   HABITS — capa de datos (Supabase)
   - Autenticación: correo/contraseña, Google y recuperación.
   - Lectura completa del estado del usuario.
   - Escrituras en cola (en orden) para que marcar/desmarcar
     rápido nunca deje la base de datos desincronizada.
   Si config.js no está configurado, DB.enabled = false y la
   app trabaja solo con localStorage.
   ========================================================= */
const DB = (() => {
  const cfg = Object.freeze({ ...(window.HABITS_CONFIG || {}) });
  const configured = !!(cfg.supabaseUrl && cfg.supabaseAnonKey && !/TU_/.test(cfg.supabaseUrl + cfg.supabaseAnonKey));
  const enabled = configured && !!window.supabase;
  const client = enabled ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey) : null;
  const redirectTo = location.origin + location.pathname;

  let user = null;
  let queue = Promise.resolve();
  let pending = 0;
  let status = 'ok';
  const statusListeners = new Set();
  const errorListeners = new Set();

  const setStatus = s => { status = s; statusListeners.forEach(fn => fn(s)); };

  /** Encola una escritura. Nunca lanza: los errores se notifican a onError. */
  function write(label, fn) {
    pending++;
    setStatus('saving');
    queue = queue.then(async () => {
      try {
        const { error } = await fn();
        if (error) throw error;
      } catch (err) {
        console.error(`[DB] ${label}`, err);
        status = 'error';
        errorListeners.forEach(f => f(label, err));
      } finally {
        pending--;
        if (!pending) setStatus(status === 'error' ? 'error' : 'ok');
      }
    });
    return queue;
  }

  /* ---------- Mapeo app ⇄ filas ---------- */
  const toRow = h => ({
    id: h.id, name: h.name, emoji: h.emoji, color: h.color, at_time: h.time,
    duration: h.duration, days: h.days, category: h.category, note: h.note || '',
    created_on: h.createdAt,
  });
  const fromRow = r => ({
    id: r.id, name: r.name, emoji: r.emoji, color: r.color, time: r.at_time,
    duration: r.duration, days: r.days, category: r.category, note: r.note || '',
    createdAt: r.created_on,
  });

  /**
   * Lee todas las filas del usuario, por páginas. Filtra por user_id aunque RLS ya lo
   * haga (defensa en profundidad) y ordena por la clave para que las páginas no se solapen.
   */
  async function selectAll(table, columns, orderBy) {
    const PAGE = 1000, rows = [];
    for (let from = 0; ; from += PAGE) {
      let q = client.from(table).select(columns).eq('user_id', user.id);
      for (const col of orderBy) q = q.order(col, { ascending: true });
      const { data, error } = await q.range(from, from + PAGE - 1);
      if (error) throw error;
      rows.push(...data);
      if (data.length < PAGE) return rows;
    }
  }

  async function insertChunks(table, rows) {
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await client.from(table).insert(rows.slice(i, i + 500));
      if (error) return { error };
    }
    return { error: null };
  }

  /* ---------- Debounce del perfil ---------- */
  let profileTimer = null;

  return {
    enabled,
    configured,
    googleLogin: !!cfg.googleLogin,
    captchaSiteKey: typeof cfg.turnstileSiteKey === 'string' ? cfg.turnstileSiteKey : '',
    get user() { return user; },
    get status() { return status; },
    get busy() { return pending > 0; },
    onStatus: fn => statusListeners.add(fn),
    onError: fn => errorListeners.add(fn),

    /* ---------- Auth ---------- */
    onAuth(fn) {
      client.auth.onAuthStateChange((event, session) => {
        user = session?.user || null;
        // No llamar a Supabase dentro del callback (puede bloquearse): diferir.
        setTimeout(() => fn(event, user), 0);
      });
    },
    signIn: (email, password, captchaToken) =>
      client.auth.signInWithPassword({ email, password, options: { captchaToken } }),
    signUp: (email, password, name, captchaToken) =>
      client.auth.signUp({ email, password, options: { data: { name }, emailRedirectTo: redirectTo, captchaToken } }),
    signInGoogle: () => client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } }),
    resetPassword: (email, captchaToken) => client.auth.resetPasswordForEmail(email, { redirectTo, captchaToken }),
    updatePassword: password => client.auth.updateUser({ password }),
    /** Espera las escrituras pendientes (máx. 10 s). Si no hay red, cierra al menos en este dispositivo. */
    async signOut() {
      await Promise.race([queue, new Promise(r => setTimeout(r, 10000))]);
      const res = await client.auth.signOut();
      return res.error ? client.auth.signOut({ scope: 'local' }) : res;
    },

    /* ---------- Lectura ---------- */
    async loadState() {
      const [profile, habits, completions] = await Promise.all([
        client.from('profiles').select('settings, unlocked').eq('id', user.id).maybeSingle(),
        selectAll('habits', '*', ['id']),
        selectAll('completions', 'habit_id, day', ['day', 'habit_id']),
      ]);
      if (profile.error) throw profile.error;
      const log = {};
      for (const c of completions) (log[c.day] ||= []).push(c.habit_id);
      // Orden estable: por hora del hábito y, a igual hora, por fecha de creación.
      habits.sort((a, b) => a.at_time.localeCompare(b.at_time) || a.inserted_at.localeCompare(b.inserted_at));
      return {
        habits: habits.map(fromRow),
        log,
        settings: profile.data?.settings || {},
        unlocked: profile.data?.unlocked || {},
        hasProfile: !!profile.data,
      };
    },

    /* ---------- Escrituras ---------- */
    saveHabit: h => write('guardar hábito',
      () => client.from('habits').upsert({ ...toRow(h), user_id: user.id })),

    deleteHabit: id => write('eliminar hábito',
      () => client.from('habits').delete().eq('id', id).eq('user_id', user.id)),

    setCompletion: (habitId, day, done) => write(done ? 'completar' : 'desmarcar', () => done
      ? client.from('completions').upsert({ habit_id: habitId, day, user_id: user.id }, { onConflict: 'habit_id,day', ignoreDuplicates: true })
      : client.from('completions').delete().eq('habit_id', habitId).eq('day', day).eq('user_id', user.id)),

    saveProfile(settings, unlocked) {
      clearTimeout(profileTimer);
      const uid = user?.id;
      profileTimer = setTimeout(() => {
        if (!uid) return;
        write('guardar perfil', () => client.from('profiles')
          .upsert({ id: uid, settings, unlocked, updated_at: new Date().toISOString() }));
      }, 600);
    },

    /** Reemplaza todo (demo, importar, borrar todo). */
    replaceAll: (habits, log, settings, unlocked) => write('reemplazar datos', async () => {
      const del = await client.from('habits').delete().eq('user_id', user.id);
      if (del.error) return del;
      if (habits.length) {
        const ins = await client.from('habits').insert(habits.map(h => ({ ...toRow(h), user_id: user.id })));
        if (ins.error) return ins;
      }
      const ids = new Set(habits.map(h => h.id));
      const rows = Object.entries(log).flatMap(([day, list]) =>
        list.filter(id => ids.has(id)).map(habit_id => ({ habit_id, day, user_id: user.id })));
      const comp = await insertChunks('completions', rows);
      if (comp.error) return comp;
      return client.from('profiles').upsert({ id: user.id, settings, unlocked, updated_at: new Date().toISOString() });
    }),

    /** Espera a que terminen las escrituras pendientes. */
    flush: () => queue,

    /* ---------- Notificaciones push (ver supabase/migrations/20261018_push.sql) ---------- */
    async pushPublicKey() {
      const { data, error } = await client.rpc('push_public_key');
      if (error) throw error;
      return data;
    },
    async registerPush(endpoint, p256dh, auth, tz) {
      const { error } = await client.rpc('push_register', { p_endpoint: endpoint, p_p256dh: p256dh, p_auth: auth, p_tz: tz });
      if (error) throw error;
    },
    async unregisterPush(endpoint) {
      const { error } = await client.rpc('push_unregister', { p_endpoint: endpoint });
      if (error) throw error;
    },
    /** Pide al servidor una notificación de prueba para los dispositivos de esta cuenta. */
    async testPush() {
      const { data, error } = await client.functions.invoke('send-reminders', { body: { test: true } });
      if (error) throw error;
      return data;   // { devices, sent }
    },
  };
})();
