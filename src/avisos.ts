// Lógica de avisos: estado en un momento dado y qué avisos cubren un punto.
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import {
  type AvisoListado,
  type CabeceraQuebradas,
  type Dia,
  NIVELES,
  type Nivel,
  type ZonaQuebradas,
} from "./senamhi.js";
import { inicioDiaLima } from "./tiempo.js";

/**
 * Cada aviso trae un polígono de nivel 1 ("No es necesario tomar precauciones especiales") que
 * cubre el resto del territorio. No es un aviso para esa zona: solo cuentan los niveles 2 a 4.
 */
export const NIVEL_MINIMO_AVISO = 2;

/** Rectángulo que contiene al Perú (con margen). */
export const enPeru = (lon: number, lat: number) =>
  lon >= -81.5 && lon <= -68.5 && lat >= -18.5 && lat <= 0.1;

export type Estado = "proximo" | "en_curso" | "terminado";

export const estado = (inicio: string, fin: string, momento: number): Estado =>
  momento < Date.parse(inicio) ? "proximo" : momento > Date.parse(fin) ? "terminado" : "en_curso";

/** Vigencia de un día: la de sus polígonos, o el día calendario completo en Lima si no tiene. */
function vigenciaDia(d: Dia) {
  if (d.poligonos.length) {
    return {
      inicio: d.poligonos.map((p) => p.inicio).sort()[0],
      fin: d.poligonos
        .map((p) => p.fin)
        .sort()
        .at(-1) as string,
    };
  }
  const ini = inicioDiaLima(d.fecha);
  return { inicio: new Date(ini).toISOString(), fin: new Date(ini + 86_400_000 - 1000).toISOString() };
}

export const nivelInfo = (n: Nivel) => ({ nivel: n, color: NIVELES[n].color, texto_nivel: NIVELES[n].texto });

export type AvisoConDias = AvisoListado & { dias: Dia[] };

const meta = (a: AvisoListado) => ({
  tipo: "meteorologico" as const,
  numero: a.numero,
  anio: a.anio,
  titulo: a.titulo,
  nivel_aviso: a.nivel,
  color_aviso: a.color,
  emision: a.emision,
  inicio: a.inicio,
  fin: a.fin,
  url: a.url,
});

/** Resumen de un aviso sin geometrías: niveles presentes en cada día. */
export function resumen(a: AvisoConDias, momento: number) {
  return {
    ...meta(a),
    dias: a.dias.map((d) => {
      const v = vigenciaDia(d);
      const niveles = [...new Set(d.poligonos.map((p) => p.nivel))]
        .filter((n) => n >= NIVEL_MINIMO_AVISO)
        .sort();
      return {
        mapa: d.mapa,
        fecha: d.fecha,
        ...v,
        estado: estado(v.inicio, v.fin, momento),
        niveles,
        sin_poligonos: d.poligonos.length === 0,
      };
    }),
  };
}

/** Días pendientes (no terminados) que no traen polígonos: el aviso no se puede evaluar en esos días. */
export const diasSinPoligonos = (a: AvisoConDias, momento: number) =>
  a.dias.filter(
    (d) =>
      d.poligonos.length === 0 && estado(vigenciaDia(d).inicio, vigenciaDia(d).fin, momento) !== "terminado",
  );

/**
 * Días del aviso, no terminados en `momento`, en los que (lat, lon) cae dentro de algún polígono.
 * Si cae en varios (bordes compartidos), se reporta el nivel más alto.
 */
export function evaluarPunto(a: AvisoConDias, lat: number, lon: number, momento: number) {
  const dias = a.dias.flatMap((d) => {
    const v = vigenciaDia(d);
    const e = estado(v.inicio, v.fin, momento);
    if (e === "terminado") return [];
    const niveles = d.poligonos
      .filter((p) => p.nivel >= NIVEL_MINIMO_AVISO && booleanPointInPolygon([lon, lat], p.geometry))
      .map((p) => p.nivel);
    if (!niveles.length) return [];
    return [{ mapa: d.mapa, fecha: d.fecha, ...v, estado: e, ...nivelInfo(Math.max(...niveles) as Nivel) }];
  });
  return dias.length ? { ...meta(a), dias } : null;
}

export type Quebradas = { cabecera: CabeceraQuebradas; zonas: ZonaQuebradas[] };

export function resumenQuebradas(q: Quebradas, momento: number) {
  const c = q.cabecera;
  return {
    tipo: "activacion_quebradas" as const,
    numero: c.numero,
    anio: c.anio,
    ...nivelInfo(c.nivel),
    inicio: c.inicio,
    fin: c.fin,
    duracion_horas: c.duracion_horas,
    estado: estado(c.inicio, c.fin, momento),
    zonas: q.zonas.map(({ geometry: _g, ...z }) => z),
  };
}

/** Zonas del aviso de quebradas que contienen el punto (si el aviso no terminó). */
export function evaluarQuebradas(q: Quebradas, lat: number, lon: number, momento: number) {
  const r = resumenQuebradas(q, momento);
  if (r.estado === "terminado") return null;
  const zonas = q.zonas
    .filter((z) => z.nivel >= NIVEL_MINIMO_AVISO && booleanPointInPolygon([lon, lat], z.geometry))
    .map(({ geometry: _g, ...z }) => ({ ...z, ...nivelInfo(z.nivel) }));
  return zonas.length ? { ...r, zonas } : null;
}
