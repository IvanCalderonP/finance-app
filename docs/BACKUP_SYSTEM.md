# Sistema de backups y restauración

Propósito: definir recuperación local y nube opcional sin convertir cloud en la base financiera. Estado: diseño v1, sin implementación, cifrado ni cuenta real configurados.

## Alcance y contenido

Todo perfil, incluido LOCAL sin cuenta, puede exportar, importar y restaurar un archivo. Nombre base FinanceApp_Backup_YYYY-MM-DD; propuesta agregar hora/ID para evitar sobrescribir exportaciones del mismo día. Extensión final pendiente de especificación del formato.

Propuesta de contenedor versionado: cabecera mínima (format_version, algoritmo/versión criptográfica, KDF, salt, nonce, tamaño); payload con manifest y dataset canónico. Dentro del payload: schema_version, versión app, plataforma, fecha UTC, perfil/origen local, conteos y checksum de integridad. Exportar cuentas, ledger/asientos, movimientos/desgloses, categorías, tarjetas/ciclos/aplicaciones, deudas/pagos, recibos/recurrencias, presupuestos, asignaciones/compromisos/historial, metas/aportes/reservas, otros activos, eventos y preferencias financieras. No exportar tokens, sesiones, contraseñas, PIN/verificadores locales, biometría, llaves sin envolver ni credenciales de Supabase. Las proyecciones, cachés remotas e identificadores de notificación se reconstruyen; backup_metadata evita incluir recursivamente archivos de backup.

No incluir nombre de persona, saldo ni concepto financiero en nombre de archivo, ruta cloud o cabecera pública. Metadatos privados permanecen cifrados.

## Formato, integridad y cifrado futuros

La fase 2 autorizada utiliza exclusivamente datos sintéticos sin cifrar; debe identificarse como prototipo. Antes de datos reales o upload, implementar cifrado autenticado en dispositivo, compresión antes de cifrado, límites de tamaño y validación versionada. Algoritmo, librería y parámetros de KDF deben seleccionarse y revisarse en fase de seguridad, no crear criptografía propia.

El checksum detecta corrupción accidental, no sustituye autenticidad. AEAD valida contenido y cabecera asociada. Llave de respaldo distinta del token de Supabase y del PIN de UI; recuperable con material controlado por usuario (clave/frase de recuperación o envoltura por secreto independiente). Guardar la llave local en almacenamiento seguro según plataforma; no enviar llave o secreto de recuperación al admin/servidor. Un PIN corto solo no protege un archivo portable frente a fuerza bruta. Sin llave recuperable, pérdida del dispositivo puede hacer el backup irrecuperable; explicar y comprobar recuperación antes de habilitar cloud.

## Exportación consistente

Tomar snapshot consistente a través del adaptador SQLite; no copiar archivo abierto ignorando WAL. No bloquear red dentro de la transacción. Exportar a temporal privado, validar manifiesto y coherencia, cifrar cuando corresponda y publicar/compartir solo archivo final. Limpiar temporales en éxito y fallo. Evitar temporales con payload sensible sin protección del sistema. Exportar no cambia saldo, compromisos ni movimientos.

## Importación y restauración segura

1. Usuario elige archivo; verificar formato y límites sin ejecutar contenido ni SQL del archivo.
2. Descifrar y autenticar; clave incorrecta/corrupción produce error, sin tocar la base activa.
3. Revisar compatibilidad de formato/esquema; rechazar versión futura desconocida. Migrar copia temporal solo por rutas de migración soportadas.
4. Cargar en base/perfil aislado, validando IDs, FKs, monedas, enteros, equilibrio de asientos, desgloses, financiación, conteos e idempotencia. Reconstruir saldos desde asientos; no sumar saldo exportado y ledger.
5. Mostrar fecha/origen/perfil y resumen local. Primera versión restaura por reemplazo del perfil elegido; no mezclar ni sumar movimientos. Respaldar el perfil anterior y pedir confirmación del reemplazo.
6. Cerrar conexiones y hacer sustitución atómica según plataforma, conservando recuperación del perfil previo si falla. No borrar origen ni backup elegido.
7. Recrear proyecciones y recordatorios con permisos actuales, invalidar cachés remotas y sesiones. No reasignar autorización por roles importados ni asociar automáticamente el perfil a otra cuenta cloud.

Restaurar dos veces el mismo archivo produce el mismo estado, no duplicados. Interrupción/crash deja base antigua utilizable o nueva completa. Importar un archivo ajeno requiere selección explícita del perfil y no otorga acceso a servicios cloud de su propietario.

