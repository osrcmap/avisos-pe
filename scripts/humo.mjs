// Prueba de humo del paquete compilado (dist/cli.js) con el Node que la ejecute (>= 20).
// Levanta un servidor local que imita al SENAMHI con test/fixtures: no depende de la red.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

const raiz = new URL("..", import.meta.url).pathname;
const fx = (n) => join(raiz, "test/fixtures", n);
const pkg = JSON.parse(readFileSync(join(raiz, "package.json"), "utf8"));

// Copia aislada (solo lo que se publica, sin node_modules): falla si el bundle deja de ser autónomo.
const aislado = mkdtempSync(join(tmpdir(), "avisos-pe-humo-"));
for (const f of ["dist", "package.json"]) cpSync(join(raiz, f), join(aislado, f), { recursive: true });

const servidor = createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  const p = u.searchParams.get("p");
  let f = null;
  if (u.pathname === "/" && p === "aviso-meteorologico") f = fx("lista.html");
  else if (u.pathname === "/" && p === "aviso-meteorologico-detalle") f = fx("detalle.html");
  else if (u.pathname === "/main.php") f = fx("quebradas.html");
  else if (u.pathname.includes("/g_acti_quebrada/")) f = fx("quebradas.json");
  else if (u.pathname.includes("/g_aviso/")) {
    const qry = (u.searchParams.get("viewparams") ?? "").replace("qry:", "").replaceAll("_", "-");
    const tipo = u.searchParams.get("typeNames")?.endsWith("_aux") ? "aux" : "wfs";
    f = fx(`${tipo}-${qry}.json`);
    if (!existsSync(f)) return res.end('{"type":"FeatureCollection","features":[]}');
  }
  if (!f) {
    res.statusCode = 404;
    return res.end();
  }
  res.end(readFileSync(f));
});
await new Promise((ok) => servidor.listen(0, ok));
const base = `http://localhost:${servidor.address().port}`;

function correr(...args) {
  return new Promise((ok) => {
    const hijo = spawn(process.execPath, [join(aislado, "dist/cli.js"), ...args, "--json"], {
      env: {
        ...process.env,
        AVISOS_PE_BASE_WEB: base,
        AVISOS_PE_BASE_GEO: base,
        XDG_CACHE_HOME: mkdtempSync(join(tmpdir(), "avisos-pe-humo-")),
      },
    });
    let out = "";
    let err = "";
    hijo.stdout.on("data", (d) => (out += d));
    hijo.stderr.on("data", (d) => (err += d));
    hijo.on("close", (code) => {
      assert.ok(out.trim(), `sin salida para: ${args.join(" ")}\nstderr: ${err}`);
      ok({ code, out, json: out.trim().startsWith("{") ? JSON.parse(out) : null });
    });
  });
}

try {
  assert.equal((await correr("--version")).json.version, pkg.version);

  const punto = await correr(
    "punto",
    "--lat",
    "-9.8072",
    "--lon",
    "-78.2257",
    "--momento",
    "2026-10-17T10:00-05:00",
  );
  assert.equal(punto.code, 0);
  assert.equal(punto.json.resumen.nivel_maximo_en_curso, 4);
  assert.ok(punto.json.aviso.length > 0);

  const invertido = await correr("punto", "--lat", "-76.7", "--lon", "-11.9");
  assert.equal(invertido.json.code, "FUERA_DE_COBERTURA");

  const cap = await correr("cap", "quebradas", "--momento", "2026-10-17T10:00-05:00");
  assert.match(cap.out, /<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">/);

  console.log(`humo ok: node ${process.version}, ${pkg.name}@${pkg.version}`);
} finally {
  servidor.close();
}
