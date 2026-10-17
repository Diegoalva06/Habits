'use strict';

/* =========================================================
   HABITS — lógica de la app
   Datos en localStorage: hábitos, historial (log), ajustes y logros.
   ========================================================= */

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const STORE_KEY = 'habits.2026.v1';
const DAY_SHORT = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const DAY_LETTER = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
const DAY_LONG = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]; // semana empieza en lunes
const { EMOJIS, COLORS, defaults, pad, dk, parseDk, startOfDay, addDays, isScheduled } = HabitsCore;
const COLOR_NAMES = ['violeta', 'cian', 'rosa', 'naranja', 'verde', 'amarillo', 'rojo', 'azul', 'lima'];
const MILESTONES = [3, 7, 14, 21, 30, 50, 100, 180, 365];
const LEVEL_TITLES = ['Novato', 'Aprendiz', 'Constante', 'Disciplinado', 'Enfocado', 'Imparable', 'Maestro', 'Élite', 'Leyenda', 'Mítico'];
const QUOTES = [
  'Somos lo que hacemos repetidamente. La excelencia no es un acto, es un hábito. — Aristóteles',
  'No subes al nivel de tus metas, caes al nivel de tus sistemas. — James Clear',
  'Pequeñas mejoras diarias son la clave de resultados asombrosos.',
  'La motivación te pone en marcha; el hábito te mantiene en movimiento.',
  'No rompas la cadena. Un día a la vez.',
  'La disciplina es elegir entre lo que quieres ahora y lo que más quieres.',
  'Cada acción es un voto por la persona en la que te quieres convertir.',
  'Hazlo tan fácil que no puedas decir que no.',
  'El éxito es la suma de pequeños esfuerzos repetidos día tras día.',
  'Empieza donde estás. Usa lo que tienes. Haz lo que puedas.',
  'Un 1% mejor cada día son 37 veces mejor en un año.',
  'Nunca falles dos veces seguidas.',
  'La constancia vence al talento cuando el talento no es constante.',
  'Lo que haces todos los días importa más que lo que haces de vez en cuando.',
];

/* ---------------- Estado ---------------- */
/** ¿Hay sesión con Supabase? Si no, la app trabaja en modo local. */
const cloud = () => DB.enabled && !!DB.user;
// En modo nube, localStorage es solo una caché por usuario (para notified y arranque sin red).
const storeKey = () => (cloud() ? `${STORE_KEY}:${DB.user.id}` : STORE_KEY);

/** Todo lo que entra (localStorage, respaldo, servidor) pasa por aquí. */
const sanitize = raw => HabitsCore.sanitizeState(raw, today());

function load(key = storeKey()) {
  try {
    const raw = JSON.parse(localStorage.getItem(key));
    if (!raw || !Array.isArray(raw.habits)) return defaults();
    return sanitize(raw);
  } catch {
    return defaults();
  }
}
let state = defaults();
let stateVersion = 0;      // sube con cada cambio: invalida computeAll() y detecta ediciones locales
let saveWarned = false;
/** Guarda en localStorage. Si no se puede (cuota llena, modo privado), avisa una vez. */
function save() {
  stateVersion++;
  try {
    localStorage.setItem(storeKey(), JSON.stringify(state));
    saveWarned = false;
    return true;
  } catch (err) {
    console.error('[save]', err);
    if (!saveWarned) {
      saveWarned = true;
      toast('💾', 'No se pudo guardar en este dispositivo',
        cloud() ? 'Tus cambios se siguen enviando a tu cuenta.' : 'Exporta un respaldo en Ajustes para no perder datos.', { ms: 7000 });
    }
    return false;
  }
}
/** Guarda ajustes y logros (local + nube). */
const saveProfile = () => {
  save();
  if (cloud()) DB.saveProfile(state.settings, state.unlocked);
};

const ui = {
  view: 'today',
  selDate: null,           // día seleccionado en "Hoy"
  todayFilter: 'all',
  search: '',
  cat: 'Todas',
  sort: 'time',
  detailId: null,
  detailMonth: null,
  lastDayKey: null,
  animate: true,
  started: false,          // interfaz ya arrancada
  userId: null,            // usuario con sesión (modo nube)
  recovery: false,         // llegó desde el enlace de "olvidé mi contraseña"
  lastSync: 0,
};

/* ---------------- Fechas ---------------- */
const today = () => startOfDay(new Date());
const todayKey = () => dk(new Date());
const mondayOf = d => addDays(startOfDay(d), -((d.getDay() + 6) % 7));
const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const nowMin = () => { const n = new Date(); return n.getHours() * 60 + n.getMinutes(); };

function fmtTime(t) {
  if (!state.settings.h12) return t;
  let [h, m] = t.split(':').map(Number);
  const ap = h >= 12 ? 'p.m.' : 'a.m.';
  h = h % 12 || 12;
  return `${h}:${pad(m)} ${ap}`;
}
function fmtDuration(min) {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}
function fmtDays(days) {
  if (days.length === 7) return 'Todos los días';
  const s = [...days].sort().join();
  if (s === '1,2,3,4,5') return 'Lunes a viernes';
  if (s === '0,6') return 'Fines de semana';
  return WEEK_ORDER.filter(d => days.includes(d)).map(d => DAY_SHORT[d]).join(' · ');
}

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
// UUID v4 (Postgres lo exige). randomUUID solo existe en HTTPS/localhost; si no, se arma con
// getRandomValues, y en navegadores sin Web Crypto, con Math.random.
function uid() {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  const rnd = c?.getRandomValues ? () => c.getRandomValues(new Uint8Array(1))[0] : () => Math.floor(Math.random() * 256);
  return '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, ch => (ch ^ (rnd() & (15 >> (ch / 4)))).toString(16));
}
const isUuid = s => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

/* ---------------- Núcleo: rachas y estadísticas (ver core.js) ---------------- */
const getHabit = id => state.habits.find(h => h.id === id);
const isDone = (h, key) => HabitsCore.isDone(state.log, h, key);
const habitStats = h => HabitsCore.habitStats(h, state.log, today());
const dayInfo = d => HabitsCore.dayInfo(state.habits, state.log, d);
const globalStats = () => HabitsCore.globalStats(state.habits, state.log, today());

function levelFromXp(xp) {
  // Nivel L requiere 50·L·(L-1) XP → 0, 100, 300, 600, 1000...
  let L = 1;
  while (xp >= 50 * (L + 1) * L) L++;
  const base = 50 * L * (L - 1), next = 50 * (L + 1) * L;
  return { level: L, xp, base, next, pct: ((xp - base) / (next - base)) * 100, title: LEVEL_TITLES[Math.min(L - 1, LEVEL_TITLES.length - 1)] };
}

/** Rachas, XP y nivel. Se memoriza: solo se recalcula si cambió el estado o el día. */
let memo = null;
function computeAll() {
  const key = `${stateVersion}|${todayKey()}`;
  if (memo && memo.key === key && memo.state === state) return memo.val;
  const perHabit = new Map(state.habits.map(h => [h.id, habitStats(h)]));
  const g = globalStats();
  const completions = [...perHabit.values()].reduce((s, x) => s + x.total, 0);
  const xp = completions * 10 + g.perfectDays * 25;
  const val = { perHabit, global: g, completions, lvl: levelFromXp(xp) };
  memo = { key, state, val };
  return val;
}

/* ---------------- Logros ---------------- */
const ACHIEVEMENTS = [
  { id: 'first_habit', icon: '🌱', name: 'Primer paso', desc: 'Crea tu primer hábito', goal: 1, val: c => c.habits },
  { id: 'first_check', icon: '✅', name: 'Arranque', desc: 'Completa un hábito por primera vez', goal: 1, val: c => c.completions },
  { id: 'streak3', icon: '🔥', name: 'En llamas', desc: 'Racha de 3 días en un hábito', goal: 3, val: c => c.bestHabit },
  { id: 'streak7', icon: '⚡', name: 'Semana imparable', desc: 'Racha de 7 días en un hábito', goal: 7, val: c => c.bestHabit },
  { id: 'streak21', icon: '🧬', name: 'Hábito formado', desc: 'Racha de 21 días en un hábito', goal: 21, val: c => c.bestHabit },
  { id: 'streak30', icon: '🛡️', name: 'Mes de hierro', desc: 'Racha de 30 días en un hábito', goal: 30, val: c => c.bestHabit },
  { id: 'streak100', icon: '💯', name: 'Centurión', desc: 'Racha de 100 días en un hábito', goal: 100, val: c => c.bestHabit },
  { id: 'perfect1', icon: '🌟', name: 'Día perfecto', desc: 'Completa todo lo de un día', goal: 1, val: c => c.perfectDays },
  { id: 'perfect7', icon: '👑', name: 'Semana perfecta', desc: '7 días perfectos seguidos', goal: 7, val: c => c.globalBest },
  { id: 'c50', icon: '🎯', name: 'Medio centenar', desc: '50 hábitos completados', goal: 50, val: c => c.completions },
  { id: 'c250', icon: '🏔️', name: 'Constancia pura', desc: '250 hábitos completados', goal: 250, val: c => c.completions },
  { id: 'habits5', icon: '🧩', name: 'Coleccionista', desc: 'Ten 5 hábitos activos', goal: 5, val: c => c.habits },
  { id: 'cats3', icon: '⚖️', name: 'Equilibrio', desc: 'Hábitos en 3 categorías', goal: 3, val: c => c.cats },
  { id: 'early', icon: '🌅', name: 'Madrugador', desc: 'Completa un hábito antes de las 7:00', goal: 1, val: c => c.early },
  { id: 'owl', icon: '🦉', name: 'Búho nocturno', desc: 'Completa un hábito después de las 21:00', goal: 1, val: c => c.owl },
  { id: 'lvl5', icon: '🚀', name: 'Despegue', desc: 'Llega al nivel 5', goal: 5, val: c => c.level },
  { id: 'lvl10', icon: '🐉', name: 'Mítico', desc: 'Llega al nivel 10', goal: 10, val: c => c.level },
];

