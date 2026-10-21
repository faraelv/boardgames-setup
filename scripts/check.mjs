// Valida cada juego de games/ contra el esquema y genera la guía para TODAS las
// combinaciones de respuestas, para detectar variables mal escritas o condiciones rotas.
// Uso: npm run check   (falla con código 1 si algo no cuadra; lo ejecuta también GitHub)
import fs from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { generateGuide, buildContext } from '../src/engine.js';

const schema = JSON.parse(fs.readFileSync(new URL('../schema/game.schema.json', import.meta.url)));
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(schema);

const dir = new URL('../games/', import.meta.url);
const ids = new Map();
let failed = false;
const fail = msg => { failed = true; console.log('✗ ' + msg); };

for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort()) {
  let game;
  try { game = JSON.parse(fs.readFileSync(new URL(file, dir))); }
  catch (e) { fail(`${file}: JSON mal formado (${e.message})`); continue; }

  if (!validate(game)) { fail(`${file} no cumple el esquema:\n${JSON.stringify(validate.errors, null, 2)}`); continue; }
  if (ids.has(game.id)) fail(`${file}: el id "${game.id}" ya lo usa ${ids.get(game.id)}`);
  ids.set(game.id, file);

  const domains = (game.options ?? []).map(o =>
    o.type === 'boolean' ? [true, false] : o.type === 'choice' ? o.choices.map(c => c.value) : [o.default]);
  let combos = [[]];
  for (const d of domains) combos = combos.flatMap(c => d.map(v => [...c, v]));
  const seen = new Set();
  let count = 0;
  for (let p = game.players.min; p <= game.players.max; p++) {
    for (const combo of combos) {
      const answers = { players: p };
      (game.options ?? []).forEach((o, i) => (answers[o.id] = combo[i]));
      try {
        const key = JSON.stringify(buildContext(game, answers).ctx);
        if (seen.has(key)) continue;
        seen.add(key);
        generateGuide(game, answers);
        count++;
      } catch (e) {
        fail(`${file} con ${JSON.stringify(answers)}: ${e.message}`);
      }
    }
  }
  console.log(`✓ ${file}: ${count} configuraciones`);
}
process.exit(failed ? 1 : 0);
