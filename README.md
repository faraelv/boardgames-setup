# Mesa Lista

PWA que guía la preparación de nuestros juegos de mesa según el número de jugadores, las expansiones y el modo de juego.

**App:** https://faraelv.github.io/boardgames-setup/

- Funciona sin conexión una vez instalada.
- Grupo de jugadores guardado en el móvil, con selector de «¿Quién juega?» y sorteo del orden.
- Lista de pasos con casillas, progreso, sorteos y preparaciones a mitad de partida (por ejemplo, al descubrir una especie en SETI).

## Instalar en el móvil

1. Abre la dirección de la app en **Chrome** (Android).
2. Menú ⋮ → **Instalar app** (o *Añadir a pantalla de inicio*).
3. Cuando haya una versión nueva, la app muestra un aviso: pulsa **Actualizar**.

## Estructura

| Carpeta | Contenido |
|---|---|
| `games/` | Un JSON por juego. **Es lo único que hay que tocar para añadir o corregir juegos.** |
| `schema/game.schema.json` | Formato que debe cumplir cada juego. |
| `src/` | La app: `index.html`, `app.js` (interfaz), `engine.js` (motor), `sw.js` (modo sin conexión), manifest e iconos. |
| `scripts/check.mjs` | Valida todos los juegos y genera la guía para todas las combinaciones de respuestas. |
| `scripts/build.mjs` | Construye `dist/`: copia la app, junta los juegos en `games.json` y versiona el service worker. |
| `.github/workflows/deploy.yml` | En cada push a `main`: valida, construye y publica en GitHub Pages. |

## Añadir un juego

1. Crea `games/<nombre-con-guiones>.json` a partir del manual del juego (mira `seti.json`, `heat.json` o `puerto-rico.json` como ejemplo).
2. `npm run check` — tiene que salir ✓ en todos los juegos.
3. Haz commit y push a `main`. GitHub valida y publica solo; los móviles reciben el juego la próxima vez que abren la app con conexión.

Si la validación falla, GitHub no publica nada y la app sigue como estaba.

Para ocultar un juego sin borrarlo, añádelo a `EXCLUDE` en `scripts/build.mjs`.

### Formato en resumen

- `players`: `{ "min", "max", "default" }`. Crea la variable `players`.
- `options`: preguntas previas (`boolean` o `choice`). Con `when` solo aparecen si aplican.
- `vars`: valores derivados por casos; el primero cuyo `when` se cumple gana. Se usan en textos como `{nombre}`.
- `sections` → `steps`: `text`, `who` (`table`, `eachPlayer`, `rival`, `firstPlayer`), `when`, `components`, `tip`, `warning`, `link`, `randomizer` (`firstPlayer`, `pick`, `dice`) y `substeps`.
- `events`: preparaciones durante la partida (se muestran aparte, en «Durante la partida»).
- Condiciones: `is`, `eq`, `in`, `gte`, `lte`, combinadas con `all`, `any` y `not`.
- Textos en español, **redactados con palabras propias** (no copiados del manual). Indica de dónde sale cada juego en `sources`.

## Desarrollo local

```bash
npm install
npm run check      # validar juegos
npm run serve      # construir y servir en http://localhost:4173
```

## Pendientes conocidos

- **SETI**: confirmar la composición de objetivos del Rival en las dificultades 2, 3 y 5.
- **Arquitectos**: valores de la cara 2 y solitario tomados de un resumen de reglas; confirmar con la caja.
- **Saboteur**: la guía es del Saboteur original (3–10 jugadores).
- **Faraway**: rango 2–6 jugadores asumido.
