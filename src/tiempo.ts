// Perú usa UTC-5 todo el año (sin horario de verano).
const OFFSET_MS = 5 * 3600_000;

/** "2026-10-18T00:00:00-05:00" (formato que exige CAP: sin "Z"). */
export function isoLima(ms: number): string {
  return `${new Date(ms - OFFSET_MS).toISOString().slice(0, 19)}-05:00`;
}

/** Fecha calendario en Lima, "2026-10-18". */
export const fechaLima = (ms: number) => isoLima(ms).slice(0, 10);

/** Inicio del día `fecha` (YYYY-MM-DD) en Lima, en ms. */
export const inicioDiaLima = (fecha: string) => Date.parse(`${fecha}T00:00:00-05:00`);

/** Días calendario entre dos fechas YYYY-MM-DD, ambos incluidos. */
export const diasIncluidos = (desde: string, hasta: string) =>
  Math.round((inicioDiaLima(hasta) - inicioDiaLima(desde)) / 86_400_000) + 1;
