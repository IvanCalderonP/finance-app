# Fase 2 — prueba técnica de almacenamiento

Fecha: 2026-10-12. Solo datos sintéticos. Estado: laboratorio implementado, validación auxiliar realizada y pruebas Android confirmadas por el usuario; evaluación completa de web pendiente. La evidencia Android es el reporte del usuario, no una ejecución observada directamente por el agente.

## Alcance y dependencias

Añadidas con expo install y npm: expo-sqlite 57.0.4, expo-file-system 57.0.7, expo-document-picker 57.0.3 y expo-sharing 57.0.23. Las tres últimas permiten los archivos locales de ensayo. Sin dependencias nuevas de tests: node:test y node:sqlite de Node 24.21.0.

Expo detectó parches compatibles y se aplicaron: expo 57.0.28, expo-router 57.0.26, expo-splash-screen 57.0.10 y @expo/ui 57.0.23. No se cambió Node ni se instaló Android Studio/ADB u otro software de sistema. npm audit informa 30 alertas (12 moderadas, 18 altas); no se forzó una actualización incompatible. Antes de producción deberá hacerse su revisión.

## Estructura técnica

- src/database/technical/schema.ts: nombre de base y migración mínima V1.
- src/database/technical/lab.ts: migración, cola de acceso, transacciones, validación, snapshot, restauración y diagnóstico.
- src/database/technical/expo-adapter.ts: conexión Expo con carga diferida fuera del render del servidor.
- src/features/storage-lab/StorageLabScreen.tsx y src/app/storage-lab.tsx: pantalla técnica, sin diseño financiero.
- src/services/technical-files/index.ts y index.web.ts: archivos nativos/web separados.
- tests/storage-lab.test.mjs: tests con SQLite real de Node sobre el mismo núcleo técnico.
- metro.config.js: soporte WASM; conservar la carga lazy y el mapa de bundles del worker.

Base finance-storage-lab-v1.db, aislada de cualquier futura base financiera. Dos tablas lab_parents/lab_samples con CHECK de IDs/campos fijos, tag SYNTHETIC, FK RESTRICT y enteros de prueba. No cuentas, tarjetas, presupuestos, deudas, metas, Auth, cifrado ni Supabase. Migrar/leer al iniciar no resembran muestras, para no producir una falsa prueba de persistencia.

## Resultados y límites de evidencia

| Comprobación | Resultado observado | Lo que NO demuestra |
| --- | --- | --- |
| TypeScript / lint | Correctos | Ejecución nativa |
| Expo Doctor | 21/21 | Confiabilidad de SQLite web |
| Tests SQLite real de Node | 11/11 | Equivalencia de adaptador Expo nativo/WASM |
| Persistencia | Cerrar/reabrir conexión y lectura desde otro proceso Node sin sembrar: correctos | Cierre completo de Expo Go o pestaña |
| Commit / rollback / FK | Correctos en SQL de Node; migración fallida revierte esquema y user_version | Resultado de esos controles en un teléfono |
| Exportar/importar | Archivo JSON en disco, roundtrip, restore repetido y fallo de restore con rollback: correctos en Node | Que el diálogo de Android guardó un archivo o el navegador lo descargó |
| Android | Bundle generado y usuario confirma las cuatro pruebas: diagnóstico, cierre/reapertura, reinicio completo y exportación/restauración | Evidencia reportada por usuario; agente sin acceso al teléfono; modelo/OS/versión Expo Go no registrados |
| Web | /storage-lab responde HTTP 200 con COEP require-corp y COOP same-origin; exportación genera HTML, JS, worker y WASM | No se ejecutó el worker ni SQLite en navegador controlable; persistencia del navegador pendiente |

Los 11 tests cubren migración repetible, apertura sin siembra, commit/rollback/FK/roundtrip, persistencia en otro proceso, export/import de archivo, rechazo de archivos inválidos, rollback de restore fallido, serialización del propietario de conexión, reactivación de FK, rechazo de esquema futuro y rollback de primera migración fallida y recuperación de un diagnóstico interrumpido (algunas verificaciones agrupadas en un test).

## Error web encontrado y corrección

El usuario reportó Worker chunk not found for expo-sqlite/web/worker.ts. Se reprodujo HTTP 500 en /storage-lab. Desactivar lazy bundling mediante EXPO_NO_METRO_LAZY=1 hizo responder el HTML, pero el usuario después confirmó un fallo real del navegador: Bundle splitting is required for Web Worker imports. Ese workaround era incompleto y fue retirado; no debe recomendarse ni mantenerse como variable de entorno.

Corrección final: conservar lazy bundling predeterminado y cargar expo-sqlite mediante import() únicamente cuando se abre la conexión (fuera de SSR), con Metro reiniciado y cache limpia. Se comprobó HTTP 200 en /storage-lab, el bundle cliente con lazy=true y mapa hacia expo-sqlite/build/index.bundle, ese módulo HTTP 200 con mapa hacia expo-sqlite/web/worker.bundle, y el worker HTTP 200. Esto comprueba la cadena de carga y resuelve la ausencia de mapa identificada en el error; no equivale a ejecución de SQLite ni prueba de persistencia en navegador. Después de la corrección, el usuario respondió «listo prosigue». Se toma como confirmación de apertura del laboratorio web, sin evidencia aún de las operaciones SQL, persistencia tras cerrar pestaña o manejo de archivos. No se modificaron node_modules ni configuraciones globales.

Fue necesario reiniciar Metro y limpiar su cache. No se mata el servidor iniciado por el usuario; la prueba del agente usó 8082 para no interrumpir 8081. Las cabeceras se verificaron por HTTP. Una exportación estática necesita que su servidor de hosting también entregue dichas cabeceras; no está publicada.

