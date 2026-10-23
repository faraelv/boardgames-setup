
import { evalCondition, buildContext, generateGuide, fill } from './engine.js';

let GAMES = [];
const APP_VERSION = document.documentElement.dataset.version || 'local';

/* ---------- almacenamiento (opcional, solo en este navegador) ---------- */
// El progreso de una partida (casillas, eventos y puntos) caduca 4 h después del último cambio:
// sobrevive a que Android cierre la app a mitad de partida, pero la siguiente empieza de cero.
const SESSION_KEY = /^(done|events|score):/;
const SESSION_TTL = 4 * 60 * 60 * 1000;
const store = {
  get(k, d) {
    try {
      const raw = localStorage.getItem(k);
      if (!raw) return d;
      const v = JSON.parse(raw);
      if (!SESSION_KEY.test(k)) return v;
      if (v && typeof v === 'object' && 't' in v && Date.now() - v.t < SESSION_TTL) return v.v;
      localStorage.removeItem(k); return d; // caducado (o guardado con el formato antiguo, sin fecha)
    } catch { return d; }
  },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(SESSION_KEY.test(k) ? { v, t: Date.now() } : v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};
// Al abrir, limpiar el progreso caducado de partidas anteriores.
try { for (const k of Object.keys(localStorage)) if (SESSION_KEY.test(k)) store.get(k); } catch {}

/* ---------- interfaz ---------- */
const app = document.getElementById('app');
const prog = document.getElementById('prog');
let state = { view: 'list', game: null, answers: {}, tool: null, tab: 'setup' }; // tool: 'pick' (sortear juego) o 'draw' (orden y equipos)

const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v; else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) n.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) n.append(kid.nodeType ? kid : document.createTextNode(kid));
  return n;
};
const WHO = { table: 'Mesa', eachPlayer: 'Cada jugador', rival: 'Rival', firstPlayer: 'Jugador inicial' };
// Portada en miniatura (o inicial si no hay) y tono suave de fondo sacado de la portada.
const tintStyle = g => g.tint ? `--tint:${g.tint}` : null;
const coverThumb = g => g.cover
  ? el('img', { class: 'cover', src: g.cover, alt: '', loading: 'lazy', decoding: 'async', width: 56, height: 56 })
  : el('span', { class: 'cover mono', 'aria-hidden': 'true' }, g.name.replace(/^[¡¿]/, '').charAt(0));
const playersLabel = g => g.players.min === g.players.max ? `${g.players.min} jug.` : `${g.players.min}–${g.players.max} jug.`;

/* ---------- navegación con el historial (botón atrás del móvil) ---------- */
// Cada pantalla es una entrada del historial: list → questions → guide.
// Abrir el panel del grupo añade otra entrada, así «atrás» primero lo cierra.
function showView(view, gameId) {
  if (gameId && state.game?.id !== gameId) {
    const g = GAMES.find(x => x.id === gameId);
    if (g) { state.game = g; state.answers = store.get('answers:' + g.id, {}); }
  }
  if (view !== 'list' && !state.game) view = 'list';
  if (view === 'guide' && state.view !== 'guide') state.tab = 'setup';
  state.view = view; render(); window.scrollTo(0, 0);
}
function go(view) {
  history.pushState({ view, gameId: state.game?.id }, '');
  showView(view, state.game?.id);
}
history.replaceState({ view: 'list' }, '');
window.addEventListener('popstate', e => {
  const st = e.state || { view: 'list' };
  if (!sheet.hidden && !st.sheet) hideSheet();
  if (st.sheet) return;
  const tool = st.tool || null;
  if (tool !== state.tool) { state.tool = tool; if (st.view === 'list' && state.view === 'list') { render(); window.scrollTo(0, 0); return; } }
  if (st.view !== state.view || st.gameId !== state.game?.id) showView(st.view, st.gameId);
});

function render() {
  app.replaceChildren();
  prog.hidden = !(state.view === 'guide' && state.tab === 'setup');
  ({ list: renderList, questions: renderQuestions, guide: renderGuide })[state.view]();
  syncWakeLock();
}

