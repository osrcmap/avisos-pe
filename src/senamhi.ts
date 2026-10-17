// Lectura de las publicaciones del SENAMHI: tabla de avisos (HTML), polígonos (GeoServer WFS)
// y aviso de activación de quebradas. Ver RESEARCH.md.
import * as cheerio from "cheerio";
import { z } from "zod";
import { fallo } from "./errores.js";
import { enParalelo, type OpcionesHttp, pedir, pedirJson } from "./http.js";
import { diasIncluidos, fechaLima, inicioDiaLima } from "./tiempo.js";

// Sobrescribibles para pruebas o espejos.
export const BASE_WEB = process.env.AVISOS_PE_BASE_WEB || "https://www.senamhi.gob.pe";
export const BASE_GEO = process.env.AVISOS_PE_BASE_GEO || "https://idesep.senamhi.gob.pe";

export const URL_LISTA = `${BASE_WEB}/?p=aviso-meteorologico`;
export const URL_QUEBRADAS = `${BASE_WEB}/main.php?dp=lima&p=aviso-activacion-quebrada`;
export const urlDetalle = (anio: number, idWeb: number) =>
  `${BASE_WEB}/?p=aviso-meteorologico-detalle&a=${anio}&b=${idWeb}&c=00&d=SENA`;

const wfs = (espacio: string, capa: string, extra = "") =>
  `${BASE_GEO}/geoserver/${espacio}/ows?service=WFS&version=2.0.0&request=GetFeature&typeNames=${espacio}:${capa}&outputFormat=application/json&srsName=EPSG:4326${extra}`;
export const urlMapa = (numero: number, mapa: number, anio: number) =>
  wfs("g_aviso", "view_aviso", `&viewparams=qry:${numero}_${mapa}_${anio}`);
export const urlProvincias = (numero: number, mapa: number, anio: number) =>
  wfs("g_aviso", "view_aviso_aux", `&viewparams=qry:${numero}_${mapa}_${anio}`);
export const URL_QUEBRADAS_WFS = wfs("g_acti_quebrada", "view_av_activ_qdra");

export const NIVELES = {
  1: { color: "verde", texto: "No es necesario tomar precauciones especiales." },
  2: {
    color: "amarillo",
    texto:
      "Peligro: Pueden ocurrir fenómenos meteorológicos peligrosos que, sin embargo, son normales en esta región. Recomendación: Manténgase al corriente del desarrollo de la situación meteorológica. Sea prudente si realiza actividades al aire libre que puedan acarrear riesgos en caso de mal tiempo.",
  },
  3: {
    color: "naranja",
    texto:
      "Peligro: Se predicen fenómenos meteorológicos peligrosos. Recomendación: Manténgase al corriente del desarrollo de la situación y cumpla los consejos e instrucciones dados por las autoridades.",
  },
  4: {
    color: "rojo",
    texto:
      "Peligro: Se predicen fenómenos meteorológicos de gran magnitud. Recomendación: Sea extremadamente precavido. Esté al corriente en todo momento del desarrollo de la situación y cumpla los consejos e instrucciones dados por las autoridades.",
  },
} as const;
export type Nivel = keyof typeof NIVELES;

const NIVEL_POR_COLOR: Record<string, Nivel> = { VERDE: 1, AMARILLO: 2, NARANJA: 3, ROJO: 4 };

/** "Nivel 3" → 3. Cualquier otra cosa es un cambio de formato. */
export function nivelDe(texto: unknown): Nivel {
  const m = /^Nivel\s+([1-4])$/i.exec(String(texto ?? "").trim());
  if (!m) throw fallo("FORMATO_INESPERADO", `Nivel desconocido en la capa del SENAMHI: "${texto}".`);
  return Number(m[1]) as Nivel;
}

// ---------- Tabla de avisos meteorológicos ----------

const ENCABEZADOS = ["Aviso", "Nro.", "Emisión", "Inicio", "Fin", "Duración", "Nivel"];

