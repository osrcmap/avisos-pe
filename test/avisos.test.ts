import { expect, test } from "bun:test";
import {
  type AvisoConDias,
  diasSinPoligonos,
  evaluarPunto,
  evaluarQuebradas,
  type Quebradas,
  resumen,
} from "../src/avisos.js";
import type { Nivel, Poligono } from "../src/senamhi.js";

// Cuadrados sintéticos (lon/lat) para resultados verificables a mano.
const cuadrado = (x0: number, y0: number, x1: number, y1: number): Poligono["geometry"] => ({
  type: "Polygon",
  coordinates: [
    [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
      [x0, y0],
    ],
  ],
});
const dia18 = { inicio: "2026-10-18T05:00:00.000Z", fin: "2026-10-19T04:59:59.000Z" };
const dia19 = { inicio: "2026-10-19T05:00:00.000Z", fin: "2026-10-20T04:59:59.000Z" };
const pol = (nivel: Nivel, g: Poligono["geometry"], d = dia18): Poligono => ({ nivel, geometry: g, ...d });

const aviso = (dias: AvisoConDias["dias"]): AvisoConDias => ({
  numero: 500,
  anio: 2026,
  id_web: 1,
  titulo: "PRECIPITACIONES DE PRUEBA",
  emision: "2026-10-17",
  inicio: "2026-10-18",
  fin: "2026-10-19",
  duracion_horas: 47,
  nivel: 3,
  color: "naranja",
  estado_fuente: "emitido",
  url: "https://example.org",
  dias,
});

// Nivel 1 cubre todo; nivel 2 cubre [-78,-77]x[-13,-12]; nivel 3 (superpuesto) [-77.6,-77.4]x[-12.6,-12.4].
const a = aviso([
  {
    mapa: 1,
    fecha: "2026-10-18",
    poligonos: [
      pol(1, cuadrado(-82, -19, -68, 1)),
      pol(2, cuadrado(-78, -13, -77, -12)),
      pol(3, cuadrado(-77.6, -12.6, -77.4, -12.4)),
    ],
  },
  {
    mapa: 2,
    fecha: "2026-10-19",
    poligonos: [pol(1, cuadrado(-82, -19, -68, 1), dia19), pol(2, cuadrado(-78, -13, -77, -12), dia19)],
  },
]);
const ANTES = Date.parse("2026-10-17T12:00:00-05:00");

test("punto en zonas superpuestas: se reporta el nivel más alto", () => {
  const r = evaluarPunto(a, -12.5, -77.5, ANTES);
  expect(r?.dias.map((d) => [d.fecha, d.nivel, d.color, d.estado])).toEqual([
    ["2026-10-18", 3, "naranja", "proximo"],
    ["2026-10-19", 2, "amarillo", "proximo"],
  ]);
});

test("el nivel 1 (fondo del territorio) no es un aviso para el punto", () => {
  expect(evaluarPunto(a, -5, -75, ANTES)).toBeNull();
});

test("los días terminados no se reportan", () => {
  const r = evaluarPunto(a, -12.5, -77.5, Date.parse("2026-10-19T10:00:00-05:00"));
  expect(r?.dias.map((d) => [d.fecha, d.estado])).toEqual([["2026-10-19", "en_curso"]]);
  expect(evaluarPunto(a, -12.5, -77.5, Date.parse("2026-10-21T00:00:00-05:00"))).toBeNull();
});

test("resumen: niveles por día sin el nivel 1", () => {
  expect(resumen(a, ANTES).dias.map((d) => d.niveles)).toEqual([[2, 3], [2]]);
});

test("un día pendiente sin polígonos se informa como no evaluable", () => {
  const b = aviso([{ mapa: 1, fecha: "2026-10-18", poligonos: [] }]);
  expect(diasSinPoligonos(b, ANTES).map((d) => d.fecha)).toEqual(["2026-10-18"]);
  expect(diasSinPoligonos(b, Date.parse("2026-10-20T00:00:00-05:00"))).toEqual([]);
});

test("quebradas: zona que contiene el punto, solo mientras el aviso no termina", () => {
  const q: Quebradas = {
    cabecera: {
      numero: 289,
      anio: 2026,
      nivel: 2,
      inicio: "2026-10-16T18:00:00.000Z",
      fin: "2026-10-17T18:00:00.000Z",
      duracion_horas: 24,
    },
    zonas: [
      {
        nivel: 2,
        departamento: "PIURA",
        provincia: "HUANCABAMBA",
        distrito: "EL CARMEN DE LA FRONTERA",
        descripcion: "Ante el pronóstico de lluvias...",
        recomendacion: "Estar atentos...",
        fecha: "2026-10-16",
        geometry: cuadrado(-79.3, -5.1, -79.2, -4.9),
      },
    ],
  };
  const r = evaluarQuebradas(q, -5.0, -79.25, ANTES);
  expect(r?.zonas.map((z) => [z.distrito, z.color])).toEqual([["EL CARMEN DE LA FRONTERA", "amarillo"]]);
  expect(evaluarQuebradas(q, -12, -77, ANTES)).toBeNull();
  expect(evaluarQuebradas(q, -5.0, -79.25, Date.parse("2026-10-17T13:01:00-05:00"))).toBeNull();
});