function achievementCtx(all) {
  const stats = [...all.perHabit.entries()];
  return {
    habits: state.habits.length,
    completions: all.completions,
    bestHabit: Math.max(0, ...stats.map(([, s]) => s.best)),
    perfectDays: all.global.perfectDays,
    globalBest: all.global.best,
    cats: new Set(state.habits.map(h => h.category)).size,
    early: stats.some(([id, s]) => s.total > 0 && toMin(getHabit(id).time) < 7 * 60) ? 1 : 0,
    owl: stats.some(([id, s]) => s.total > 0 && toMin(getHabit(id).time) >= 21 * 60) ? 1 : 0,
    level: all.lvl.level,
  };
}

function checkAchievements(silent = false) {
  const ctx = achievementCtx(computeAll());
  let fresh = 0, changed = false;
  ACHIEVEMENTS.forEach(a => {
    if (state.unlocked[a.id] || a.val(ctx) < a.goal) return;
    state.unlocked[a.id] = todayKey();
    changed = true;
    if (!silent) {
      setTimeout(() => toast(a.icon, `Logro desbloqueado: ${a.name}`, a.desc, { gold: true, ms: 4500 }), 600 + fresh * 700);
      fresh++;
    }
  });
  if (changed) saveProfile();
  if (fresh) setTimeout(celebrate, 600);
}

/* ---------------- Acciones ---------------- */
function toggle(id, key, originEl) {
  const h = getHabit(id);
  if (!h) return;
  const before = computeAll();
  const arr = (state.log[key] ||= []);
  const idx = arr.indexOf(id);
  const completing = idx < 0;
  if (completing) arr.push(id); else arr.splice(idx, 1);
  if (!arr.length) delete state.log[key];
  save();
  if (cloud()) DB.setCompletion(id, key, completing);

  if (completing) {
    ding();
    navigator.vibrate?.(15);   // pequeño toque háptico en Android (iOS lo ignora)
    if (originEl) {
      const r = originEl.getBoundingClientRect();
      burst(r.left + r.width / 2, r.top + r.height / 2, 34, [h.color, '#ffffff', '#fbbf24']);
    }
    const after = computeAll();
    const st = after.perHabit.get(id);
    if (key === todayKey() && MILESTONES.includes(st.current)) {
      toast('🏆', `¡${st.current} días seguidos!`, `${h.name} — sigue así`, { gold: true, ms: 4500 });
      celebrate();
    } else {
      toast(h.emoji, h.name, st.current > 1 ? `🔥 Racha de ${st.current} días · +10 XP` : '¡Hecho! Tu racha empieza hoy · +10 XP');
    }
    if (after.global.perfectDays > before.global.perfectDays) {
      setTimeout(() => toast('🌟', '¡Día perfecto!', `Racha global: ${after.global.current} días · +25 XP`, { gold: true }), 400);
      celebrate();
    }
    if (after.lvl.level > before.lvl.level) {
      setTimeout(() => toast('⬆️', `¡Nivel ${after.lvl.level}!`, `Ahora eres ${after.lvl.title}`, { gold: true, ms: 4500 }), 800);
      celebrate();
    }
  }
  checkAchievements();
  render();
  if (completing) $$(`[data-toggle="${id}"]`).forEach(b => b.classList.add('pop'));
}

function deleteHabit(id) {
  const h = getHabit(id);
  if (!h) return;
  confirmDialog('¿Eliminar hábito?', `Se borrará "${h.name}" y todo su historial.`, 'Eliminar').then(ok => {
    if (!ok) return;
    state.habits = state.habits.filter(x => x.id !== id);
    for (const k of Object.keys(state.log)) {
      state.log[k] = state.log[k].filter(x => x !== id);
      if (!state.log[k].length) delete state.log[k];
    }
    save();
    if (cloud()) DB.deleteHabit(id); // las completions se borran en cascada
    closeModal($('#habitModal'));
    closeModal($('#detailModal'));
    toast('🗑️', 'Hábito eliminado', h.name);
    render();
  });
}

/* ---------------- Navegación ---------------- */
function go(view) {
  ui.view = view;
  ui.animate = true;
  $$('.nav-item, .bottom-nav [data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  $$('.view').forEach(v => v.classList.toggle('active', v.id === `view-${view}`));
  try { localStorage.setItem('habits.view', view); } catch { /* ignore */ }
  window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  render();
}

/* =========================================================
   RENDER
   ========================================================= */
/** Nunca deja la app en blanco: si algo falla al pintar, muestra una pantalla de recuperación. */
function render() {
  try {
    renderViews();
    $('#crash')?.remove();
  } catch (err) {
    console.error('[render]', err);
    showCrash();
  }
}

function renderViews() {
  // Las animaciones de entrada solo se reproducen al cambiar de vista
  document.body.classList.toggle('quiet', !ui.animate);
  ui.animate = false;
  const all = computeAll();
  renderSidebar(all);
  if (ui.view === 'today') renderToday(all);
  if (ui.view === 'habits') renderHabits(all);
  if (ui.view === 'stats') renderStats(all);
  if (ui.view === 'awards') renderAwards(all);
  if (ui.view === 'settings') renderSettings();
  if (ui.detailId && $('#detailModal').classList.contains('open')) renderDetail(all);
}

function showCrash() {
  if ($('#crash')) return;
  const el = document.createElement('div');
  el.id = 'crash';
  el.className = 'crash';
  el.setAttribute('role', 'alertdialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-labelledby', 'crashTitle');
  el.innerHTML = `
    <div class="card crash-card">
      <div class="empty-icon">🛠️</div>
      <h2 id="crashTitle">Algo salió mal al mostrar tus datos</h2>
      <p class="muted">Puede que los datos guardados en este dispositivo estén dañados.
        Descarga un respaldo antes de restaurar.</p>
      <p class="muted small">${cloud()
        ? 'Restaurar borra solo la copia de este dispositivo y vuelve a cargar tus hábitos desde tu cuenta.'
        : 'Restaurar borra los hábitos guardados en este navegador.'}</p>
      <div class="crash-actions">
        <button class="btn btn-ghost" data-crash="retry">Reintentar</button>
        <button class="btn btn-ghost" data-crash="export">Descargar respaldo</button>
        <button class="btn btn-danger" data-crash="restore">Restaurar</button>
      </div>
    </div>`;
  el.addEventListener('click', e => {
    const a = e.target.closest('[data-crash]')?.dataset.crash;
    if (a === 'retry') { el.remove(); state = sanitize(state); save(); render(); }
    if (a === 'export') exportData();
    if (a === 'restore') {
      try { localStorage.removeItem(storeKey()); } catch { /* ignore */ }
      location.reload();
    }
  });
  document.body.append(el);
  el.querySelector('button').focus();
}

function renderSidebar(all) {
  const L = all.lvl;
  $('#levelBadge').textContent = `Nv. ${L.level}`;
  $('#levelXp').textContent = `${L.xp - L.base} / ${L.next - L.base} XP`;
  $('#xpFill').style.width = `${Math.max(2, L.pct)}%`;
  $('#levelTitle').textContent = `${L.title} · ${L.xp} XP totales`;
  // Versión compacta para móvil (la barra lateral se oculta)
  $('#mLevelBadge').textContent = `Nv. ${L.level}`;
  $('#mLevelTitle').textContent = L.title;
  $('#mLevelXp').textContent = `${L.xp - L.base} / ${L.next - L.base} XP`;
  $('#mXpFill').style.width = `${Math.max(2, L.pct)}%`;
  if (cloud()) {
    const display = state.settings.name || (DB.user.email || 'Tú').split('@')[0] || 'Tú';
    $('#userAvatar').textContent = display[0].toUpperCase();
    $('#userChipName').textContent = display;
  }
}

/* ---------- HOY ---------- */
function renderToday(all) {
  const now = new Date();
  const t = today();
  const sel = ui.selDate || t;
  const selKey = dk(sel);
  const isToday = selKey === dk(t);

  // Encabezado
  const hr = now.getHours();
  const hello = hr < 12 ? 'Buenos días' : hr < 19 ? 'Buenas tardes' : 'Buenas noches';
  $('#greeting').textContent = state.settings.name ? `${hello}, ${state.settings.name}` : hello;
  $('#todayDate').textContent = `${DAY_LONG[now.getDay()]}, ${now.getDate()} de ${MONTHS[now.getMonth()]}`;
  const doy = Math.floor((t - new Date(t.getFullYear(), 0, 0)) / 864e5);
  $('#quote').textContent = `“${QUOTES[doy % QUOTES.length]}”`;

  // Anillo
  const info = dayInfo(sel);
  const pct = info.total ? Math.round((info.done / info.total) * 100) : 0;
  const C = 2 * Math.PI * 52;
  $('#ringFg').style.strokeDasharray = C;
  $('#ringFg').style.strokeDashoffset = C * (1 - pct / 100);
  $('#ringPct').textContent = `${pct}%`;
  $('#ringSub').textContent = `${info.done} / ${info.total} hábitos`;
  $('.progress-info h3').textContent = isToday ? 'Progreso del día' : `Progreso del ${DAY_LONG[sel.getDay()]} ${sel.getDate()}`;
  const left = info.total - info.done;
  $('#progressMsg').textContent =
    !state.habits.length ? 'Crea tu primer hábito para empezar.' :
    !info.total ? 'No hay hábitos programados este día. Descansa 😌' :
    pct === 100 ? 'Día perfecto. Eres imparable 🔥' :
    pct === 0 ? 'Arranca con el primero, tú puedes 💪' :
    pct < 50 ? `Buen comienzo. Te faltan ${left}.` : `¡Ya casi! Solo ${left} más.`;

  // Racha global
  $('#globalStreak').textContent = all.global.current;
  $('#globalBest').textContent = `${all.global.best} días`;
  $('#flame').classList.toggle('cold', all.global.current === 0);

  renderNext();
  renderWeek(t, sel);
  renderTimeline(all, sel, isToday);
}

function nextHabit() {
  const t = today(), key = dk(t), nm = nowMin();
  const pending = state.habits.filter(h => isScheduled(h, t) && !isDone(h, key)).sort((a, b) => toMin(a.time) - toMin(b.time));
  return pending.find(h => toMin(h.time) <= nm && nm <= toMin(h.time) + h.duration)   // en curso
    || pending.find(h => toMin(h.time) >= nm)                                           // próximo
    || pending[0] || null;                                                              // atrasado
}

function renderNext() {
  const h = nextHabit();
  const box = $('#nextHabit');
  if (!h) {
    box.innerHTML = state.habits.length
      ? `<span class="muted">Nada pendiente hoy 🎉</span>`
      : `<span class="muted">Aún no tienes hábitos.</span>`;
    return;
  }
  box.style.setProperty('--hc', h.color);
  box.innerHTML = `
    <div class="next-emoji" style="background:color-mix(in srgb, ${esc(h.color)} 20%, transparent)">${esc(h.emoji)}</div>
    <div class="next-name">${esc(h.name)}</div>
    <div class="next-when">${esc(fmtTime(h.time))} · ${fmtDuration(h.duration)}</div>
    <div class="countdown" id="countdown" data-time="${h.time}" data-dur="${h.duration}"></div>`;
  updateCountdown();
}

function updateCountdown() {
  const el = $('#countdown');
  if (!el) return;
  const now = new Date();
  const [hh, mm] = el.dataset.time.split(':').map(Number);
  const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm);
  let diff = Math.floor((target - now) / 1000);
  if (diff <= 0) {
    const dur = Number(el.dataset.dur) * 60;
    el.textContent = diff > -60 ? '¡Es ahora!'
      : -diff <= dur ? `En curso · quedan ${fmtDuration(Math.ceil((dur + diff) / 60))}`
      : `Atrasado ${fmtDuration(Math.floor(-diff / 60))}`;
    return;
  }
  const h = Math.floor(diff / 3600); diff %= 3600;
  const m = Math.floor(diff / 60), s = diff % 60;
  el.textContent = `en ${h ? h + 'h ' : ''}${pad(m)}m ${pad(s)}s`;
}