/* ---------- pantalla siempre encendida mientras se sigue la guía ---------- */
let wakeLock = null;
async function syncWakeLock() {
  const want = state.view === 'guide' && document.visibilityState === 'visible';
  try {
    if (want && !wakeLock && 'wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!want && wakeLock) {
      await wakeLock.release(); wakeLock = null;
    }
  } catch { wakeLock = null; } // batería baja o el sistema lo deniega: la app sigue igual
}
// Android libera el bloqueo al salir de la app; se recupera al volver.
document.addEventListener('visibilitychange', syncWakeLock);

function openGame(g) { state.game = g; state.answers = store.get('answers:' + g.id, {}); state.tool = null; go('questions'); }

function renderList() {
  if (state.tool === 'pick') return renderPick();
  if (state.tool === 'draw') return renderDraw();
  const openTool = tool => { history.pushState({ view: 'list', tool }, ''); state.tool = tool; render(); window.scrollTo(0, 0); };
  app.append(
    el('div', { class: 'listHead' },
      el('p', { class: 'intro' }, 'Elige el juego, responde a cuatro preguntas y sigue la preparación paso a paso.'),
      el('div', { class: 'toolRow' },
        el('button', { class: 'pickBtn', onclick: () => openTool('pick') }, diceIcon(), 'Sortear juego'),
        el('button', { class: 'pickBtn', onclick: () => openTool('draw') }, peopleIcon(), 'Orden y equipos'))),
    el('div', { class: 'games' }, GAMES.map(g => el('button', { class: 'game', style: tintStyle(g), onclick: () => openGame(g) },
      coverThumb(g), el('h2', {}, g.name), el('span', { class: 'meta' }, g.publisher || ''), el('span', { class: 'players' }, playersLabel(g)))))
  );
}

function diceIcon() {
  const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', '18'); svg.setAttribute('height', '18'); svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = '<rect x="3" y="3" width="18" height="18" rx="4" fill="none" stroke="currentColor" stroke-width="2"/><g fill="currentColor"><circle cx="8.5" cy="8.5" r="1.6"/><circle cx="15.5" cy="15.5" r="1.6"/><circle cx="12" cy="12" r="1.6"/></g>';
  return svg;
}

function renderPick() {
  const ids = GAMES.map(g => g.id);
  let sel = new Set(store.get('pickSel', ids).filter(id => ids.includes(id)));
  const save = () => store.set('pickSel', [...sel]);
  const result = el('div', { class: 'pickResult', hidden: true, 'aria-live': 'polite' });
  const countEl = el('span', {});
  const cards = new Map();
  const refresh = () => {
    countEl.textContent = sel.size === 1 ? '1 juego seleccionado' : `${sel.size} juegos seleccionados`;
    drawBtn.disabled = sel.size < 2;
    for (const [id, c] of cards) c.setAttribute('aria-pressed', String(sel.has(id)));
  };
  const fits = n => GAMES.filter(g => g.players.min <= n && g.players.max >= n).map(g => g.id);
  const drawBtn = el('button', { class: 'go drawBtn', onclick: () => {
    const pool = GAMES.filter(g => sel.has(g.id));
    const g = pool[Math.floor(Math.random() * pool.length)];
    result.hidden = false;
    result.replaceChildren(el('div', { class: 'eyebrow' }, 'Hoy toca'), el('h2', {}, g.name),
      el('div', { class: 'row' },
        el('button', { class: 'go', onclick: () => { history.replaceState({ view: 'list' }, ''); openGame(g); } }, 'Preparar'),
        el('button', { class: 'ghost', onclick: () => drawBtn.click() }, 'Otra vez')));
    result.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } }, 'Sortear');

  const nums = []; for (let n = 1; n <= Math.max(...GAMES.map(g => g.players.max)); n++) nums.push(n);
  app.append(
    el('div', { class: 'title-block' }, el('div', { class: 'eyebrow' }, 'Sortear juego'), el('h1', {}, '¿A qué jugamos?')),
    el('p', { class: 'help' }, 'Marca los juegos entre los que quieres sortear. Puedes elegir rápido los que admiten cuántos sois.'),
    el('div', { class: 'quick' },
      el('div', { class: 'quickRow' }, el('span', { class: 'qlabel' }, 'Somos'),
        el('div', { class: 'seg nums' }, nums.map(n => el('button', { 'aria-label': n === 1 ? 'Solo' : `${n} jugadores`, onclick: () => { sel = new Set(fits(n)); save(); refresh(); } }, String(n))))),
      el('div', { class: 'seg' },
        el('button', { onclick: () => { sel = new Set(ids); save(); refresh(); } }, 'Todos'),
        el('button', { onclick: () => { sel = new Set(); save(); refresh(); } }, 'Ninguno'))),
    result,
    el('div', { class: 'games picking' }, GAMES.map(g => {
      const c = el('button', { class: 'game', 'aria-pressed': String(sel.has(g.id)), onclick: () => {
        sel.has(g.id) ? sel.delete(g.id) : sel.add(g.id); save(); refresh(); } },
        el('span', { class: 'tick', 'aria-hidden': 'true' }),
        el('h2', {}, g.name), el('span', { class: 'players' }, playersLabel(g)));
      cards.set(g.id, c); return c;
    })),
    el('div', { class: 'pickBar' }, countEl, drawBtn));
  refresh();
}

