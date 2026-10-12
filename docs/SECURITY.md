# Seguridad y privacidad

Propósito: definir controles y límites antes de implementarlos. Estado: propuesta v1. PIN, biometría, secretos seguros, cifrado de SQLite y backups NO están implementados; la pantalla y la base técnica contienen únicamente muestras sintéticas fijas, sin datos financieros reales.

## Modelo de amenazas

Proteger datos contra acceso casual con dispositivo desbloqueado, pérdida/robo, lectura de archivos/backups, cloud mal configurado, errores de restore, telemetría, capturas en segundo plano, inyección SQL, XSS en web y automatización no autorizada. Un sistema operativo comprometido, una app maliciosa con control del dispositivo o un cliente modificado pueden acceder a datos/llaves usados en memoria; cifrar no elimina esas limitaciones.

Admin no dispone de tablas financieras remotas ni llaves del usuario. Aunque operadores privilegiados puedan acceder al ciphertext de Storage, no deberían poder descifrarlo. Un administrador que controla despliegues podría publicar código malicioso: separación de permisos, revisión de cambios y auditoría del backend/deploy son controles adicionales; no prometer privacidad absoluta por usar RLS.

## Controles locales futuros

- PIN: verificador resistente a extracción con salt/KDF revisados, intentos limitados y demoras. No guardar PIN en texto ni cifrar backup portable solo con PIN corto. Recuperación no puede convertirse en bypass silencioso del cifrado.
- Biometría: mecanismo de OS que permite acceso a una llave almacenada de forma segura; no guardar datos biométricos ni enviarlos a cloud. Cambios de biometría, revocación y fallback PIN requieren política explícita.
- Autolock: por inactividad y transición a segundo plano; bloquear antes de volver a mostrar datos, con tolerancia configurable. La UI bloqueada no es equivalente a cifrado en disco.
- Fondo: ocultar datos sensibles en snapshot del selector de apps, proteger notificaciones y considerar restricciones de captura donde plataforma lo permita. No prometer bloqueo universal de screenshots en web/iOS.
- Secretos: llave de base/backup y tokens en adaptador de almacén seguro de OS; nunca AsyncStorage, logs, .env públicas, settings, SQLite sin protección ni repositorio. Limpiar llaves de memoria cuando proceda sin prometer borrado garantizado en JS.
- SQLite: cifrado futuro mediante solución revisada y soporte real por plataforma; valorar SQLCipher en build nativo. Migrar una base clara a cifrada de forma segura, con rollback y limpieza controlada. No activar un flag y asumir que toda copia/temporal queda cifrada.

