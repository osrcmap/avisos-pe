# Investigación de fuentes

Cómo publica el SENAMHI sus avisos, verificado el 17 de octubre de 2026.

## Avisos meteorológicos

### Lista (HTML)

`https://www.senamhi.gob.pe/?p=aviso-meteorologico`: una tabla con **todos los avisos desde 2021** (2,100 filas, ~1.3 MB, sin gzip). Columnas: Aviso, Nro., Emisión, Inicio, Fin, Duración, Nivel.

- El número se reinicia cada año; el año está en el enlace de la fila (`a=2026`), junto con un id interno (`b=29288`).
- La columna Nro. marca `(emitido)` (aún no empieza) o `(vigente)`; los vencidos no llevan marca. avisos-pe decide por fechas, no por esa marca.
- Nivel: AMARILLO, NARANJA o ROJO (el máximo del aviso).
- Todas las filas son de la sede nacional (`c=00&d=SENA`).

### Zonas (GeoServer WFS)

El mapa de cada aviso (`/mapas/mapa-avisos-meteorologicos/`) usa la capa WMS `g_aviso:view_aviso` de `https://idesep.senamhi.gob.pe/geoserver`. La misma capa responde **WFS en GeoJSON**:

```
/geoserver/g_aviso/ows?service=WFS&version=2.0.0&request=GetFeature
  &typeNames=g_aviso:view_aviso&outputFormat=application/json&srsName=EPSG:4326
  &viewparams=qry:{numero}_{mapa}_{anio}
```

- **Un mapa por día calendario** entre inicio y fin, ambos incluidos; el mapa siguiente viene vacío. Verificado con los 8 avisos activos.
- Campos: `nro_aviso`, `nro_mapa`, `nivel` ("Nivel 1".."Nivel 4"), `fecha_emi`, `fech_ini`/`fech_fin` (UTC; 05:00Z = 00:00 en Lima), `cod_fen`, `cod_even`, `cod_sede`, `respons`, `pub`, `cap`, `geom` (MultiPolygon, lon/lat).
- **Cada aviso incluye un polígono de nivel 1** que cubre el resto del territorio ("No es necesario tomar precauciones especiales").
- **Los niveles se superponen** (un punto naranja también está dentro del amarillo).
- Polígonos muy detallados: ~2.3 MB por día de un aviso; con `Accept-Encoding: gzip`, ~680 KB.
- `g_aviso:view_aviso_aux` (mismo `viewparams`) lista departamentos y provincias del día, sin geometría ni nivel.
- No conocemos las tablas de `cod_fen`/`cod_even` ni el significado de `pub` y `cap` (`cap` vale 0 en todos los avisos vistos).

> **El filtro espacial del servidor no es confiable.** `CQL_FILTER=INTERSECTS(geom, POINT(lon lat))` devolvió **cero** polígonos para 20 de 20 puntos que Turf ubica dentro de uno (aviso 423, mapa 1). Usarlo habría dicho "sin avisos" a personas en zona de aviso. avisos-pe descarga los polígonos y evalúa en local con `@turf/boolean-point-in-polygon`.

### Descripción

Cualquier página de detalle (`?p=aviso-meteorologico-detalle&a=…&b=…`) trae **una pestaña por aviso activo** con id `tabs-{numero}{anio}` y el texto "El SENAMHI informa que…".

### Textos de nivel (leyenda del mapa)

1. No es necesario tomar precauciones especiales.
2. Pueden ocurrir fenómenos meteorológicos peligrosos que, sin embargo, son normales en esta región…
3. Se predicen fenómenos meteorológicos peligrosos…
4. Se predicen fenómenos meteorológicos de gran magnitud…

(Textos completos en `src/senamhi.ts`.)

## Aviso de corto plazo ante posible activación de quebradas

Página: `https://www.senamhi.gob.pe/main.php?dp=lima&p=aviso-activacion-quebrada` (el contenido es nacional). Indica la posibilidad de activación de quebradas (huaicos) por la lluvia pronosticada para las siguientes 24 horas, considerando la lluvia de los 7 días previos y la susceptibilidad a movimientos en masa.

- La pestaña `#nav-aviso-tab` dice "Aviso 289 - 2026"; el panel `#nav-aviso` trae nivel, "Fecha de inicio: Viernes 16 octubre 2026 - 13:00 horas" y "Duración: 24 hrs".
- **Trampa:** la página también muestra un COMUNICADO de 2020 ("…Decreto Supremo N°044-2020-PCM…") que **no** está comentado en el HTML. Un regex sobre todo el texto lo toma como "aviso 44 de 2020". avisos-pe lee solo la pestaña y el panel del aviso, y verifica que coincidan.
- Zonas: WFS `g_acti_quebrada:view_av_activ_qdra` (sin `viewparams`): solo el aviso actual. Campos `nivel`, `fecha`, `descripcion`, `recomendacion`, `nombdep`, `nombprov`, `nombdist`, `geom`. No trae número ni vigencia.
- El mapa también llama a `include/ajax_informacion*.php` (conteos de instituciones educativas, establecimientos de salud y vías expuestas); no se usa.

## Acceso desde el extranjero

El 17 de octubre de 2026, `https://www.senamhi.gob.pe` agotó el tiempo de espera (30 s, dos ejecuciones) desde los runners de GitHub Actions, mientras respondía en 1.7 s desde una conexión en el Perú. Parece un bloqueo a IPs extranjeras o de nube. Por eso no hay un chequeo diario de la fuente en CI.

## CAP

El SENAMHI no publica CAP: no hay feed en su web ni aparece en el Severe Weather Information Centre de la OMM. avisos-pe genera CAP 1.2 validado contra `CAP-v1.2.xsd` de OASIS.

## Pendiente

- Avisos hidrológicos (`?p=aviso-hidrologico`) y páginas por departamento (`main.php?dp=<depto>&p=avisos`).
- Tablas de códigos `cod_fen` / `cod_even`.
- Historial de avisos de quebradas (la capa WFS solo tiene el actual): requiere capturas periódicas.
- Confirmar con el SENAMHI condiciones de reutilización y si planean publicar CAP.
