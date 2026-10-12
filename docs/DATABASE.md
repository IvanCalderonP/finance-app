# Modelo de datos local propuesto

Propósito: definir el esquema lógico antes de migraciones. Estado: modelo financiero propuesto con decisiones V1 aprobadas; existe una primera migración financiera limitada al núcleo mínimo. La fase 2 crea únicamente una base técnica separada. SQLite local es la fuente financiera. Supabase no contiene estas tablas financieras.

## Convenciones

UUID TEXT generado localmente para PK; FKs dentro del mismo perfil. Todo registro tiene profile_id, created_at y, si mutable, updated_at/revision. Fechas de instante UTC ISO 8601 y fechas civiles YYYY-MM-DD con zona del perfil. Dinero INTEGER en unidades menores; moneda y escala explícitas. Dominio valida enteros seguros en JavaScript y ausencia de overflow. Tasas en puntos básicos; no REAL para dinero. Estados/enums con CHECK al implementar. No almacenar PAN, CVV, credenciales bancarias ni secretos en estas tablas.

Una base por perfil con local_profile_id; user_id remoto opcional, sin requisito de conexión. El aislamiento por perfil se valida también en repositorios y relaciones. Abrir conexión con foreign_keys habilitado; serializar escritores y considerar WAL en nativo según pruebas del adaptador. Nunca copiar únicamente el archivo principal de una base activa con WAL.

## Núcleo y asientos

| Tabla | Campos y restricciones propuestos |
| --- | --- |
| profiles | id, display_name opcional, timezone, default_currency, remote_user_id nullable; identidad local sin cuenta |
| accounts | id, name, type(bank/cash/savings/custom), currency, availability_policy(free/protected), obligatoria e independiente de type, active, ledger_node_id UNIQUE; saldo actual derivado, no fuente mutable independiente |
| ledger_nodes | id, kind(asset/liability/equity/income/expense), currency, normal_side; nodo de cuenta, tarjeta, deuda o contraparte técnica de apertura/ajuste |
| transactions | id, kind, effective_date, occurred_at, status(posted/reversed), source(manual/aggregate/import), idempotency_key UNIQUE por perfil, reversal_of UNIQUE nullable FK, note; título opcional |
| transaction_entries | id, transaction_id FK, ledger_node_id FK, debit_minor, credit_minor; exactamente un lado positivo; moneda igual a nodo y movimiento de primera fase |
| transaction_splits | id, transaction_id FK, category_id FK, amount_minor firmado para gasto/reembolso, small_expense_tag; suma debe coincidir con reconocimiento categorizable del movimiento |
| income | id, transaction_id UNIQUE FK, kind(salary/extra/other), source_label; importe/moneda vienen del movimiento, nunca otro ingreso independiente |
| categories | id, name, kind(expense/income), parent_id nullable FK, active; no borrar si referenciada |
| other_assets | id, name, currency, valuation_minor, valuation_date, active; activo no incluido en accounts; cambios explícitos y trazables |

Asientos por movimiento y moneda equilibran suma(debit)=suma(credit). Saldo activo = débitos − créditos; deuda = créditos − débitos. Compra TC: débito a gasto y crédito a pasivo TC. Pago TC: débito pasivo TC y crédito banco. Transferencia: débito destino y crédito origen. Préstamo a persona: débito activo por cobrar y crédito banco. Préstamo recibido: débito banco y crédito pasivo personal. Apertura usa contraparte de patrimonio, no ingreso/gasto del período. La categoría es un desglose del gasto, no un segundo débito.

Añadir kinds opening, lend, borrow, refund y reversal a los tipos centrales solicitados. goal_contribution y reserve son eventos virtuales: pueden tener transactions sin asientos monetarios; deben vincular efectos de compromisos. withdrawal con destino cash es transferencia; un gasto cotidiano agregado es expense. No codificar esta distinción únicamente en una etiqueta textual.

## Tarjetas, ciclos y pagos

| Tabla | Campos y restricciones propuestos |
| --- | --- |
| credit_cards | id, name, currency, limit_minor, closing_day, due_rule, default_payment_account_id FK nullable, status, ledger_node_id UNIQUE; deuda utilizada y crédito disponible derivados |
| credit_card_cycles | id, card_id FK, starts_on, closes_on, due_on, status; UNIQUE(card_id, starts_on); snapshot de saldo de corte, reconciliable con asientos |
| credit_card_cycle_entries | id, cycle_id FK, transaction_entry_id UNIQUE FK; clasificación temporal, no otra deuda |
| credit_card_payments | id, transaction_id UNIQUE FK, card_id FK, paying_account_id FK; importe de asientos; sin gasto de principal |
| credit_card_payment_applications | id, payment_id FK, cycle_id FK, amount_minor > 0; suma = porción aplicada del pago; residual sin ciclo aún identificado, si corresponde |