function peopleIcon() {
  const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', '18'); svg.setAttribute('height', '18'); svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = '<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><circle cx="17" cy="9" r="2.8"/><path d="M17 14.5c2.4 0 4 1.5 4.6 4.5"/></g>';
  return svg;
}

const shuffle = arr => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

/* Sorteo de orden de turno o de equipos, sin elegir juego. */
function renderDraw() {
  const roster = getRoster();
  const saved = store.get('drawState', {});
  const ds = { mode: saved.mode === 'teams' ? 'teams' : 'order', teams: saved.teams || 2, guests: saved.guests || [], sel: saved.sel };
  const names = [...roster, ...ds.guests.filter(g => !roster.includes(g))];
  let sel = new Set((ds.sel ?? roster).filter(n => names.includes(n)));
  const save = () => store.set('drawState', { mode: ds.mode, teams: ds.teams, guests: ds.guests, sel: [...sel] });
  const result = el('div', { class: 'drawResult', hidden: true, 'aria-live': 'polite' });
  const body = el('div', { class: 'questions' });

  const draw = () => {
    const who = names.filter(n => sel.has(n));
    result.hidden = false;
    if (ds.mode === 'order') {
      result.replaceChildren(el('div', { class: 'eyebrow' }, 'Orden de turno'),
        el('ol', { class: 'order big' }, shuffle(who).map(n => el('li', {}, n))));
    } else {
      const teams = Array.from({ length: ds.teams }, () => []);
      shuffle(who).forEach((n, i) => teams[i % ds.teams].push(n));
      const order = shuffle(teams.map((_, i) => i));
      result.replaceChildren(el('div', { class: 'eyebrow' }, `${ds.teams} equipos`),
        el('div', { class: 'teams' }, teams.map((t, i) => el('div', { class: 'team' },
          el('h3', {}, `Equipo ${i + 1}`, i === order[0] && el('span', { class: 'starts' }, 'empieza')),
          el('ul', {}, t.map(n => el('li', {}, n)))))));
    }
    result.append(el('button', { class: 'ghost', onclick: draw }, 'Otra vez'));
    result.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  const paint = () => {
    const n = sel.size, maxTeams = Math.floor(n / 2);
    if (ds.mode === 'teams' && maxTeams >= 2) ds.teams = Math.min(Math.max(ds.teams, 2), maxTeams);
    const toggle = name => { sel.has(name) ? sel.delete(name) : sel.add(name); save(); result.hidden = true; paint(); };
    const input = el('input', { type: 'text', placeholder: 'Otro nombre (invitado)', maxlength: '24', autocomplete: 'off', 'aria-label': 'Añadir invitado' });
    const addGuest = e => {
      e.preventDefault();
      const v = input.value.trim();
      if (!v || names.some(x => x.toLowerCase() === v.toLowerCase())) { input.select(); return; }
      ds.guests.push(v); names.push(v); sel.add(v); save(); paint();
    };
    const removeGuest = g => { ds.guests = ds.guests.filter(x => x !== g); names.splice(names.indexOf(g), 1); sel.delete(g); save(); result.hidden = true; paint(); };
    let problem = '';
    if (n < 2) problem = 'Elige al menos 2 jugadores.';
    else if (ds.mode === 'teams' && maxTeams < 2) problem = 'Para hacer equipos hacen falta al menos 4 jugadores.';
    const teamItems = []; for (let t = 2; t <= Math.max(2, maxTeams); t++) teamItems.push({ value: t, label: String(t) });
    const sizes = ds.mode === 'teams' && !problem
      ? (n % ds.teams === 0 ? `${ds.teams} equipos de ${n / ds.teams}.` : `${ds.teams} equipos de ${Math.floor(n / ds.teams)} o ${Math.ceil(n / ds.teams)}.`) : '';
    body.replaceChildren(...[
      el('div', { class: 'q' }, el('span', { class: 'label' }, '¿Qué sorteamos?'),
        seg([{ value: 'order', label: 'Orden de turno' }, { value: 'teams', label: 'Equipos' }], ds.mode, v => { ds.mode = v; save(); result.hidden = true; paint(); })),
      el('div', { class: 'q' }, el('span', { class: 'label' }, '¿Quién juega?'),
        names.length ? el('div', { class: 'seg' }, names.map(p => ds.guests.includes(p) && !roster.includes(p)
          ? el('span', { class: 'guest' }, el('button', { 'aria-pressed': String(sel.has(p)), onclick: () => toggle(p) }, p),
              el('button', { class: 'x', 'aria-label': 'Quitar a ' + p, onclick: () => removeGuest(p) }, '×'))
          : el('button', { 'aria-pressed': String(sel.has(p)), onclick: () => toggle(p) }, p)))
          : el('p', { class: 'help' }, 'Añade nombres aquí o guarda a vuestro grupo con el botón de personas de arriba.'),
        el('form', { class: 'addp', onsubmit: addGuest }, input, el('button', { type: 'submit' }, 'Añadir'))),
      ds.mode === 'teams' && maxTeams >= 2 && el('div', { class: 'q' }, el('span', { class: 'label' }, 'Número de equipos'),
        seg(teamItems, ds.teams, v => { ds.teams = v; save(); result.hidden = true; paint(); }), el('p', { class: 'help' }, sizes)),
      problem && el('p', { class: 'help bad' }, problem),
      el('button', { class: 'go', disabled: !!problem, onclick: draw }, ds.mode === 'order' ? 'Sortear orden' : 'Hacer equipos')].filter(Boolean));
  };

  app.append(
    el('div', { class: 'title-block' }, el('div', { class: 'eyebrow' }, 'Sorteo'), el('h1', {}, 'Orden y equipos')),
    body, result);
  paint();
}

const getRoster = () => store.get('roster', []);
const sheet = document.getElementById('sheet');
const backdrop = document.getElementById('backdrop');
const groupBtn = document.getElementById('groupBtn');

function updateBadge() {
  const n = getRoster().length, b = document.getElementById('groupCount');
  b.hidden = n === 0; b.textContent = n;
  groupBtn.setAttribute('aria-label', n ? `Vuestro grupo, ${n} jugadores` : 'Vuestro grupo');
}
function openSheet() {
  history.pushState({ ...(history.state || {}), sheet: true }, '');
  renderSheet(); sheet.hidden = false; backdrop.hidden = false;
  groupBtn.setAttribute('aria-expanded', 'true');
  setTimeout(() => document.getElementById('newPlayer')?.focus(), 0);
}
function hideSheet() {
  sheet.hidden = true; backdrop.hidden = true;
  groupBtn.setAttribute('aria-expanded', 'false'); groupBtn.focus();
}
// Cerrar con ×, fondo o Esc: si el panel tiene su entrada en el historial, se quita con «atrás».
function closeSheet() { history.state?.sheet ? history.back() : hideSheet(); }
groupBtn.addEventListener('click', () => sheet.hidden ? openSheet() : closeSheet());
backdrop.addEventListener('click', closeSheet);
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !sheet.hidden) closeSheet(); });