function renderWeek(t, sel) {
  const mon = mondayOf(t);
  const C = 2 * Math.PI * 11;
  $('#weekStrip').innerHTML = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(mon, i);
    const future = d > t;
    const info = dayInfo(d);
    const ratio = info.total ? info.done / info.total : 0;
    return `
      <button class="wday ${dk(d) === dk(t) ? 'today' : ''} ${dk(d) === dk(sel) ? 'selected' : ''}" data-date="${dk(d)}" ${future ? 'disabled' : ''}>
        <span class="wday-name">${DAY_SHORT[d.getDay()]}</span>
        <span class="wday-num">${d.getDate()}</span>
        <span class="wday-dot ${info.perfect && !future ? 'perfect' : ''}">
          <svg viewBox="0 0 28 28"><circle class="bg" cx="14" cy="14" r="11"/>
          <circle class="fg" cx="14" cy="14" r="11" style="stroke-dasharray:${C};stroke-dashoffset:${C * (1 - (future ? 0 : ratio))}"/></svg>
        </span>
      </button>`;
  }).join('');
}

function renderTimeline(all, sel, isToday) {
  const key = dk(sel);
  $('#timelineTitle').textContent = isToday ? 'Agenda de hoy' : `Agenda del ${DAY_LONG[sel.getDay()]} ${sel.getDate()}`;
  let items = state.habits.filter(h => isScheduled(h, sel)).sort((a, b) => toMin(a.time) - toMin(b.time));
  const box = $('#timeline');

  if (!state.habits.length) {
    box.innerHTML = emptyState('🌱', 'Tu viaje empieza aquí', 'Crea un hábito, elige a qué hora lo harás y construye tu racha día a día.', true);
    return;
  }
  if (ui.todayFilter === 'pending') items = items.filter(h => !isDone(h, key));
  if (ui.todayFilter === 'done') items = items.filter(h => isDone(h, key));
  if (!items.length) {
    box.innerHTML = ui.todayFilter === 'pending' && dayInfo(sel).total
      ? emptyState('🎉', '¡Todo listo!', 'No te queda nada pendiente. Disfruta tu racha.')
      : emptyState('😌', 'Nada por aquí', 'No hay hábitos que mostrar en este filtro.');
    return;
  }

  const nm = nowMin();
  let nowPlaced = !isToday;
  let html = '';
  items.forEach((h, i) => {
    const start = toMin(h.time), end = start + (h.duration || 0);
    if (!nowPlaced && start > nm) {
      html += `<div class="now-line"><span>AHORA</span></div>`;
      nowPlaced = true;
    }
    const done = isDone(h, key);
    const st = all.perHabit.get(h.id);
    let tag = '';
    if (!done && isToday) {
      if (nm >= start && nm <= end) tag = `<span class="tag now">● En curso</span>`;
      else if (nm > end) tag = `<span class="tag late">Atrasado</span>`;
      else {
        const diff = start - nm;
        tag = `<span class="tag">en ${diff >= 60 ? Math.floor(diff / 60) + ' h ' : ''}${diff % 60} min</span>`;
      }
    } else if (!done && !isToday) tag = `<span class="tag late">No completado</span>`;
    html += `
      <div class="t-item ${done ? 'done' : ''}" style="--hc:${esc(h.color)};animation-delay:${i * 40}ms" data-open="${esc(h.id)}">
        <span class="t-time">${esc(fmtTime(h.time))}</span>
        <div class="t-emoji">${esc(h.emoji)}</div>
        <div class="t-body">
          <div class="t-name">${esc(h.name)}</div>
          <div class="t-meta">
            <span>${fmtDuration(h.duration)}</span>
            <span class="t-streak">🔥 ${st.current}</span>
            <span>${esc(h.category)}</span>
            ${tag}
          </div>
        </div>
        <button class="check ${done ? 'on' : ''}" data-toggle="${esc(h.id)}" aria-label="Marcar ${esc(h.name)}" aria-pressed="${done}">
          <svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>
        </button>
      </div>`;
  });
  if (!nowPlaced) html += `<div class="now-line"><span>AHORA</span></div>`;
  box.innerHTML = html;
}

function emptyState(icon, title, text, cta = false) {
  return `<div class="empty"><div class="empty-icon">${icon}</div><h3>${title}</h3><p>${text}</p>
    ${cta ? `<button class="btn btn-primary" data-action="new">＋ Crear mi primer hábito</button>
    <button class="btn btn-ghost" data-action="demo" style="margin-left:8px">Ver demo</button>` : ''}</div>`;
}

/* ---------- HÁBITOS ---------- */
function renderHabits(all) {
  const cats = ['Todas', ...new Set(state.habits.map(h => h.category))];
  if (!cats.includes(ui.cat)) ui.cat = 'Todas';
  $('#categoryChips').innerHTML = cats.length > 2
    ? cats.map(c => `<button class="chip ${c === ui.cat ? 'active' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`).join('')
    : '';

  let list = state.habits.filter(h =>
    (ui.cat === 'Todas' || h.category === ui.cat) && norm(h.name).includes(norm(ui.search)));
  const s = id => all.perHabit.get(id);
  const sorters = {
    time: (a, b) => toMin(a.time) - toMin(b.time),
    streak: (a, b) => s(b.id).current - s(a.id).current,
    rate: (a, b) => s(b.id).rate30 - s(a.id).rate30,
    name: (a, b) => a.name.localeCompare(b.name),
  };
  list.sort(sorters[ui.sort]);

  const grid = $('#habitGrid');
  if (!state.habits.length) { grid.innerHTML = emptyState('🧩', 'Sin hábitos todavía', 'Crea el primero y aparecerá aquí.', true); return; }
  if (!list.length) { grid.innerHTML = emptyState('🔍', 'Sin resultados', 'Prueba con otra búsqueda o categoría.'); return; }

  const t = today();
  grid.innerHTML = list.map((h, i) => {
    const st = s(h.id);
    const heat = Array.from({ length: 30 }, (_, k) => {
      const d = addDays(t, k - 29);
      if (!isScheduled(h, d)) return '<i class="off"></i>';
      return `<i class="${isDone(h, dk(d)) ? 'on' : ''}" title="${dk(d)}"></i>`;
    }).join('');
    return `
      <article class="card h-card" style="--hc:${esc(h.color)};animation-delay:${i * 40}ms" data-open="${esc(h.id)}">
        <div class="h-top">
          <div class="h-emoji">${esc(h.emoji)}</div>
          <div style="min-width:0">
            <div class="h-name">${esc(h.name)}</div>
            <div class="h-sub">${esc(fmtTime(h.time))} · ${fmtDuration(h.duration)} · ${esc(h.category)}</div>
          </div>
        </div>
        <div class="h-stats">
          <div class="h-stat"><b>🔥 ${st.current}</b><span>Racha</span></div>
          <div class="h-stat"><b>${st.best}</b><span>Mejor</span></div>
          <div class="h-stat"><b>${st.rate30}%</b><span>30 días</span></div>
        </div>
        <div class="mini-heat">${heat}</div>
        <div class="h-days">${WEEK_ORDER.map(d => `<span class="${h.days.includes(d) ? 'on' : ''}">${DAY_LETTER[d]}</span>`).join('')}</div>
      </article>`;
  }).join('');
}