const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const AvisoListado = z.object({
  numero: z.number().int().positive(),
  anio: z.number().int().min(2000),
  id_web: z.number().int().positive(),
  titulo: z.string().min(1),
  emision: fecha,
  inicio: fecha,
  fin: fecha,
  duracion_horas: z.number().int().positive().nullable(),
  nivel: z.union([z.literal(2), z.literal(3), z.literal(4)]),
  color: z.enum(["amarillo", "naranja", "rojo"]),
  estado_fuente: z.enum(["emitido", "vigente"]).nullable(),
  url: z.string(),
});
export type AvisoListado = z.infer<typeof AvisoListado>;

/**
 * Lee la tabla de avisos. Es estricta con lo reciente: si una fila de este año o
 * marcada como emitida/vigente no se puede leer, falla (no queremos perder un aviso).
 * Filas antiguas ilegibles se descartan y se cuentan.
 */
export function leerLista(html: string, ahora = Date.now()): { avisos: AvisoListado[]; descartadas: number } {
  const $ = cheerio.load(html);
  const tabla = $("table")
    .toArray()
    .find((t) => {
      const ths = $(t)
        .find("thead th")
        .toArray()
        .map((th) => $(th).text().trim());
      return ths.join("|") === ENCABEZADOS.join("|");
    });
  if (!tabla) throw fallo("FORMATO_INESPERADO", "No se encontró la tabla de avisos meteorológicos.");

  const anioActual = Number(fechaLima(ahora).slice(0, 4));
  const avisos: AvisoListado[] = [];
  let descartadas = 0;
  for (const tr of $(tabla).find("tbody tr").toArray()) {
    const celdas = $(tr)
      .find("td")
      .toArray()
      .map((td) => $(td).text().replace(/\s+/g, " ").trim());
    const href = $(tr).find("a").attr("href") ?? "";
    const q = new URLSearchParams(href.split("?")[1] ?? "");
    const nro = /^(\d+)\s*(?:\((emitido|vigente)\))?/i.exec(celdas[1] ?? "");
    const color = (celdas[6] ?? "").toUpperCase();
    const fila = AvisoListado.safeParse({
      numero: nro ? Number(nro[1]) : Number.NaN,
      anio: Number(q.get("a")),
      id_web: Number(q.get("b")),
      titulo: celdas[0],
      emision: celdas[2],
      inicio: celdas[3],
      fin: celdas[4],
      duracion_horas: /^(\d+)/.exec(celdas[5] ?? "") ? Number(/^(\d+)/.exec(celdas[5])?.[1]) : null,
      nivel: NIVEL_POR_COLOR[color],
      color: color.toLowerCase(),
      estado_fuente: nro?.[2]?.toLowerCase() ?? null,
      url: urlDetalle(Number(q.get("a")), Number(q.get("b"))),
    });
    if (fila.success) {
      avisos.push(fila.data);
      continue;
    }
    const reciente =
      /\((emitido|vigente)\)/i.test(celdas[1] ?? "") || (celdas[2] ?? "").startsWith(String(anioActual));
    if (reciente) {
      throw fallo("FORMATO_INESPERADO", `Fila de aviso ilegible: ${JSON.stringify(celdas)}.`, fila.error);
    }
    descartadas++;
  }
  if (avisos.length === 0) throw fallo("FORMATO_INESPERADO", "La tabla de avisos no tiene filas legibles.");
  return { avisos, descartadas };
}

/**
 * Avisos ya emitidos y que no terminan antes del día de `momento` (en Lima).
 * Por fechas y no por la marca "(vigente)" de la tabla: así también sirve para un `momento` pasado o futuro.
 */
export function activos(avisos: AvisoListado[], momento: number): AvisoListado[] {
  const hoy = fechaLima(momento);
  return avisos.filter((a) => a.emision <= hoy && a.fin >= hoy);
}

// ---------- Polígonos por día ----------

export type Poligono = {
  nivel: Nivel;
  inicio: string; // ISO UTC
  fin: string;
  geometry: { type: "Polygon" | "MultiPolygon"; coordinates: any };
};

export type Dia = {
  mapa: number;
  fecha: string; // fecha calendario en Lima
  poligonos: Poligono[];
};

