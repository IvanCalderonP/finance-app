# Arquitectura de Finance App

Estado: arquitectura general aprobada y decisiones V1 incorporadas, 2026-10-12. Documentación previa a implementación. Las decisiones propuestas requieren revisión antes de programar sus módulos.

## Objetivo y límites

Mostrar dinero realmente disponible después de compromisos, sin contar dos veces un mismo recurso. La aplicación financiera es local-first: SQLite local es la fuente de verdad; lectura, escritura, cálculos, calendario y backups por archivo funcionan sin internet ni cuenta. Supabase se limita a identidad, autorización remota, administración y backups opcionales. No hay réplica continua de movimientos ni resolución automática de conflictos entre dispositivos.

## Capas y dependencias

| Capa | Responsabilidad | Dependencias permitidas |
| --- | --- | --- |
| Rutas/UI | Presentar datos, validar entrada básica y solicitar acciones | Casos de uso, hooks de presentación |
| Aplicación | Orquestar comandos, repositorios, permisos locales y transacciones | Motor y contratos de infraestructura |
| Motor financiero | Validar invariantes y producir efectos contables y de compromisos | Tipos de dominio; sin React, SQLite, Supabase, red ni APIs nativas |
| Persistencia | Guardar efectos atómicamente, consultar y reconstruir proyecciones | Adaptador SQLite y contratos |
| Servicios de plataforma | Archivos, secretos, recordatorios, ciclo de vida y backups | Adaptadores por plataforma |
| Servicios remotos | Auth, permisos de cloud y Storage | Red; no necesarios para operaciones financieras |

Flujo de escritura: UI → caso de uso → leer estado dentro de una unidad de trabajo → motor → validar → persistir movimiento, asientos, desglose, compromisos y proyecciones en una única transacción → notificar UI. Las notificaciones y llamadas de red ocurren después del commit, con reintentos idempotentes; nunca mantienen abierta una transacción financiera.

El motor tiene cálculos puros y comandos que reciben un snapshot, una fecha explícita e identificador de operación y devuelven efectos o errores de dominio. Ejemplos futuros: calculateAvailableBalance, calculateNetWorth, registerCreditCardPurchase, payCreditCard, registerIncome, distributeIncome, reserveFunds, releaseReservedFunds, registerDebt, receiveDebtPayment, payDebt, registerBillPayment, transferBetweenAccounts. El reloj y generador de IDs se inyectan. El motor no guarda datos ni registra telemetría sensible.

## Organización propuesta (no crear aún todos los archivos)

```text
src/
  app/                      # Expo Router: rutas y layouts delgados
  features/
    dashboard/ transactions/ accounts/ cards/ budgets/ bills/
    income/ allocations/ goals/ reserves/ debts/ calendar/
    statistics/ reminders/ backups/ auth/ settings/
      application/          # casos de uso del módulo
      components/ hooks/    # presentación específica
  components/               # presentación compartida
  financial-engine/
    model/ commands/ calculations/ policies/ errors/ __tests__/
  database/
    contracts/ sqlite/ repositories/ projections/ migrations/
  services/
    backup/ notifications/ security/ remote/ platform/
  hooks/                    # hooks compartidos
  store/                    # estado efímero de UI; no segunda base financiera
  utils/                    # funciones técnicas sin reglas de negocio
  types/                    # contratos compartidos, sin copias del dominio
assets/
docs/
```

El proyecto admin será una aplicación web separada, fuera de src/app. No tendrá ruta ni opción Admin en la aplicación del usuario. No se elige todavía una librería de estado, validación, gráficos, calendario, base de datos o cifrado.

## Persistencia y plataformas

