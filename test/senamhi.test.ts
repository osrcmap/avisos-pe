import { describe, expect, test } from "bun:test";
import {
  activos,
  leerCabeceraQuebradas,
  leerDescripciones,
  leerLista,
  leerZonasQuebradas,
  nivelDe,
} from "../src/senamhi.js";

const fx = (n: string) => Bun.file(`${import.meta.dir}/fixtures/${n}`).text();
const MOMENTO = Date.parse("2026-10-17T10:00:00-05:00");

describe("leerLista", () => {
  test("lee número, año (del enlace), fechas, nivel y estado", async () => {
    const { avisos, descartadas } = leerLista(await fx("lista.html"), MOMENTO);
    expect(descartadas).toBe(0);
    expect(avisos.map((a) => [a.numero, a.anio, a.estado_fuente, a.nivel])).toEqual([
      [423, 2026, "emitido", 3],
      [422, 2026, "emitido", 2],
      [421, 2026, "vigente", 3],
      [419, 2026, "vigente", 4],
      [415, 2026, "vigente", 3],
      [45, 2021, null, 3],
    ]);
    expect(avisos[0]).toMatchObject({
      titulo: "INCREMENTO DE VIENTO EN LA COSTA CENTRO Y SUR Y SIERRA SUR",
      emision: "2026-10-16",
      inicio: "2026-10-18",
      fin: "2026-10-20",
      duracion_horas: 71,
      color: "naranja",
      url: "https://www.senamhi.gob.pe/?p=aviso-meteorologico-detalle&a=2026&b=29288&c=00&d=SENA",
    });
  });

  test("sin la tabla esperada → FORMATO_INESPERADO", () => {
    expect(() => leerLista("<html><body>mantenimiento</body></html>")).toThrow(/tabla de avisos/);
  });

  test("una fila reciente ilegible falla en vez de perder el aviso", async () => {
    const html = (await fx("lista.html")).replace(">NARANJA<", ">MORADO<");
    expect(() => leerLista(html, MOMENTO)).toThrow(/Fila de aviso ilegible/);
  });

  test("una fila antigua ilegible se descarta y se cuenta", async () => {
    const html = (await fx("lista.html")).replace("2021-03-08", "08/03/2021");
    const r = leerLista(html, MOMENTO);
    expect(r.descartadas).toBe(1);
    expect(r.avisos).toHaveLength(5);
  });
});

describe("activos", () => {
  test("emitidos y no terminados en el día del momento (hora de Lima)", async () => {
    const { avisos } = leerLista(await fx("lista.html"), MOMENTO);
    expect(activos(avisos, MOMENTO).map((a) => a.numero)).toEqual([423, 422, 421, 419, 415]);
    // El 14/10 aún no se habían emitido 423, 422, 421 ni 419.
    expect(activos(avisos, Date.parse("2026-10-14T12:00:00-05:00")).map((a) => a.numero)).toEqual([415]);
    // 23:30 del 17 en Lima ya es 18 en UTC: el 415 (fin 17/10) sigue activo.
    expect(activos(avisos, Date.parse("2026-10-17T23:30:00-05:00")).map((a) => a.numero)).toContain(415);
  });
});

test("nivelDe solo acepta Nivel 1 a 4", () => {
  expect(nivelDe("Nivel 3")).toBe(3);
  expect(nivelDe(" nivel 2 ")).toBe(2);
  expect(() => nivelDe("Nivel 5")).toThrow();
  expect(() => nivelDe(null)).toThrow();
});

test("leerDescripciones: una por pestaña de aviso activo", async () => {
  const d = leerDescripciones(await fx("detalle.html"));
  expect([...d.keys()]).toEqual(["4192026", "4212026"]);
  expect(d.get("4192026")).toStartWith("El SENAMHI informa que, desde el sábado 17 al lunes 19 de octubre");
});

describe("quebradas", () => {
  test("cabecera: lee la pestaña del aviso e ignora el comunicado de 2020 (N°044-2020)", async () => {
    const html = await fx("quebradas.html");
    expect(html).toContain("044-2020");
    expect(leerCabeceraQuebradas(html)).toEqual({
      numero: 289,
      anio: 2026,
      nivel: 2,
      inicio: "2026-10-16T18:00:00.000Z", // 13:00 en Lima
      fin: "2026-10-17T18:00:00.000Z",
      duracion_horas: 24,
    });
  });

  test("cabecera sin pestaña de aviso → FORMATO_INESPERADO", async () => {
    const html = (await fx("quebradas.html")).replaceAll('id="nav-aviso-tab"', 'id="otra"');
    expect(() => leerCabeceraQuebradas(html)).toThrow(/aviso de quebradas/);
  });

  test("zonas con distrito, nivel y textos oficiales", async () => {
    const zonas = leerZonasQuebradas(JSON.parse(await fx("quebradas.json")));
    expect(zonas.map((z) => [z.distrito, z.nivel])).toEqual([
      ["NAMBALLE", 2],
      ["NAMBALLE", 2],
      ["NAMBALLE", 2],
      ["EL CARMEN DE LA FRONTERA", 2],
    ]);
    expect(zonas[0].recomendacion).toBe(
      "Estar atentos a la información oficial y seguir las instrucciones de las autoridades competentes.",
    );
  });
});