function renderSheet() {
  const roster = getRoster();
  const save = r => { store.set('roster', r); updateBadge(); renderSheet(); if (state.view !== 'list' || state.tool === 'draw') render(); };
  const input = el('input', { id: 'newPlayer', type: 'text', placeholder: 'Nombre', maxlength: '24', autocomplete: 'off', 'aria-label': 'Nombre del jugador' });
  const add = e => {
    e.preventDefault();
    const name = input.value.trim();
    if (!name || roster.some(n => n.toLowerCase() === name.toLowerCase())) { input.select(); return; }
    save([...roster, name]);
    setTimeout(() => document.getElementById('newPlayer')?.focus(), 0);
  };
  sheet.replaceChildren(
    el('div', { class: 'head' }, el('h2', { id: 'sheetTitle' }, 'Vuestro grupo'),
      el('button', { class: 'close', 'aria-label': 'Cerrar', onclick: closeSheet }, '×')),
    el('p', { class: 'help' }, roster.length ? 'Antes de cada partida podrás elegir quién juega.' : 'Añade a quienes soléis jugar para elegirlos en cada partida y sortear quién empieza.'),
    roster.length > 0 && el('ul', { class: 'people' }, roster.map(n => el('li', {}, el('span', {}, n),
      el('button', { 'aria-label': 'Quitar a ' + n, onclick: () => save(roster.filter(x => x !== n)) }, '×')))),
    el('form', { class: 'addp', onsubmit: add }, input, el('button', { type: 'submit' }, 'Añadir')),
    el('p', { class: 'version' }, 'Ronda Cero · versión ' + APP_VERSION));
}

