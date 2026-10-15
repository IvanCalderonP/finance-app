# Funcionalidades y navegación

Estado: versión local de prueba con datos sintéticos, 14 de octubre de 2026. La navegación principal es **Inicio, Movimientos, Calendario, Metas y Más**. Desde Más se abren Cuentas, Tarjetas, Deudas, Presupuestos, Recibos, Distribución, Reservas, Estadísticas, Categorías y preferencias.

## Uso actual

Inicio concentra Disponible real, saldo físico, dinero comprometido, TC pendiente, Yo debo, Me deben, meta principal y hasta tres próximos pagos. Las acciones rápidas registran gasto, ingreso, gasto diario o compra TC. Las cuentas y movimientos detallados están en sus propias pantallas. Hay tema claro/oscuro/sistema y una preferencia persistente para ocultar importes en la interfaz.

| Módulo | Funciona ahora |
| --- | --- |
| Cuentas y movimientos | Banco, efectivo, ahorro protegido, saldo contable, ingreso/gasto, transferencia, ajuste con motivo, gasto diario agregado, reverso e idempotencia. Retirar banco → efectivo es transferencia; gasto diario es gasto sin saldo efectivo ficticio. |
| Desglose y categorías | Categorías/subcategorías personalizadas; división exacta de gastos bancarios, diarios y compras TC; edición y reversos sin asientos ni deuda duplicados. |
| Tarjetas | Deuda inicial, compras, ciclos, corte inclusivo por fecha efectiva, vencimiento, pagos parciales/totales, corrección manual de ciclo y reverso permitido por las reglas V1. |
| Deudas personales | Me deben / Yo debo, personas manuales, origen, cobros/pagos parciales, vencimiento y reversos. Disponible real excluye cuentas por cobrar; patrimonio ofrece ambas vistas. |
| Presupuestos y apartados | Límite mensual/semanal/personalizado renovable, asignado/gastado/restante/exceso; financiación real separada, movimientos entre apartados y cierre con mantener, liberar o enviar sobrante financiado a meta. |
| Recibos | Serie única/semanal/mensual/personalizada, esperado/real, vencimiento, reserva, pagos parciales de banco/TC, estado y siguiente instancia sin asiento automático. |
| Distribución | Varias plantillas, cantidades fijas, porcentajes del ingreso original, prioridad, sobrante, previsualización, edición manual, insuficiencias y confirmación atómica. Puede usar ingreso existente una sola vez. |
| Metas y reservas | Varias metas, historial/progreso/faltante/estimación, meta principal; reservas bloqueadas pasan a liberables en `unlock_on` y exigen confirmación. |
| Calendario | Día/semana/mes; recibos, TC, deudas, ingresos previstos, metas, reservas y eventos. Ingreso previsto se enlaza al movimiento real. Preferencias y programación de notificaciones locales en Android/iOS. |
| Estadísticas | Comparación mensual, categorías y método de pago, patrimonio/disponible/deuda TC histórica, presupuesto frente a gasto, aportes a metas, gastos pequeños y filtros. |

Los formularios muestran estados vacíos, validan importes y fechas y preservan la información financiera al cerrarse/reabrirse la base. Las notificaciones se sincronizan al entrar a la app o tras un cambio confirmado; el SO puede posponerlas. La web muestra calendario y datos mediante SQLite/WASM como prueba técnica separada, sin notificaciones nativas. El laboratorio ofrece exportación/restauración sintética; todavía no existe backup financiero cifrado.

## Reglas visibles

Un presupuesto creado no reduce Disponible real; un apartado realmente financiado sí. Dinero en una cuenta protegida no se descuenta dos veces si respalda meta/reserva. Una compra TC es gasto y pasivo; el pago liquida pasivo, sin gasto nuevo. Un por cobrar no es efectivo disponible. Las fechas previstas no registran automáticamente gastos ni ingresos. Un vencimiento de reserva solo habilita la confirmación de liberación.

## Límites para esta etapa

Se usan únicamente datos sintéticos porque SQLite financiero no está cifrado. No hay Auth, Supabase, sincronización, backup financiero real, biometría, panel Admin ni lectura de notificaciones bancarias. El panel Admin está diseñado como proyecto web separado, sin acceso a contenido financiero. Android físico había validado anteriormente el núcleo y tarjetas; la interfaz y notificaciones añadidas aquí necesitan revisión en teléfono. Web requiere pruebas adicionales de persistencia bajo varias pestañas, cuota, modo privado y arranque offline. Ver [SECURITY.md](SECURITY.md) y [ARCHITECTURE.md](ARCHITECTURE.md).
