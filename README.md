# Finance App

Proyecto inicial de finanzas personales con React Native, Expo SDK 57, TypeScript y Expo Router. Solo incluye la pantalla de comprobación.

## Ejecutar

Desde /home/ivancalderon/Escritorio/proyectosRepo:

```sh
cd finance-app
npm install
npx expo start
```

Android: abre Expo Go y escanea el QR con teléfono y computadora conectados a la misma red Wi-Fi. Expo Go debe ser compatible con SDK 57.

Web: presiona `w` en la terminal de Expo y abre la dirección indicada en el navegador.

## Comprobaciones

```sh
npm run typecheck
npm run lint
npx expo-doctor
```

## Estructura

Las rutas están en `src/app/`. Las carpetas `features`, `components`, `financial-engine`, `database`, `services`, `hooks`, `store`, `utils` y `types` dentro de `src/` quedan reservadas para el desarrollo futuro. Los seis documentos en `docs/` deben completarse antes de implementar sus módulos.

Git está inicializado dentro de este proyecto. No se han implementado funciones financieras ni instalado las dependencias aplazadas.

## Entorno e instalación

Node 24.21.0, npm/npx 11.19.0, Git 2.54.0. No se cambió Node ni se instaló software del sistema. Se conservaron las dependencias del template default y se añadieron ESLint y eslint-config-expo para lint. Las versiones exactas están en package-lock.json.

Las instalaciones secundarias iniciadas por npx propagan la opción global allow-scripts, incompatible con npm 11.19.0. Para la preparación se utilizó una configuración de usuario temporal, sin modificar la global. npm install directo funciona normalmente.

npm audit informa 29 vulnerabilidades (11 moderadas, 18 altas) en dependencias del template. Las soluciones automáticas propuestas cambian versiones incompatibles con SDK 57, por lo que no se aplicó audit fix --force. Quedan pendientes de una actualización compatible antes de publicar o usar datos reales.

## Validación inicial

TypeScript y lint pasaron. Expo Doctor completó 21/21 comprobaciones. El comando npx expo start inició en modo Expo Go; la respuesta web contiene los dos textos solicitados, la exportación web terminó correctamente y Metro generó el bundle Android. No se probó la apertura en un teléfono físico. El servidor de comprobación se detuvo al finalizar.

## Fase 2 — laboratorio SQLite (solo datos sintéticos)

```sh
npx expo start --clear
npm run test:storage
```

Abre «Abrir prueba técnica SQLite» desde Inicio. Usa únicamente las muestras fijas del laboratorio. Si tienes Metro abierto, detenlo y reinícialo: la configuración WASM y la importación diferida de SQLite deben recargarse. No desactives lazy bundling ni uses EXPO_NO_METRO_LAZY=1: el worker necesita el mapa de bundles. La prueba web es independiente de Android.

Resultados, pasos de cierre completo, archivos y límites de evidencia: [docs/STORAGE_TECHNICAL_REPORT.md](docs/STORAGE_TECHNICAL_REPORT.md). Once tests técnicos pasaron; Las cuatro pruebas básicas en Android fueron confirmadas por el usuario; persistencia y restauración reales en navegador siguen pendientes de verificación. No almacenar datos financieros reales sin cifrado.
