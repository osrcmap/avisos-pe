import { accessSync, constants, mkdirSync, readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { z } from "zod";
import pkg from "../package.json" with { type: "json" };
import { renderDoctor, runDoctor } from "./agent/doctor.js";
import { detectMode, type EmitOptions, emit } from "./agent/json-mode.js";
import { emitNextSteps, type NextStep } from "./agent/next-steps.js";
import {
  type AvisoConDias,
  diasSinPoligonos,
  enPeru,
  evaluarPunto,
  evaluarQuebradas,
  type Quebradas,
  resumen,
  resumenQuebradas,
} from "./avisos.js";
import { capMeteorologico, capQuebradas } from "./cap.js";
import { ERRORES, exitCode, fallo } from "./errores.js";
import { AppError } from "./foundation/error-map.js";
import { DIR_CACHE, enParalelo, type OpcionesHttp, pedir } from "./http.js";
import {
  type AvisoListado,
  activos,
  descripcion,
  dias,
  leerLista,
  NIVELES,
  type Nivel,
  provincias,
  quebradas,
  URL_LISTA,
  URL_QUEBRADAS,
  URL_QUEBRADAS_WFS,
} from "./senamhi.js";
import { fechaLima, isoLima } from "./tiempo.js";

/** Segundos de caché por defecto: los avisos cambian a lo más unas veces al día. */
const CACHE_SEGUNDOS = 600;

const AVISO = [
  "Avisos oficiales del SENAMHI reproducidos sin modificar su nivel, vigencia ni zonas. No es una orden de evacuación.",
  "Las zonas de aviso son regionales: indican dónde se esperan las condiciones, no la intensidad en cada calle.",
  "Que no haya avisos para un punto no garantiza que no ocurran lluvias intensas o huaicos.",
  "Ante una emergencia sigue las indicaciones de INDECI, SENAMHI y tu municipalidad.",
];

// ---------- Entradas ----------

const aNumero = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? Number(v) : v);

const momento = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/,
    "ISO 8601 con zona horaria, p. ej. 2026-10-18T15:00-05:00",
  )
  .optional()
  .describe("Momento a evaluar (por defecto, ahora). Debe incluir la zona horaria: 2026-10-18T15:00-05:00");
const tipo = z.enum(["todos", "meteorologico", "quebradas"]).default("todos");
const sinCache = z
  .boolean()
  .default(false)
  .describe("Ignorar la caché local (10 min) y consultar al SENAMHI");

const ENTRADAS = {
  vigentes: z.strictObject({ tipo, momento, "sin-cache": sinCache }),
  punto: z.strictObject({
    lat: z.preprocess(aNumero, z.number().min(-90).max(90)).describe("Latitud WGS84 (Perú: -18.5 a 0.1)"),
    lon: z
      .preprocess(aNumero, z.number().min(-180).max(180))
      .describe("Longitud WGS84 (Perú: -81.5 a -68.5)"),
    tipo,
    momento,
    "sin-cache": sinCache,
  }),
  aviso: z.strictObject({
    numero: z.preprocess(aNumero, z.number().int().positive()).describe("Número del aviso meteorológico"),
    anio: z
      .preprocess(aNumero, z.number().int().min(2021).optional())
      .describe("Año del aviso (por defecto, el actual)"),
    geojson: z.boolean().default(false).describe("Emitir los polígonos como GeoJSON FeatureCollection"),
    "sin-cache": sinCache,
  }),
  cap: z.strictObject({
    numero: z
      .union([z.literal("quebradas"), z.preprocess(aNumero, z.number().int().positive())])
      .describe("Número del aviso meteorológico, o 'quebradas' para el aviso de activación de quebradas"),
    anio: z.preprocess(aNumero, z.number().int().min(2021).optional()),
    momento,
    "sin-cache": sinCache,
  }),
  schema: z.strictObject({
    comando: z.enum(["vigentes", "punto", "aviso", "cap", "schema", "doctor"]).optional(),
  }),
  doctor: z.strictObject({ "sin-red": z.boolean().default(false).describe("No consultar al SENAMHI") }),
};
type Comando = keyof typeof ENTRADAS;