## Protocolo Android pendiente

1. En la carpeta finance-app, detener el servidor antiguo y ejecutar npx expo start --clear. Abrir QR en Expo Go compatible con SDK 57.
2. Entrar a Abrir prueba técnica SQLite. No se insertan filas al iniciar; solo se elimina una posible fila lab-probe de diagnóstico interrumpido, sin cambiar lab-persist.
3. Insertar muestra una vez y anotar value de lab-persist. Leer sin insertar. Cerrar conexión/reabrir y comparar.
4. Ejecutar diagnóstico; deben aparecer Commit, Rollback, Foreign keys y restauración interna en OK. El marcador previo debe conservarse.
5. Cerrar completamente Expo Go, volver a abrir la app y leer sin pulsar Insertar: mismo marcador. Recargar JS no equivale a cierre de proceso.
6. Exportar el archivo sintético, confirmar dónde se guardó, incrementar el marcador, seleccionar archivo exportado y confirmar restauración: vuelve al valor exportado. Repetir importación no añade filas.
7. Evaluar operaciones con red desconectada una vez cargado el código. Expo Go puede necesitar Metro/red para volver a cargar el bundle: el arranque offline de un binario instalado requiere prueba posterior con development build, no lo garantiza este ensayo.

Registrar teléfono/OS/Expo Go y resultados, sin datos personales. El botón Cerrar conexión/reabrir verifica conexión, no fuerza reinicio de la app.

## Protocolo web independiente pendiente

Abrir http://localhost:8081/storage-lab (o el puerto indicado), ejecutar controles anteriores, cerrar toda la pestaña y reabrir exactamente el mismo origen/puerto. Cambiar puerto u origen cambia almacenamiento: no interpretarlo como pérdida en el mismo perfil. Verificar crossOriginIsolated/SharedArrayBuffer y que WASM/worker cargan; errores se muestran en pantalla.

Probar navegador normal/privado, cierre del navegador, cuota/borrado de datos y dos pestañas intentando escribir. La cola implementada serializa solo una instancia; no se declara resuelta la concurrencia entre pestañas. Ensayar descarga/selección/confirmación de archivo sin subirlo a ninguna red. El usuario reportó ambos errores del worker y, tras la segunda corrección, confirmó «listo prosigue». Esto acredita apertura según su reporte, pero todavía no confirma persistencia ni restauración del navegador.

No se implementó PWA/service worker: cargar la web sin internet no está probado ni garantizado. Validar caché de recursos y persistencia real por navegador antes de aceptar funciones offline web. Según [Expo SQLite SDK 57](https://docs.expo.dev/versions/v57.0.0/sdk/sqlite/), el soporte web es alpha y necesita WASM/SharedArrayBuffer; withExclusiveTransactionAsync no está disponible en web. El laboratorio usa transacción explícita con conexión propiedad de una cola, sin afirmar que esto basta para todos los escritores del navegador.

## Backups de ensayo y seguridad

FinanceApp_SYNTHETIC_LAB.json tiene formato/esquema V1, padres y muestras. Se rechazan campos adicionales, IDs ajenos, decimales, relaciones inválidas, duplicados y archivos de más de 16 KB. La restauración solo toca la base técnica y exige confirmación en pantalla. No es el backup financiero de producción, no tiene cifrado ni nube. La etiqueta sintética no es un mecanismo para clasificar datos reales: no reutilizar el laboratorio con ellos.

Android usa cache temporal y diálogo de compartir; al importar se lee una copia en cache y se elimina esa copia. Web descarga Blob y usa selector de archivos. La restauración es un reemplazo transaccional del dataset; no importa SQL ejecutable ni suma saldos guardados. Recuperación por perfil completo y cifrado quedan para sus fases futuras.

## Viabilidad y siguiente puerta

La separación motor/contratos/SQLite sigue siendo viable como arquitectura y los tests auxiliares respaldan las operaciones SQL mínimas. Android supera las pruebas básicas según confirmación del usuario; web NO está aprobado para datos financieros ni como alternativa fiable todavía. El error de bundling se corrigió a nivel servidor, pero no permite concluir persistencia web. No sustituir SQLite por Supabase si web falla.

Antes de aprobar paridad multiplataforma: completar las pruebas de runtime web y registrar sus resultados. Android cuenta con confirmación básica del usuario; no ampliar el alcance de implementación sin nueva instrucción. Si web no cumple, mantener SQLite local nativo y revisar el adaptador web sin cloud financiero. No usar datos financieros reales sin cifrado y revisión de seguridad. Esta fase no inicia módulos financieros ni admin.

## Archivos modificados/creados

Modificados: app.json, package.json, package-lock.json, tsconfig.json, src/app/index.tsx y los seis documentos ARCHITECTURE, FINANCIAL_RULES, DATABASE, FEATURES, BACKUP_SYSTEM y SECURITY. Creados: metro.config.js, ruta storage-lab, carpeta src/database/technical, carpeta src/features/storage-lab, carpeta src/services/technical-files, tests/storage-lab.test.mjs y este informe. README incorpora acceso e instrucciones de la fase 2. No se modificó src/financial-engine ni se implementaron módulos financieros.

## Confirmación Android del usuario — 2026-10-12

Tras recibir el protocolo de cuatro pasos para Expo Go Android, el usuario respondió «todo bien». Se registra como confirmación reportada de inserción/lectura, cierre y reapertura de conexión, diagnóstico con commit/rollback/foreign keys, conservación del marcador tras cerrar completamente Expo Go y exportación/importación con restauración del valor exportado. No se recibieron logs ni detalles de dispositivo; no es una prueba directamente observada por el agente. No confirma arranque sin internet, concurrencia entre pestañas ni persistencia/restauración web.