/* ---------- ESTADÍSTICAS ---------- */
function renderStats(all) {
  const t = today();
  const rates = [...all.perHabit.values()].map(s => s.rate30);
  const avg = rates.length ? Math.round(rates.reduce((a, b) => a + b, 0) / rates.length) : 0;
  const kpis = [
    ['✅', 'Completados', all.completions],
    ['🔥', 'Mejor racha global', `${all.global.best}d`],
    ['🌟', 'Días perfectos', all.global.perfectDays],
    ['📈', 'Cumplimiento 30d', `${avg}%`],
  ];
  $('#kpis').innerHTML = kpis.map(([i, l, v]) =>
    `<div class="card kpi"><span class="kpi-icon">${i}</span><div class="kpi-label">${l}</div><div class="kpi-val">${v}</div></div>`).join('');

  // Heatmap 26 semanas
  const start = addDays(mondayOf(t), -25 * 7);
  let cells = '';
  for (let i = 0; i < 26 * 7; i++) {
    const d = addDays(start, i);
    if (d > t) { cells += '<i class="future"></i>'; continue; }
    const info = dayInfo(d);
    const r = info.total ? info.done / info.total : 0;
    const lv = !info.done ? 0 : r === 1 ? 4 : r >= 0.5 ? 3 : r >= 0.25 ? 2 : 1;
    cells += `<i class="l${lv} ${dk(d) === dk(t) ? 'today' : ''}" title="${d.getDate()} ${MONTHS[d.getMonth()]}: ${info.done}/${info.total}"></i>`;
  }
  $('#heatmap').innerHTML = cells;
  // En pantallas angostas el mapa desborda: mostrar primero las semanas más recientes
  $('.heatmap-wrap').scrollLeft = $('.heatmap-wrap').scrollWidth;

  // Barras 14 días
  $('#bars').innerHTML = Array.from({ length: 14 }, (_, k) => {
    const d = addDays(t, k - 13);
    const info = dayInfo(d);
    const p = info.total ? Math.round((info.done / info.total) * 100) : 0;
    return `<div class="bar"><div class="bar-fill ${p ? '' : 'zero'}" style="height:${Math.max(p, 3)}%" data-v="${p}% · ${info.done}/${info.total}"></div>
      <span class="bar-label">${DAY_LETTER[d.getDay()]}${d.getDate()}</span></div>`;
  }).join('');

  // Por día de la semana (últimas 12 semanas, sin contar hoy)
  const agg = Array.from({ length: 7 }, () => ({ done: 0, total: 0 }));
  for (let k = 1; k <= 84; k++) {
    const d = addDays(t, -k), info = dayInfo(d);
    agg[d.getDay()].done += info.done;
    agg[d.getDay()].total += info.total;
  }
  const pcts = agg.map(a => (a.total ? Math.round((a.done / a.total) * 100) : 0));
  const bestDow = pcts.indexOf(Math.max(...pcts));
  $('#dowChart').innerHTML = WEEK_ORDER.map(d => `
    <div class="dow-row ${d === bestDow && pcts[d] > 0 ? 'best' : ''}">
      <span>${DAY_SHORT[d]}</span>
      <div class="dow-track"><div class="dow-fill" style="width:${pcts[d]}%"></div></div>
      <span>${pcts[d]}%</span>
    </div>`).join('');

  // Ranking
  const ranked = state.habits.map(h => ({ h, s: all.perHabit.get(h.id) })).sort((a, b) => b.s.rate30 - a.s.rate30);
  $('#ranking').innerHTML = ranked.length ? ranked.map(({ h, s }, i) => `
    <div class="rank-row" style="--hc:${esc(h.color)}">
      <span class="rank-pos">#${i + 1}</span>
      <div class="rank-emoji">${esc(h.emoji)}</div>
      <span class="rank-name">${esc(h.name)}</span>
      <div class="rank-track"><div class="rank-fill" style="width:${s.rate30}%"></div></div>
      <span class="rank-pct">${s.rate30}%</span>
    </div>`).join('') : '<p class="muted">Aún no hay datos.</p>';
}

/* ---------- LOGROS ---------- */
function renderAwards(all) {
  const ctx = achievementCtx(all);
  const got = ACHIEVEMENTS.filter(a => state.unlocked[a.id]).length;
  $('#awardsCount').textContent = `🏆 ${got} / ${ACHIEVEMENTS.length}`;
  $('#awards').innerHTML = ACHIEVEMENTS.map((a, i) => {
    const on = !!state.unlocked[a.id];
    const p = Math.min(100, (a.val(ctx) / a.goal) * 100);
    return `<div class="card award ${on ? 'unlocked' : 'locked'}" style="animation:itemIn .5s ${i * 30}ms both var(--ease)">
      <div class="award-icon">${a.icon}</div>
      <h4>${a.name}</h4>
      <p>${a.desc}</p>
      ${on ? `<p class="small" style="margin-top:10px;color:#fcd34d">Desbloqueado ${state.unlocked[a.id]}</p>`
           : `<div class="award-prog"><div style="width:${p}%"></div></div><p class="small" style="margin-top:6px">${Math.min(a.val(ctx), a.goal)} / ${a.goal}</p>`}
    </div>`;
  }).join('');
}

/* ---------- AJUSTES ---------- */
function renderSettings() {
  const n = $('#userName');
  if (document.activeElement !== n) n.value = state.settings.name;
  $('#notifToggle').checked = state.settings.notifications;
  $('#soundToggle').checked = state.settings.sound;
  $('#h12Toggle').checked = state.settings.h12;
}

/* ---------- DETALLE ---------- */
function openDetail(id) {
  ui.detailId = id;
  ui.detailMonth = new Date(today().getFullYear(), today().getMonth(), 1);
  renderDetail(computeAll());
  openModal($('#detailModal'));
}

function renderDetail(all) {
  const h = getHabit(ui.detailId);
  if (!h) { closeModal($('#detailModal')); return; }
  const st = all.perHabit.get(h.id);
  const m = ui.detailMonth, t = today();
  const first = new Date(m.getFullYear(), m.getMonth(), 1);
  const daysIn = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
  const offset = (first.getDay() + 6) % 7;

  let cal = WEEK_ORDER.map(d => `<div class="cal-dow">${DAY_SHORT[d]}</div>`).join('');
  cal += '<div class="cal-day blank"></div>'.repeat(offset);
  for (let n = 1; n <= daysIn; n++) {
    const d = new Date(m.getFullYear(), m.getMonth(), n), key = dk(d);
    const future = d > t, sched = isScheduled(h, d), done = isDone(h, key);
    let cls = 'cal-day';
    if (!sched) cls += ' off';
    else if (done) cls += ' done';
    else if (!future && key !== dk(t)) cls += ' miss';
    if (key === dk(t)) cls += ' today';
    const can = sched && !future;
    if (can) cls += ' clickable';
    cal += `<div class="${cls}" ${can ? `data-caltoggle="${key}"` : ''}>${n}</div>`;
  }

  $('#detailBody').style.setProperty('--hc', h.color);
  $('#detailBody').innerHTML = `
    <div class="modal-head">
      <div class="detail-hero">
        <div class="h-emoji">${esc(h.emoji)}</div>
        <div>
          <h2 id="detailTitle">${esc(h.name)}</h2>
          <p class="muted">${esc(fmtTime(h.time))} · ${fmtDuration(h.duration)} · ${fmtDays(h.days)}</p>
          ${h.note ? `<p class="small" style="margin-top:4px;color:var(--hc)">💡 ${esc(h.note)}</p>` : ''}
        </div>
      </div>
      <button class="icon-btn" data-close aria-label="Cerrar">✕</button>
    </div>
    <div class="detail-stats">
      <div class="h-stat"><b>🔥 ${st.current}</b><span>Racha actual</span></div>
      <div class="h-stat"><b>🏆 ${st.best}</b><span>Mejor racha</span></div>
      <div class="h-stat"><b>${st.rate30}%</b><span>Últimos 30 días</span></div>
      <div class="h-stat"><b>${st.total}</b><span>Veces hecho</span></div>
    </div>
    <div>
      <div class="calendar-head">
        <button class="icon-btn" data-month="-1" aria-label="Mes anterior">‹</button>
        <h3>${MONTHS[m.getMonth()]} ${m.getFullYear()}</h3>
        <button class="icon-btn" data-month="1" aria-label="Mes siguiente">›</button>
      </div>
      <p class="muted small" style="text-align:center;margin:4px 0 12px">Toca un día para marcarlo o desmarcarlo</p>
      <div class="calendar">${cal}</div>
    </div>
    <div>
      <p class="card-eyebrow" style="margin-bottom:10px">Hitos de racha</p>
      <div class="milestones">${MILESTONES.map(x => `<span class="milestone ${st.best >= x ? 'hit' : ''}">${st.best >= x ? '🏅' : '🔒'} ${x} días</span>`).join('')}</div>
    </div>
    <div class="modal-foot">
      <button class="btn btn-danger-ghost" data-delete="${esc(h.id)}">Eliminar</button>
      <span class="spacer"></span>
      <button class="btn btn-ghost" data-edit="${esc(h.id)}">Editar</button>
      <button class="btn btn-primary" data-close>Listo</button>
    </div>`;
}

/* =========================================================
   MODALES
   ========================================================= */
const FOCUSABLE = 'button:not([disabled]):not([hidden]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const focusables = el => $$(FOCUSABLE, el).filter(x => x.offsetParent !== null);
const topModal = () => $$('.modal-backdrop.open').pop() || null;
const anyModalOpen = () => !!topModal();
const returnFocus = new Map();   // modal → elemento que tenía el foco al abrirlo
const closeHooks = new Map();    // modal → se llama al cerrarlo por cualquier vía (fondo, Esc, ✕)

/** Solo el modal de arriba es interactivo; el resto de la página queda inerte. */
function syncInert() {
  const top = topModal();
  $('.app').inert = !!top;
  $$('.modal-backdrop').forEach(m => { m.inert = !!top && m !== top; });
}

function openModal(el) {
  if (!el.classList.contains('open')) returnFocus.set(el, document.activeElement);
  el.classList.add('open');
  el.setAttribute('aria-hidden', 'false');
  syncInert();
  requestAnimationFrame(() => { if (!el.contains(document.activeElement)) focusables(el)[0]?.focus(); });
}
function closeModal(el) {
  if (!el || !el.classList.contains('open')) return;
  el.classList.remove('open');
  el.setAttribute('aria-hidden', 'true');
  if (el.id === 'detailModal') ui.detailId = null;
  syncInert();
  const hook = closeHooks.get(el);
  closeHooks.delete(el);
  hook?.();
  const back = returnFocus.get(el);
  returnFocus.delete(el);
  const top = topModal();
  if (el.contains(document.activeElement)) document.activeElement.blur();   // nunca dejar el foco en un modal cerrado
  if (back?.isConnected && (!top || top.contains(back))) back.focus({ preventScroll: true });
}