const DESCRIPCIONES: Record<Comando, string> = {
  vigentes:
    "Avisos meteorológicos y de activación de quebradas que no han terminado, con sus niveles por día.",
  punto: "Avisos que cubren un punto (lat, lon), día por día, con su nivel.",
  aviso:
    "Detalle de un aviso meteorológico: descripción, niveles por día y provincias; o sus polígonos en GeoJSON.",
  cap: "Aviso en formato CAP 1.2 (XML). Reproducción no oficial: el SENAMHI no publica CAP.",
  schema: "Describe entradas y salidas de un comando (JSON Schema).",
  doctor: "Revisa la caché local y que las publicaciones del SENAMHI se puedan leer.",
};

const SALIDAS: Record<Comando, string> = {
  vigentes:
    "{ ok, momento, meteorologicos: Aviso[] (dias: { mapa, fecha, inicio, fin, estado, niveles[], sin_poligonos }), quebradas: AvisoQuebradas | null, datos, aviso }",
  punto:
    "{ ok, consulta, resumen: { nivel_maximo_en_curso, nivel_maximo_proximo, avisos }, meteorologicos: Aviso[] (dias: { fecha, inicio, fin, estado, nivel, color, texto_nivel }), quebradas: AvisoQuebradas | null (zonas que contienen el punto), no_evaluables: { numero, anio, motivo }[], datos, aviso }",
  aviso: "{ ok, aviso: Aviso + descripcion + dias[].provincias } o, con --geojson, un FeatureCollection",
  cap: "XML CAP 1.2 (urn:oasis:names:tc:emergency:cap:1.2). Un <info> por día y nivel >= 2.",
  schema: "{ ok, comandos } o { ok, comando, descripcion, entrada, salida }",
  doctor: "{ ok, checks: { name, ok, detail }[] }",
};

// ---------- Utilidades ----------

function leerParams(v: string | undefined): Record<string, unknown> {
  if (!v) return {};
  let p: unknown;
  try {
    p = JSON.parse(v.startsWith("@") ? readFileSync(v.slice(1), "utf8") : v);
  } catch (e) {
    throw fallo("PARAMS_INVALIDOS", `No se pudo leer --params ${v}.`, e);
  }
  if (!p || typeof p !== "object" || Array.isArray(p))
    throw fallo("PARAMS_INVALIDOS", "--params debe ser un objeto JSON.");
  return p as Record<string, unknown>;
}

/** Las coordenadas del Perú son negativas y parseArgs toma "-12.05" como otra opción. */
export function unirNegativos(argv: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--") && !a.includes("=") && /^-\d/.test(argv[i + 1] ?? ""))
      out.push(`${a}=${argv[++i]}`);
    else out.push(a);
  }
  return out;
}

const http = (e: { "sin-cache"?: boolean }): OpcionesHttp => ({
  cacheSegundos: e["sin-cache"] ? 0 : CACHE_SEGUNDOS,
});
const ahora = (e: { momento?: string }) => (e.momento ? Date.parse(e.momento) : Date.now());

/** Procedencia: la consulta más antigua usada (puede venir de caché). */
function datos(obtenido: string[]) {
  return {
    fuente: "SENAMHI – senamhi.gob.pe e idesep.senamhi.gob.pe",
    url_avisos: URL_LISTA,
    url_quebradas: URL_QUEBRADAS,
    obtenido_en: obtenido.length ? obtenido.sort()[0] : null,
  };
}

async function lista(o: OpcionesHttp) {
  const r = await pedir(URL_LISTA, o);
  return { ...leerLista(r.cuerpo), obtenido_en: r.obtenido_en };
}

