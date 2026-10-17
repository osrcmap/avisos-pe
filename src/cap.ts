// Common Alerting Protocol 1.2 (OASIS) a partir de los avisos del SENAMHI.
// No es un CAP oficial: el SENAMHI no publica CAP. Se marca como reproducción en <note>
// y se conserva exactamente el nivel, la vigencia y los polígonos publicados.
import { create } from "xmlbuilder2";
import type { XMLBuilder } from "xmlbuilder2/lib/interfaces.js";
import { type AvisoConDias, type Estado, estado, type Quebradas } from "./avisos.js";
import { NIVELES, type Nivel, type Poligono, URL_QUEBRADAS } from "./senamhi.js";
import { isoLima } from "./tiempo.js";

const NS = "urn:oasis:names:tc:emergency:cap:1.2";
export const SENDER = "https://github.com/osrcmap/avisos-pe";
const SENDER_NAME =
  "SENAMHI – Servicio Nacional de Meteorología e Hidrología del Perú (reproducido por avisos-pe)";

const SEVERIDAD: Record<Nivel, string> = { 1: "Minor", 2: "Moderate", 3: "Severe", 4: "Extreme" };
const RESPUESTA: Record<Nivel, string> = { 1: "None", 2: "Monitor", 3: "Prepare", 4: "Prepare" };
const URGENCIA: Record<Estado, string> = { en_curso: "Expected", proximo: "Future", terminado: "Past" };

/** Anillos exteriores como "lat,lon lat,lon ..." (CAP no admite huecos: el área incluye los huecos, lo que sobreestima). */
export function anillosCap(g: Poligono["geometry"]): string[] {
  const exteriores: number[][][] =
    g.type === "Polygon" ? [g.coordinates[0]] : g.coordinates.map((p: any) => p[0]);
  return exteriores
    .filter((r) => r.length >= 4)
    .map((r) => {
      const cerrado = r[0][0] === r.at(-1)?.[0] && r[0][1] === r.at(-1)?.[1] ? r : [...r, r[0]];
      return cerrado.map(([lon, lat]) => `${+lat.toFixed(6)},${+lon.toFixed(6)}`).join(" ");
    });
}

function cabecera(identificador: string, enviado: number, nota: string, url: string): XMLBuilder {
  return create({ version: "1.0", encoding: "UTF-8" })
    .ele(NS, "alert")
    .ele("identifier")
    .txt(identificador)
    .up()
    .ele("sender")
    .txt(SENDER)
    .up()
    .ele("sent")
    .txt(isoLima(enviado))
    .up()
    .ele("status")
    .txt("Actual")
    .up()
    .ele("msgType")
    .txt("Alert")
    .up()
    .ele("source")
    .txt(`SENAMHI ${url}`)
    .up()
    .ele("scope")
    .txt("Public")
    .up()
    .ele("note")
    .txt(nota)
    .up();
}

type Info = {
  categorias: string[];
  evento: string;
  nivel: Nivel;
  estado: Estado;
  inicio: string;
  fin: string;
  titular: string;
  descripcion: string;
  instruccion: string;
  web: string;
  areas: { descripcion: string; anillos: string[] }[];
};

function agregarInfo(alerta: XMLBuilder, i: Info) {
  const info = alerta.ele("info");
  info.ele("language").txt("es-PE");
  for (const c of i.categorias) info.ele("category").txt(c);
  info.ele("event").txt(i.evento);
  info.ele("responseType").txt(RESPUESTA[i.nivel]);
  info.ele("urgency").txt(URGENCIA[i.estado]);
  info.ele("severity").txt(SEVERIDAD[i.nivel]);
  info.ele("certainty").txt("Likely");
  info.ele("effective").txt(isoLima(Date.parse(i.inicio)));
  info.ele("onset").txt(isoLima(Date.parse(i.inicio)));
  info.ele("expires").txt(isoLima(Date.parse(i.fin)));
  info.ele("senderName").txt(SENDER_NAME);
  info.ele("headline").txt(i.titular);
  info.ele("description").txt(i.descripcion);
  info.ele("instruction").txt(i.instruccion);
  info.ele("web").txt(i.web);
  const param = (nombre: string, valor: string) => {
    const p = info.ele("parameter");
    p.ele("valueName").txt(nombre);
    p.ele("value").txt(valor);
  };
  param("nivel_senamhi", String(i.nivel));
  param("color_senamhi", NIVELES[i.nivel].color);
  for (const a of i.areas) {
    const area = info.ele("area");
    area.ele("areaDesc").txt(a.descripcion);
    for (const r of a.anillos) area.ele("polygon").txt(r);
  }
}