/** Mantiene el Tab dentro del modal abierto. */
function trapFocus(e) {
  const m = topModal();
  if (!m) return;
  const list = focusables(m);
  if (!list.length) { e.preventDefault(); return; }
  const first = list[0], last = list[list.length - 1];
  if (!m.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
  else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

/* ---------- Donaciones (Nequi / Bre-B) ----------
   La llave se arma al abrir la ventana para que los robots
   que buscan correos en el código no la lean tan fácil. */
const DONATE_KEY = ['theholadiego', 'gmail.com'];
const donateKey = () => DONATE_KEY.join('@');
function openDonate() {
  $('#donateKey').textContent = donateKey();
  openModal($('#donateModal'));
}
async function copyDonateKey(btn) {
  try {
    await navigator.clipboard.writeText(donateKey());
  } catch {
    // Navegadores sin portapapeles: selecciona el texto para copiarlo a mano
    getSelection().selectAllChildren($('#donateKey'));
    toast('📋', 'Selecciona y copia la llave', 'Tu navegador no permitió copiar automáticamente.');
    return;
  }
  btn.textContent = '¡Copiada!';
  setTimeout(() => { btn.textContent = 'Copiar'; }, 1800);
  toast('💜', '¡Gracias por tu apoyo!', 'Llave copiada. Pégala en tu app como llave Bre-B.');
}

/** Siempre resuelve: true con "Confirmar"; false con "Cancelar", fondo, Esc o si se abre otro. */
function confirmDialog(title, text, okLabel = 'Confirmar') {
  const m = $('#confirmModal');
  closeModal(m);                           // resuelve como "no" una confirmación anterior pendiente
  return new Promise(resolve => {
    let settled = false;
    const done = v => {
      if (settled) return;
      settled = true;
      $('#confirmYes').onclick = $('#confirmNo').onclick = null;
      closeHooks.delete(m);
      closeModal(m);
      resolve(v);
    };
    $('#confirmTitle').textContent = title;
    $('#confirmText').textContent = text;
    $('#confirmYes').textContent = okLabel;
    $('#confirmYes').onclick = () => done(true);
    $('#confirmNo').onclick = () => done(false);
    openModal(m);
    closeHooks.set(m, () => done(false));
  });
}

/* ---------- Formulario de hábito ---------- */
const form = { id: null, emoji: EMOJIS[0], color: COLORS[0], days: [0, 1, 2, 3, 4, 5, 6] };

function openHabitModal(id = null) {
  const h = id ? getHabit(id) : null;
  form.id = h ? h.id : null;
  form.emoji = h ? h.emoji : EMOJIS[Math.floor(Math.random() * 12)];
  form.color = h ? h.color : COLORS[state.habits.length % COLORS.length];
  form.days = h ? [...h.days] : [0, 1, 2, 3, 4, 5, 6];
  $('#fName').value = h ? h.name : '';
  $('#fTime').value = h ? h.time : suggestTime();
  $('#fDuration').value = h ? h.duration : 15;
  $('#fCategory').value = h ? h.category : 'Salud';
  $('#fNote').value = h ? h.note || '' : '';
  $('#modalTitle').textContent = h ? 'Editar hábito' : 'Nuevo hábito';
  $('#deleteHabitBtn').hidden = !h;
  closeModal($('#detailModal'));
  syncForm();
  openModal($('#habitModal'));
  setTimeout(() => $('#fName').focus(), 80);
}

function suggestTime() {
  const n = new Date();
  const m = Math.ceil((n.getHours() * 60 + n.getMinutes() + 30) / 30) * 30 % (24 * 60);
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

function syncForm() {
  const modal = $('#habitForm');
  modal.style.setProperty('--hc', form.color);
  // Los botones se crean una vez y luego solo se actualizan: así el foco del teclado no se pierde.
  if (!$('#fDays').children.length) {
    $('#fDays').innerHTML = WEEK_ORDER.map(d =>
      `<button type="button" data-day="${d}" aria-label="${DAY_LONG[d]}">${DAY_LETTER[d]}</button>`).join('');
    $('#fEmoji').innerHTML = EMOJIS.map(e =>
      `<button type="button" data-emoji="${e}" aria-label="Icono ${e}">${e}</button>`).join('');
    $('#fColor').innerHTML = COLORS.map((c, i) =>
      `<button type="button" data-color="${c}" style="background:${c};color:${c}" aria-label="Color ${COLOR_NAMES[i]}"></button>`).join('');
  }
  const mark = (b, on) => { b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); };
  $$('#fDays [data-day]').forEach(b => mark(b, form.days.includes(Number(b.dataset.day))));
  $$('#fEmoji [data-emoji]').forEach(b => mark(b, b.dataset.emoji === form.emoji));
  $$('#fColor [data-color]').forEach(b => mark(b, b.dataset.color === form.color));
  $('#pvEmoji').textContent = form.emoji;
  $('#pvName').textContent = $('#fName').value.trim() || 'Tu hábito';
  $('#pvMeta').textContent = `${fmtTime($('#fTime').value || '00:00')} · ${form.days.length ? fmtDays(form.days) : 'Sin días'}`;
}

function submitHabit(e) {
  e.preventDefault();
  const name = $('#fName').value.trim();
  if (!name) { $('#fName').focus(); return; }
  if (!form.days.length) { toast('⚠️', 'Elige al menos un día'); return; }
  const data = {
    name,
    time: $('#fTime').value || '07:00',
    duration: Math.min(600, Math.max(1, parseInt($('#fDuration').value, 10) || 15)),
    days: [...form.days].sort(),
    emoji: form.emoji,
    color: form.color,
    category: $('#fCategory').value || (form.id && getHabit(form.id)?.category) || 'Otro',
    note: $('#fNote').value.trim(),
  };
  let habit;
  if (form.id) {
    habit = Object.assign(getHabit(form.id), data);
    toast('✏️', 'Hábito actualizado', name);
  } else {
    habit = { id: uid(), createdAt: todayKey(), ...data };
    state.habits.push(habit);
    toast(data.emoji, '¡Hábito creado!', `${fmtTime(data.time)} · ${fmtDays(data.days)}`);
    burst(innerWidth / 2, innerHeight / 2, 50, [data.color, '#fff']);
  }
  save();
  if (cloud()) DB.saveHabit(habit);
  closeModal($('#habitModal'));
  checkAchievements();
  render();
}

/* =========================================================
   PALETA DE COMANDOS (Ctrl+K)
   ========================================================= */
let paletteSel = 0, paletteItems = [];

function buildPalette(q) {
  const tk = todayKey(), t = today();
  const cmds = [
    { g: 'Acciones', icon: '＋', label: 'Nuevo hábito', hint: 'N', run: () => openHabitModal() },
    { g: 'Acciones', icon: '☀️', label: 'Ir a Hoy', hint: '1', run: () => go('today') },
    { g: 'Acciones', icon: '🧩', label: 'Ir a Hábitos', hint: '2', run: () => go('habits') },
    { g: 'Acciones', icon: '📊', label: 'Ir a Estadísticas', hint: '3', run: () => go('stats') },
    { g: 'Acciones', icon: '🏆', label: 'Ir a Logros', hint: '4', run: () => go('awards') },
    { g: 'Acciones', icon: '⚙️', label: 'Ir a Ajustes', hint: '5', run: () => go('settings') },
    { g: 'Acciones', icon: '⬇️', label: 'Exportar datos', run: exportData },
  ];
  const habits = state.habits.flatMap(h => {
    const out = [];
    if (isScheduled(h, t)) {
      const done = isDone(h, tk);
      out.push({ g: 'Hoy', icon: h.emoji, label: `${done ? 'Desmarcar' : 'Completar'}: ${h.name}`, hint: fmtTime(h.time), run: () => toggle(h.id, tk) });
    }
    out.push({ g: 'Hábitos', icon: h.emoji, label: `Ver ${h.name}`, hint: 'detalle', run: () => openDetail(h.id) });
    return out;
  });
  const nq = norm(q.trim());
  return [...habits.filter(x => x.g === 'Hoy'), ...cmds, ...habits.filter(x => x.g === 'Hábitos')]
    .filter(x => !nq || norm(x.label).includes(nq));
}

function renderPalette() {
  paletteItems = buildPalette($('#paletteInput').value);
  paletteSel = Math.min(paletteSel, Math.max(0, paletteItems.length - 1));
  let lastG = '';
  $('#paletteList').innerHTML = paletteItems.length ? paletteItems.map((it, i) => {
    const head = it.g !== lastG ? `<li class="pl-group">${it.g}</li>` : '';
    lastG = it.g;
    return `${head}<li class="${i === paletteSel ? 'sel' : ''}" data-pi="${i}">
      <span class="pl-icon">${esc(it.icon)}</span>${esc(it.label)}<span class="pl-hint">${esc(it.hint || '')}</span></li>`;
  }).join('') : '<li class="pl-group">Sin resultados</li>';
  $('#paletteList .sel')?.scrollIntoView({ block: 'nearest' });
}

function openPalette() {
  $('#paletteInput').value = '';
  paletteSel = 0;
  renderPalette();
  openModal($('#palette'));
  setTimeout(() => $('#paletteInput').focus(), 50);
}
function runPalette(i) {
  const it = paletteItems[i];
  if (!it) return;
  closeModal($('#palette'));
  it.run();
}

/* =========================================================
   EFECTOS: confeti, sonido, toasts
   ========================================================= */
const cv = $('#confetti');
const cx = cv.getContext('2d');
let parts = [], raf = null;
function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  cv.width = innerWidth * dpr; cv.height = innerHeight * dpr;
  cx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
function burst(x, y, n = 40, colors = COLORS) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, sp = 4 + Math.random() * 8;
    parts.push({
      x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 5,
      s: 4 + Math.random() * 5, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4,
      c: colors[Math.floor(Math.random() * colors.length)], life: 0, round: Math.random() < 0.3,
    });
  }
  if (!raf) raf = requestAnimationFrame(loopConfetti);
}
function loopConfetti() {
  cx.clearRect(0, 0, innerWidth, innerHeight);
  parts = parts.filter(p => p.y < innerHeight + 30 && p.life < 240);
  for (const p of parts) {
    p.life++; p.vy += 0.28; p.vx *= 0.985; p.x += p.vx; p.y += p.vy; p.r += p.vr;
    cx.save();
    cx.globalAlpha = Math.max(0, 1 - p.life / 240);
    cx.translate(p.x, p.y); cx.rotate(p.r); cx.fillStyle = p.c;
    if (p.round) { cx.beginPath(); cx.arc(0, 0, p.s / 2, 0, Math.PI * 2); cx.fill(); }
    else cx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
    cx.restore();
  }
  raf = parts.length ? requestAnimationFrame(loopConfetti) : null;
}
function celebrate() {
  const c = document.documentElement.classList.contains('halloween')
    ? ['#f97316', '#fb923c', '#facc15', '#a855f7', '#7c3aed', '#84cc16', '#ffffff']
    : ['#a78bfa', '#22d3ee', '#f472b6', '#fbbf24', '#34d399', '#ffffff'];
  burst(innerWidth * 0.15, innerHeight * 0.8, 70, c);
  burst(innerWidth * 0.85, innerHeight * 0.8, 70, c);
  setTimeout(() => burst(innerWidth * 0.5, innerHeight * 0.35, 90, c), 250);
}

