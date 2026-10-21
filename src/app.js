
import { evalCondition, buildContext, generateGuide, fill } from './engine.js';

let GAMES = [];
const APP_VERSION = document.documentElement.dataset.version || 'local';

/* ---------- almacenamiento (opcional, solo en este navegador) ---------- */
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

/* ---------- interfaz ---------- */
const app = document.getElementById('app');
const backBtn = document.getElementById('back');
const prog = document.getElementById('prog');
let state = { view: 'list', game: null, answers: {} };

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
  if (st.view !== state.view || st.gameId !== state.game?.id) showView(st.view, st.gameId);
});
backBtn.addEventListener('click', () => history.back());

function render() {
  app.replaceChildren();
  backBtn.hidden = state.view === 'list';
  prog.hidden = state.view !== 'guide';
  ({ list: renderList, questions: renderQuestions, guide: renderGuide })[state.view]();
}

function renderList() {
  app.append(
    el('p', { class: 'intro' }, 'Elige el juego, responde a cuatro preguntas y sigue la preparación paso a paso.'),
    el('div', { class: 'games' }, GAMES.map(g => el('button', { class: 'game', onclick: () => {
      state.game = g; state.answers = store.get('answers:' + g.id, {}); go('questions');
    } }, el('h2', {}, g.name), el('span', { class: 'meta' }, g.publisher || ''), el('span', { class: 'players' }, playersLabel(g)))))
  );
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
  const save = r => { store.set('roster', r); updateBadge(); renderSheet(); if (state.view !== 'list') render(); };
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
  const { visible, ctx, sections, events } = generateGuide(g, state.answers);
  const key = guideKey();
  const done = new Set(store.get(key, []));
  const total = sections.reduce((n, s) => n + s.steps.length, 0);
  const updateProgress = () => {
    document.getElementById('progFill').style.width = (total ? done.size / total * 100 : 0) + '%';
    document.getElementById('progCount').textContent = `${done.size} de ${total} pasos`;
    finish.hidden = done.size < total;
  };

  const chips = [g.players.min !== g.players.max ? (ctx.players === 1 ? 'Solitario' : `${ctx.players} jugadores`) : null,
    ...whoPlaying(ctx),
    ...visible.map(o => o.type === 'boolean' ? (o.value ? o.label.replace(/^¿|\?$/g, '') : null) : `${o.label}: ${o.choices.find(c => c.value === o.value)?.label.split(' —')[0]}`)].filter(Boolean);

  app.append(el('div', { class: 'title-block' }, el('div', { class: 'eyebrow' }, 'Preparación'), el('h1', {}, g.name),
    el('ul', { class: 'summary' }, chips.map(c => el('li', {}, c)))));

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
      const body = el('div', { class: 'body' },
        st.who && el('span', { class: 'who' + (st.who === 'rival' ? ' rival' : '') }, WHO[st.who]),
        el('label', { for: 'c-' + id }, el('p', { class: 'text' }, st.text)),
        st.substeps?.length && el('ul', { class: 'subs' }, st.substeps.map(x => el('li', {}, x.text))),
        st.components?.length && el('div', { class: 'comps' }, st.components.map(c => el('span', {}, `${c.qty ?? ''} × ${c.name}`))),
        st.warning && el('p', { class: 'note warn' }, el('b', {}, 'Ojo: '), st.warning),
        st.tip && el('p', { class: 'note tip' }, st.tip),
        st.link && el('a', { class: 'link', href: st.link, target: '_blank', rel: 'noopener' }, 'Abrir ayuda externa ↗'),
        st.randomizer && randomizer(st.randomizer, ctx));
      li.append(cb, body);
      list.append(li);
    }
    return list;
  };

  sections.forEach(s => {
    app.append(el('section', { class: 'sec' }, el('h2', {}, s.title, el('span', { class: 'n' }, `${s.steps.length} pasos`)),
      stepList(s.id, s.steps, done, key, updateProgress)));
  });

  const finish = el('div', { class: 'finish', hidden: true }, el('h2', {}, 'Todo listo'), el('p', {}, '¡A jugar!'));
  app.append(finish);

  if (events.length) {
    const evKey = key.replace('done:', 'events:');
    const evDone = new Set(store.get(evKey, []));
    const groups = [...new Set(events.map(e => e.group || 'Otros'))];
    const wrap = el('section', { class: 'sec during' }, el('div', { class: 'eyebrow' }, 'Durante la partida'));
    for (const grp of groups) {
      wrap.append(el('h2', {}, grp));
      for (const ev of events.filter(e => (e.group || 'Otros') === grp)) {
        const det = el('details', { class: 'event' }, el('summary', {}, el('span', {}, ev.title), el('span', { class: 'n' }, `${ev.steps.length} pasos`)),
          stepList('ev-' + ev.id, ev.steps, evDone, evKey));
        wrap.append(det);
      }
    }
    app.append(wrap);
  }

  app.append(
    el('div', { class: 'tools' }, el('button', { onclick: () => { store.del(key); store.del(key.replace('done:', 'events:')); render(); } }, 'Desmarcar todo')),
    g.sources?.length && el('p', { class: 'sources' }, 'Basado en: ' + g.sources.map(s => s.title).join(' · ')));
  updateProgress();
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