const capitalizar = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

/**
 * Un <info> por día y por nivel >= 2 (amarillo, naranja, rojo). El nivel 1 ("no es necesario
 * tomar precauciones especiales") no se emite como alerta.
 */
export function capMeteorologico(a: AvisoConDias, descripcion: string | null, momento: number): string {
  const nota = `Reproducción no oficial generada por avisos-pe a partir del aviso N° ${a.numero}-${a.anio} del SENAMHI. Nivel, vigencia y polígonos sin modificar. El SENAMHI no publica CAP.`;
  const alerta = cabecera(
    `pe-senamhi-aviso-meteorologico-${a.anio}-${a.numero}`,
    Date.parse(`${a.emision}T00:00:00-05:00`),
    nota,
    a.url,
  );
  for (const d of a.dias) {
    const niveles = [...new Set(d.poligonos.map((p) => p.nivel))].filter((n) => n >= 2).sort();
    for (const n of niveles) {
      const ps = d.poligonos.filter((p) => p.nivel === n);
      const inicio = ps.map((p) => p.inicio).sort()[0];
      const fin = ps
        .map((p) => p.fin)
        .sort()
        .at(-1) as string;
      agregarInfo(alerta, {
        categorias: ["Met"],
        evento: capitalizar(a.titulo),
        nivel: n,
        estado: estado(inicio, fin, momento),
        inicio,
        fin,
        titular: `Aviso N° ${a.numero}-${a.anio}: ${capitalizar(a.titulo)} – nivel ${NIVELES[n].color} (${d.fecha})`,
        descripcion: descripcion ?? a.titulo,
        instruccion: NIVELES[n].texto,
        web: a.url,
        areas: [
          {
            descripcion: `Zonas en nivel ${NIVELES[n].color}, ${d.fecha}`,
            anillos: ps.flatMap((p) => anillosCap(p.geometry)),
          },
        ],
      });
    }
  }
  return alerta.end({ prettyPrint: true });
}

export function capQuebradas(q: Quebradas, momento: number): string {
  const c = q.cabecera;
  const nota = `Reproducción no oficial generada por avisos-pe a partir del aviso de corto plazo ante posible activación de quebradas N° ${c.numero}-${c.anio} del SENAMHI. Nivel, vigencia y polígonos sin modificar. El SENAMHI no publica CAP.`;
  const alerta = cabecera(
    `pe-senamhi-activacion-quebradas-${c.anio}-${c.numero}`,
    Date.parse(c.inicio),
    nota,
    URL_QUEBRADAS,
  );
  const niveles = [...new Set(q.zonas.map((z) => z.nivel))].filter((n) => n >= 2).sort();
  for (const n of niveles) {
    const zs = q.zonas.filter((z) => z.nivel === n);
    agregarInfo(alerta, {
      categorias: ["Geo", "Met"],
      evento: "Posible activación de quebradas (huaicos)",
      nivel: n,
      estado: estado(c.inicio, c.fin, momento),
      inicio: c.inicio,
      fin: c.fin,
      titular: `Aviso N° ${c.numero}-${c.anio}: posible activación de quebradas – nivel ${NIVELES[n].color}`,
      descripcion: zs[0]?.descripcion ?? "Posible activación de quebradas.",
      instruccion: zs[0]?.recomendacion ?? NIVELES[n].texto,
      web: URL_QUEBRADAS,
      areas: zs.map((z) => ({
        descripcion:
          [z.distrito, z.provincia, z.departamento].filter(Boolean).join(", ") || "Zona sin nombre",
        anillos: anillosCap(z.geometry),
      })),
    });
  }
  return alerta.end({ prettyPrint: true });
}