let actx = null;
function ding() {
  if (!state.settings.sound) return;
  try {
    actx ||= new (window.AudioContext || window.webkitAudioContext)();
    const t = actx.currentTime;
    [880, 1318.5].forEach((f, i) => {
      const o = actx.createOscillator(), g = actx.createGain(), st = t + i * 0.09;
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, st);
      g.gain.exponentialRampToValueAtTime(0.14, st + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, st + 0.45);
      o.connect(g).connect(actx.destination);
      o.start(st); o.stop(st + 0.5);
    });
  } catch { /* sin audio */ }
}

function toast(icon, title, text = '', opts = {}) {
  const el = document.createElement('div');
  el.className = `toast${opts.gold ? ' gold' : ''}`;
  el.innerHTML = `<span class="t-ico">${esc(icon)}</span><div><b>${esc(title)}</b>${text ? `<span class="muted small">${esc(text)}</span>` : ''}</div>`;
  $('#toasts').append(el);
  while ($('#toasts').children.length > 4) $('#toasts').firstElementChild.remove();
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 350); }, opts.ms || 3200);
}

/* =========================================================
   RECORDATORIOS
   ========================================================= */
function checkReminders() {
  const now = new Date(), key = dk(now);
  const hm = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  let changed = false;
  for (const h of state.habits) {
    if (h.time !== hm || !isScheduled(h, now) || isDone(h, key)) continue;
    const nk = `${key}|${esc(h.id)}`;
    if (state.notified[nk]) continue;
    state.notified[nk] = 1; changed = true;
    toast(h.emoji, `Es hora: ${h.name}`, `${fmtDuration(h.duration)} · no rompas tu racha 🔥`, { ms: 8000 });
    if (state.settings.notifications && 'Notification' in window && Notification.permission === 'granted') {
      try { new Notification(`${h.emoji} ${h.name}`, { body: `Es hora de tu hábito · ${fmtTime(h.time)}`, tag: nk }); } catch { /* ignore */ }
    }
  }
  for (const k of Object.keys(state.notified)) if (!k.startsWith(key)) { delete state.notified[k]; changed = true; }
  if (changed) save();
}

/* =========================================================
   DATOS: exportar / importar / demo / reset
   ========================================================= */