function seg(items, current, onPick) {
  return el('div', { class: 'seg', role: 'group' }, items.map(it =>
    el('button', { 'aria-pressed': String(it.value === current), onclick: () => onPick(it.value) }, it.label)));
}

function renderQuestions() {
  const g = state.game;
  const { visible, ctx } = buildContext(g, state.answers);
  const set = (k, v) => { state.answers[k] = v; store.set('answers:' + g.id, state.answers); render(); };
  const qs = el('div', { class: 'questions' });
  const roster = getRoster();
  if (!roster.length) {
    qs.append(el('p', { class: 'hint' }, 'Consejo: añade a vuestro grupo con el botón de personas de arriba a la derecha para elegir quién juega y sortear el orden con nombres.'));
  }
  if (roster.length) {
    const who = (state.answers.who || []).filter(n => roster.includes(n));
    const toggle = n => {
      const next = who.includes(n) ? who.filter(x => x !== n) : [...who, n];
      state.answers.who = next;
      if (next.length >= g.players.min && next.length <= g.players.max) state.answers.players = next.length;
      store.set('answers:' + g.id, state.answers); render();
    };
    const n = who.length, out = n > 0 && (n < g.players.min || n > g.players.max);
    qs.append(el('div', { class: 'q' }, el('span', { class: 'label' }, '¿Quién juega?'),
      el('div', { class: 'seg' }, roster.map(p => el('button', { 'aria-pressed': String(who.includes(p)), onclick: () => toggle(p) }, p))),
      el('p', { class: 'help' + (out ? ' bad' : '') }, n === 0 ? 'Toca los nombres de quienes juegan hoy.'
        : out ? `${g.name} es para ${playersLabel(g).replace(' jug.', '')} jugadores y has elegido ${n}.`
        : n === 1 ? `Juega ${who[0]} contra el Rival.` : `Juegan ${n}: ${who.join(', ')}.`)));
  }
  if (g.players.min !== g.players.max) {
    const items = []; for (let p = g.players.min; p <= g.players.max; p++) items.push({ value: p, label: p === 1 ? '1 (solo)' : String(p) });
    qs.append(el('div', { class: 'q' }, el('span', { class: 'label' }, 'Número de jugadores'), seg(items, ctx.players, v => set('players', v))));
  }
  for (const o of visible) {
    const items = o.type === 'boolean' ? [{ value: true, label: 'Sí' }, { value: false, label: 'No' }] : o.choices;
    qs.append(el('div', { class: 'q' }, el('span', { class: 'label' }, o.label), o.help && el('p', { class: 'help' }, o.help), seg(items, o.value, v => set(o.id, v))));
  }
  app.append(
    el('div', { class: 'title-block' }, el('div', { class: 'eyebrow' }, 'Configura la partida'), el('h1', {}, g.name)),
    qs,
    el('button', { class: 'go', onclick: () => go('guide') }, 'Ver preparación')
  );
}

