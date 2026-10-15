# Base de datos financiera local

Estado: esquema SQLite implementado hasta `user_version=7` (14 de octubre de 2026). El archivo principal es `finance-local-v1.db`; el laboratorio técnico usa otra base. Supabase no contiene estas tablas financieras.

## Migraciones implementadas

| Versión | Tablas y finalidad |
| --- | --- |
| 001 | `profiles`, `ledger_nodes`, `accounts`, `categories`, `transactions`, `transaction_entries`, `transaction_splits`, `schema_migrations`: perfil local, cuentas y libro mayor equilibrado. |
| 002 | `credit_cards`, ciclos, compras asociadas, pagos, aplicaciones y correcciones de ciclo. |
| 003 | `people`, `debts`, `debt_payments`, `debt_events`: principales por cobrar/pagar y trazabilidad. |
| 004 | `funding_buckets`, `funding_events`, `budgets`, `budget_periods`, `savings_goals`, `locked_reserves`, `planning_operations`. |
| 005 | `bill_series`, `bill_occurrences`, `bill_payments`, `distribution_templates`, `income_distributions`. |
| 006 | `financial_events`, `financial_reminders`, `insights_settings`, `local_notification_mappings`. |
| 007 | Jerarquía `categories.parent_id`, solicitudes idempotentes de categoría, `split_edits`, `account_availability_events` y `app_preferences`. |

Las migraciones 001–007 se aplican en orden, en transacciones, comprueban `PRAGMA foreign_key_check` y rechazan una versión futura. La migración 002 reconstruye una tabla por la ampliación del ledger y reactiva claves externas incluso tras error. Las pruebas actualizan una base poblada, inyectan fallos y comprueban que sobreviven los asientos, las relaciones y la versión anterior cuando falla una migración.

## Invariantes persistentes

`transactions` lleva clave de idempotencia por perfil, fecha efectiva, moneda, tipo y posible `reversal_of`. `transaction_entries` contiene débitos/créditos en unidades menores; SQLite impide confirmar un asiento desbalanceado y modificar asientos `POSTED`. Las categorías y desgloses se validan por perfil/tipo. `split_edits` registra cambios antes/después; el total del desglose debe igualar el gasto, y el reverso conserva importes opuestos.

Las cuentas no tienen una columna de saldo editable. `availability_policy` vale `free` o `protected`; `account_availability_events` fecha los cambios. Al migrar datos antiguos se reconstruye una política inicial con la primera fecha contable disponible, porque no existe historial previo al cambio de esquema.

`funding_events` son inmutables y registran importes firmados por apartado, cuenta, fecha y eventual transacción. Los saldos de apartados, metas y reservas se proyectan; no crean dinero. Las validaciones entre varias filas, incluida exclusividad de fondos, deuda pendiente, moneda, perfil y fechas históricas, se ejecutan en una transacción serializada. Un mismo recurso retenido en cuenta `protected` y meta/reserva no se descuenta dos veces. Las referencias polimórficas de `funding_buckets.target_id` para tarjeta/deuda/recibo se comprueban en el servicio, además de las FK ordinarias.

`bill_series` es una regla; `bill_occurrences` es cada recibo y tiene unicidad `(profile_id,series_id,period_index)`. El esperado y real son metadatos, no asiento. `bill_payments` enlaza una transacción de banco o TC de forma única. Se materializan instancias cercanas y las necesarias al registrar pagos; el calendario puede prever recurrencias futuras sin insertar asientos ni instancias para todo el año. `income_distributions` enlaza un ingreso una sola vez y guarda el plan confirmado; los fondos reales van a `funding_events`.

`financial_events` guarda ingresos previstos y eventos manuales. Un ingreso real puede enlazarse a su evento por FK; al revertirlo vuelve a quedar previsto en la proyección. `financial_reminders` guarda preferencias y `local_notification_mappings` los identificadores nativos para cancelar/reprogramar. Las estadísticas, estados vencidos, deuda, patrimonio y Disponible real se calculan desde tablas canónicas, no como saldos independientes.

## Backups y plataformas

Solo el laboratorio técnico admite hoy exportación/restauración de su base sintética con comprobación de integridad. Un backup financiero futuro deberá incluir las siete versiones de datos canónicos, categorías, eventos y preferencias; excluir mapeos nativos que se regeneran. Deberá validar FKs, asientos, monedas, financiación y límites en una restauración transaccional cifrada. Web SQLite/WASM continúa en evaluación separada; perder datos del origen del navegador sigue siendo posible. Ver [BACKUP_SYSTEM.md](BACKUP_SYSTEM.md) y [STORAGE_TECHNICAL_REPORT.md](STORAGE_TECHNICAL_REPORT.md).
