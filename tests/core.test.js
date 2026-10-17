// Tests del núcleo de Habits. Ejecuta: node --test
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');

const T = new Date(2026, 9, 17);              // "hoy" fijo: sábado 17 de octubre de 2026
const key = n => C.dk(C.addDays(T, n));       // día relativo a hoy
const ALL = [0, 1, 2, 3, 4, 5, 6];
const habit = (over = {}) => ({
  id: 'h1', name: 'Leer', emoji: '📚', color: '#a78bfa', time: '07:00', duration: 15,
  days: ALL, category: 'Estudio', note: '', createdAt: key(-9), ...over,
});

/* ---------- Rachas ---------- */
test('racha por hábito: días seguidos hasta hoy', () => {
  const h = habit();
  const log = { [key(-2)]: ['h1'], [key(-1)]: ['h1'], [key(0)]: ['h1'] };
  const s = C.habitStats(h, log, T);
  assert.equal(s.current, 3);
  assert.equal(s.best, 3);
  assert.equal(s.total, 3);
});

test('hoy pendiente no rompe la racha; ayer sin hacer sí', () => {
  const h = habit();
  assert.equal(C.habitStats(h, { [key(-2)]: ['h1'], [key(-1)]: ['h1'] }, T).current, 2);
  assert.equal(C.habitStats(h, { [key(-2)]: ['h1'] }, T).current, 0);
});

test('un día no programado no rompe la racha', () => {
  const skip = C.addDays(T, -1).getDay();     // ayer no está programado
  const h = habit({ days: ALL.filter(d => d !== skip) });
  const log = { [key(-2)]: ['h1'], [key(0)]: ['h1'] };
  assert.equal(C.habitStats(h, log, T).current, 2);
});

test('racha global = días perfectos seguidos', () => {
  const a = habit({ id: 'a' }), b = habit({ id: 'b' });
  const log = { [key(-2)]: ['a', 'b'], [key(-1)]: ['a', 'b'], [key(0)]: ['a'] };
  const g = C.globalStats([a, b], log, T);
  assert.equal(g.current, 2);
  assert.equal(g.perfectDays, 2);
});

/* ---------- Robustez ante datos maliciosos ---------- */
test('createdAt absurdo no cuelga los cálculos (recorrido acotado)', () => {
  const h = habit({ createdAt: '-5000-01-01' });
  const t0 = Date.now();
  C.habitStats(h, {}, T);
  C.globalStats([h], {}, T);
  assert.ok(Date.now() - t0 < 1000, 'debería tardar milisegundos');
});

test('sanitizeState acota createdAt al historial permitido', () => {
  const old = C.sanitizeState({ habits: [habit({ createdAt: '1800-01-01' })], log: {} }, T);
  assert.equal(old.habits[0].createdAt, key(-C.MAX_HISTORY_DAYS));
  const bad = C.sanitizeState({ habits: [habit({ createdAt: '-5000-01-01' })], log: {} }, T);
  assert.equal(bad.habits[0].createdAt, key(0));
  const f = C.sanitizeState({ habits: [habit({ createdAt: '2999-01-01' })], log: {} }, T);
  assert.equal(f.habits[0].createdAt, key(0));
});

test('sanitizeState repara campos ausentes o inválidos', () => {
  const s = C.sanitizeState({ habits: [{ id: 'x', name: 'a', days: null, time: '99:99', duration: 'mucho' }], log: { [key(0)]: 'no-array' } }, T);
  const h = s.habits[0];
  assert.deepEqual(h.days, ALL);
  assert.equal(h.time, '07:00');
  assert.equal(h.duration, 15);
  assert.equal(h.emoji, C.EMOJIS[0]);
  assert.equal(h.color, C.COLORS[0]);
  assert.equal(h.category, 'Otro');
  assert.deepEqual(s.log, {});
  // y con eso los cálculos ya no revientan
  assert.doesNotThrow(() => C.habitStats(h, s.log, T));
});

test('sanitizeState neutraliza HTML en emoji y color (XSS)', () => {
  const s = C.sanitizeState({ habits: [habit({ emoji: '<img src=x onerror=alert(1)>', color: '"><img src=x onerror=alert(1)>' })], log: {} }, T);
  assert.equal(s.habits[0].emoji, C.EMOJIS[0]);
  assert.equal(s.habits[0].color, C.COLORS[0]);
});

test('sanitizeState descarta ids peligrosos, duplicados y hábitos que no son objetos', () => {
  const s = C.sanitizeState({ habits: [null, 5, habit({ id: '"><b>' }), habit(), habit()], log: {} }, T);
  assert.equal(s.habits.length, 1);
  assert.equal(s.habits[0].id, 'h1');
});

test('sanitizeState limpia el log: fechas inválidas, ids desconocidos y duplicados', () => {
  const log = { [key(0)]: ['h1', 'h1', 'otro', 7], 'ayer': ['h1'], '__proto__': ['h1'], '1900-01-01': ['h1'] };
  const s = C.sanitizeState({ habits: [habit()], log }, T);
  assert.deepEqual(s.log, { [key(0)]: ['h1'] });
});

test('sanitizeState limita la cantidad de hábitos', () => {
  const habits = Array.from({ length: C.MAX_HABITS + 50 }, (_, i) => habit({ id: `h${i}` }));
  assert.equal(C.sanitizeState({ habits, log: {} }, T).habits.length, C.MAX_HABITS);
});

test('sanitizeState conserva ajustes válidos y descarta los demás', () => {
  const s = C.sanitizeState({ habits: [], log: {}, settings: { name: 'Diego', sound: 'sí', h12: true }, unlocked: { streak3: key(0), 'x y': key(0), c50: 'ayer' } }, T);
  assert.deepEqual(s.settings, { name: 'Diego', notifications: false, sound: true, h12: true });
  assert.deepEqual(s.unlocked, { streak3: key(0) });
});

test('sanitizeState con basura devuelve el estado por defecto', () => {
  for (const raw of [null, 42, 'x', [], { habits: 'no' }]) {
    assert.deepEqual(C.sanitizeState(raw, T), C.defaults());
  }
});

test('safeEmoji acepta emojis compuestos y rechaza texto', () => {
  assert.equal(C.safeEmoji('🏋️‍♀️'), '🏋️‍♀️');
  assert.equal(C.safeEmoji('hola'), C.EMOJIS[0]);
  assert.equal(C.safeEmoji('🔥<b>'), C.EMOJIS[0]);
});