function whoPlaying(ctx) {
  const roster = getRoster();
  const who = (state.answers.who || []).filter(n => roster.includes(n));
  return who.length === ctx.players ? who : [];
}

function guideKey() { const { ctx } = buildContext(state.game, state.answers); return 'done:' + state.game.id + ':' + JSON.stringify(ctx); }

function renderGuide() {
  const g = state.game;
  const guide = generateGuide(g, state.answers);
  const { visible, ctx, sections, reference, scoring } = guide;
  const tabs = [['setup', 'Preparación'], reference.length && ['turn', 'Turno'], scoring && ['score', 'Puntos']].filter(Boolean);
  if (!tabs.some(([id]) => id === state.tab)) state.tab = 'setup';

  const chips = [g.players.min !== g.players.max ? (ctx.players === 1 ? 'Solitario' : `${ctx.players} jugadores`) : null,
    ...whoPlaying(ctx),
    ...visible.map(o => o.type === 'boolean' ? (o.value ? o.label.replace(/^¿|\?$/g, '') : null) : `${o.label}: ${o.choices.find(c => c.value === o.value)?.label.split(' —')[0]}`)].filter(Boolean);

  app.append(el('div', { class: 'title-block' }, el('h1', {}, g.name),
    el('ul', { class: 'summary' }, chips.map(c => el('li', {}, c)))));
  if (tabs.length > 1) {
    app.append(el('div', { class: 'tabs', role: 'tablist' }, tabs.map(([id, label]) =>
      el('button', { role: 'tab', 'aria-selected': String(state.tab === id), onclick: () => { state.tab = id; render(); window.scrollTo(0, 0); } }, label))));
  }
  ({ setup: renderSetupTab, turn: renderTurnTab, score: renderScoreTab })[state.tab](guide, tabs);
}

const pasos = n => n === 1 ? "1 paso" : `${n} pasos`;

function itemBody(st, ctx) {
  return [
    st.who && el('span', { class: 'who' + (st.who === 'rival' ? ' rival' : '') }, WHO[st.who]),
    el('p', { class: 'text' }, st.text),
    st.substeps?.length && el('ul', { class: 'subs' }, st.substeps.map(x => el('li', {}, x.text))),
    st.components?.length && el('div', { class: 'comps' }, st.components.map(c => el('span', {}, `${c.qty ?? ''} × ${c.name}`))),
    st.warning && el('p', { class: 'note warn' }, el('b', {}, 'Ojo: '), st.warning),
    st.tip && el('p', { class: 'note tip' }, st.tip),
    st.link && el('a', { class: 'link', href: st.link, target: '_blank', rel: 'noopener' }, 'Abrir ayuda externa ↗'),
    st.randomizer && randomizer(st.randomizer, ctx),
  ];
}