Ciclos congelan fechas para conservar historial. La asociación credit_card_cycle_entries puede corregirse manualmente sin crear transaction_entries nuevos; añadir historial credit_card_cycle_corrections(id, entry_id FK, previous_cycle_id FK, new_cycle_id FK, reason, corrected_at). Recalcular resúmenes y revisar aplicaciones de pago si el cambio afecta un ciclo liquidado, sin repetir deuda/gasto. Deuda de tarjeta y pendiente por ciclo son proyecciones del mismo ledger. Crédito excedido puede dar disponible de crédito negativo. No modificar deuda/periodos copiando importes entre tablas sin referencias a asientos.

## Compromisos y financiación

| Tabla | Campos y restricciones propuestos |
| --- | --- |
| commitments | id, kind(card/debt/bill/goal/reserve/budget/protected_account), currency, status, amount_minor solo para compromisos no pasivos, liability_node_id FK nullable, bill_id/goal_id/reserve_id/budget_id/account_id FKs nullable; un propietario válido mediante CHECK, UNIQUE del propietario activo |
| commitment_funding | id, commitment_id FK, account_id FK, amount_minor >= 0; UNIQUE(commitment_id, account_id); misma moneda; reparto exclusivo de recursos |
| commitment_events | id, commitment_id FK, transaction_id FK, action(create/fund/consume/release/reassign), amount_minor; historial idempotente de variaciones |
| allocation_rules | id, name, active, priority, method(fixed/percent/remainder), fixed_minor o percentage_bps, target_commitment_id o target_kind(free), currency; campos excluyentes |
| allocation_runs | id, income_id FK, version, idempotency_key UNIQUE, status; un plan activo por ingreso; redistribuir sustituye/revierte anterior, no lo suma |
| allocations | id, run_id FK, rule_id nullable FK, commitment_id nullable FK, amount_minor, priority_snapshot, method_snapshot; libre sin compromiso; suma <= ingreso |

Para card/debt, amount se deriva de su pasivo; commitment_funding es un subconjunto respaldado, no otro descuento. Para bill/goal/reserve/budget representa fondos retenidos; suma de financiación = importe retenido. En ahorro protegido, el compromiso implícito representa solo el remanente positivo no asignado a otro propósito: ahorro residual + metas/reservas en esa cuenta <= saldo positivo. Fondos comprometidos para otro objetivo no pueden respaldar simultáneamente deuda.

La exclusividad y límites de financiación son invariantes de varias filas: verificarlos en la misma transacción con escritores serializados; un CHECK aislado no basta. No crear compromiso adicional por cada asignación a una deuda existente. Una obligación tiene una identidad estable aun si cambia de fase (recibo reservado a compra TC); la transición consume el compromiso anterior y enlaza el nuevo pasivo.

## Planificación y ahorro

| Tabla | Campos y restricciones propuestos |
| --- | --- |
| budgets | id, category_id FK, currency, assigned_minor, starts_on, ends_on, renewal_rule_id nullable; UNIQUE(category_id,currency,starts_on,ends_on) propuesta primera fase; gastado/restante derivados |
| bills | id, recurring_item_id FK nullable, name, category_id FK, currency, expected_minor, actual_minor nullable, due_on, preferred_payment_kind, account_id/card_id nullable; estado y pagado derivados |
| bill_payments | id, bill_id FK, transaction_id UNIQUE FK, applied_minor; permite pagos parciales, no otra salida de dinero |
| goals | id, name, currency, target_minor > 0, target_date nullable, primary_goal boolean, status; máximo una meta principal activa por perfil |
| goal_contributions | id, goal_id FK, transaction_id FK, commitment_event_id UNIQUE FK, signed_amount_minor; ahorro actual procede del compromiso, no suma adicional a cuentas |
| reserves | id, name, currency, unlock_on nullable, policy(blocked/releasable), status; cantidad retenida en commitments, sin segundo saldo independiente |
| recurring_items | id, kind(bill/income/budget/event), frequency, interval, anchor_date, end_date nullable, next_due_on, template_data versionado, active; sin ejecución silenciosa de asientos |
| recurring_occurrences | id, recurring_item_id FK, occurrence_date, entity_kind, entity_id; UNIQUE(recurring_item_id,occurrence_date); FK concreta a instancia según tipo al concretar SQL |
| financial_events | id, kind, event_date, timezone, linked bill/card_cycle/debt/goal/recurrence FKs excluyentes o manual, status; ingresos previstos sin ingreso contable |
| reminders | id, linked_event_id FK, offset, enabled, privacy_mode, platform_notification_id nullable; recordar no significa pagar |

No almacenar un enum que mezcle vencimiento y financiación sin conservar ambos atributos. Saldo residual, importes reservados y fecha definen estado visible. Plantillas con monto previsto no son ingresos/gastos reales. Para tarjetas V1: effective_date, corte inclusivo, último día válido del mes y sin ajuste por fines de semana/feriados están aprobados. Fechas y reglas de repetición no asociadas a tarjetas siguen pendientes.

