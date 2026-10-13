# Reglas financieras y casos de prueba

Propósito: establecer invariantes de negocio y evitar doble conteo. Estado: arquitectura general y decisiones V1 aprobadas el 2026-10-12; los puntos aún no resueltos se identifican como propuestas. El núcleo local mínimo ya implementa cuentas, ledger e ingresos/gastos/transferencias; los módulos avanzados siguen pendientes.

## Magnitudes por moneda

- Saldo físico S: suma de saldos contables de banco, efectivo, ahorro y otras cuentas monetarias. Crédito no utilizado y por cobrar no son efectivo.
- Deuda exigible L: principal y cargos reconocidos pendientes de tarjetas y YO DEBO; incluye saldos de apertura, no solo el período de tarjeta. No duplicar sobregiros si ya aparecen como saldo negativo de cuenta.
- Compromisos no pasivos H: reservas de recibos no reconocidos aún como deuda, metas, sobres de presupuesto financiados, reservas bloqueadas y ahorro excluido. Son partes del saldo físico, no activos adicionales.
- Comprometido C = L + H, con identidad única por obligación/propósito. Financiado indica cuánto está respaldado; no añade otra deducción.
- Disponible real D = S − C. Puede ser negativo; mostrar déficit, sin truncar a cero. La cifra agregada no afirma que haya liquidez en cualquier cuenta concreta.
- Por cobrar R: saldo pendiente de ME DEBEN; nunca aumenta D.
- Patrimonio aprobado: neto total N = S + otros activos no incluidos en cuentas + R − L; mostrar R por separado. Mostrar también patrimonio sin por cobrar = N − R. Así un préstamo y su cobro no simulan pérdida/ganancia de patrimonio. H no se resta de N. Para el disponible, separar saldo libre y protegido: D = saldo de cuentas free − L − apartados exclusivos respaldados en cuentas free. Los apartados/meta/reserva de cuentas protected están cubiertos por su exclusión y no se descuentan otra vez. Si una cuenta protegida tiene saldo negativo, mostrarlo en patrimonio y bloquear nuevas financiaciones; su tratamiento como pasivo exige conciliación explícita, nunca ocultar un sobregiro.

Cada unidad monetaria reservada tiene un solo propósito activo. Asignar a tarjeta/deuda ya incluida en L solo marca financiación de esa misma obligación. Si un recibo reservado se paga con TC, su compromiso se convierte en deuda de TC atómicamente: eliminar la reserva y registrar la deuda, sin superponer ambas. No sumar una meta virtual, una cuenta ahorro y una reserva que representen los mismos fondos.

Decisión aprobada: availability_policy por cuenta es free o protected; el saldo de una cuenta protected no es dinero disponible. La política es independiente del tipo de cuenta; no inferir disponibilidad únicamente por el nombre o tipo ahorro. Sus fondos asignados a metas/reservas se cuentan dentro de esa exclusión; únicamente el remanente sin propósito tiene un compromiso implícito de ahorro. Nunca descontar saldo protegido completo y además sus metas. Reasignar fondos ya bloqueados exige liberación explícita; no financiar obligaciones con fondos de otra reserva sin consentimiento.

## Efectos de operaciones

| Operación | Recursos/deudas | Ingreso/gasto | Disponible y patrimonio |
| --- | --- | --- | --- |
| Ingreso real | Cuenta +importe | Ingreso +importe | D y N aumentan antes de asignar |
| Gasto desde cuenta | Cuenta −importe | Gasto una vez | D y N disminuyen; consumir reserva vinculada si existe |
| Compra TC | TC pendiente +importe | Gasto al comprar | D y N disminuyen; S no cambia |
| Pago TC | Cuenta −importe; TC pendiente −importe | Ninguno por principal | D y N no cambian si solo se liquida compromiso existente |
| Transferencia/retiro banco a efectivo | Origen −importe; destino +importe | Ninguno | N y S iguales; D igual si mantienen política y compromisos |
| Aporte virtual a meta | Cuenta sin cambio; H +importe libre | Ninguno | N igual; D baja solo si eran fondos libres |
| Crear/liberar reserva | Cuenta sin cambio; H aumenta/disminuye | Ninguno | N igual; D cambia por importe neto nuevo/liberado |
| Prestar dinero | Cuenta −importe; por cobrar +importe | No gasto | D baja; N total igual |
| Cobrar principal | Cuenta +importe; por cobrar −importe | No ingreso | D sube; N total igual |
| Recibir préstamo | Cuenta +importe; YO DEBO +importe | No ingreso | D y N iguales bajo compromiso total de deuda |
| Pagar principal personal | Cuenta −importe; YO DEBO −importe | No gasto | D y N iguales |
| Ajuste/apertura | Asiento explícito con motivo | No clasificar automáticamente como ingreso/gasto | Recalcular sin esconder diferencias |

