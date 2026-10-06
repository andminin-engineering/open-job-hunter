# OJH-KANBAN-SCALE-001 — tablero utilizable con más de 200 vacantes

## Baseline y objetivo

- Baseline compartido: `d6105b7aaf9e1d9c179818ed49a16f8db786b88a`.
- El usuario aprobó: altura adaptable y scroll interno por columna; accesos siempre visibles a Ofertas y Descartadas; búsqueda y orden; carga paginada con total real; tarjetas distinguibles cuando hay varias de la misma empresa.
- La copia de la base real del ejecutable confirmó 301 registros, de los cuales 8 usan estados heredados de sólo lectura: `aplicada` (7) y `entrevista_inicial` (1). Deben quedar visibles sin migrar ni alterar la base.
- La mejora sigue siendo local hasta autorización humana específica de push/merge/release. No ejecutar GitHub Actions manualmente.

> Decisión de producto posterior (2026-10-06): el pedido de UX se amplió después de este contrato inicial. La vista **Tablero** muestra seis columnas: las cuatro en curso, **Con oferta** (`oferta`) y **Rechazadas** (`rechazada`). **Descartadas**, **Sin evaluar** y **Otros estados** tienen vistas enfocadas; Con oferta y Rechazadas también pueden enfocarse por separado. El propietario eligió **Con oferta** porque el estado registra una propuesta recibida, no una aceptación ni un servicio prestado; una aceptación futura debe poder consolidar el historial profesional con significado propio. Las referencias a **Ofertas** y a una vista agrupada **Descartadas/Rechazadas** más abajo describen la propuesta original, no la interfaz final. La API `estados` sigue disponible y se usa para leer estados heredados.

## Contrato API acordado

`GET /api/pipeline` conserva su uso actual y acepta además:

- `offset`: entero no negativo, predeterminado `0`.
- `q`: búsqueda sin distinguir mayúsculas/minúsculas por empresa, fuente y texto de la oferta.
- `sort`: `updated_desc` (predeterminado), `score_desc` o `company_asc`.
- `estados`: lista CSV de estados válidos para una vista agrupada, por ejemplo `descartada,rechazada`. No se combina con `estado`; `estado` singular existente sigue funcionando.
- Para consultas de lectura, `estado`/`estados` también aceptan los dos valores heredados `aplicada` y `entrevista_inicial`. Esto no amplía los estados permitidos para escribir o mover vacantes.
- `limit`: mantiene el máximo existente de 200 y su comportamiento previo para clientes actuales.

Respuesta: `{ ok: true, total, allTotal, items, limit, offset, hasMore }`. `total` es la cantidad que coincide con estados y búsqueda antes de paginar; `allTotal` cuenta todas las vacantes guardadas, sin filtros; `items` es sólo la página solicitada; `hasMore` indica más elementos del filtro. Orden estable con desempate por fecha de actualización e ID. Parámetros nuevos malformados responden 400. No alterar los registros ni el formato del archivo de datos.

## Propiedad de archivos y revisión

- Claude Code: sólo `src/index.ts` para el contrato API. Commit local sin push. No editar interfaz ni tests.
- Codex: `app/index.html`, tests de interfaz e integración HTTP/runtime, y documentación de uso si corresponde. Codex integra y ejecuta los gates; revisa independientemente el backend de Claude.
- Claude revisa en modo lectura la implementación UI de Codex; Copilot o Cursor puede revisar el diff combinado si está disponible. Nadie aprueba código que editó.

## Comportamiento de la interfaz

- En escritorio, las cuatro columnas activas quedan en una misma fila; Ofertas, Descartadas/Rechazadas, Sin evaluar (`nueva`) y Otros estados (`aplicada`, `entrevista_inicial`) tienen accesos visibles con contadores y vista propia, sin quedar ocultas debajo de columnas largas.
- Cada lista usa alto relativo al viewport y scroll interno; encabezado y cantidad permanecen visibles. Las regiones con scroll son accesibles por teclado y tienen nombre accesible.
- Se cargan páginas por estado/grupo con un control explícito `Ver más`, sin insinuar que sólo existen los elementos cargados. La búsqueda y el orden actúan sobre todos los datos a través de la API, no sólo sobre la página visible.
- `Vacantes registradas` usa `allTotal`, no `items.length`; los contadores de columnas usan `total` filtrado. Se diferencia el estado `rechazada` del `descartada` en tarjetas agrupadas.
- La tarjeta muestra además un fragmento seguro y breve de la descripción para distinguir vacantes de la misma empresa. La interfaz nunca interpreta HTML de fuentes externas.
- Los cambios de estado refrescan los contadores y las listas sin borrar registros. Diseño usable con ventana pequeña y zoom.

## Verificación

- Tests para `>200` registros: página, total real, búsqueda, orden, `estados`, estados no ocultos, filtros y `hasMore`.
- Tests de interfaz: columnas acotadas, controles de navegación, carga adicional y búsqueda/orden consultando API, no filtrado sólo local.
- Gates: `npm run build`, `npm test`, `npm run test:runtime`, `npm run doctor`, `npm audit --audit-level=high`, `git diff --check`.
- Handoff con commit(s), archivos, salida real de gates, revisión y pendientes; sin push/merge/release.