async function meteorologicosActivos(m: number, o: OpcionesHttp) {
  const l = await lista(o);
  const obtenido = [l.obtenido_en];
  const avisos: AvisoConDias[] = await enParalelo(activos(l.avisos, m), 2, async (a) => {
    const r = await dias(a, o);
    obtenido.push(...r.obtenido_en);
    return { ...a, dias: r.dias };
  });
  return { avisos, obtenido };
}

function buscar(avisos: AvisoListado[], numero: number, anio: number) {
  const a = avisos.find((x) => x.numero === numero && x.anio === anio);
  if (!a) {
    throw fallo("NO_ENCONTRADO", `No existe el aviso ${numero}-${anio} en la lista del SENAMHI.`);
  }
  return a;
}

const fechaCorta = (iso: string) => isoLima(Date.parse(iso)).slice(5, 16).replace("T", " ");

type Resultado = {
  valor: unknown;
  pasos?: NextStep[];
  humano?: () => void;
  fallido?: boolean;
  /** Texto crudo para stdout (CAP XML), en lugar de JSON. */
  crudo?: string;
};

// ---------- Comandos ----------

async function cmdVigentes(e: z.infer<typeof ENTRADAS.vigentes>): Promise<Resultado> {
  const m = ahora(e);
  const o = http(e);
  const obtenido: string[] = [];
  let met: ReturnType<typeof resumen>[] | null = null;
  let q: ReturnType<typeof resumenQuebradas> | null = null;
  if (e.tipo !== "quebradas") {
    const r = await meteorologicosActivos(m, o);
    obtenido.push(...r.obtenido);
    met = r.avisos.map((a) => resumen(a, m)).filter((a) => a.dias.some((d) => d.estado !== "terminado"));
  }
  if (e.tipo !== "meteorologico") {
    const r = await quebradas(o);
    obtenido.push(...r.obtenido_en);
    q = resumenQuebradas(r, m);
  }
  const valor = {
    ok: true,
    momento: isoLima(m),
    meteorologicos: met,
    quebradas: q && q.estado !== "terminado" ? q : null,
    ultimo_aviso_quebradas: q ? { numero: q.numero, anio: q.anio, fin: q.fin, estado: q.estado } : null,
    datos: datos(obtenido),
    aviso: AVISO,
  };
  const pasos: NextStep[] = (met ?? []).slice(0, 1).map((a) => ({
    command: `avisos-pe aviso ${a.numero} --anio ${a.anio}`,
    description: "Descripción y provincias del aviso",
  }));
  pasos.push({
    command: "avisos-pe punto --lat <lat> --lon <lon>",
    description: "Qué avisos cubren una ubicación",
  });
  const humano = () => {
    const out = [`Avisos del SENAMHI al ${isoLima(m).slice(0, 16).replace("T", " ")} (hora de Perú)`];
    for (const a of met ?? []) {
      out.push(`● ${a.numero}-${a.anio} ${a.titulo} — máximo ${a.color_aviso}`);
      out.push(
        `    ${a.dias
          .map(
            (d) =>
              `${d.fecha.slice(5)}: ${d.niveles.map((n) => NIVELES[n].color).join("/") || "sin zonas"} (${d.estado.replace("_", " ")})`,
          )
          .join(" · ")}`,
      );
    }
    if (met && !met.length) out.push("Sin avisos meteorológicos activos.");
    if (valor.quebradas) {
      const qq = valor.quebradas;
      out.push(
        `● Activación de quebradas ${qq.numero}-${qq.anio}: nivel ${qq.color}, hasta ${fechaCorta(qq.fin)}`,
      );
      out.push(
        `    ${[...new Set(qq.zonas.map((z) => `${z.distrito} (${z.provincia}, ${z.departamento})`))].join("; ")}`,
      );
    } else if (e.tipo !== "meteorologico") out.push("Sin aviso de activación de quebradas vigente.");
    for (const a of AVISO) out.push(`! ${a}`);
    process.stdout.write(`${out.join("\n")}\n`);
  };
  return { valor, pasos, humano };
}

