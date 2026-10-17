#!/usr/bin/env node
// Ejecutable del paquete. Separado de cli.ts para no depender de import.meta.main,
// que no existe en todas las versiones de Node ni sobrevive igual al bundle.
import { ejecutar } from "./cli.js";

await ejecutar(process.argv.slice(2));
