// Construye la PWA en dist/:
// - copia la app de src/,
// - junta todos los juegos de games/ en dist/games.json (ordenados por nombre),
// - pone en el service worker una versión nueva para que los móviles detecten la actualización.
// Para ocultar un juego sin borrarlo, añade su fichero a EXCLUDE.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const EXCLUDE = [];
const SRC = 'src', OUT = 'dist';

fs.rmSync(OUT, { recursive: true, force: true });
fs.cpSync(SRC, OUT, { recursive: true });

const files = fs.readdirSync('games').filter(f => f.endsWith('.json') && !EXCLUDE.includes(f));
const strip = name => name.replace(/^[¡¿]/, '');
const games = files.map(f => JSON.parse(fs.readFileSync(path.join('games', f), 'utf8')))
  .sort((a, b) => strip(a.name).localeCompare(strip(b.name), 'es'));
fs.writeFileSync(path.join(OUT, 'games.json'), JSON.stringify(games));

// Ficheros de la app que se guardan para funcionar sin conexión.
const walk = d => fs.readdirSync(d, { withFileTypes: true })
  .flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
const shell = walk(OUT)
  .map(f => path.relative(OUT, f).split(path.sep).join('/'))
  .filter(f => f !== 'sw.js')
  .sort();
const shellList = ['./', ...shell.map(f => './' + f)];

const hash = crypto.createHash('sha256');
for (const f of shell) hash.update(f).update(fs.readFileSync(path.join(OUT, f)));
const version = hash.digest('hex').slice(0, 12);

// La versión visible en la app: fecha de publicación + hash corto.
const stamp = new Date().toISOString().slice(0, 10).replaceAll('-', '');
const appVersion = `${stamp}-${version.slice(0, 6)}`;
const idx = path.join(OUT, 'index.html');
fs.writeFileSync(idx, fs.readFileSync(idx, 'utf8').replace('__APP_VERSION__', appVersion));

const swPath = path.join(OUT, 'sw.js');
fs.writeFileSync(swPath, fs.readFileSync(swPath, 'utf8')
  .replace('__VERSION__', version)
  .replace('__SHELL__', JSON.stringify(shellList)));

console.log(`ok · versión ${appVersion} · ${games.length} juegos: ${games.map(g => g.name).join(', ')}`);
