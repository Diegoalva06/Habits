/* =========================================================
   HABITS — núcleo puro (sin DOM)
   Fechas, rachas, estadísticas y saneamiento de datos.
   Todo lo que entra a la app (localStorage, respaldos, servidor)
   pasa por sanitizeState(): así un dato dañado o malicioso no
   puede romper la interfaz, inyectar HTML ni colgar la pestaña.
   Se usa en el navegador (window.HabitsCore) y en los tests (Node).
   ========================================================= */
(function (root) {
  'use strict';

  const EMOJIS = ['💧', '🧘', '📚', '💪', '🏃', '💻', '🥗', '😴', '✍️', '🎸', '🧠', '🌅', '🚭', '💊', '🧹', '💰', '🙏', '🎨', '🚴', '🏊', '🍎', '☕', '📵', '🗣️', '🌱', '🎯', '📝', '🦷', '🐶', '🎧'];
  const COLORS = ['#a78bfa', '#22d3ee', '#f472b6', '#fb923c', '#34d399', '#facc15', '#f87171', '#60a5fa', '#a3e635'];
  const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

  // Límites: acotan el trabajo de cada render y el tamaño de lo guardado.
  const MAX_HISTORY_DAYS = 5 * 366;   // historial que se conserva y se recorre (~5 años)
  const MAX_HABITS = 200;
  const MAX_NAME = 40, MAX_CATEGORY = 30, MAX_NOTE = 60;

  /* ---------------- Fechas ---------------- */
  const pad = n => String(n).padStart(2, '0');
  const dk = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseDk = s => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d); };
  const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const isDateKey = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && dk(parseDk(s)) === s;
  /** Primer día que se tiene en cuenta para rachas y estadísticas. */
  const historyStart = t => addDays(t, -MAX_HISTORY_DAYS);

  /* ---------------- Rachas y estadísticas ---------------- */
  const isScheduled = (h, d) => h.days.includes(d.getDay()) && dk(d) >= h.createdAt;
  const isDone = (log, h, key) => (log[key] || []).includes(h.id);

  /**
   * Racha por hábito: solo cuentan los días programados.
   * Un día no programado no rompe la racha, y hoy pendiente tampoco.
   */
  function habitStats(h, log, t) {
    const tk = dk(t), from30 = addDays(t, -29), min = historyStart(t);
    let start = parseDk(h.createdAt);
    if (!(start >= min)) start = min;     // también cubre fechas inválidas (NaN)
    let run = 0, best = 0, total = 0, sched30 = 0, done30 = 0;
    for (let d = start; d <= t; d = addDays(d, 1)) {
      if (!isScheduled(h, d)) continue;
      const key = dk(d), done = isDone(log, h, key);
      if (done) { run++; total++; best = Math.max(best, run); }
      else if (key !== tk) run = 0;
      if (d >= from30 && (done || key !== tk)) { sched30++; if (done) done30++; }
    }
    return { current: run, best, total, rate30: sched30 ? Math.round((done30 / sched30) * 100) : 0 };
  }

  function dayInfo(habits, log, d) {
    const key = dk(d);
    const sched = habits.filter(h => isScheduled(h, d));
    const done = sched.filter(h => isDone(log, h, key)).length;
    return { key, total: sched.length, done, perfect: sched.length > 0 && done === sched.length };
  }

  function earliestDate(habits, t) {
    if (!habits.length) return t;
    const first = parseDk(habits.reduce((m, h) => (h.createdAt < m ? h.createdAt : m), dk(t)));
    const min = historyStart(t);
    return first >= min ? first : min;
  }

  /** Racha global = días perfectos seguidos (todos los hábitos programados completados). */
  function globalStats(habits, log, t) {
    const tk = dk(t);
    let run = 0, best = 0, perfectDays = 0;
    for (let d = earliestDate(habits, t); d <= t; d = addDays(d, 1)) {
      const info = dayInfo(habits, log, d);
      if (!info.total) continue;
      if (info.perfect) { run++; perfectDays++; best = Math.max(best, run); }
      else if (info.key !== tk) run = 0;
    }
    return { current: run, best, perfectDays };
  }

  /* ---------------- Saneamiento ---------------- */
  const defaults = () => ({
    habits: [],
    log: {},                 // { 'YYYY-MM-DD': [habitId, ...] }
    settings: { name: '', notifications: false, sound: true, h12: false },
    unlocked: {},            // { achievementId: 'YYYY-MM-DD' }
    notified: {},            // { 'YYYY-MM-DD|habitId': 1 }
  });

  const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
  const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const bool = (v, def) => (typeof v === 'boolean' ? v : def);
  const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
  const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
  const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

  /** Solo emojis: nada de HTML, comillas ni espacios. */
  function safeEmoji(e) {
    if (EMOJIS.includes(e)) return e;
    return typeof e === 'string' && e.length <= 16 && !/[<>&"'`\\\s]/.test(e) && /\p{Extended_Pictographic}/u.test(e)
      ? e : EMOJIS[0];
  }

  function sanitizeHabit(x, minKey, maxKey) {
    if (!isObj(x)) return null;
    const id = typeof x.id === 'number' ? String(x.id) : x.id;
    if (typeof id !== 'string' || !ID_RE.test(id)) return null;
    const days = Array.isArray(x.days)
      ? [...new Set(x.days.map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= 6))].sort()
      : [];
    const duration = Math.round(Number(x.duration));
    let createdAt = isDateKey(x.createdAt) ? x.createdAt : maxKey;
    if (createdAt < minKey) createdAt = minKey;
    if (createdAt > maxKey) createdAt = maxKey;
    return {
      id,
      name: str(x.name, MAX_NAME) || 'Hábito',
      emoji: safeEmoji(x.emoji),
      color: COLOR_RE.test(x.color) ? x.color.toLowerCase() : COLORS[0],
      time: TIME_RE.test(x.time) ? x.time : '07:00',
      duration: Number.isFinite(duration) ? Math.min(600, Math.max(1, duration)) : 15,
      days: days.length ? days : [...ALL_DAYS],
      category: str(x.category, MAX_CATEGORY) || 'Otro',
      note: str(x.note, MAX_NOTE),
      createdAt,
    };
  }

  /**
   * Devuelve un estado válido a partir de cualquier cosa.
   * Descarta lo que no encaja en vez de fallar.
   */
  function sanitizeState(raw, t) {
    const out = defaults();
    if (!isObj(raw)) return out;
    const minKey = dk(historyStart(t)), today = dk(t), maxKey = dk(addDays(t, 1));

    const ids = new Set();
    for (const x of Array.isArray(raw.habits) ? raw.habits : []) {
      if (out.habits.length >= MAX_HABITS) break;
      const h = sanitizeHabit(x, minKey, today);
      if (h && !ids.has(h.id)) { ids.add(h.id); out.habits.push(h); }
    }

    if (isObj(raw.log)) {
      for (const [k, v] of Object.entries(raw.log)) {
        if (!isDateKey(k) || k < minKey || k > maxKey || !Array.isArray(v)) continue;
        const list = [...new Set(v.filter(id => typeof id === 'string' && ids.has(id)))];
        if (list.length) out.log[k] = list;
      }
    }

    const s = isObj(raw.settings) ? raw.settings : {};
    out.settings = {
      name: str(s.name, MAX_NAME),
      notifications: bool(s.notifications, false),
      sound: bool(s.sound, true),
      h12: bool(s.h12, false),
    };

    if (isObj(raw.unlocked)) {
      for (const [k, v] of Object.entries(raw.unlocked).slice(0, 100)) {
        if (/^[a-z0-9_]{1,32}$/.test(k) && isDateKey(v)) out.unlocked[k] = v;
      }
    }

    if (isObj(raw.notified)) {
      for (const k of Object.keys(raw.notified).slice(0, 500)) {
        if (/^\d{4}-\d{2}-\d{2}\|[A-Za-z0-9_-]{1,64}$/.test(k)) out.notified[k] = 1;
      }
    }
    return out;
  }

  const api = {
    EMOJIS, COLORS, ALL_DAYS, MAX_HISTORY_DAYS, MAX_HABITS,
    pad, dk, parseDk, startOfDay, addDays, isDateKey,
    isScheduled, isDone, habitStats, dayInfo, earliestDate, globalStats,
    defaults, sanitizeHabit, sanitizeState, safeEmoji,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HabitsCore = Object.freeze(api);
})(typeof window !== 'undefined' ? window : globalThis);
