# Funcionalidades, navegación y fases

Propósito: definir alcance sin construir todavía las funciones. Estado: propuesta v1. La pantalla actual incluye una UI mínima del núcleo financiero, sin diseño definitivo.

## Navegación propuesta

Mantener Inicio, Movimientos, Calendario, Metas y Más. Inicio prioriza Disponible real; saldo físico y comprometido explican la cifra. Meta principal, tarjeta seleccionada, próximos pagos y presupuesto se presentan como resumen corto, no todas las tarjetas ni todas las categorías. Accesos rápidos: gasto, ingreso y transferencia; detalles y funciones avanzadas dentro de su módulo. No añadir pestaña Admin.

Más agrupa: dinero (cuentas, tarjetas, ingresos, deudas, reservas); planificación (presupuestos, recibos); análisis (estadísticas, gastos hormiga); aplicación (backups, seguridad y configuración). Auth se ofrece al activar servicios de cuenta/cloud, no bloquea el uso LOCAL. D negativo, compromisos sin fondos, moneda y vencimientos deben ser claros; revelar el cálculo del disponible al solicitar detalle.

## Alcance por módulo

| Módulo | Capacidad prevista | Regla/limitación |
| --- | --- | --- |
| Cuentas | Banco, efectivo, ahorro y personalizadas; archivar, conciliación | Saldo desde asientos; transferencia no gasto |
| Movimientos | Ingreso, gasto, traslado, principal de deuda/TC, ajustes, reversos y eventos virtuales | Una operación financiera central; desglose sin repetir gasto |
| Tarjetas | Límites, deuda, crédito, ciclos, corte, vencimiento y pagos parciales | Gasto en compra; pago liquida, no vuelve a gastar |
| Presupuestos/comida | Categorías, asignado, usado, restante, porcentaje, renovación | Presupuesto no reserva por sí mismo |
| Cotidianos | Registro agregado opcional y posterior desglose | No exige cada dólar; no conservar efectivo ficticio |
| Hormiga | Vista opcional de gastos pequeños | Una etiqueta de gastos existentes; umbral por definir |
| Recibos | Esperado/real, frecuencia, vencimiento, reserva y pagos | Plantilla genera instancia, no pago automático |
| Ingresos/distribución | Salario/extras, reglas fijas/porcentaje/prioridad/sobrante | Depósito propio no ingreso; asignaciones virtuales |
| Metas | Múltiples, progreso, aportes, fecha y estimación | No son activos separados de cuentas |
| Reservas | Fondos protegidos y plazo de bloqueo | Patrimonio sí; disponible no |
| Deudas | ME DEBEN / YO DEBO, personas, parcialidades, notas y fechas | Por cobrar no efectivo; principal no gasto/ingreso |
| Calendario | Cortes, pagos, recibos, deudas, ingresos previstos y metas | Evento previsto no movimiento realizado |
| Estadísticas | Categorías, presupuestos, patrimonio y tendencias | TC al comprar; evitar sumar subtotales superpuestos |
| Recordatorios/notificaciones | Recibos, TC, corte, deuda, presupuesto y meta | Permiso opcional; calendario funciona si se deniega |
| Datos/backup | SQLite offline, exportar/importar/restaurar | Sin cuenta; restauración transaccional validada |
| Seguridad | Bloqueo, secretos, privacidad y cifrado futuros | Capacidades distintas por plataforma |
| Auth/cloud | Cuenta opcional, permiso remoto, backups manuales | No sincronización continua de movimientos |
| Admin web separado | Usuarios, roles, permisos, testers, versiones, flags, soporte y métricas técnicas | Sin acceso financiero ni llaves de descifrado |
| Automatización Android futura | Sugerir registrar/editar/ignorar notificación bancaria | Consentimiento, confirmación por operación, nunca registro silencioso |

## Fases y puertas de salida