Android/iOS: adaptador SQLite local. Web: mismo motor y contratos, adaptador SQLite/WASM local a validar en una prueba técnica antes de construir módulos. Según [Expo SQLite SDK 57](https://docs.expo.dev/versions/v57.0.0/sdk/sqlite/), el soporte web es alpha y exige WASM y cabeceras para SharedArrayBuffer. No confundir la pantalla web actual con persistencia financiera offline ya implementada.

La fase técnica deberá comprobar reinicio, persistencia del navegador, cuotas, modo privado, concurrencia entre pestañas y aislamiento del origen. El funcionamiento web offline requiere además una estrategia de caché de recursos de aplicación/PWA; SQLite por sí solo no permite cargar la app sin red. Si el adaptador no satisface las pruebas, revisar una alternativa SQLite local tras aprobación, sin convertir Supabase en fuente financiera. La eliminación de datos del navegador y la desinstalación pueden destruir datos: ofrecer exportación local y explicar persistencia real.

Una base por perfil local; el perfil LOCAL no necesita user_id remoto. Asociar una cuenta remota al perfil requiere acción explícita, no migración ni upload automático. Cambiar usuario no reutiliza silenciosamente otro perfil. Auth vencido no bloquea funciones locales. La autorización cloud se verifica remotamente al subir/restaurar, nunca se confía solo en el rol guardado.

## Decisiones transversales

- Importes enteros en unidades menores y moneda ISO; porcentajes en puntos básicos. No aritmética monetaria con decimales binarios. Validar límites seguros de JavaScript; definir escala por moneda.
- Resultado por moneda; no sumar USD y otra moneda. Tipo de cambio, conversión y patrimonio consolidado quedan fuera de la primera fase.
- IDs locales UUID; idempotencia por perfil/operación. Movimientos confirmados inmutables con reversos explícitos y trazabilidad.
- Movimientos y asientos constituyen la fuente contable. Saldos y totales son proyecciones reconstruibles; nunca valores editables independientes.
- Fechas de instante en UTC; vencimientos/cortes como fechas civiles con zona del perfil. La fecha de negocio determina presupuesto y ciclo, no el momento de sincronización.
- Presupuestos son medición; reservas/asignaciones son compromisos. Vínculos de origen permiten compartir identidad sin duplicar descuento.
- Contabilidad de recursos, obligaciones y por cobrar separada de reconocimiento de ingreso/gasto; liquidar principal no repite una categoría de gasto.

## Decisiones pendientes antes de implementar

Quedan pendientes ventana de gastos hormiga, automatización de intereses/comisiones, reembolsos parciales, edición retroactiva general, llaves de recuperación y equivalencia de seguridad en web. Están aprobados free/protected por cuenta sin doble descuento, presupuesto separado de apartado, dos operaciones de efectivo, ambos patrimonios con/sin por cobrar, corte inclusivo por effective_date y último día válido, corrección manual sin repetir asientos y reservas liberables con confirmación. Las propuestas restantes están en los demás documentos; no son funcionalidades existentes.

## Criterios de aceptación de arquitectura

Motor testeable sin React ni dispositivo; escritura atómica e idempotente; reconstrucción determinista de saldos; operaciones principales sin red ni sesión; ningún dato financiero en admin/telemetría; restauración validada sin pérdida del perfil anterior; pruebas reales de persistencia y offline por plataforma. Implementar cada módulo solo con reglas y contratos definidos.

## Fase 2 autorizada: laboratorio separado

Base finance-storage-lab-v1.db, sin tablas financieras, datos reales, cifrado ni cloud. Migración técnica V1 con lab_parents/lab_samples y PRAGMA user_version. Pantalla /storage-lab únicamente para diagnóstico. Adaptador Expo SQLite y núcleo SQL testeable con SQLite de Node (evidencia técnica auxiliar, no equivalente a runtime Android/Web). Migración y apertura no insertan datos: esto evita confundir resembrado con persistencia. Exportación/importación JSON limitada a filas sintéticas conocidas.

Web es una prueba independiente, no aprobación de confiabilidad. Habilitar WASM y cabeceras de aislamiento para el ensayo, sin implementar aún caché/PWA ni afirmar arranque offline. No hay fallback remoto a Supabase. Admin permanece solo documentado. Ver STORAGE_TECHNICAL_REPORT.md para resultados y límites de evidencia.

## Tarjetas V1

Motor puro cards.ts, servicio card-application.ts y repositorio SQLite separado, compartiendo la misma conexión privada y cola del núcleo. Asientos, clasificación de ciclos, pagos y aplicaciones se confirman en una sola transacción. Inicio incluye deuda y disponible; /cards ofrece operaciones mínimas. Sin dependencias nuevas. Android del núcleo confirmado por el usuario («no si quedo sigue»); no fue observado directamente por el agente. Los tests usan SQLite de Node y datos sintéticos. El usuario confirmó en Expo Go Android la creación de tarjeta, compra, pago parcial y persistencia tras cerrar y reabrir. Web continúa como evaluación separada.

Validación automatizada: 72/72 tests (27 nuevos de tarjetas), TypeScript y lint correctos, Expo Doctor 21/21. Exportación Android Hermes y web completada; /cards respondió HTTP 200. La exportación verifica empaquetado; la prueba física posterior de tarjetas fue confirmada por el usuario. La persistencia SQLite web requiere evaluación separada.

## Deudas personales V1

Motor puro `financial-engine/debts.ts`; servicio, proyecciones y repositorio SQLite separados, sobre la misma conexión y cola financiera. Inicio combina pasivos de TC y deudas como compromisos distintos y muestra cuentas por cobrar por separado. `/debts` ofrece dos pestañas y operaciones con datos sintéticos. Pruebas SQLite verifican idempotencia, reversos, rollback, perfiles y reapertura; exportación Android/web verifica empaquetado. La prueba física de tarjetas fue confirmada por el usuario en Expo Go; la UI de deudas aún no se ha probado en el dispositivo.