function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `habits-backup-${todayKey()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast('⬇️', 'Datos exportados');
}

/** Tras demo / importar / borrar todo: recalcula logros y reemplaza todo en la nube. */
function commitAll() {
  checkAchievements(true);
  save();
  if (cloud()) DB.replaceAll(state.habits, state.log, state.settings, state.unlocked);
  render();
}

/** Los respaldos del modo local usan IDs cortos; Postgres necesita UUID. */
function normalizeIds(s) {
  const map = {};
  for (const h of s.habits) if (!isUuid(h.id)) { map[h.id] = uid(); h.id = map[h.id]; }
  if (Object.keys(map).length) {
    for (const k of Object.keys(s.log)) s.log[k] = s.log[k].map(id => map[id] || id);
  }
  return s;
}

const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

function importData(file) {
  if (file.size > MAX_IMPORT_BYTES) { toast('⚠️', 'Archivo demasiado grande', 'Un respaldo de Habits pesa mucho menos de 5 MB'); return; }
  const r = new FileReader();
  r.onload = () => {
    let data;
    try {
      data = JSON.parse(r.result);
      if (!data || !Array.isArray(data.habits) || !data.log || typeof data.log !== 'object') throw new Error('formato');
    } catch {
      toast('⚠️', 'Archivo no válido', 'Debe ser un respaldo de Habits');
      return;
    }
    const clean = normalizeIds(sanitize(data));
    const dropped = data.habits.length - clean.habits.length;
    state = clean;
    commitAll();
    toast('⬆️', 'Datos importados', `${state.habits.length} hábitos${dropped > 0 ? ` · ${dropped} descartados por no ser válidos` : ''}`);
  };
  r.onerror = () => toast('⚠️', 'No se pudo leer el archivo');
  r.readAsText(file);
}

async function loadDemo() {
  if (state.habits.length && !(await confirmDialog('¿Cargar demo?', 'Se reemplazarán tus hábitos actuales por datos de ejemplo.', 'Cargar demo'))) return;
  const t = today(), created = dk(addDays(t, -75));
  const mk = (name, emoji, color, time, days, category, duration, note) =>
    ({ id: uid(), name, emoji, color, time, days, category, duration, note, createdAt: created });
  const all = [0, 1, 2, 3, 4, 5, 6];
  const habits = [
    mk('Meditar', '🧘', '#a78bfa', '06:30', all, 'Mente', 10, 'Empezar el día con calma'),
    mk('Beber 2L de agua', '💧', '#22d3ee', '08:00', all, 'Salud', 5, 'Energía y piel sana'),
    mk('Programar 1 hora', '💻', '#34d399', '15:00', [1, 2, 3, 4, 5, 6], 'Estudio', 60, 'Ser un dev top'),
    mk('Entrenar', '💪', '#f472b6', '18:00', [1, 2, 3, 4, 5], 'Fitness', 60, ''),
    mk('Leer 20 páginas', '📚', '#fb923c', '21:30', all, 'Estudio', 30, '20 libros este año'),
    mk('Sin pantallas antes de dormir', '📵', '#facc15', '22:30', all, 'Mente', 30, 'Dormir mejor'),
  ];
  const log = {};
  const nm = nowMin();
  for (let d = parseDk(created); d <= t; d = addDays(d, 1)) {
    const key = dk(d), back = Math.round((t - d) / 864e5);
    for (const h of habits) {
      if (!h.days.includes(d.getDay())) continue;
      let done;
      if (back === 0) done = toMin(h.time) < nm && Math.random() < 0.7;
      else if (back <= 12) done = true;               // racha reciente
      else done = Math.random() < 0.78;
      if (done) (log[key] ||= []).push(h.id);
    }
  }
  state.habits = habits;
  state.log = log;
  state.unlocked = {};
  commitAll();
  toast('✨', 'Demo cargada', 'Explora estadísticas, rachas y logros');
  celebrate();
}

async function resetAll() {
  if (!(await confirmDialog('¿Borrar todo?', 'Se eliminarán todos tus hábitos, historial y logros.', 'Borrar todo'))) return;
  state = { ...defaults(), settings: state.settings, notified: state.notified };
  commitAll();
  toast('🧹', 'Todo borrado', 'Empieza de cero');
}

/* =========================================================
   EVENTOS
   ========================================================= */
function bind() {
  // Navegación
  $$('[data-view]').forEach(b => b.addEventListener('click', () => go(b.dataset.view)));
  $('#openPalette').addEventListener('click', openPalette);

  // Delegación global
  document.addEventListener('click', e => {
    const t = e.target;
    const tog = t.closest('[data-toggle]');
    if (tog) {
      e.stopPropagation();
      tog.classList.add('pop');
      toggle(tog.dataset.toggle, dk(ui.selDate || today()), tog);
      return;
    }
    if (t.closest('[data-action="new"]')) return openHabitModal();
    if (t.closest('[data-action="demo"]')) return loadDemo();
    if (t.closest('[data-action="logout"]')) return logout();
    if (t.closest('[data-action="donate"]')) return openDonate();
    const ck = t.closest('[data-action="copy-key"]');
    if (ck) return copyDonateKey(ck);
    const op = t.closest('[data-open]');
    if (op) return openDetail(op.dataset.open);
    const ed = t.closest('[data-edit]');
    if (ed) return openHabitModal(ed.dataset.edit);
    const del = t.closest('[data-delete]');
    if (del) return deleteHabit(del.dataset.delete);
    const ct = t.closest('[data-caltoggle]');
    if (ct) return toggle(ui.detailId, ct.dataset.caltoggle, ct);
    const mo = t.closest('[data-month]');
    if (mo) {
      const m = ui.detailMonth;
      ui.detailMonth = new Date(m.getFullYear(), m.getMonth() + Number(mo.dataset.month), 1);
      return renderDetail(computeAll());
    }
    if (t.closest('[data-close]')) return closeModal(t.closest('.modal-backdrop'));
    if (t.classList.contains('modal-backdrop')) return closeModal(t);
  });

  // Semana
  $('#weekStrip').addEventListener('click', e => {
    const b = e.target.closest('.wday');
    if (!b || b.disabled) return;
    ui.selDate = parseDk(b.dataset.date);
    if (dk(ui.selDate) === todayKey()) ui.selDate = null;
    render();
  });

  // Filtro de hoy
  $('#todayFilter').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    ui.todayFilter = b.dataset.filter;
    $$('#todayFilter button').forEach(x => x.classList.toggle('active', x === b));
    render();
  });

  // Hábitos: búsqueda, categorías, orden
  let searchTimer = null;
  $('#habitSearch').addEventListener('input', e => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { ui.search = e.target.value; render(); }, 150);
  });
  $('#categoryChips').addEventListener('click', e => {
    const c = e.target.closest('[data-cat]');
    if (c) { ui.cat = c.dataset.cat; render(); }
  });
  $('#habitSort').addEventListener('change', e => { ui.sort = e.target.value; render(); });

  // Formulario
  $('#habitForm').addEventListener('submit', submitHabit);
  $('#habitForm').addEventListener('input', syncForm);
  $('#fDays').addEventListener('click', e => {
    const b = e.target.closest('[data-day]');
    if (!b) return;
    const d = Number(b.dataset.day);
    form.days = form.days.includes(d) ? form.days.filter(x => x !== d) : [...form.days, d];
    syncForm();
  });
  $('.day-presets').addEventListener('click', e => {
    const p = e.target.closest('[data-preset]')?.dataset.preset;
    if (!p) return;
    form.days = { all: [0, 1, 2, 3, 4, 5, 6], week: [1, 2, 3, 4, 5], weekend: [0, 6] }[p];
    syncForm();
  });
  $('#fEmoji').addEventListener('click', e => {
    const b = e.target.closest('[data-emoji]');
    if (b) { form.emoji = b.dataset.emoji; syncForm(); }
  });
  $('#fColor').addEventListener('click', e => {
    const b = e.target.closest('[data-color]');
    if (b) { form.color = b.dataset.color; syncForm(); }
  });
  $('#deleteHabitBtn').addEventListener('click', () => form.id && deleteHabit(form.id));

  // Paleta
  $('#paletteInput').addEventListener('input', () => { paletteSel = 0; renderPalette(); });
  $('#paletteInput').addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); paletteSel = Math.min(paletteSel + 1, paletteItems.length - 1); renderPalette(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); paletteSel = Math.max(paletteSel - 1, 0); renderPalette(); }
    if (e.key === 'Enter') { e.preventDefault(); runPalette(paletteSel); }
  });
  $('#paletteList').addEventListener('click', e => {
    const li = e.target.closest('[data-pi]');
    if (li) runPalette(Number(li.dataset.pi));
  });

  // Ajustes
  $('#userName').addEventListener('input', e => { state.settings.name = e.target.value.trim(); saveProfile(); renderSidebar(computeAll()); });
  $('#soundToggle').addEventListener('change', e => { state.settings.sound = e.target.checked; saveProfile(); if (e.target.checked) ding(); });
  $('#h12Toggle').addEventListener('change', e => { state.settings.h12 = e.target.checked; saveProfile(); render(); });
  $('#notifToggle').addEventListener('change', async e => {
    if (!e.target.checked) { state.settings.notifications = false; saveProfile(); return; }
    if (!('Notification' in window)) { toast('⚠️', 'Tu navegador no soporta notificaciones'); e.target.checked = false; return; }
    const perm = await Notification.requestPermission();
    state.settings.notifications = perm === 'granted';
    e.target.checked = state.settings.notifications;
    saveProfile();
    toast(perm === 'granted' ? '🔔' : '🔕', perm === 'granted' ? 'Recordatorios activados' : 'Permiso denegado');
  });
  $('#exportBtn').addEventListener('click', exportData);
  $('#importFile').addEventListener('change', e => { if (e.target.files[0]) importData(e.target.files[0]); e.target.value = ''; });
  $('#demoBtn').addEventListener('click', loadDemo);
  $('#resetBtn').addEventListener('click', resetAll);

  // Teclado
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      $('#palette').classList.contains('open') ? closeModal($('#palette')) : openPalette();
      return;
    }
    if (e.key === 'Escape') {
      const open = topModal();
      if (open) closeModal(open);
      return;
    }
    if (e.key === 'Tab') { if (anyModalOpen()) trapFocus(e); return; }
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName);
    if (typing || anyModalOpen() || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key.toLowerCase() === 'n') { e.preventDefault(); openHabitModal(); }
    const views = { 1: 'today', 2: 'habits', 3: 'stats', 4: 'awards', 5: 'settings' };
    if (views[e.key]) go(views[e.key]);
  });

  window.addEventListener('resize', resizeCanvas);
  window.addEventListener('storage', e => { if (ui.started && e.key === storeKey()) { state = load(); render(); } });
}

/* =========================================================
   CUENTA (Supabase): login, registro, sesión
   ========================================================= */
const AUTH_MODES = {
  login:   { title: 'Bienvenido de nuevo', sub: 'Entra para ver tus hábitos y tu racha.', btn: 'Entrar', fields: ['email', 'pass'] },
  signup:  { title: 'Crea tu cuenta', sub: 'Tus hábitos y rachas, sincronizados en todos tus dispositivos.', btn: 'Crear cuenta', fields: ['name', 'email', 'pass'] },
  forgot:  { title: 'Recupera tu acceso', sub: 'Te enviaremos un enlace para crear una nueva contraseña.', btn: 'Enviar enlace', fields: ['email'] },
  newpass: { title: 'Nueva contraseña', sub: 'Escribe la nueva contraseña para tu cuenta.', btn: 'Guardar contraseña', fields: ['pass'] },
};
const AUTH_ERRORS = [
  ['Invalid login credentials', 'Correo o contraseña incorrectos.'],
  ['Email not confirmed', 'Confirma tu correo antes de entrar (revisa también spam).'],
  // Mensaje neutro a propósito: no confirma si un correo ya está registrado.
  ['User already registered', 'No se pudo crear la cuenta. Si ya tienes una, inicia sesión o recupera tu contraseña.'],
  ['captcha', 'Completa la verificación de seguridad e inténtalo de nuevo.'],
  ['Password should be', 'La contraseña debe tener al menos 6 caracteres.'],
  ['For security purposes', 'Espera unos segundos antes de intentarlo de nuevo.'],
  ['rate limit', 'Demasiados intentos. Espera un momento.'],
  ['Failed to fetch', 'Sin conexión. Revisa tu internet.'],
];
const authError = err => AUTH_ERRORS.find(([k]) => err?.message?.includes(k))?.[1] || err?.message || 'Algo salió mal. Intenta de nuevo.';
const auth = { mode: 'login', busy: false };

/* ---------- CAPTCHA (Cloudflare Turnstile, opcional) ----------
   Se activa poniendo turnstileSiteKey en config.js y la secret key en
   Supabase → Authentication → Attack Protection. Frena registros en masa. */
const captcha = { token: null, widget: null };
const captchaOn = () => !!DB.captchaSiteKey;
function setupCaptcha() {
  if (!captchaOn()) return;
  $('#authCaptcha').hidden = false;
  const s = document.createElement('script');
  s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
  s.async = true;
  s.onload = () => {
    captcha.widget = window.turnstile.render('#authCaptcha', {
      sitekey: DB.captchaSiteKey,
      theme: 'dark',
      language: 'es',
      callback: t => { captcha.token = t; },
      'expired-callback': () => { captcha.token = null; },
      'error-callback': () => { captcha.token = null; },
    });
  };
  s.onerror = () => authMsg('No se pudo cargar la verificación de seguridad. Recarga la página.');
  document.head.append(s);
}
/** Los tokens son de un solo uso: tras cada intento se pide uno nuevo. */
function resetCaptcha() {
  captcha.token = null;
  if (captcha.widget !== null) window.turnstile?.reset(captcha.widget);
}

function showAuth(mode = 'login') {
  $('#auth').hidden = false;
  $('#authLoading').hidden = true;
  $('#authForm').hidden = false;
  setAuthMode(mode);
}
function showAuthLoading(text) {
  $('#auth').hidden = false;
  $('#authForm').hidden = true;
  $('#authLoading').hidden = false;
  $('#authLoadingText').textContent = text;
}
const hideAuth = () => { $('#auth').hidden = true; };
function authMsg(text, ok = false) {
  $('#authMsg').textContent = text;
  $('#authMsg').classList.toggle('ok', ok);
}

function setAuthMode(mode) {
  auth.mode = mode;
  const m = AUTH_MODES[mode], tabs = mode === 'login' || mode === 'signup';
  $('#authTitle').textContent = m.title;
  $('#authSub').textContent = m.sub;
  $('#authSubmit').textContent = m.btn;
  $('#authNameField').hidden = !m.fields.includes('name');
  $('#authEmailField').hidden = !m.fields.includes('email');
  $('#authPassField').hidden = !m.fields.includes('pass');
  $('#authPass').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
  $('#authPass').placeholder = mode === 'login' ? 'Tu contraseña' : 'Mínimo 6 caracteres';
  $('#authTabs').hidden = !tabs;
  $$('#authTabs button').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  $('#authForgot').hidden = mode !== 'login';
  $('#authBack').hidden = mode !== 'forgot';
  $('#authGoogleBox').hidden = !DB.googleLogin || !tabs;
  authMsg('');
}

async function submitAuth(e) {
  e.preventDefault();
  if (auth.busy) return;
  const m = AUTH_MODES[auth.mode];
  const name = $('#authName').value.trim(), email = $('#authEmail').value.trim(), pass = $('#authPass').value;
  if (m.fields.includes('name') && !name) return authMsg('¿Cómo te llamas?');
  if (m.fields.includes('email') && !/^\S+@\S+\.\S+$/.test(email)) return authMsg('Escribe un correo válido.');
  if (m.fields.includes('pass') && !pass) return authMsg('Escribe tu contraseña.');
  if (m.fields.includes('pass') && auth.mode !== 'login' && pass.length < 6) return authMsg('La contraseña debe tener al menos 6 caracteres.');
  const needsCaptcha = captchaOn() && auth.mode !== 'newpass';
  if (needsCaptcha && !captcha.token) return authMsg('Completa la verificación de seguridad.');
  const token = needsCaptcha ? captcha.token : undefined;

  auth.busy = true;
  $('#authSubmit').disabled = true;
  authMsg('');
  try {
    if (auth.mode === 'login') {
      const { error } = await DB.signIn(email, pass, token);
      if (error) throw error;              // si todo va bien, onAuth → enterApp
    } else if (auth.mode === 'signup') {
      const { data, error } = await DB.signUp(email, pass, name, token);
      if (error) throw error;
      if (!data.session) {                 // Supabase pide confirmar el correo
        setAuthMode('login');
        $('#authEmail').value = email;
        authMsg('📩 Te enviamos un correo de confirmación. Ábrelo y luego inicia sesión.', true);
      }
    } else if (auth.mode === 'forgot') {
      const { error } = await DB.resetPassword(email, token);
      if (error) throw error;
      authMsg('📩 Si ese correo tiene cuenta, te llegó un enlace para cambiar la contraseña.', true);
    } else if (auth.mode === 'newpass') {
      const { error } = await DB.updatePassword(pass);
      if (error) throw error;
      ui.recovery = false;
      history.replaceState(null, '', location.pathname);
      toast('🔑', 'Contraseña actualizada', 'Ya puedes seguir con tus hábitos');
      if (ui.userId) hideAuth(); else enterApp(DB.user);
    }
  } catch (err) {
    authMsg(authError(err));
  } finally {
    auth.busy = false;
    $('#authSubmit').disabled = false;
    if (needsCaptcha) resetCaptcha();
  }
}

function handleAuth(event, user) {
  if (event === 'PASSWORD_RECOVERY') { ui.recovery = true; showAuth('newpass'); return; }
  if (user && user.id !== ui.userId) enterApp(user);
  else if (!user && (ui.userId || event === 'INITIAL_SESSION')) leaveApp();
}

async function enterApp(user) {
  ui.userId = user.id;
  showAuthLoading('Cargando tus hábitos…');
  const cached = load();
  try {
    const { hasProfile, ...remote } = await DB.loadState();
    if (ui.userId !== user.id) return;     // cambió de cuenta mientras cargaba
    state = sanitize({ ...remote, notified: cached.notified });
    if (!hasProfile) {                     // primera vez: crear perfil con el nombre del registro
      state.settings.name ||= user.user_metadata?.name || user.user_metadata?.full_name || '';
      saveProfile();
    }
    save();
  } catch (err) {
    console.error(err);
    state = cached;
    toast('📡', 'Sin conexión con el servidor', 'Mostrando tu última copia en este dispositivo', { ms: 5000 });
  }
  ui.lastSync = Date.now();
  if (location.hash.includes('access_token') && !ui.recovery) history.replaceState(null, '', location.pathname);
  $('#userChip').hidden = false;
  $('#accountCard').hidden = false;
  $('#accountEmail').textContent = user.email;
  if (ui.recovery) showAuth('newpass'); else hideAuth();
  startApp();
  if (!ui.recovery) offerLocalMigration();
}

function leaveApp() {
  ui.userId = null;
  state = defaults();
  $$('.modal-backdrop.open').forEach(closeModal);
  $('#userChip').hidden = true;
  $('#accountCard').hidden = true;
  if (ui.started) render();
  showAuth('login');
}

async function logout() {
  if (!cloud()) return;
  const text = DB.status === 'error'
    ? 'Hay cambios que no se pudieron sincronizar y se perderán. Toca "Error · reintentar" antes de salir si quieres conservarlos.'
    : 'Tus hábitos quedan guardados en tu cuenta.';
  if (!(await confirmDialog('¿Cerrar sesión?', text, 'Cerrar sesión'))) return;
  showAuthLoading('Guardando cambios…');
  try {
    const { error } = await DB.signOut();  // espera a que terminen las escrituras pendientes
    if (error) throw error;                // si va bien, onAuth → leaveApp
  } catch (err) {
    console.error('[logout]', err);
    if (cloud()) hideAuth();
    toast('📡', 'No se pudo cerrar sesión', 'Revisa tu conexión e inténtalo de nuevo.', { ms: 5000 });
  }
}

/** Si había hábitos del modo local (sin cuenta) en este navegador, ofrece subirlos. */
async function offerLocalMigration() {
  const flag = `${STORE_KEY}:migrated`;
  try { if (localStorage.getItem(flag)) return; } catch { return; }
  const legacy = load(STORE_KEY);
  if (!legacy.habits.length || state.habits.length) return;
  const ok = await confirmDialog('¿Subir tus hábitos a tu cuenta?',
    `Encontramos ${legacy.habits.length} hábitos guardados en este navegador. ¿Quieres pasarlos a tu cuenta para no perder tu racha?`,
    'Subir hábitos');
  try { localStorage.setItem(flag, '1'); } catch { /* ignore */ }
  if (!ok || !cloud()) return;
  state = normalizeIds(sanitize({ ...legacy, settings: { ...legacy.settings, name: state.settings.name || legacy.settings.name } }));
  commitAll();
  toast('☁️', 'Hábitos subidos', 'Ya están en tu cuenta');
}

function updateSync(s) {
  const el = $('#syncStatus');
  el.dataset.state = s;
  el.querySelector('span').textContent = { ok: 'Sincronizado', saving: 'Guardando…', error: 'Error · reintentar' }[s];
}

/** Al volver a la pestaña, trae cambios hechos desde otro dispositivo. */
async function refreshFromServer() {
  if (document.hidden || !cloud() || !ui.userId || DB.busy || DB.status === 'error' || anyModalOpen()) return;
  if (Date.now() - (ui.lastSync || 0) < 30000) return;
  ui.lastSync = Date.now();
  const before = { version: stateVersion, state, user: ui.userId };
  try {
    const { hasProfile, ...remote } = await DB.loadState();
    // Si hubo cambios locales mientras llegaba la respuesta, no pisarlos: se reintenta en la próxima visita.
    if (DB.busy || !cloud() || stateVersion !== before.version || state !== before.state || ui.userId !== before.user) return;
    state = sanitize({ ...remote, notified: state.notified });
    save();
    render();
  } catch { /* sin red: se reintenta en la próxima visita */ }
}

/* =========================================================
   INICIO
   ========================================================= */
function tick() {
  updateCountdown();
  const key = todayKey();
  if (key !== ui.lastDayKey) { ui.lastDayKey = key; ui.selDate = null; render(); }
}

/** Arranca la interfaz (una sola vez) con el estado ya cargado. */
function startApp() {
  ui.lastDayKey = todayKey();
  ui.selDate = null;
  checkAchievements(true);
  if (ui.started) { render(); return; }
  ui.started = true;
  let saved = null;
  try { saved = localStorage.getItem('habits.view'); } catch { /* ignore */ }
  go(['today', 'habits', 'stats', 'awards', 'settings'].includes(saved) ? saved : 'today');
  setInterval(tick, 1000);
  setInterval(() => {
    if (DB.enabled && !ui.userId) return;
    checkReminders();
    if (ui.view === 'today' && !anyModalOpen()) render();
  }, 30000);
  checkReminders();
}

function bindAuth() {
  $('#authForm').addEventListener('submit', submitAuth);
  $('#authTabs').addEventListener('click', e => {
    const b = e.target.closest('[data-mode]');
    if (b) setAuthMode(b.dataset.mode);
  });
  $('#authForgot').addEventListener('click', () => setAuthMode('forgot'));
  $('#authBack').addEventListener('click', () => setAuthMode('login'));
  $('#authGoogle').addEventListener('click', async () => {
    const { error } = await DB.signInGoogle();   // redirige a Google
    if (error) authMsg(authError(error));
  });
  $('#syncStatus').addEventListener('click', () => {
    if (DB.status !== 'error') return;
    toast('🔄', 'Reintentando sincronización…');
    DB.replaceAll(state.habits, state.log, state.settings, state.unlocked);
  });
  document.addEventListener('visibilitychange', refreshFromServer);
  window.addEventListener('focus', refreshFromServer);
}

/* =========================================================
   PWA: service worker (offline) e instalación como app
   ========================================================= */
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
// iPadOS se presenta como Mac; se distingue por la pantalla táctil
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
let installPrompt = null;   // evento de Chrome/Edge/Android para mostrar el diálogo de instalación

function updateInstallCard() {
  const card = $('#installCard');
  if (isStandalone()) { card.hidden = true; return; }
  if (installPrompt) {
    card.hidden = false;
    $('#installBtn').hidden = false;
    $('#installText').textContent = 'Tenla en tu pantalla de inicio como una app, a pantalla completa.';
  } else if (isIOS()) {
    // iOS no permite instalar con un botón: hay que hacerlo desde el menú Compartir
    card.hidden = false;
    $('#installBtn').hidden = true;
    $('#installText').textContent = 'Toca Compartir (el cuadrado con la flecha ↑) y luego "Agregar a inicio".';
  } else {
    card.hidden = true;
  }
}

function setupPWA() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(err => console.warn('[sw]', err));
  }
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();   // en vez de la mini-barra del navegador, usamos nuestro botón en Ajustes
    installPrompt = e;
    updateInstallCard();
  });
  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    updateInstallCard();
    toast('📲', 'Habits instalada', 'Ya la tienes en tu pantalla de inicio');
  });
  $('#installBtn').addEventListener('click', async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;   // el evento solo sirve una vez
    updateInstallCard();
  });
  updateInstallCard();
}

function init() {
  resizeCanvas();
  bind();
  setupPWA();

  // Sin Supabase configurado → modo local (como antes, sin cuentas)
  if (!DB.enabled) {
    if (DB.configured) {
      showAuthLoading('No se pudo conectar con el servicio de cuentas. Revisa tu internet y recarga la página.');
      $('#authLoading .spinner').hidden = true;
      return;
    }
    state = load();
    startApp();
    return;
  }

  bindAuth();
  setupCaptcha();
  ui.recovery = /type=recovery/.test(location.hash);
  DB.onStatus(updateSync);
  DB.onError(label => toast('⚠️', 'No se pudo sincronizar', `Falló: ${label}. Toca "Error · reintentar" en tu perfil.`, { ms: 6000 }));
  showAuthLoading('Conectando…');
  DB.onAuth(handleAuth);
}

init();