## Roles y permisos cloud

| Modo/rol | Acceso local | Backup cloud |
| --- | --- | --- |
| LOCAL | Sin cuenta, finanzas y archivos offline | No |
| STANDARD | Cuenta opcional asociada, mismas finanzas locales | Solo si permiso explícito habilitado; rol no basta |
| CLOUD | Misma base local, cuenta asociada | Manual si cloud_backup_enabled=true y sesión/autorización válida |
| ADMIN | Permisos en web admin separado | No acceso a finanzas ajenas; no concede cloud automáticamente |

Propuesta: roles ayudan a clasificar usuarios, cloud_backup_enabled es permiso remoto específico. Asignar CLOUD debe coordinar permiso en backend, pero cliente siempre verifica ambos requisitos definidos por la política final. ADMIN es una capacidad administrativa separada, no una escalada para descifrar backups. Una caché de permiso solo informa offline; vencimiento/revocación impide nuevas acciones remotas hasta verificar. No bloquea SQLite, exportación ni historial local. No usar acceso a copia cifrada como autorización para leer finanzas.

## Storage y retención de dos copias

Bucket privado backups, prefijo user_id derivado de la sesión validada. latest y previous son roles lógicos, no sobrescrituras ciegas de archivos en uso. Usar IDs opacos/versiones y manifest remoto que referencia los dos objetos confirmados. El manifest contiene solo ID, fecha, tamaño, versión técnica y digest del ciphertext; jamás saldo, categorías, cantidades de movimientos o llave.

Protocolo propuesto: verificar autorización → cifrar localmente → subir temporal con ID idempotente → verificar tamaño/digest y éxito → hacer compare-and-swap del manifest por revisión para latest=nuevo y previous=latest anterior → eliminar objeto anterior a previous y temporales no referenciados. Storage no ofrece una transacción conjunta con la base remota: coordinar con endpoint autorizado y recuperación explícita. Conservar siempre el último backup válido hasta confirmar el reemplazo. La limpieza recupera fallos de upload, rotación, red y concurrencia; estado estable conserva únicamente última y anterior. Puede existir un tercer temporal limitado durante rotación; imponer cuota/TTL y limpieza de huérfanos para no acumular indefinidamente. Dos dispositivos no deben sobrescribir a ciegas el manifest.

Download cloud recupera ciphertext, valida y descifra localmente, siguiendo el mismo flujo de restauración con confirmación; nunca restauración automática al iniciar sesión. La nube conserva snapshots manuales, no cambios continuos ni mezcla de datos de dispositivos.

[Supabase Storage](https://supabase.com/docs/guides/storage/security/access-control) aplica control mediante RLS; en la fase cloud definir políticas por propietario y permiso para listar/leer/subir/reemplazar/eliminar. No confiar solo en nombres de carpeta. Service-role permanece únicamente en backend. Revocación, acceso a copias existentes y eliminación por política deben definirse antes de implementar; no borrar backups del usuario silenciosamente por un cambio de rol.

## Pruebas y riesgos

Roundtrip sin pérdida; claves erróneas; corrupción y AEAD; esquema antiguo/futuro; zip bomb y límites; FKs/asientos inválidos; restore repetido; crash durante reemplazo; WAL activo; temporales; pérdida de conexión; revocación; acceso entre usuarios; rotaciones concurrentes; retención última/anterior; archivo de otro perfil; recuperación en dispositivo nuevo sin sesión original. Metadatos filtrados y pérdida de clave son riesgos aun con ciphertext correcto. Diseñar experiencia y recuperación antes de upload real.

## Ensayo local fase 2

FinanceApp_SYNTHETIC_LAB.json es un formato de ensayo distinto del backup financiero futuro. Contiene únicamente kind, formatVersion=1, schemaVersion=1 y filas técnicas con IDs/campos fijos. Límite de 16 KB, validación de estructura, enteros, IDs, relaciones y ausencia de campos adicionales. No es un contenedor cifrado ni una implementación de cloud.

Restaurar reemplaza únicamente filas de la base de laboratorio en una transacción y tras confirmación en UI; no toca bases financieras. Si falla la escritura, rollback recupera las filas anteriores. Android exporta archivo temporal de cache mediante diálogo de compartir y lo elimina al terminar; importar copia a cache y limpia esa copia. Web descarga Blob y usa selector de archivos local, sin upload. Cancelar selección no cambia datos. Confirmar archivo guardado exige comprobar el diálogo/plataforma; el éxito de abrir compartir no garantiza que el usuario guardó el archivo.
