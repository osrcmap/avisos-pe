---
name: avisos-pe
description: Consulta los avisos oficiales del SENAMHI (Perú) para una ubicación o a nivel nacional — lluvias, vientos, temperaturas y posible activación de quebradas (huaicos) — con su nivel (amarillo, naranja, rojo) por día. Úsalo cuando alguien pregunte si hay alertas o avisos meteorológicos o de huaicos para un lugar del Perú, hoy o en los próximos días.
---

# avisos-pe

CLI que reproduce los avisos oficiales del SENAMHI. Consulta al SENAMHI en vivo (caché de 10 minutos).

## Flujo

1. Consigue **coordenadas** (lat/lon WGS84); en asentamientos humanos pide la ubicación compartida antes que una dirección.
2. Consulta (si no está instalado globalmente, antepone `npx @osrcmap/` a cada comando `avisos-pe`, también a los de `next-step`):
   ```bash
   avisos-pe punto --lat <lat> --lon <lon> --json
   ```
   Para otro momento: `--momento 2026-10-19T15:00-05:00` (siempre con zona horaria).
3. Para el texto oficial completo: `avisos-pe aviso <numero> --anio <anio> --json`.
4. Panorama nacional: `avisos-pe vigentes --json`.

## Cómo responder al usuario

- Di el **nivel por día** (amarillo, naranja, rojo), el **título** del aviso y su **vigencia**, y comparte el enlace `url` del aviso.
- Transmite el `aviso` de la respuesta y cita `datos.obtenido_en`.
- Si hay `quebradas`, destácalo: es el aviso de posible activación de quebradas (huaicos) en las próximas horas. Incluye su `recomendacion`.
- Si `no_evaluables` no está vacío, dilo: hay avisos activos que no se pudieron evaluar para ese punto.
- **Nunca** digas que un lugar "está a salvo" porque no haya avisos.
- **Nunca** des órdenes de evacuación ni subas o bajes niveles. Remite a INDECI, SENAMHI y la municipalidad.

## Errores

Respuesta `{"ok": false, "code", "error", "hint"}`:
- `FUENTE_NO_DISPONIBLE` o `FORMATO_INESPERADO`: **no** hay información, no "no hay avisos". Dilo así y sugiere revisar senamhi.gob.pe.
- `FUERA_DE_COBERTURA`: casi siempre lat/lon invertidos.
- `ARGS_INVALIDOS`: revisa `avisos-pe schema <comando>`.