async function cmdPunto(e: z.infer<typeof ENTRADAS.punto>): Promise<Resultado> {
  if (!enPeru(e.lon, e.lat)) throw fallo("FUERA_DE_COBERTURA", `(${e.lat}, ${e.lon}) está fuera del Perú.`);
  const m = ahora(e);
  const o = http(e);
  const obtenido: string[] = [];
  const met: NonNullable<ReturnType<typeof evaluarPunto>>[] = [];
  const noEvaluables: { numero: number; anio: number; motivo: string }[] = [];
  let q: ReturnType<typeof evaluarQuebradas> = null;

  if (e.tipo !== "quebradas") {
    const r = await meteorologicosActivos(m, o);
    obtenido.push(...r.obtenido);
    for (const a of r.avisos) {
      const faltan = diasSinPoligonos(a, m);
      if (faltan.length) {
        noEvaluables.push({
          numero: a.numero,
          anio: a.anio,
          motivo: `El SENAMHI no publicó zonas para ${faltan.map((d) => d.fecha).join(", ")}`,
        });
      }
      const ev = evaluarPunto(a, e.lat, e.lon, m);
      if (ev) met.push(ev);
    }
  }
  if (e.tipo !== "meteorologico") {
    const r: Quebradas & { obtenido_en: string[] } = await quebradas(o);
    obtenido.push(...r.obtenido_en);
    q = evaluarQuebradas(r, e.lat, e.lon, m);
  }

  const niveles = (estadoBuscado: string) => [
    ...met.flatMap((a) => a.dias.filter((d) => d.estado === estadoBuscado).map((d) => d.nivel)),
    ...(q && q.estado === estadoBuscado ? q.zonas.map((z) => z.nivel) : []),
  ];
  const maximo = (ns: number[]) => (ns.length ? Math.max(...ns) : null);
  const valor = {
    ok: true,
    consulta: { lat: e.lat, lon: e.lon, momento: isoLima(m), tipo: e.tipo },
    resumen: {
      nivel_maximo_en_curso: maximo(niveles("en_curso")),
      nivel_maximo_proximo: maximo(niveles("proximo")),
      avisos: met.length + (q ? 1 : 0),
    },
    meteorologicos: met,
    quebradas: q,
    no_evaluables: noEvaluables,
    datos: datos(obtenido),
    aviso: AVISO,
  };
  const pasos: NextStep[] = met.map((a) => ({
    command: `avisos-pe aviso ${a.numero} --anio ${a.anio}`,
    description: "Descripción oficial del aviso",
  }));
  const humano = () => {
    const out = [
      `Avisos del SENAMHI para (${e.lat}, ${e.lon}) al ${isoLima(m).slice(0, 16).replace("T", " ")} (hora de Perú)`,
    ];
    const niveles = new Set<number>();
    for (const a of met) {
      out.push(`● ${a.numero}-${a.anio} ${a.titulo}`);
      for (const d of a.dias) {
        out.push(`    ${d.fecha}: nivel ${d.color.toUpperCase()} (${d.estado.replace("_", " ")})`);
        niveles.add(d.nivel);
      }
    }
    if (q) {
      for (const z of q.zonas) {
        out.push(
          `● Activación de quebradas ${q.numero}-${q.anio}: nivel ${z.color.toUpperCase()} hasta ${fechaCorta(q.fin)} — ${z.distrito}`,
        );
        if (z.descripcion) out.push(`    ${z.descripcion}`);
        if (z.recomendacion) out.push(`    ${z.recomendacion}`);
      }
    }
    if (!met.length && !q) out.push("Ningún aviso vigente o próximo cubre este punto.");
    for (const n of [...niveles].sort())
      out.push(`  ${NIVELES[n as Nivel].color.toUpperCase()}: ${NIVELES[n as Nivel].texto}`);
    for (const n of noEvaluables)
      out.push(`⚠ No se pudo evaluar el aviso ${n.numero}-${n.anio}: ${n.motivo}.`);
    out.push("", `Fuente: SENAMHI. Consultado: ${valor.datos.obtenido_en ?? "-"}.`);
    for (const a of AVISO) out.push(`! ${a}`);
    process.stdout.write(`${out.join("\n")}\n`);
  };
  return { valor, pasos, humano };
}