function leerPoligonos(json: any, numero: number, mapa: number): Poligono[] {
  if (json?.type !== "FeatureCollection" || !Array.isArray(json.features)) {
    throw fallo("FORMATO_INESPERADO", `El mapa ${mapa} del aviso ${numero} no es un FeatureCollection.`);
  }
  return json.features.map((f: any) => {
    const p = f.properties ?? {};
    const tipo = f.geometry?.type;
    if (tipo !== "Polygon" && tipo !== "MultiPolygon") {
      throw fallo("FORMATO_INESPERADO", `Geometría ${tipo} inesperada en el aviso ${numero}, mapa ${mapa}.`);
    }
    if (p.nro_aviso !== undefined && Number(p.nro_aviso) !== numero) {
      throw fallo(
        "FORMATO_INESPERADO",
        `El mapa ${mapa} devolvió el aviso ${p.nro_aviso} en vez del ${numero}.`,
      );
    }
    const inicio = Date.parse(p.fech_ini);
    const fin = Date.parse(p.fech_fin);
    if (!Number.isFinite(inicio) || !Number.isFinite(fin)) {
      throw fallo("FORMATO_INESPERADO", `Fechas ilegibles en el aviso ${numero}, mapa ${mapa}.`);
    }
    return {
      nivel: nivelDe(p.nivel),
      inicio: new Date(inicio).toISOString(),
      fin: new Date(fin).toISOString(),
      geometry: f.geometry,
    };
  });
}

/** Un mapa por día calendario entre inicio y fin (verificado con los avisos de octubre de 2026). */
export async function dias(
  a: AvisoListado,
  o: OpcionesHttp,
): Promise<{ dias: Dia[]; obtenido_en: string[] }> {
  const n = diasIncluidos(a.inicio, a.fin);
  if (n < 1 || n > 10) throw fallo("FORMATO_INESPERADO", `El aviso ${a.numero} dura ${n} días.`);
  const mapas = Array.from({ length: n }, (_, i) => i + 1);
  const rs = await enParalelo(mapas, 3, async (mapa) => {
    const { json, obtenido_en } = await pedirJson(urlMapa(a.numero, mapa, a.anio), o);
    const fecha = fechaLima(inicioDiaLima(a.inicio) + (mapa - 1) * 86_400_000);
    return { dia: { mapa, fecha, poligonos: leerPoligonos(json, a.numero, mapa) }, obtenido_en };
  });
  return { dias: rs.map((r) => r.dia), obtenido_en: rs.map((r) => r.obtenido_en) };
}

export async function provincias(a: AvisoListado, mapa: number, o: OpcionesHttp) {
  const { json } = await pedirJson(urlProvincias(a.numero, mapa, a.anio), o);
  const vistos = new Set<string>();
  const out: { departamento: string; provincia: string; ubigeo: string }[] = [];
  for (const f of json?.features ?? []) {
    const p = f.properties ?? {};
    const ubigeo = `${p.iddpto ?? ""}${p.idprov ?? ""}`;
    if (vistos.has(ubigeo)) continue;
    vistos.add(ubigeo);
    out.push({ departamento: p.nombdep, provincia: p.nombprov, ubigeo });
  }
  return out;
}

/** Descripciones de todos los avisos activos: la página de detalle trae una pestaña por aviso. */
export function leerDescripciones(html: string): Map<string, string> {
  const $ = cheerio.load(html);
  const out = new Map<string, string>();
  $("[id^=tabs-]").each((_, el) => {
    const id = $(el).attr("id") ?? "";
    if (!/^tabs-\d+$/.test(id)) return;
    const texto = $(el)
      .find("div.row > div.col-lg-12")
      .toArray()
      .map((e) => $(e).clone().children().remove().end().text().replace(/\s+/g, " ").trim())
      .find((t) => t.length > 40);
    if (texto) out.set(id.slice(5), texto); // clave: `${numero}${anio}`
  });
  return out;
}

export async function descripcion(a: AvisoListado, o: OpcionesHttp): Promise<string | null> {
  const r = await pedir(a.url, o);
  return leerDescripciones(r.cuerpo).get(`${a.numero}${a.anio}`) ?? null;
}

// ---------- Aviso de activación de quebradas ----------

const MESES: Record<string, string> = {
  enero: "01",
  febrero: "02",
  marzo: "03",
  abril: "04",
  mayo: "05",
  junio: "06",
  julio: "07",
  agosto: "08",
  setiembre: "09",
  septiembre: "09",
  octubre: "10",
  noviembre: "11",
  diciembre: "12",
};

