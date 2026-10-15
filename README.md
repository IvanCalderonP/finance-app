# Finance App

Aplicación de finanzas personales con React Native, Expo SDK 57, TypeScript, Expo Router y SQLite local. La versión actual es un prototipo funcional para **datos sintéticos**: la base financiera todavía no está cifrada.

## Iniciar

```sh
cd /home/ivancalderon/Escritorio/proyectosRepo/finance-app
npm install
npx expo start
```

En Android, abre Expo Go y escanea el QR con teléfono y equipo en la misma red. Para web, pulsa `w` en la terminal y abre la dirección indicada. Si cambias dependencias o aparecen errores de caché, reinicia con `npx expo start --clear`. No hace falta Android Studio para usar un teléfono físico.

## Qué puedes probar

Inicio muestra Disponible real, saldo físico, compromisos, deudas, meta principal y próximos pagos. Sus accesos rápidos registran ingreso, gasto, gasto diario y compra TC. La barra inferior abre Movimientos, Calendario, Metas y Más; desde Más se llega a cuentas, tarjetas, deudas, presupuestos y apartados, recibos, distribución, reservas, estadísticas, categorías y preferencias. Pulsa «Probar con ejemplos» en un perfil vacío para cargar cuentas, tarjetas y deudas **sintéticas**; los demás módulos pueden crearse desde sus pantallas.

La base `finance-local-v1.db` es la fuente financiera en Android/iOS. Las migraciones 001–007 conservan ledger, financiación, recibos, planificación, calendario y preferencias. Una compra TC es gasto; pagarla liquida deuda. Un presupuesto sin financiación no reduce Disponible real; un apartado financiado sí. Los montos pueden ocultarse en la interfaz y hay tema claro/oscuro/sistema. Los recordatorios locales se configuran desde Calendario y se sincronizan en móvil tras los cambios y al volver a la app.

Web usa SQLite/WASM como **prueba técnica separada**. Las notificaciones nativas, el cifrado y el backup financiero real aún no están disponibles allí. El laboratorio SQLite mantiene una base aparte y permite exportar/restaurar únicamente datos técnicos sintéticos. No uses datos financieros reales hasta completar cifrado, recuperación y revisión de seguridad.

## Verificaciones

```sh
npm run typecheck
npm run lint
npm test
npx expo-doctor
```

La lógica vive en `src/financial-engine/`, los casos de uso en `src/services/finance/`, SQLite en `src/database/finance/`, las pantallas en `src/features/` y las rutas delgadas en `src/app/`. Las reglas, tablas y límites actuales se describen en [ARCHITECTURE.md](docs/ARCHITECTURE.md), [FINANCIAL_RULES.md](docs/FINANCIAL_RULES.md), [DATABASE.md](docs/DATABASE.md), [FEATURES.md](docs/FEATURES.md) y [SECURITY.md](docs/SECURITY.md).

`npm audit` aún informa 30 avisos heredados de dependencias (12 moderados, 18 altos); no se aplicó una actualización forzada incompatible con SDK 57. Antes de publicar o usar datos reales hacen falta revisión de esos avisos, cifrado y prueba física de esta interfaz ampliada.
