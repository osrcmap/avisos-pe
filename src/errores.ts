import { AppError, type ErrorMap } from "./foundation/error-map.js";

export const ERRORES = {
  ARGS_INVALIDOS: {
    name: "ArgsInvalidos",
    human: "Parámetros inválidos.",
    hint: "Revisa los parámetros con `avisos-pe schema <comando>`.",
  },
  COMANDO_DESCONOCIDO: {
    name: "ComandoDesconocido",
    human: "Comando desconocido.",
    hint: "Comandos: vigentes, punto, aviso, cap, schema, doctor. Usa `avisos-pe --help`.",
  },
  PARAMS_INVALIDOS: {
    name: "ParamsInvalidos",
    human: "No se pudo leer --params.",
    hint: "--params acepta un objeto JSON en línea o @ruta/al/archivo.json.",
  },
  FUERA_DE_COBERTURA: {
    name: "FueraDeCobertura",
    human: "El punto está fuera del Perú.",
    hint: "Verifica el orden: --lat es la latitud (Perú: -18.5 a 0.1) y --lon la longitud (Perú: -81.5 a -68.5).",
  },
  NO_ENCONTRADO: {
    name: "NoEncontrado",
    human: "No existe ese aviso.",
    hint: "Usa `avisos-pe vigentes` para ver los números de los avisos activos.",
  },
  FUENTE_NO_DISPONIBLE: {
    name: "FuenteNoDisponible",
    human: "No se pudo consultar al SENAMHI.",
    hint: "No se puede afirmar que no haya avisos. Reintenta en unos minutos o revisa senamhi.gob.pe. Diagnóstico: `avisos-pe doctor`.",
  },
  FORMATO_INESPERADO: {
    name: "FormatoInesperado",
    human: "El SENAMHI cambió el formato de su publicación.",
    hint: "No se puede afirmar que no haya avisos. Revisa senamhi.gob.pe y reporta un issue para actualizar avisos-pe.",
  },
  ERROR_INTERNO: {
    name: "ErrorInterno",
    human: "Error inesperado.",
    hint: "Abre un issue con el comando exacto que corriste.",
  },
} satisfies ErrorMap;

export type Codigo = keyof typeof ERRORES;

/** Errores de uso salen con código 2; el resto con 1. */
export const exitCode = (code: string) =>
  ["ARGS_INVALIDOS", "COMANDO_DESCONOCIDO", "PARAMS_INVALIDOS", "FUERA_DE_COBERTURA"].includes(code) ? 2 : 1;

export const fallo = (code: Codigo, detalle?: string, causa?: unknown) =>
  new AppError(code, detalle ? { ...ERRORES[code], human: detalle } : ERRORES[code], causa);