export type CabeceraQuebradas = {
  numero: number;
  anio: number;
  nivel: Nivel;
  inicio: string; // ISO UTC
  fin: string;
  duracion_horas: number;
};

/**
 * Número, nivel e inicio/duración del aviso de quebradas vigente según su página.
 * Solo se lee la pestaña del aviso (#nav-aviso): la página también trae un comunicado
 * de 2020 ("Decreto Supremo N°044-2020-PCM") que un regex sobre todo el texto confundiría.
 */
export function leerCabeceraQuebradas(html: string): CabeceraQuebradas {
  const $ = cheerio.load(html);
  const t = $("#nav-aviso").text().replace(/\s+/g, " ");
  const num = /^\s*Aviso\s+(\d+)\s*-\s*(\d{4})\s*$/.exec($("#nav-aviso-tab").text());
  const nivel = /NIVEL\s+(AMARILLO|NARANJA|ROJO)/i.exec(t);
  const ini = /Fecha de inicio:\s*\S+\s+(\d{1,2})\s+([a-záéíóú]+)\s+(\d{4})\s*-\s*(\d{1,2}):(\d{2})/i.exec(t);
  const dur = /Duraci[oó]n:\s*(\d+)\s*hrs?/i.exec(t);
  const mes = ini ? MESES[ini[2].toLowerCase()] : undefined;
  if (!num || !nivel || !ini || !dur || !mes) {
    throw fallo("FORMATO_INESPERADO", "No se pudo leer el número, nivel o vigencia del aviso de quebradas.");
  }
  if (!new RegExp(`N[°º]\\s*0*${num[1]}\\s*-\\s*${num[2]}`).test(t)) {
    throw fallo(
      "FORMATO_INESPERADO",
      `La pestaña dice aviso ${num[1]}-${num[2]} pero el contenido no coincide.`,
    );
  }
  const inicio = Date.parse(
    `${ini[3]}-${mes}-${ini[1].padStart(2, "0")}T${ini[4].padStart(2, "0")}:${ini[5]}:00-05:00`,
  );
  const horas = Number(dur[1]);
  return {
    numero: Number(num[1]),
    anio: Number(num[2]),
    nivel: NIVEL_POR_COLOR[nivel[1].toUpperCase()],
    inicio: new Date(inicio).toISOString(),
    fin: new Date(inicio + horas * 3600_000).toISOString(),
    duracion_horas: horas,
  };
}

export type ZonaQuebradas = {
  nivel: Nivel;
  departamento: string | null;
  provincia: string | null;
  distrito: string | null;
  descripcion: string | null;
  recomendacion: string | null;
  fecha: string | null;
  geometry: Poligono["geometry"];
};

export function leerZonasQuebradas(json: any): ZonaQuebradas[] {
  if (json?.type !== "FeatureCollection" || !Array.isArray(json.features)) {
    throw fallo("FORMATO_INESPERADO", "La capa de quebradas no es un FeatureCollection.");
  }
  const t = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  return json.features.map((f: any) => {
    const p = f.properties ?? {};
    if (f.geometry?.type !== "Polygon" && f.geometry?.type !== "MultiPolygon") {
      throw fallo("FORMATO_INESPERADO", `Geometría ${f.geometry?.type} inesperada en la capa de quebradas.`);
    }
    return {
      nivel: nivelDe(p.nivel),
      departamento: t(p.nombdep),
      provincia: t(p.nombprov),
      distrito: t(p.nombdist),
      descripcion: t(p.descripcion),
      recomendacion: t(p.recomendacion),
      fecha: t(p.fecha)?.slice(0, 10) ?? null,
      geometry: f.geometry,
    };
  });
}

export async function quebradas(o: OpcionesHttp) {
  const [pagina, capa] = await Promise.all([pedir(URL_QUEBRADAS, o), pedirJson(URL_QUEBRADAS_WFS, o)]);
  return {
    cabecera: leerCabeceraQuebradas(pagina.cuerpo),
    zonas: leerZonasQuebradas(capa.json),
    obtenido_en: [pagina.obtenido_en, capa.obtenido_en],
  };
}
