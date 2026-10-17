# Limitaciones

Lee esto antes de usar `avisos-pe` para informar a personas.

## Qué es y qué no es

- **Reproduce** los avisos del SENAMHI: nivel, vigencia, zonas y textos tal como se publican. No genera avisos propios ni cambia niveles.
- **No es una orden de evacuación** ni reemplaza los canales oficiales (INDECI, SENAMHI, municipalidad, SISMATE).
- **Las zonas son regionales.** Un polígono de aviso indica dónde se esperan las condiciones (por ejemplo, "sierra norte"), no la lluvia que caerá en cada calle.
- **Ausencia de avisos ≠ seguridad.** Puede llover fuerte o activarse una quebrada sin aviso vigente.

## Dependencia de la fuente

- **El SENAMHI no responde desde fuera del Perú o desde la nube.** El 17 de octubre de 2026, senamhi.gob.pe agotó el tiempo de espera desde GitHub Actions (EE. UU.) en dos intentos, mientras respondía en menos de 2 s desde el Perú. Un bot o servidor que use avisos-pe debe correr en el Perú o salir por un proxy peruano.
- Se consulta al SENAMHI en cada uso (con caché de 10 minutos). Si no responde, el resultado es el error `FUENTE_NO_DISPONIBLE`, nunca una lista vacía.
- La lista de avisos se lee del HTML de senamhi.gob.pe. Si cambia el formato, el resultado es `FORMATO_INESPERADO`. Una fila reciente ilegible hace fallar la consulta completa para no perder un aviso; las filas antiguas ilegibles se descartan y `doctor` las cuenta.
- Si el SENAMHI no publica las zonas de un día de un aviso, ese aviso aparece en `no_evaluables`.

## Interpretación

- **El nivel 1 (verde) no se reporta.** Cada aviso trae un polígono de nivel 1 que cubre el resto del país con el texto "No es necesario tomar precauciones especiales". Reportarlo haría que todo punto "tenga" todos los avisos.
- **Zonas superpuestas:** los polígonos de distintos niveles se superponen; se reporta el nivel más alto que contiene al punto.
- **Puntos en el borde** de un polígono pueden quedar dentro o fuera según la precisión del trazo del SENAMHI.
- Los días de un aviso van de 00:00 a 23:59:59 hora de Lima, según los polígonos publicados.

## Aviso de activación de quebradas

- Solo se conoce el aviso **vigente o el último**: la capa del SENAMHI no guarda historial.
- Número, nivel, inicio y duración se leen de la página del aviso; los polígonos y textos por distrito, de la capa WFS. Si ambos se desincronizan (por ejemplo, la página se actualiza antes que la capa), el resultado puede mezclar dos avisos durante unos minutos.
- La página también muestra un comunicado de 2020 sobre la suspensión del servicio; se ignora a propósito (ver RESEARCH.md).

## CAP

- **No es un CAP oficial:** el SENAMHI no publica CAP. Cada alerta lo dice en `<note>` y usa como `sender` este proyecto.
- CAP no admite huecos en polígonos: el área CAP incluye los huecos, así que sobreestima la zona (nunca la reduce).
- Un CAP de un aviso nacional puede pesar más de 1 MB por el detalle de los polígonos.
- El nivel 1 no se emite. `urgency` sale de la vigencia (`Expected` en curso, `Future` próximo, `Past` terminado) y `severity` del nivel (amarillo `Moderate`, naranja `Severe`, rojo `Extreme`).

## No cubierto (aún)

- Avisos hidrológicos y avisos de las direcciones zonales del SENAMHI.
- Historial de avisos de quebradas.
