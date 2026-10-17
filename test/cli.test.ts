// Pruebas de punta a punta contra un servidor local que imita al SENAMHI con fixtures reales.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unirNegativos } from "../src/cli.js";

const FX = join(import.meta.dir, "fixtures");
const CLI = join(import.meta.dir, "../src/bin.ts");
const MOMENTO = "2026-10-17T10:00-05:00";
const xmllint = spawnSync("xmllint", ["--version"]).status === 0;
if (!xmllint && process.env.REQUIRE_XMLLINT)
  throw new Error("REQUIRE_XMLLINT=1 pero xmllint no está instalado");

let servidor: ReturnType<typeof Bun.serve>;
let base: string;
let peticiones = 0;

beforeAll(() => {
  servidor = Bun.serve({
    port: 0,
    fetch(req) {
      peticiones++;
      const u = new URL(req.url);
      const archivo = (n: string) => new Response(readFileSync(join(FX, n)));
      if (u.pathname.startsWith("/caido")) return new Response("error", { status: 500 });
      if (u.pathname.startsWith("/vacio")) return new Response("<html><body>mantenimiento</body></html>");
      const p = u.searchParams.get("p");
      if (u.pathname === "/" && p === "aviso-meteorologico") return archivo("lista.html");
      if (u.pathname === "/" && p === "aviso-meteorologico-detalle") return archivo("detalle.html");
      if (u.pathname === "/main.php" && p === "aviso-activacion-quebrada") return archivo("quebradas.html");
      if (u.pathname.includes("/geoserver/g_acti_quebrada/")) return archivo("quebradas.json");
      if (u.pathname.includes("/geoserver/g_aviso/")) {
        const qry = (u.searchParams.get("viewparams") ?? "").replace("qry:", "").replaceAll("_", "-");
        const tipo = u.searchParams.get("typeNames")?.endsWith("_aux") ? "aux" : "wfs";
        const f = `${tipo}-${qry}.json`;
        // Sin fixture para ese aviso/día: el SENAMHI devolvería un FeatureCollection vacío.
        return existsSync(join(FX, f))
          ? archivo(f)
          : Response.json({ type: "FeatureCollection", features: [] });
      }
      return new Response("no encontrado", { status: 404 });
    },
  });
  base = `http://localhost:${servidor.port}`;
});
afterAll(() => servidor.stop(true));

// Asíncrono: el servidor falso vive en este mismo proceso y spawnSync lo bloquearía.
async function correr(args: string[], o: { web?: string; cache?: string } = {}) {
  const proc = Bun.spawn([process.execPath, CLI, ...args, "--json"], {
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      AVISOS_PE_BASE_WEB: `${base}${o.web ?? ""}`,
      AVISOS_PE_BASE_GEO: base,
      XDG_CACHE_HOME: o.cache ?? mkdtempSync(join(tmpdir(), "avisos-pe-cache-")),
    },
  });
  const out = (await new Response(proc.stdout).text()).trim();
  const code = await proc.exited;
  return { code, out, json: out.startsWith("{") ? JSON.parse(out) : null };
}

test("unirNegativos: '--lat -12.05' no se confunde con una opción", async () => {
  expect(unirNegativos(["punto", "--lat", "-12.05", "--lon", "-77"])).toEqual([
    "punto",
    "--lat=-12.05",
    "--lon=-77",
  ]);
});

describe("punto", () => {
  test("nivel 4 del aviso 419 y nivel 3 del 421 en zonas reales", async () => {
    const { code, json } = await correr([
      "punto",
      "--lat",
      "-9.8072",
      "--lon",
      "-78.2257",
      "--momento",
      MOMENTO,
    ]);
    expect(code).toBe(0);
    const a419 = json.meteorologicos.find((a: any) => a.numero === 419);
    expect(a419.dias[0]).toMatchObject({ fecha: "2026-10-17", nivel: 4, color: "rojo", estado: "en_curso" });
    expect(json.resumen.nivel_maximo_en_curso).toBe(4);
    expect(json.aviso.join(" ")).toContain("No es una orden de evacuación");
  });

  test("zonas superpuestas (2 y 3): reporta 3", async () => {
    const { json } = await correr(["punto", "--lat", "-12.8127", "--lon", "-75.7685", "--momento", MOMENTO]);
    expect(json.meteorologicos.find((a: any) => a.numero === 419).dias[0].nivel).toBe(3);
  });

  test("avisos sin zonas publicadas aparecen como no evaluables (no se omiten en silencio)", async () => {
    const { json } = await correr(["punto", "--lat", "-3.75", "--lon", "-73.25", "--momento", MOMENTO]);
    expect(json.meteorologicos).toEqual([]);
    expect(json.no_evaluables.map((n: any) => n.numero).sort()).toEqual([415, 422, 423]);
  });

  test("aviso de activación de quebradas en El Carmen de la Frontera", async () => {
    const { json } = await correr(["punto", "--lat", "-5.01039", "--lon", "-79.24678", "--momento", MOMENTO]);
    expect(json.quebradas).toMatchObject({ numero: 289, anio: 2026, estado: "en_curso" });
    expect(json.quebradas.zonas.map((z: any) => z.distrito)).toEqual(["EL CARMEN DE LA FRONTERA"]);
  });

  test("lat/lon invertidos → FUERA_DE_COBERTURA", async () => {
    const { code, json } = await correr(["punto", "--lat", "-76.7", "--lon", "-11.9"]);
    expect([code, json.code]).toEqual([2, "FUERA_DE_COBERTURA"]);
  });

  test("momento sin zona horaria → ARGS_INVALIDOS", async () => {
    expect(
      (await correr(["punto", "--lat", "-12", "--lon", "-77", "--momento", "2026-10-18T15:00"])).json.code,
    ).toBe("ARGS_INVALIDOS");
  });
});