Comisiones, intereses y penalidades se reconocen como gastos nuevos explícitos; no se mezclan con principal. Descuentos, condonaciones, impagos y pérdidas de por cobrar requieren operación y motivo específicos, pendiente de cerrar antes de implementar. Una deuda por compra debe enlazarse al gasto que la originó; no generar gasto otra vez al pagar ni asumir que toda deuda inicial es consumo de este mes.

## Tarjetas y recibos

Crédito disponible = límite − deuda utilizada neta; no es saldo físico ni disponible real. Se permiten pagos parciales, total y múltiples tarjetas. Primera fase: rechazar sobrepago de deuda; un saldo acreedor requerirá regla explícita futura. No ocultar deuda superior al límite; mostrar exceso y bloquear nuevas compras manuales que excedan límite salvo decisión explícita futura.

El ciclo resume movimientos de tarjeta; no es otra deuda adicional a L. Separar saldo de corte, compras posteriores, pagos aplicados y pendiente total. Propuesta: asignar pagos a los ciclos más antiguos pendientes con desglose persistido; revisión de política antes de construir. El pago mínimo no sustituye deuda total en D. Cambiar día de corte no reescribe ciclos cerrados. En V1 effective_date asigna la compra: hasta corte inclusive pertenece al ciclo que cierra ese día; después pertenece al siguiente. Si el día no existe, usar el último válido del mes. No ajustar fines de semana ni feriados. La corrección manual de ciclo cambia únicamente la asociación temporal y recalcula resúmenes de ambos ciclos; preserva el mismo asiento, deuda y gasto. Registrar ciclo anterior/nuevo y motivo, sin duplicar compra.

Recibo recurrente = plantilla; recibo del período = instancia. Un importe esperado no es un gasto. Pendiente y vencido sin reserva son previsión; reservado incorpora su importe a H. Mostrar previsiones no financiadas separadas. No asumir que cada recibo pendiente es deuda contable. Si se reconoce como deuda, convertir reserva en el mismo compromiso pasivo. Pago crea gasto una sola vez y consume el compromiso correspondiente. Con TC crea deuda TC y consume la reserva. Si monto real difiere del reservado, liberar sobrante o descontar diferencia; nunca conservar reserva de un recibo ya pagado.

Pago parcial de recibo: mantener total real, pagado acumulado y saldo residual; estado pagado solo si residual cero. Propuesta de estado derivado: pagado si cero; vencido si venció con residual; reservado si no vencido y tiene fondos; pendiente en otro caso. El importe reservado se muestra además para no perderlo al vencer. Un pago parcial con TC convierte únicamente la porción pagada en deuda TC. Generación recurrente idempotente por plantilla/fecha; no crea movimientos de dinero automáticamente.

## Presupuestos, efectivo y gastos hormiga

Presupuesto = límite por categoría/período; restante = asignado − gasto neto reconocido; puede ser negativo. Porcentaje usado cuando asignado > 0; para cero mostrar sin presupuesto, no dividir por cero. Compra TC participa al comprar; pago TC no participa. Renovación mensual genera otra instancia, conserva historial y no arrastra sobrantes salvo regla futura explícita.

Un presupuesto no reduce D por existir. Solo una asignación financiada crea H, consumido por gastos enlazados. Cuando hay gasto cubierto, S o L cambia y H baja por la misma porción: esa cantidad ya no era libre antes de gastar.

Operación A, Retirar a efectivo: transferencia banco → efectivo, sin gasto. Operación B, Retiro para gastos diarios (gasto cotidiano agregado de $50): registrar gasto desde la cuenta origen o consumir efectivo ya retirado, según elección; no crear a la vez efectivo disponible +$50. No obligar a detallar. Si después desglosa transporte $20 y comida $30, reemplazar las líneas de categoría del mismo gasto, sin nuevos asientos ni nuevos gastos. Si conserva dinero en efectivo tras registrar todo como gasto, debe corregir el agregado explícitamente; la app no puede conocer el remanente sin entrada del usuario.

Gastos hormiga son una etiqueta o vista del gasto existente, no otro movimiento ni categoría adicional sumable al total. Propuesta: umbral configurable por moneda y etiqueta opcional; no elegir un umbral financiero sin usuario. El total mensual cuenta cada línea una vez.

## Distribución, metas y reservas