[Expo SQLite SDK 57](https://docs.expo.dev/versions/v57.0.0/sdk/sqlite/) documenta que SQLCipher requiere configuración nativa y no está disponible en Expo Go. Cuando llegue esa fase, crear development build, sin instalar Android Studio por anticipado. Web SQLite está en alpha y sus necesidades de WASM/cabeceras deben validarse; no asumir SQLCipher, biometría y almacenamiento seguro nativo disponibles en navegador.

Para web definir frontera separada: HTTPS/origen aislado, CSP, prevención de XSS, sin secretos persistidos en localStorage, protección de llave con mecanismo revisado y bloqueo de sesión local. Llave en memoria sin recuperación puede perderse al recargar; persistencia de navegador es borrable y no es una garantía de respaldo. La UI debe reflejar capacidades reales, no afirmar equivalencia de cifrado nativo/web antes de pruebas.

## Identidad, acceso offline y perfil

LOCAL no necesita Supabase ni acceso a internet. Un token expirado o servidor caído no bloquea finanzas existentes, aunque sí requiere revalidación para operaciones cloud. PIN local y Auth remoto son mecanismos distintos. Login/logout/cambio de usuario no destruye ni transfiere propiedad local automáticamente; gestionar asociación de perfil y política de cierre/bloqueo explícitamente. Logout retira sesiones y caché de autorización remota, preservando el perfil salvo eliminación solicitada y respaldada.

La sesión remota tiene su propio ciclo de vida, separado del acceso a datos locales; ver [Supabase sessions](https://supabase.com/docs/guides/auth/sessions). Cloud usa sesión válida más permisos del servidor; no permitir upload por rol importado en backup o flag local modificado. Roles y permisos remotos solo cambian por backend autorizado. ADMIN requiere controles reforzados de sesión y privilegio mínimo en aplicación web separada.

## Privacidad cloud y admin

Cifrar backups en dispositivo antes de upload; autenticar el ciphertext; la llave no viaja con archivo ni se deriva de user_id/token. Recuperación bajo control del usuario, sin llave maestra de admin. Bucket privado y RLS por propietario; endpoint de retención igualmente verifica usuario/permiso, nunca confía en user_id del formulario. URL firmada de corta duración si se necesita; no registrar URLs/tokens. Credencial service-role nunca en app móvil/web pública; clave pública de cliente no sustituye políticas del backend.

Admin permite identidad/estado de cuenta, plataforma, versión app, cloud habilitado, fecha/tamaño del último backup y errores técnicos mínimos. Prohibidos saldos, compras, tarjetas, deudas, personas, conceptos, categorías, movimientos y contenido descifrado. No enviar cantidad de filas/estadísticas financieras bajo la etiqueta de métricas técnicas. Mensajes técnicos sanitizados sin SQL con valores, rutas privadas, payloads, capturas ni nombres de archivos sensibles. La administración de flags no puede habilitar upload financiero automático.

## Validación, consistencia y registro

Repositorios con SQL parametrizado, nunca concatenación de entradas. Esquema y reglas monetarias validados antes de confirmar; comprobar FKs, moneda/perfil, asientos, fondos, idempotencia y límites. Restore trata archivos como datos hostiles: no ejecutar SQL o código importado, rechazar formato inválido y límites excesivos. No imprimir backups ni movimientos en console/logs/errores. Auditoría financiera local puede registrar motivo/ID y reversos, sin envío remoto. Registro remoto solo técnico y opt-in cuando corresponda.

Dependencias se revisan antes de distribución. La preparación reportó 29 avisos de auditoría del template: resolver con versiones compatibles o documentar evaluación real antes de publicar; no silenciar doctor/lint ni forzar degradaciones incompatibles. No instalar módulos de seguridad en esta fase documental.

## Notificaciones y automatización

Recordatorios opcionales, locales donde sea viable; permisos denegados no rompen calendario. Propuesta de privacidad: contenido genérico por defecto sin montos/personas en pantalla bloqueada. Cambiar zona/fecha/restaurar exige reprogramar y deduplicar. Sistemas móviles limitan ejecución en fondo; no prometer alertas exactas o registros financieros garantizados desde procesos de fondo.

Detector Android futuro requiere consentimiento granular y revocable para acceso a notificaciones. Procesamiento local, filtros específicos, retención mínima de texto y deduplicación de sugerencias; no enviar notificaciones bancarias a servidor. Registrar/Editar/Ignorar confirma la intención antes de crear movimiento; parser nunca ejecuta instrucciones del texto ni registra silenciosamente. Una sugerencia es dato no confirmado, no movimiento ni deuda. Cancelar permiso detiene detección y limpia pendientes según política definida. No implementado ahora.

## Puertas de aceptación

Pruebas de bloqueo/fondo, intentos PIN, biometría cambiada, recuperación sin dispositivo original, migración cifrada/rollback, pérdida de llave, restore hostil, acceso entre perfiles/usuarios, revocación cloud, admin sin datos/llaves, logs sanitizados, temporales y exposición web. Definir comportamiento sin almacén seguro y sin soporte de cifrado antes de prometer protección. Toda decisión criptográfica concreta requiere revisión antes de implementar y probar con datos reales.

## Restricción aprobada para fase 2

No almacenar datos financieros reales sin cifrado. El laboratorio no pide entradas financieras y su importador acepta solo campos/IDs sintéticos conocidos con valores enteros acotados. La etiqueta SYNTHETIC no es una clasificación automática de datos ni un control criptográfico; nunca reutilizar este formato o base para producción. No se implementan cifrado, Auth, Supabase, biometría ni admin en esta fase. Los permisos y diálogos locales solo sirven al ensayo de archivos.