## Personas y deudas

| Tabla | Campos y restricciones propuestos |
| --- | --- |
| people | id, name, notes nullable; contacto opcional mínimo, sin envío a cloud |
| debts | id, person_id FK, direction(receivable/payable), currency, initial_minor, concept, opened_on, due_on nullable, notes, ledger_node_id UNIQUE, origin_transaction_id FK, status; pendiente derivado de ledger |
| debt_payments | id, debt_id FK, transaction_id UNIQUE FK, principal_minor, direction(received/paid); intereses/comisiones por asientos separados y gasto/ingreso explícito |

Inicial es dato de origen; pendiente no se resta manualmente y por asientos a la vez. Registro de deuda existente usa apertura; deuda por compra enlaza gasto; préstamo recibido no ingreso; préstamo entregado no gasto. No crear una deuda personal paralela por el mismo consumo ya en TC.

## Configuración y proyecciones

| Tabla | Campos y restricciones propuestos |
| --- | --- |
| settings | key PK por perfil, value_json versionado; zona, moneda, preferencias, nunca llaves/tokens/PIN sin hash |
| schema_migrations | version PK, applied_at; futura, sin migraciones implementadas |
| backup_metadata | id, format_version, schema_version, created_at, source(local/cloud), byte_size, checksum, status, opaque_remote_id nullable; sin llave ni payload |
| account_balance_projection | account_id PK FK, balance_minor, last_revision; reconstruible desde asientos |
| entitlement_cache | remote_user_id, cloud_backup_enabled, role, fetched_at, expires_at; solo informativo offline, no autorización de upload |

Las proyecciones de deuda, ciclos, gasto y compromisos pueden ser vistas o cachés. La elección se hará tras medir, no implementar ahora. Toda modificación confirmada de saldo tiene asientos; metadata mutable no reemplaza historial. Reversos conservan relaciones para auditoría local.

## Índices, consistencia y backup

Índices futuros: movimientos por perfil/fecha, asientos por nodo/movimiento, categorías por período, ciclos por tarjeta/fechas, deudas por dirección/persona/vencimiento, recibos por vencimiento, eventos por fecha, financiación por cuenta, idempotencia por operación. UNIQUE de instancias recurrentes y pagos evita duplicados. Relacionar moneda, perfil y origen validando FKs y reglas de dominio. Eliminar con RESTRICT entidades financieras referenciadas; preferir archivado y reverso.

Backups deben incluir todas las tablas canónicas y relaciones, configuración financiera, saldos de apertura y eventos virtuales. Excluir secretos, tokens, cachés de auth, IDs de notificación y proyecciones reconstruibles; recrearlos tras restaurar. Validar esquema, FKs, balance de asientos, monedas, importes y financiación. Restaurar no suma un saldo guardado y sus asientos. Ver BACKUP_SYSTEM.md.

## Pendiente

Antes de migraciones: convertir este modelo lógico en SQL con constraints concretos, resolver destinos polimórficos mediante FKs reales, definir firmas de repositorios, decidir alcance de otras monedas y evaluar persistencia web. Probar transacciones, reconstrucción y restauración en cada plataforma. Solo las tablas del núcleo mínimo indicadas abajo están implementadas; las demás siguen como propuesta.

## Esquema técnico implementado en fase 2

En base separada finance-storage-lab-v1.db: lab_parents(id limitado a lab-demo, tag SYNTHETIC) y lab_samples(id limitado a lab-seed/lab-persist/lab-probe, parent_id FK RESTRICT, value INTEGER entre 0 y 1000000, tag SYNTHETIC). No importes monetarios, personas, notas ni datos reales. user_version=1 se confirma en la misma transacción de creación; versiones futuras se rechazan. foreign_keys se habilita y verifica en cada conexión.

Solo una instancia de laboratorio posee la conexión y serializa lectura/escritura/close/export/restore. BEGIN IMMEDIATE/COMMIT/ROLLBACK explícitos en conexión privada, sin dependencia de withExclusiveTransactionAsync (no disponible en web). Concurrencia entre pestañas todavía requiere validación y no se declara resuelta. Migración no siembra datos.

## Núcleo financiero implementado

Base finance-local-v1.db, separada del laboratorio. Migración 001: profiles, accounts, ledger_nodes, transactions, transaction_entries, transaction_splits, categories y schema_migrations. Saldo derivado únicamente de entradas POSTED. Perfil LOCAL y categorías iniciales automáticos; ninguna cuenta o movimiento se siembra sin acción explícita.

Retiro cotidiano = EXPENSE/daily, no transferencia ni creación de cash. Cash es un tipo opcional de cuenta. Se conservan los asientos confirmados y se crean reversos referenciados; los splits de gastos pueden reemplazarse atómicamente sin asientos nuevos. Restricciones compuestas por perfil/moneda, índices, posting equilibrado e inmutabilidad de entries. No existe columna editable de saldo. UUID se generan en infraestructura, no en el motor.