async function cmdAviso(e: z.infer<typeof ENTRADAS.aviso>): Promise<Resultado> {
  const o = http(e);
  const anio = e.anio ?? Number(fechaLima(Date.now()).slice(0, 4));
  const l = await lista(o);
  const a = buscar(l.avisos, e.numero, anio);
  const d = await dias(a, o);
  if (e.geojson) {
    const features = d.dias.flatMap((dia) =>
      dia.poligonos.map((p) => ({
        type: "Feature",
        geometry: p.geometry,
        properties: {
          numero: a.numero,
          anio: a.anio,
          titulo: a.titulo,
          mapa: dia.mapa,
          fecha: dia.fecha,
          nivel: p.nivel,
          color: NIVELES[p.nivel].color,
          inicio: p.inicio,
          fin: p.fin,
          fuente: a.url,
        },
      })),
    );
    return { valor: { type: "FeatureCollection", features } };
  }
  const conDias = { ...a, dias: d.dias };
  const r = resumen(conDias, Date.now());
  const [desc, provs] = await Promise.all([
    descripcion(a, o),
    enParalelo(d.dias, 3, (dia) => provincias(a, dia.mapa, o)),
  ]);
  const valor = {
    ok: true,
    aviso: { ...r, descripcion: desc, dias: r.dias.map((dia, i) => ({ ...dia, provincias: provs[i] })) },
    datos: datos([l.obtenido_en, ...d.obtenido_en]),
    aviso_legal: AVISO,
  };
  const pasos: NextStep[] = [
    {
      command: `avisos-pe cap ${a.numero} --anio ${a.anio}`,
      description: "El aviso en formato CAP 1.2",
      optional: true,
    },
    {
      command: `avisos-pe aviso ${a.numero} --anio ${a.anio} --geojson`,
      description: "Polígonos en GeoJSON",
      optional: true,
    },
  ];
  return { valor, pasos };
}

async function cmdCap(e: z.infer<typeof ENTRADAS.cap>): Promise<Resultado> {
  const o = http(e);
  const m = ahora(e);
  if (e.numero === "quebradas") return { valor: null, crudo: capQuebradas(await quebradas(o), m) };
  const anio = e.anio ?? Number(fechaLima(m).slice(0, 4));
  const a = buscar((await lista(o)).avisos, e.numero, anio);
  const [d, desc] = await Promise.all([dias(a, o), descripcion(a, o)]);
  return { valor: null, crudo: capMeteorologico({ ...a, dias: d.dias }, desc, m) };
}

function cmdSchema(e: z.infer<typeof ENTRADAS.schema>): Resultado {
  if (!e.comando) {
    return {
      valor: {
        ok: true,
        comandos: Object.entries(DESCRIPCIONES).map(([nombre, descripcion]) => ({ nombre, descripcion })),
        niveles: Object.fromEntries(Object.entries(NIVELES).map(([n, v]) => [n, v])),
        flags_globales: {
          "--json": "Fuerza salida JSON (por defecto cuando stdout no es una terminal).",
          "--params": "Entrada como objeto JSON en línea o @archivo.json.",
        },
      },
    };
  }
  const c = e.comando;
  return {
    valor: {
      ok: true,
      comando: c,
      descripcion: DESCRIPCIONES[c],
      entrada: z.toJSONSchema(ENTRADAS[c], { io: "input" }),
      salida: SALIDAS[c],
    },
  };
}