1. **Cerrar reglas y contratos.** Revisar propuestas de FINANCIAL_RULES, esquema y seguridad, política de ahorro y por cobrar. Salida: casos numéricos aprobados y decisiones pendientes resueltas para el MVP.
2. **Prueba técnica local multiplataforma.** Luego de autorización instalar solo SQLite necesario; validar native/web, persistencia, multi pestaña, cuotas, reinicio y carga offline. Evaluar límite real de Expo Go para seguridad futura. Salida: viabilidad SQLite web y recuperación por archivo demostradas; no asumir paridad.
3. **Motor y persistencia mínimos.** Money/IDs, asientos, transacciones, repositorios, migraciones mínimas, idempotencia, reversos y tests críticos. Cuentas, ingresos, gastos y transferencias; exportación/restauración local básica antes de datos reales. Salida: invariantes y rollback probados.
4. **Obligaciones y disponibilidad.** TC, ciclos, pagos, deudas, compromisos y cálculo disponible/patrimonio. Salida: tres casos TC y financiación de deuda sin doble descuento, pruebas offline.
5. **Planificación y ahorro.** Presupuestos, cotidianos/desgloses, recibos recurrentes, distribución, metas y reservas. Salida: reserva pagada con TC, redondeo, insuficiencia y cuenta ahorro/meta sin duplicación.
6. **Experiencia y recordatorios.** Pantallas simples de los módulos, calendario y estadísticas; accesibilidad, fechas, permisos y notificaciones. Salida: UX entendible, sin registros automáticos por recordatorio.
7. **Endurecimiento de seguridad y backups.** Cifrado, manejo de llaves, recuperación, PIN/biometría donde proceda, bloqueo y privacidad. No publicar una versión con datos reales sin protección revisada, auditoría de dependencias y prueba de restauración.
8. **Identidad/cloud opcional.** Supabase Auth/roles, Storage privado, upload manual cifrado, retención de dos copias y permisos verificados. Salida: un usuario no accede a otro y el servidor no dispone de llaves; trabajo local independiente de red.
9. **Panel administrativo separado.** Roles/flags/soporte/estadísticas técnicas sin datos financieros. Sin monetización en este alcance.
10. **Automatización Android opt-in.** Solo después de revisar permisos y privacidad: sugerencias locales, deduplicación y confirmación. Requiere build nativo y autorización de una nueva fase.

Cada fase agrega tests de sus invariantes antes de ampliar funciones. No implementar todas las pruebas ahora. UI definitiva después del contrato financiero; la seguridad no se añade solo al final: separación de datos, secretos y registros se respeta desde fase 3.

## Decisiones que requieren revisión

Las decisiones V1 aprobadas son availability_policy free/protected sin duplicar metas/reservas, presupuesto sin descuento y apartado financiado con descuento, dos operaciones de efectivo, patrimonio con/sin por cobrar, ciclo por effective_date inclusivo con corrección manual, último día válido, sin ajustes por festivos y reserva liberable con confirmación. Siguen como propuestas: pago TC aplicado al ciclo más antiguo y porcentajes sobre ingreso original. No hay integración bancaria automática.

Fase activa: únicamente fase 2. Datos sintéticos, migración técnica mínima, diagnóstico, archivos JSON de prueba y evaluación separada de web. No iniciar fases 3–10 hasta una nueva instrucción.

## Riesgos principales

Doble conteo por reservas/deudas/ciclos/metas; movimientos duplicados; cambios retroactivos; respaldo insuficiente; pérdida de SQLite/navegador; diferencias web/nativo; pérdida de llave; recordatorios limitados por OS; acceso offline no equivale a autorización cloud; restauración de una versión futura; backups manuales no son sincronización. Criterios de prueba y mitigaciones constan en los documentos específicos.

## Flujo principal implementado

Inicio ofrece Ingreso, Gasto, Gastos diarios y Transferir, además de crear cuentas. Gastos diarios registra un agregado desde banco bajo Gastos cotidianos, sin pedir remanente de efectivo. Transferir a efectivo requiere una cuenta cash creada expresamente. El seed de desarrollo contiene banco, ahorro protegido y secundaria, sin efectivo; es opcional y no se ejecuta al reiniciar. Tarjetas y los demás módulos avanzados no están implementados.

## Tarjetas V1 disponibles

Crear con deuda inicial, comprar con categorías compartidas, pago parcial/total, reverso total y corrección de ciclo con motivo. Lista, detalle, ciclos y desglose de pagos en /cards; Inicio muestra saldo físico, disponible real y deuda de tarjetas. UI provisional, únicamente datos sintéticos mientras no exista cifrado. Otros módulos permanecen pendientes.