Distribución configurable por prioridades, importes fijos y porcentajes. Propuesta determinista: porcentaje sobre el ingreso original; cantidades redondeadas en unidades menores; mismo orden por prioridad e ID estable; respetar sobrante efectivo, no asignar cantidades negativas ni más que el ingreso. Mostrar asignaciones parciales e insuficiencia antes de confirmar. El destino del sobrante recibe el resto exacto. Si los porcentajes solicitados superan 100%, rechazar configuración. No asignar dinero aún comprometido a un segundo destino: lo destinado a deuda es etiquetar su financiación, no crear nueva H. Toda asignación confirma efectos virtuales atómicamente; nunca transfiere dinero ni paga obligaciones sin acción separada.

Ejemplo $1,000: TC 100 + comida 180 + recibos 90 + transporte 60 + libre 100 + moto 470 = 1,000. TC 100 ya incluido en L no descuenta otra vez; libre no crea H; los demás destinos financiados sí. Si todas esas porciones están reservadas, D queda 100; no asumir que existe ese compromiso por crear un presupuesto sin financiarlo.

Ahorro de meta = saldo de compromisos vinculados, respaldados en cuentas; aportes y retiros son historial, no activos nuevos. Progreso actual puede disminuir al liberar fondos. Estimación usa aportes netos por meses completos observados; sin historial suficiente o promedio <= 0 mostrar sin estimación. No prometer rendimiento ni fecha garantizada.

Reserva bloqueada cuenta en S y N, no en D. Crear una reserva con $200 existentes no aumenta N; incorporar $200 nuevos desde fuera y bloquearlos sí aumenta N sin aumentar D. Esta distinción corrige la ambigüedad del caso 6 solicitado. Decisión aprobada: unlock_on vencido vuelve la reserva liberable; nunca libera automáticamente y requiere confirmación del usuario. Reglas de excepción a bloqueo pendientes de aprobación.

## Invariantes y casos límite

Todas las operaciones confirmadas son atómicas, idempotentes y reversibles por movimiento de reverso; nunca borrar solo una pata de transferencia/pago. Reversar gasto resta su impacto de categoría y deuda/cuenta, con tratamiento explícito del compromiso consumido. Si operaciones posteriores impiden el reverso, exigir plan validado, no inventar saldo. Ajustes de conciliación no ocultan gastos faltantes. Cuenta inactiva sigue en patrimonio y deudas; archivar no destruye saldo ni historial.

Prohibir fondos asignados por encima de recursos positivos de su cuenta y moneda; préstamos pendientes pueden producir D negativo sin reservas ficticias. Gastar fondos comprometidos exige liberar o reasignar y confirmar; no hacerlo silenciosamente. No compensar cuentas entre monedas ni transferir entre monedas sin regla de cambio. D agregado no reemplaza la validación de liquidez de la cuenta de pago.

Casos a cerrar: meses de 28/29/30/31 días (último día válido aprobado), sin ajuste por fines de semana/feriados, compras de corte inclusivo por effective_date (aprobado), zonas horarias, importes cero/negativos, overflow, entrada duplicada, doble tap, fechas retroactivas, presupuesto agotado, pago desde ahorro, recibo vencido parcialmente reservado, reembolso antes/después de liquidar TC, deuda perdonada y restauración repetida. Ajuste de gasto histórico debe recalcular presupuesto/ciclo y validar compromisos posteriores.

## Matriz de pruebas futuras (no implementada)

| Caso | Resultado obligatorio |
| --- | --- |
| S banco 1,200; L TC 100 | D 1,100 |
| Compra TC 20 desde ese estado | L 120; gasto 20; D 1,080 |
| Pago TC 20 | Banco 1,180; L 100; D 1,080; ningún gasto nuevo |
| Banco 1,200; TC 100; recibo reservado 40; YO DEBO 30 | D 1,030 |
| Retiro banco → efectivo 50 | S y N iguales; ningún gasto |
| Registro ME DEBEN sin cobro | D no aumenta; R aparece separado |
| Préstamo propio 100 y cobro parcial 30 | R residual 70; cobro no ingreso; N total estable |
| Reservar 200 existentes / recibir y bloquear 200 nuevos | N igual en primer caso; N +200 en segundo; D baja 200 / no cambia respectivamente |
| Deuda TC 100 y asignación TC 100 | C incluye 100, no 200 |
| Recibo reservado 40 pagado con TC 40 | Reserva cero; TC +40; gasto 40 una vez; D igual |
| Presupuesto 180 sin fondos / con fondos | D igual / H +180; gasto cubierto consume H |
| Gasto cotidiano 50 desglosado 20+30 | Gasto total 50, sin segunda salida; retiro separado no suma gasto |
| Ahorro físico 200 y meta sobre esos 200 | S incluye 200 una vez; H 200 una vez |
| Pagos parciales, reembolso y reverso | Residuales correctos, categorías netas, sin duplicación |
| Distribución 1,000; insuficiencia y redondeo de porcentajes | Suma <= ingreso; resto exacto; financiación de deuda no duplica H |
| Compra en corte inclusive / día siguiente / febrero con corte 31 | Ciclo por effective_date; último día válido; sin ajuste por fin de semana |
| Corrección manual de ciclo | Misma deuda y gasto; solo cambian resúmenes y asociación |
| Reserva llega a unlock_on | Liberable pero aún comprometida hasta confirmar |
| D negativo, monedas distintas, presupuesto cero | Déficit visible; sin agregación inválida ni división por cero |
| Doble ejecución y fallo entre asientos | Un efecto por operación o rollback completo |
| Repetir recurrencia/restauración; cambio de fecha | Sin instancias duplicadas ni acumulación de saldos |