/** Un chequeo de doctor que conserva su nombre aunque falle (runDoctor lo llamaría "unknown"). */
const chequeo = (name: string, fn: () => Promise<{ ok: boolean; detail: string }>) => async () => {
  try {
    return { name, ...(await fn()) };
  } catch (err) {
    return { name, ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
};

async function cmdDoctor(e: z.infer<typeof ENTRADAS.doctor>): Promise<Resultado> {
  const o: OpcionesHttp = { cacheSegundos: 0, intentos: 1, timeoutMs: 30_000 };
  const checks = [
    chequeo("cache", async () => {
      try {
        mkdirSync(DIR_CACHE, { recursive: true });
        accessSync(DIR_CACHE, constants.W_OK);
        return { ok: true, detail: DIR_CACHE };
      } catch (err) {
        return { ok: true, detail: `sin caché (${(err as Error).message}); se consultará siempre` };
      }
    }),
  ];
  if (!e["sin-red"]) {
    let primero: AvisoListado | undefined;
    checks.push(
      chequeo("lista", async () => {
        const l = await lista(o);
        const act = activos(l.avisos, Date.now());
        primero = act[0] ?? l.avisos[0];
        return {
          ok: true,
          detail: `${l.avisos.length} avisos leídos (${act.length} activos, ${l.descartadas} filas antiguas ilegibles)`,
        };
      }),
      // GeoServer por separado: si falla solo uno de los dos servidores, se ve cuál.
      chequeo("geoserver", async () => {
        const r = await pedir(URL_QUEBRADAS_WFS, o);
        return { ok: true, detail: `idesep.senamhi.gob.pe responde (${r.cuerpo.length} bytes)` };
      }),
      chequeo("zonas", async () => {
        if (!primero) return { ok: false, detail: "sin avisos para probar (falló la lista)" };
        const d = await dias(primero, o);
        const n = d.dias.reduce((s, x) => s + x.poligonos.length, 0);
        return {
          ok: n > 0,
          detail: `aviso ${primero.numero}-${primero.anio}: ${n} polígonos en ${d.dias.length} días`,
        };
      }),
      chequeo("quebradas", async () => {
        const q = await quebradas(o);
        const c = q.cabecera;
        return {
          ok: true,
          detail: `aviso ${c.numero}-${c.anio}, nivel ${NIVELES[c.nivel].color}, ${q.zonas.length} zonas, hasta ${isoLima(Date.parse(c.fin))}`,
        };
      }),
    );
  }
  const r = await runDoctor(checks);
  const pasos: NextStep[] = r.ok
    ? []
    : [
        {
          command: "curl -I https://www.senamhi.gob.pe",
          description: "El SENAMHI no responde a muchas conexiones desde fuera del Perú o desde la nube",
          optional: true,
        },
      ];
  return { valor: r, pasos, fallido: !r.ok };
}

// ---------- Main ----------

const AYUDA = `avisos-pe ${pkg.version} — avisos del SENAMHI (Perú): meteorológicos y de activación de quebradas

Uso:
  avisos-pe vigentes [--tipo todos|meteorologico|quebradas] [--momento <ISO>]
  avisos-pe punto --lat -11.94 --lon -76.70 [--tipo ...] [--momento 2026-10-18T15:00-05:00]
  avisos-pe aviso <numero> [--anio 2026] [--geojson]
  avisos-pe cap <numero|quebradas> [--anio 2026]
  avisos-pe schema [comando]
  avisos-pe doctor [--sin-red]

Flags globales:
  --json             salida JSON (por defecto si stdout no es una terminal)
  --params <json>    entrada como objeto JSON o @archivo.json
  --sin-cache        consultar al SENAMHI aunque haya caché reciente (10 min)
  -h, --help         esta ayuda
  --version

Niveles: 1 verde, 2 amarillo, 3 naranja, 4 rojo.
Reproduce avisos oficiales; no es una orden de evacuación.
`;

function parsear(argv: string[]) {
  return parseArgs({
    args: unirNegativos(argv),
    allowPositionals: true,
    strict: true,
    options: {
      lat: { type: "string" },
      lon: { type: "string" },
      tipo: { type: "string" },
      momento: { type: "string" },
      anio: { type: "string" },
      geojson: { type: "boolean" },
      "sin-cache": { type: "boolean" },
      "sin-red": { type: "boolean" },
      json: { type: "boolean" },
      params: { type: "string" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean" },
    },
  });
}

async function main(argv: string[]) {
  let parsed: ReturnType<typeof parsear>;
  try {
    parsed = parsear(argv);
  } catch (err) {
    throw fallo("ARGS_INVALIDOS", err instanceof Error ? err.message : String(err), err);
  }
  const { values, positionals } = parsed;
  const opts: EmitOptions = { json: values.json };

  if (values.version) return emit({ ok: true, version: pkg.version }, opts, (v) => console.log(v.version));
  const comando = positionals[0];
  if (values.help || !comando) return void process.stdout.write(AYUDA);
  if (!(comando in ENTRADAS)) throw fallo("COMANDO_DESCONOCIDO", `Comando desconocido: ${comando}.`);
  const cmd = comando as Comando;

  const { json: _j, params, help: _h, version: _v, ...flags } = values;
  const crudo: Record<string, unknown> = { ...leerParams(params) };
  for (const [k, v] of Object.entries(flags)) if (v !== undefined) crudo[k] = v;
  const posicional: Partial<Record<Comando, string>> = { aviso: "numero", cap: "numero", schema: "comando" };
  if (positionals[1] !== undefined) {
    if (!posicional[cmd] || positionals.length > 2) {
      throw fallo("ARGS_INVALIDOS", `Argumentos de más: ${positionals.slice(1).join(" ")}`);
    }
    crudo[posicional[cmd] as string] = positionals[1];
  }

  const entrada = ENTRADAS[cmd].safeParse(crudo);
  if (!entrada.success) throw fallo("ARGS_INVALIDOS", z.prettifyError(entrada.error));
  const e: any = entrada.data;

  const r: Resultado =
    cmd === "vigentes"
      ? await cmdVigentes(e)
      : cmd === "punto"
        ? await cmdPunto(e)
        : cmd === "aviso"
          ? await cmdAviso(e)
          : cmd === "cap"
            ? await cmdCap(e)
            : cmd === "schema"
              ? cmdSchema(e)
              : await cmdDoctor(e);

  if (r.crudo !== undefined) process.stdout.write(r.crudo.endsWith("\n") ? r.crudo : `${r.crudo}\n`);
  else if (cmd === "doctor") renderDoctor(r.valor as any, opts);
  else emit(r.valor, opts, r.humano ? () => r.humano?.() : undefined);
  emitNextSteps(r.pasos ?? [], opts);
  if (r.fallido) process.exitCode = 1;
}

/** Punto de entrada (lo llama src/bin.ts). Nunca lanza: todo error sale estructurado con su exit code. */
export async function ejecutar(argv: string[]): Promise<void> {
  try {
    await main(argv);
  } catch (err: unknown) {
    const appErr =
      err instanceof AppError
        ? err
        : new AppError(
            "ERROR_INTERNO",
            { ...ERRORES.ERROR_INTERNO, human: err instanceof Error ? err.message : String(err) },
            err,
          );
    if (detectMode({ json: argv.includes("--json") }) === "json") {
      process.stdout.write(`${JSON.stringify(appErr.toJSON())}\n`);
    } else {
      process.stderr.write(`✗ ${appErr.human}\n${appErr.hint ? `  ${appErr.hint}\n` : ""}`);
    }
    process.exitCode = exitCode(appErr.code);
  }
}
