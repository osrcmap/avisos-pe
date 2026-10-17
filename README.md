# avisos-pe

Avisos del **SENAMHI** (Perú) en formatos que una máquina puede usar: JSON, GeoJSON y **CAP 1.2**, más un CLI *agent-first* que responde:

> ¿Qué avisos cubren este punto, hoy y en los próximos días?

Cubre los **avisos meteorológicos nacionales** (lluvias, vientos, temperaturas, con niveles amarillo, naranja y rojo por día) y el **aviso de corto plazo ante posible activación de quebradas** (huaicos). Es la segunda pieza del conjunto para El Niño 2026-2027, junto a [`peligros-pe`](https://github.com/osrcmap/peligros-pe).

> **Reproduce avisos oficiales sin modificar su nivel, vigencia ni zonas. No es una orden de evacuación.** Que no haya avisos para un punto no garantiza que no ocurran lluvias intensas o huaicos. Sigue a INDECI, SENAMHI y tu municipalidad.

## Uso

```bash
npm i -g @osrcmap/avisos-pe            # o: npx @osrcmap/avisos-pe ...

avisos-pe punto --lat -5.0104 --lon -79.2468      # ¿qué avisos cubren este punto?
avisos-pe vigentes                                 # todos los avisos activos
avisos-pe aviso 421                                # descripción oficial y provincias
avisos-pe aviso 421 --geojson > aviso-421.geojson  # polígonos por día y nivel
avisos-pe cap 421 > aviso-421.cap.xml              # CAP 1.2
avisos-pe cap quebradas                            # aviso de quebradas en CAP
avisos-pe punto --lat -11.94 --lon -76.70 --momento 2026-10-19T15:00-05:00
```

```text
Avisos del SENAMHI para (-5.01039, -79.24678) al 2026-10-17 04:08 (hora de Perú)
● 421-2026 PRECIPITACIONES EN LA SIERRA NORTE Y COSTA NORTE
    2026-10-17: nivel AMARILLO (en curso)
    2026-10-18: nivel NARANJA (proximo)
    2026-10-19: nivel AMARILLO (proximo)
● Activación de quebradas 289-2026: nivel AMARILLO hasta 10-17 13:00 — EL CARMEN DE LA FRONTERA
    Ante el pronóstico de lluvias es probable la activación de quebradas de magnitud moderada ...
    Estar atentos a la información oficial y seguir las instrucciones de las autoridades competentes.
```

### Comandos

| Comando | Qué hace |
|---|---|
| `punto --lat --lon [--tipo] [--momento]` | Avisos cuyas zonas contienen el punto, día por día, con nivel y texto oficial del nivel. |
| `vigentes [--tipo] [--momento]` | Avisos que no han terminado, con los niveles de cada día y las zonas de quebradas. |
| `aviso <n> [--anio] [--geojson]` | Descripción oficial, niveles y provincias por día; o los polígonos en GeoJSON. |
| `cap <n\|quebradas> [--anio]` | El aviso en CAP 1.2 (XML), validado contra el esquema OASIS. |
| `schema [comando]` | JSON Schema de las entradas. |
| `doctor [--sin-red]` | Caché local y que las publicaciones del SENAMHI se puedan leer. |

- `--tipo`: `todos` (por defecto), `meteorologico` o `quebradas`.
- `--momento`: ISO 8601 **con zona horaria** (`2026-10-19T15:00-05:00`). Sirve para preguntar por mañana o por un momento pasado.
- `--sin-cache`: las respuestas del SENAMHI se guardan 10 minutos en `~/.cache/avisos-pe` para no saturarlo; este flag las ignora.
- Niveles: 1 verde, 2 amarillo, 3 naranja, 4 rojo. El nivel 1 ("no es necesario tomar precauciones especiales") **no se reporta como aviso**: el SENAMHI lo usa para el resto del territorio.

### Para agentes

- JSON por defecto cuando stdout no es una terminal (`--json` lo fuerza); `cap` siempre emite XML.
- `--params '{"lat":-12.05,"lon":-77.04}'` o `--params @consulta.json`.
- Errores en stdout: `{ "ok": false, "code", "error", "hint" }`. Salida `2` uso incorrecto, `1` fuente o internos.
- Siguientes pasos en stderr como NDJSON `{"type":"next-step", ...}`.
- Toda respuesta trae `datos.obtenido_en` (cuándo se consultó al SENAMHI) y `aviso`. **Muestra el aviso al usuario final.**
- Ver [`SKILL.md`](SKILL.md).

| Código | Cuándo | Qué significa |
|---|---|---|
| `FUENTE_NO_DISPONIBLE` | El SENAMHI no respondió | **No** se puede afirmar que no haya avisos |
| `FORMATO_INESPERADO` | El SENAMHI cambió su publicación | **No** se puede afirmar que no haya avisos |
| `FUERA_DE_COBERTURA` | Punto fuera del Perú | Casi siempre lat/lon invertidos |
| `NO_ENCONTRADO` | `aviso`/`cap` con un número que no existe | Revisa `--anio` |
| `ARGS_INVALIDOS`, `PARAMS_INVALIDOS` | Entrada mal formada | Ver `schema <comando>` |

Si el SENAMHI no publicó las zonas de algún día de un aviso, `punto` lo lista en `no_evaluables`: nunca se omite en silencio.

> **Ejecútalo desde el Perú.** senamhi.gob.pe no responde a conexiones desde servidores en el extranjero o en la nube (por ejemplo, GitHub Actions). Un bot debe correr en el Perú o salir por un proxy peruano.

## Cobertura

| Publicación del SENAMHI | Cubierta | Cómo |
|---|---|---|
| Avisos meteorológicos nacionales | Sí | Tabla de avisos + polígonos por día (GeoServer WFS) |
| Aviso de corto plazo ante posible activación de quebradas | Sí, el vigente | Página del aviso + polígonos por distrito (WFS) |
| Avisos hidrológicos | No | Pendiente ([RESEARCH.md](RESEARCH.md)) |
| Avisos de las direcciones zonales | No | Pendiente |
| CAP oficial | No existe | `avisos-pe cap` genera una reproducción no oficial |

Detalles y riesgos en [`LIMITATIONS.md`](LIMITATIONS.md). Cómo funciona cada fuente, en [`RESEARCH.md`](RESEARCH.md).

## Desarrollo

```bash
bun install
bun test                   # con fixtures reales y un servidor local que imita al SENAMHI
bun run typecheck && bun run lint
bun run build              # dist/cli.js (Node >= 20)
node scripts/humo.mjs      # prueba de humo del paquete compilado, sin red
```

Variables `AVISOS_PE_BASE_WEB` y `AVISOS_PE_BASE_GEO` cambian las URLs base (pruebas o espejos).

Bloques de [cligentic](https://github.com/Railly/cligentic) (MIT) copiados en `src/agent`, `src/foundation` y `src/platform`.

## Licencia

Código: MIT. Los avisos son del SENAMHI; atribúyelos siempre al SENAMHI y enlaza el aviso original (`url` en cada respuesta).