Añadir pruebas de propiedades: transferencias conservan patrimonio; liquidar principal conserva D; reconstrucción igual a proyecciones; financiación exclusiva por unidad monetaria; ninguna asignación crea dinero. Estas reglas preceden a implementación y UI final.

## Regla implementada del flujo principal

Retiro para gastos cotidianos se registra como EXPENSE/subtype daily: banco disminuye, categoría Gastos cotidianos aumenta y no se crea efectivo. El perfil LOCAL y la carga de desarrollo no crean cuentas cash. La transferencia a una cuenta cash que el usuario cree explícitamente sigue siendo TRANSFER, sin ingreso/gasto. Desglosar un gasto sustituye sus líneas de categoría; conserva transaction_entries y el importe total. Un reverso posterior usa las categorías actuales y sus importes opuestos.

Disponible real: suma de cuentas menos saldos positivos protected y pasivos pendientes de TC y deudas personales; los saldos negativos siguen visibles como déficit. Los compromisos poseen identidad y porción ya excluida para evitar doble descuento al financiar reservas futuras. Transferir free→protected conserva patrimonio y reduce disponible. Los reversos que empeoran una cuenta por debajo de cero se rechazan; ajustes con motivo permiten conciliación explícita.

## Tarjetas V1 implementadas

Disponible real resta una vez la deuda total de tarjetas por moneda; patrimonio resta ese pasivo. No existen apartados de TC implementados: al incorporarlos deben referenciar el mismo compromiso para evitar duplicación. Saldo inicial de deuda no es gasto. Compra aumenta gasto y deuda, sin cambiar banco; pago reduce banco y deuda sin gasto nuevo. Se bloquean compras sobre límite y pagos superiores a deuda.

Corte inclusivo por effective_date; días inexistentes se ajustan al último del mes. Vencimiento: primera ocurrencia del día configurado estrictamente posterior al corte, sin ajustes de feriados. Saldo al último corte es la deuda histórica del ledger hasta esa fecha; el pendiente de cada ciclo usa su clasificación actual. Corregir clasificación no altera fecha efectiva, saldo histórico, deuda ni gasto. Pagos se aplican FIFO por fecha de corte; el desglose se reconstruye atómicamente al registrar datos retroactivos, corregir ciclo o revertir compra.

Reverso total conserva compra y asientos opuestos. V1 rechaza el reverso que dejaría saldo acreedor (por ejemplo compra ya pagada sin otra deuda); ese flujo, refund parcial y reverso de pagos requieren la siguiente extensión. Deuda inicial superior al límite puede representar deuda existente: se muestra crédito disponible negativo y se bloquean nuevas compras.

## Deudas personales V1 implementadas

Préstamo entregado: débito a cuenta por cobrar y crédito al banco; no gasto. Cobro de principal: débito al banco y crédito a la cuenta por cobrar; no ingreso. Obligación existente: apertura contra patrimonio, sin gasto actual. Préstamo recibido: banco aumenta junto con pasivo; no ingreso. Compra financiada: gasto y pasivo nacen en una sola transacción; el pago posterior liquida principal sin nuevo gasto.

Disponible real resta únicamente pasivos personales pendientes, junto con TC, y nunca agrega cuentas por cobrar. Patrimonio total suma principal por cobrar y resta pasivos; patrimonio sin por cobrar lo excluye. Los saldos provienen de asientos POSTED; estado pagada exige pendiente cero y vencida exige fecha pasada y saldo positivo; la reversión del origen muestra anulada, no pagada. Reversos conservan el historial y se bloquean si sus efectos dejan saldos imposibles o un banco sin fondos. Intereses y comisiones se registran manualmente como gastos categorizados desde Inicio, separados del principal; cálculo automático fuera de V1.