function renderSetupTab({ ctx, sections, events }, tabs) {
  const g = state.game;
  const key = guideKey();
  const done = new Set(store.get(key, []));
  const total = sections.reduce((n, s) => n + s.steps.length, 0);
  const updateProgress = () => {
    document.getElementById('progFill').style.width = (total ? done.size / total * 100 : 0) + '%';
    document.getElementById('progCount').textContent = `${done.size} de ${total} pasos`;
    finish.hidden = done.size < total;
  };

  const stepList = (prefix, steps, doneSet, storeKey, onChange) => {
    const list = el('ol', { class: 'steps' });
    for (const st of steps) {
      const id = prefix + '.' + st.id;
      const li = el('li', { class: 'step' + (st.who === 'rival' ? ' rival' : '') + (doneSet.has(id) ? ' is-done' : '') });
      const cb = el('input', { type: 'checkbox', class: 'check', id: 'c-' + id, 'aria-label': 'Hecho', checked: doneSet.has(id) });
      cb.addEventListener('change', () => {
        cb.checked ? doneSet.add(id) : doneSet.delete(id);
        li.classList.toggle('is-done', cb.checked);
        store.set(storeKey, [...doneSet]); onChange && onChange();
      });
      const [who, text, ...rest] = itemBody(st, ctx);
      li.append(cb, el('div', { class: 'body' }, who, el('label', { for: 'c-' + id }, text), ...rest));
      list.append(li);
    }
    return list;
  };

  sections.forEach(s => {
    app.append(el('section', { class: 'sec' }, el('h2', {}, s.title, el('span', { class: 'n' }, pasos(s.steps.length))),
      stepList(s.id, s.steps, done, key, updateProgress)));
  });

  const next = tabs.find(([id]) => id === 'turn');
  const finish = el('div', { class: 'finish', hidden: true }, el('h2', {}, 'Todo listo'), el('p', {}, '¡A jugar!'),
    next && el('button', { class: 'go', onclick: () => { state.tab = 'turn'; render(); window.scrollTo(0, 0); } }, 'Ver resumen del turno'));
  app.append(finish);

  if (events.length) {
    const evKey = key.replace('done:', 'events:');
    const evDone = new Set(store.get(evKey, []));
    const groups = [...new Set(events.map(e => e.group || 'Otros'))];
    const wrap = el('section', { class: 'sec during' }, el('div', { class: 'eyebrow' }, 'Durante la partida'));
    for (const grp of groups) {
      wrap.append(el('h2', {}, grp));
      for (const ev of events.filter(e => (e.group || 'Otros') === grp)) {
        wrap.append(el('details', { class: 'event' }, el('summary', {}, el('span', {}, ev.title), el('span', { class: 'n' }, pasos(ev.steps.length))),
          stepList('ev-' + ev.id, ev.steps, evDone, evKey)));
      }
    }
    app.append(wrap);
  }

  app.append(
    el('div', { class: 'tools' }, el('button', { onclick: () => { store.del(key); store.del(key.replace('done:', 'events:')); render(); } }, 'Desmarcar todo')),
    g.sources?.length && el('p', { class: 'sources' }, 'Basado en: ' + g.sources.map(s => s.title).join(' · ')));
  updateProgress();
}

function renderTurnTab({ ctx, reference }) {
  for (const r of reference) {
    app.append(el('section', { class: 'sec ref' }, el('h2', {}, r.title),
      el('ul', { class: 'refList' }, r.items.map(it => el('li', { class: 'refItem' + (it.who === 'rival' ? ' rival' : '') }, ...itemBody(it, ctx))))));
  }
}

function renderScoreTab({ ctx, scoring }) {
  const g = state.game;
  const names = whoPlaying(ctx);
  const players = names.length ? [...names] : Array.from({ length: ctx.players }, (_, i) => ctx.players === 1 ? 'Tú' : `Jugador ${i + 1}`);
  if (scoring.rival) players.push(scoring.rival);
  const key = 'score:' + g.id + ':' + JSON.stringify(players);
  const data = store.get(key, {});
  const val = (c, p) => Number(data[c]?.[p]) || 0;
  const totals = () => players.map((p, i) => ({ name: p, total: scoring.categories.reduce((t, c) => t + (c.negative ? -1 : 1) * val(c.id, i), 0) }));
  const board = el('div', { class: 'scoreBoard' });
  const drawBoard = () => {
    const t = totals(), best = Math.max(...t.map(x => x.total));
    const ranked = [...t].sort((a, b) => b.total - a.total);
    const anyScore = t.some(x => x.total !== 0);
    board.replaceChildren(el('div', { class: 'eyebrow' }, 'Total'),
      el('ol', { class: 'ranking' }, ranked.map(x => el('li', { class: anyScore && x.total === best ? 'win' : '' },
        el('span', {}, x.name), el('b', {}, String(x.total))))),
      anyScore && t.filter(x => x.total === best).length > 1 && scoring.tiebreak && el('p', { class: 'note warn' }, el('b', {}, 'Empate: '), scoring.tiebreak) || '');
  };

  if (scoring.notes) app.append(el('p', { class: 'note tip scoreNotes' }, scoring.notes));
  const cols = `repeat(${players.length}, minmax(0, 1fr))`;
  app.append(el('div', { class: 'scoreHead', style: `grid-template-columns:${cols}` }, players.map(p => el('span', { title: p }, p))));
  for (const c of scoring.categories) {
    app.append(el('div', { class: 'cat' },
      el('div', { class: 'catLabel' }, el('span', {}, (c.negative ? '− ' : '') + c.label), c.help && el('small', {}, c.help)),
      el('div', { class: 'cells', style: `grid-template-columns:${cols}` }, players.map((p, i) => {
        const inp = el('input', { type: 'number', 'aria-label': `${c.label} · ${p}`, id: `s-${c.id}-${i}`,
          value: data[c.id]?.[i] ?? '', placeholder: '0' });
        inp.addEventListener('input', () => {
          (data[c.id] ||= {})[i] = inp.value === '' ? '' : Number(inp.value);
          store.set(key, data); drawBoard();
        });
        inp.addEventListener('focus', () => inp.select());
        return inp;
      }))));
  }
  app.append(board,
    el('div', { class: 'tools' }, el('button', { onclick: () => { store.del(key); render(); } }, 'Borrar puntos')));
  drawBoard();
}

