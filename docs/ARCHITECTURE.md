# Arquitectura de Finance App

Estado: implementación local de cuentas, movimientos, tarjetas, deudas, planificación, recibos, distribución, calendario, estadísticas y preferencias (14 de octubre de 2026). Este documento describe el código actual; los servicios de nube, cifrado y panel Admin siguen siendo diseño.

## Fuente de verdad y capas

SQLite local (`finance-local-v1.db`) es la fuente financiera. Los saldos, deudas, Disponible real, patrimonios, presupuestos y estadísticas se reconstruyen a partir de asientos, desgloses y eventos de financiación. Supabase no forma parte de la ruta de lectura o escritura financiera.

- `src/app/`: rutas delgadas de Expo Router. La barra inferior contiene Inicio, Movimientos, Calendario, Metas y Más; las rutas de herramientas permanecen accesibles desde Más y desde enlaces internos.
- `src/features/` y `src/components/`: formularios, estados de carga, navegación, aspecto claro/oscuro y ocultación visual de montos.
- `src/services/finance/`: casos de uso. Todas las escrituras financieras se realizan dentro de una unidad de trabajo SQLite; se comprueban perfil, moneda, idempotencia y financiación antes del commit.
- `src/financial-engine/`: reglas de dinero, ledger, tarjetas, deudas, presupuesto, recurrencia, calendario y estadísticas, sin acceso a React ni SQLite.
- `src/database/finance/`: migraciones, repositorios y conexión privada. Una cola serializa el acceso; `BEGIN IMMEDIATE`, `COMMIT` y `ROLLBACK` conservan la atomicidad.
- `src/services/notifications/`: selección de próximos recordatorios y sincronización con notificaciones locales tras commit o al volver a primer plano.
- `src/database/technical/`: laboratorio SQLite independiente, con datos sintéticos y pruebas de exportación/restauración del laboratorio.

El reloj, la fecha civil local y los UUID se inyectan. Las fechas de negocio se guardan como `AAAA-MM-DD`, separadas de los instantes UTC de auditoría. El motor no interpreta automáticamente un vencimiento como pago, ingreso o desbloqueo.

## Contabilidad y compromisos

Todo cambio confirmado de saldo tiene asientos `POSTED` equilibrados. Gasto, compra TC y gasto diario tienen un solo movimiento contable. El desglose edita únicamente líneas de categoría, y conserva asientos y deuda; una reclasificación tras reverso actualiza el original y las líneas negativas del reverso en la misma transacción. Los cambios quedan en `split_edits`.

`funding_buckets` vincula dinero existente de una cuenta a categoría, meta, reserva, recibo, tarjeta o deuda. `funding_events` conserva aportes, traslados, consumo, restauración y liberación. Un presupuesto sin financiación solo mide el gasto. El motor valida que una cuenta no financie más que su saldo y que la financiación de pasivos no aumente el descuento de un pasivo ya incluido en Disponible real. Las cuentas `protected` excluyen su saldo de Disponible real sin volver a excluir las metas o reservas financiadas en ellas.

Recibos y plantillas de distribución usan movimientos y apartados existentes: pagar con banco registra un gasto y consume la reserva; pagar con TC registra una compra y convierte la porción financiada en cobertura de esa deuda. Confirmar una distribución de ingreso y sus apartados ocurre atómicamente. Metas y reservas no son cuentas adicionales. Una reserva con `unlock_on` exige liberación explícita una vez llegue la fecha local.

## Plataformas y recordatorios

Android/iOS usan `expo-sqlite`. Web usa el adaptador oficial SQLite/WASM de Expo como prueba técnica separada; su soporte y persistencia del navegador no equivalen a una garantía de conservación o cifrado. El laboratorio comprobó operaciones, reinicio y archivo sintético; siguen sin validarse plenamente múltiples pestañas, cuotas, modo privado, carga offline y recuperación financiera real. Ver [STORAGE_TECHNICAL_REPORT.md](STORAGE_TECHNICAL_REPORT.md).

Las preferencias de recordatorios se guardan por evento o serie. En móvil, la app programa como máximo 60 solicitudes próximas a las 09:00 locales y recalcula al cambiar datos o al reabrir. Pide permiso al activar/sincronizar desde la UI; si se deniega, el calendario continúa funcionando. Se calculan como máximo 366 días de eventos futuros y se reprograman en aperturas posteriores. Web muestra calendario pero no programa estas notificaciones nativas. Un recordatorio jamás escribe asientos. La entrega final depende del sistema operativo; la nueva versión aún requiere una comprobación física en Android. Referencia: [Expo Notifications SDK 57](https://docs.expo.dev/versions/v57.0.0/sdk/notifications/).

## Límites actuales

Los datos financieros locales todavía no están cifrados. La ocultación de montos afecta la interfaz, no los datos ni las notificaciones ya mostradas por el sistema. Usar solo datos sintéticos durante esta etapa. La exportación/restauración con validación está implementada en el laboratorio técnico, no como backup financiero de producción. Supabase, Auth, cifrado, biometría, sincronización, panel Admin y lectura de avisos bancarios no están implementados. El panel Admin sigue previsto como aplicación web separada sin acceso a saldos ni llaves.

Los reembolsos parciales, saldo acreedor de TC, intereses automáticos, cambio de moneda, edición general de asientos antiguos y reglas de seguridad web necesitan diseño y pruebas adicionales. Los nuevos módulos deben añadir migración secuencial, repositorio, caso de uso, proyección y pruebas de rollback/compatibilidad antes de presentar datos reales.
