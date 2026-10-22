// Motor de guías de preparación. No sabe nada de ningún juego concreto:
// recibe la definición JSON y las respuestas del usuario, y devuelve las preguntas
// visibles y la lista de pasos que aplican. Lo usan la app y el validador.

export function evalCondition(cond, ctx) {
  if (cond == null) return true;
  if ('all' in cond) return cond.all.every(c => evalCondition(c, ctx));
  if ('any' in cond) return cond.any.some(c => evalCondition(c, ctx));
  if ('not' in cond) return !evalCondition(cond.not, ctx);
  if ('is' in cond) return Boolean(read(ctx, cond.is));
  if ('eq' in cond) return read(ctx, cond.eq[0]) == cond.eq[1];
  if ('in' in cond) return cond.in[1].includes(read(ctx, cond.in[0]));
  if ('gte' in cond) return read(ctx, cond.gte[0]) >= cond.gte[1];
  if ('lte' in cond) return read(ctx, cond.lte[0]) <= cond.lte[1];
  throw new Error('Condición desconocida: ' + JSON.stringify(cond));
}

function read(ctx, name) {
  if (!(name in ctx)) throw new Error(`Variable no definida: ${name}`);
  return ctx[name];
}

/** Opciones visibles con las respuestas actuales; las ocultas toman su default. */
export function buildContext(game, answers = {}) {
  const ctx = { players: answers.players ?? game.players.default ?? game.players.min };
  const visible = [];
  for (const opt of game.options ?? []) {
    const shown = evalCondition(opt.when, ctx);
    let value = shown && opt.id in answers ? answers[opt.id] : opt.default;
    let choices = opt.choices;
    if (opt.type === 'choice' && shown) {
      choices = opt.choices.filter(c => evalCondition(c.when, ctx));
      if (!choices.length) throw new Error(`La opción '${opt.id}' no tiene valores posibles con ${ctx.players} jugadores`);
      if (!choices.some(c => c.value === value)) value = choices.some(c => c.value === opt.default) ? opt.default : choices[0].value;
    }
    ctx[opt.id] = value ?? false;
    if (shown) visible.push({ ...opt, choices, value: ctx[opt.id] });
  }
  for (const [name, cases] of Object.entries(game.vars ?? {})) {
    const hit = cases.find(c => evalCondition(c.when, ctx));
    if (!hit) throw new Error(`Ningún caso de la var '${name}' cumple`);
    ctx[name] = hit.value;
  }
  return { ctx, visible };
}

export function fill(text, ctx) {
  if (text == null) return text;
  return text.replace(/\{(\w+)\}/g, (_, k) => {
    if (!(k in ctx)) throw new Error(`Plantilla con variable desconocida: {${k}}`);
    return String(ctx[k]);
  });
}

function resolveSteps(steps, ctx) {
  return steps
    .filter(s => evalCondition(s.when, ctx))
    .map(s => ({
      ...s,
      text: fill(s.text, ctx),
      tip: fill(s.tip, ctx),
      warning: fill(s.warning, ctx),
      components: s.components?.map(c => ({ ...c, qty: typeof c.qty === 'string' ? fill(c.qty, ctx) : c.qty })),
      substeps: s.substeps ? resolveSteps(s.substeps, ctx) : undefined,
    }))
    // Un grupo de tareas sencillas: sin subpasos visibles desaparece; con uno, se muestra como paso normal.
    .flatMap(s => {
      if (!s.group) return [s];
      if (!s.substeps.length) return [];
      if (s.substeps.length === 1) return [{ ...s.substeps[0], id: s.id, who: s.substeps[0].who ?? s.who }];
      return [s];
    });
}

export function generateGuide(game, answers = {}) {
  const { ctx, visible } = buildContext(game, answers);
  if (ctx.players < game.players.min || ctx.players > game.players.max)
    throw new Error(`Jugadores fuera de rango (${game.players.min}-${game.players.max})`);
  const sections = game.sections
    .filter(sec => evalCondition(sec.when, ctx))
    .map(sec => ({ id: sec.id, title: fill(sec.title, ctx), steps: resolveSteps(sec.steps, ctx) }))
    .filter(sec => sec.steps.length > 0);
  const events = (game.events ?? [])
    .filter(ev => evalCondition(ev.when, ctx))
    .map(ev => ({ id: ev.id, group: ev.group, title: fill(ev.title, ctx), steps: resolveSteps(ev.steps, ctx) }))
    .filter(ev => ev.steps.length > 0);
  const reference = (game.reference ?? [])
    .filter(r => evalCondition(r.when, ctx))
    .map(r => ({ id: r.id, title: fill(r.title, ctx), items: resolveSteps(r.items, ctx) }))
    .filter(r => r.items.length > 0);
  let scoring = null;
  if (game.scoring) {
    const sc = game.scoring;
    scoring = {
      categories: sc.categories.filter(c => evalCondition(c.when, ctx))
        .map(c => ({ ...c, label: fill(c.label, ctx), help: fill(c.help, ctx) })),
      tiebreak: fill(sc.tiebreak, ctx),
      notes: fill(sc.notes, ctx),
      rival: sc.rival && evalCondition(sc.rival.when, ctx) ? fill(sc.rival.label, ctx) : null,
    };
    if (!scoring.categories.length) scoring = null;
  }
  return { ctx, visible, sections, events, reference, scoring };
}