describe("fallas de la fuente: nunca 'sin avisos'", () => {
  test("SENAMHI caído → FUENTE_NO_DISPONIBLE", async () => {
    const { code, json } = await correr(["punto", "--lat", "-12", "--lon", "-77"], { web: "/caido" });
    expect([code, json.code]).toEqual([1, "FUENTE_NO_DISPONIBLE"]);
    expect(json.hint).toContain("No se puede afirmar que no haya avisos");
  });
  test("página sin la tabla → FORMATO_INESPERADO", async () => {
    const { code, json } = await correr(["vigentes"], { web: "/vacio" });
    expect([code, json.code]).toEqual([1, "FORMATO_INESPERADO"]);
  });
});

test("caché: la segunda consulta no vuelve a pedir; --sin-cache sí", async () => {
  const cache = mkdtempSync(join(tmpdir(), "avisos-pe-cache-"));
  const args = ["punto", "--lat", "-9.8072", "--lon", "-78.2257", "--momento", MOMENTO];
  await correr(args, { cache });
  const antes = peticiones;
  expect((await correr(args, { cache })).code).toBe(0);
  expect(peticiones).toBe(antes);
  await correr([...args, "--sin-cache"], { cache });
  expect(peticiones).toBeGreaterThan(antes);
});

describe("vigentes y aviso", () => {
  test("vigentes lista los avisos y el de quebradas", async () => {
    const { json } = await correr(["vigentes", "--momento", MOMENTO]);
    expect(json.meteorologicos.map((a: any) => a.numero)).toEqual([423, 422, 421, 419, 415]);
    expect(json.quebradas.numero).toBe(289);
  });
  test("aviso con descripción oficial y provincias", async () => {
    const { json } = await correr(["aviso", "419", "--anio", "2026"]);
    expect(json.aviso.descripcion).toStartWith("El SENAMHI informa");
    expect(json.aviso.dias[0].provincias[0]).toMatchObject({ ubigeo: expect.stringMatching(/^\d{4}$/) });
  });
  test("aviso inexistente → NO_ENCONTRADO", async () => {
    expect((await correr(["aviso", "999", "--anio", "2026"])).json.code).toBe("NO_ENCONTRADO");
  });
});

describe.if(xmllint)("cap valida contra el esquema OASIS CAP 1.2", () => {
  const validar = (xml: string) => {
    const f = join(mkdtempSync(join(tmpdir(), "cap-")), "a.xml");
    writeFileSync(f, xml);
    return spawnSync("xmllint", ["--noout", "--schema", join(FX, "CAP-v1.2.xsd"), f], { encoding: "utf8" });
  };
  test("aviso meteorológico: un <info> por día y nivel >= 2, sin nivel 1", async () => {
    const { out } = await correr(["cap", "419", "--anio", "2026", "--momento", MOMENTO]);
    expect(validar(out).status).toBe(0);
    expect(out).toContain("<identifier>pe-senamhi-aviso-meteorologico-2026-419</identifier>");
    expect(out).not.toContain("nivel verde");
    expect(out.match(/<info>/g)?.length).toBe(9); // 3 días × niveles 2, 3 y 4
    expect(out).toContain("Reproducción no oficial");
  });
  test("activación de quebradas", async () => {
    const { out } = await correr(["cap", "quebradas", "--momento", MOMENTO]);
    expect(validar(out).status).toBe(0);
    expect(out).toContain("<areaDesc>EL CARMEN DE LA FRONTERA, HUANCABAMBA, PIURA</areaDesc>");
  });
});