function randomizer(r, ctx) {
  const out = el('output', {});
  const pickN = (arr, n) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a.slice(0, n); };
  let label, run;
  if (r.type === 'firstPlayer') {
    label = 'Sortear';
    const names = whoPlaying(ctx);
    if (ctx.players > 1 && names.length) label = 'Sortear orden';
    run = () => {
      if (ctx.players === 1) return Math.random() < .5 ? `Empieza ${names[0] || 'tú'}` : 'Empieza el Rival';
      if (!names.length) return `Empieza el jugador ${1 + Math.floor(Math.random() * ctx.players)}`;
      const order = pickN(names, names.length);
      return el('ol', { class: 'order' }, order.map(n => el('li', {}, n)));
    };
  } else if (r.type === 'dice') {
    label = 'Tirar dados';
    run = () => { const d = Array.from({ length: r.count || 1 }, () => 1 + Math.floor(Math.random() * r.sides)); return d.join(' + ') + (d.length > 1 ? ' = ' + d.reduce((a, b) => a + b) : ''); };
  } else {
    const pool = [...r.from, ...(r.fromWhen || []).filter(w => evalCondition(w.when, ctx)).flatMap(w => w.items)];
    const n = Number(fill(String(r.count), ctx));
    label = r.hidden ? 'Sortear (oculto)' : 'Sortear';
    run = () => { const res = pickN(pool, n).join(', '); if (!r.hidden) return res;
      const reveal = el('button', { onclick: () => reveal.replaceWith(res) }, 'Ver resultado'); return reveal; };
  }
  return el('div', { class: 'rand' }, el('button', { onclick: () => out.replaceChildren(run()) }, label), out);
}

/* ---------- arranque ---------- */
async function loadGames() {
  // network-first lo resuelve el service worker; aquí solo pedimos el fichero.
  const res = await fetch('games.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error('No se pudo cargar la lista de juegos');
  return res.json();
}

updateBadge();
app.replaceChildren(el('p', { class: 'intro' }, 'Cargando juegos…'));
loadGames().then(list => { GAMES = list; render(); }).catch(() => {
  app.replaceChildren(el('p', { class: 'intro' }, 'No se han podido cargar los juegos. Comprueba la conexión y vuelve a abrir la app.'));
});

/* ---------- actualizaciones de la app ---------- */
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(reg => {
    // Comprobar novedades al abrir y cada vez que se vuelve a la app desde segundo plano.
    const check = () => reg.update().catch(() => {});
    check();
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
    const offer = worker => {
      const bar = document.getElementById('updateBar');
      bar.hidden = false;
      document.getElementById('updateBtn').onclick = () => worker.postMessage('skipWaiting');
    };
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w);
      });
    });
  }).catch(() => {});
  // Solo recargamos cuando una versión nueva sustituye a otra (no en la primera instalación).
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController && !reloaded) { reloaded = true; location.reload(); }
  });
}
