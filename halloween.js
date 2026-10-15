/* =========================================================
   Modo Halloween 🎃
   Se activa solo entre el 1 de octubre y el 2 de noviembre.
   Para probarlo cualquier otro día: abre la web con ?halloween=1
   Para desactivarlo aunque sea octubre: ?halloween=0
   ========================================================= */
(function () {
  const params = new URLSearchParams(location.search);
  const now = new Date();
  const inSeason = now.getMonth() === 9 || (now.getMonth() === 10 && now.getDate() <= 2);
  const on = params.has('halloween') ? params.get('halloween') !== '0' : inSeason;
  if (!on) return;

  document.documentElement.classList.add('halloween');

  // Favicon y logos: 🔥 → 🎃
  const icon = document.querySelector('link[rel="icon"]');
  if (icon) icon.href = "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🎃</text></svg>";
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#0c0712');

  const BAT = `<svg viewBox="0 0 64 32"><path d="M32 9c-1.6 0-2.6 1.6-2.6 1.6L28.4 7l-.9 4.2C23.3 8.4 18 6.9 12.6 8c3 2 4.2 5 3.2 8-3-2-7.2-2.1-10.8 0 5.2 1 8.4 4 9.4 8.4 4.2-3 9.3-4 14.4-2.2.9-2.8 2-4 3.2-4s2.3 1.2 3.2 4c5.1-1.8 10.2-.8 14.4 2.2 1-4.4 4.2-7.4 9.4-8.4-3.6-2.1-7.8-2-10.8 0-1-3 .2-6 3.2-8-5.4-1.1-10.7.4-14.9 3.2L35.6 7l-1 3.6S33.6 9 32 9z"/></svg>`;

  const PUMPKIN = `<svg viewBox="0 0 120 110">
      <path class="pk-stem" d="M58 22c0-8 3-14 9-18l5 4c-5 3-7 8-7 14z"/>
      <ellipse class="pk-body" cx="38" cy="66" rx="30" ry="38"/>
      <ellipse class="pk-body" cx="82" cy="66" rx="30" ry="38"/>
      <ellipse class="pk-mid" cx="60" cy="64" rx="26" ry="42"/>
      <path class="pk-face" d="M36 56l12-12 8 14zM84 56l-12-12-8 14zM56 66h8l-4 9zM30 78c10 10 22 12 30 12s20-2 30-12l-6 2-4 6-6-5-7 6-7-6-7 6-7-6-6 5-4-6z"/>
    </svg>`;

  const GHOST = `<svg viewBox="0 0 60 72">
      <path class="gh-body" d="M30 2C14 2 4 14 4 30v40l8-7 9 7 9-7 9 7 9-7 8 7V30C56 14 46 2 30 2z"/>
      <ellipse class="gh-eye" cx="21" cy="30" rx="4" ry="6"/>
      <ellipse class="gh-eye" cx="39" cy="30" rx="4" ry="6"/>
      <ellipse class="gh-eye" cx="30" cy="46" rx="4" ry="5"/>
    </svg>`;

  const WEB = `<svg viewBox="0 0 160 160">
      <path d="M160 0L0 0M160 0L20 120M160 0L80 160M160 0L160 160M160 0L60 50"/>
      <path d="M128 0q-2 14 8 22 10 8 24 6M96 0q-4 26 14 42 16 16 50 12M64 0q-6 40 22 62 26 22 74 18M32 0q-8 52 30 82 34 30 98 24"/>
    </svg>`;

  // Capa de fondo (detrás del contenido): calabazas y fantasma
  const back = document.createElement('div');
  back.className = 'spooky-back';
  back.setAttribute('aria-hidden', 'true');
  back.innerHTML = `
    <div class="pumpkin pk-1">${PUMPKIN}</div>
    <div class="pumpkin pk-2">${PUMPKIN}</div>
    <div class="pumpkin pk-3">${PUMPKIN}</div>
    <div class="ghost">${GHOST}</div>
    <div class="moon"></div>`;

  // Capa de delante (no bloquea clics): murciélagos, telaraña y araña
  const front = document.createElement('div');
  front.className = 'spooky-front';
  front.setAttribute('aria-hidden', 'true');
  front.innerHTML = `
    ${[1, 2, 3, 4, 5].map(i => `<div class="bat bat-${i}">${BAT}</div>`).join('')}
    <div class="web">${WEB}</div>
    <div class="spider"><span class="thread"></span><span class="body">🕷️</span></div>`;

  function mount() {
    const aurora = document.querySelector('.aurora');
    if (aurora) aurora.after(back); else document.body.prepend(back);
    document.body.append(front);
    document.querySelectorAll('.brand-logo').forEach(el => { el.textContent = '🎃'; });
    document.querySelectorAll('.auth-brand .brand-sub').forEach(el => { el.textContent = 'Edición Halloween 🦇'; });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
