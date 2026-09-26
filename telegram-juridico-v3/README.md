# TELEGRAM-JURIDICO-v3

> [!WARNING]
> No hacer clasp push desde esta carpeta: las constantes CORRECT_WEBHOOK_URL, DRIVE_ROOT y SB_URL están tapadas con xxxx

Espejo del proyecto de Google Apps Script `TELEGRAM-JURIDICO-v3` (bot de Telegram
`@EstudioCastroJHC_bot`), bajado con `clasp pull` el 2026-09-26.

El flujo es de un solo sentido: Apps Script → repo (`clasp pull`). Después de cada
pull hay que volver a tapar con `"xxxx"` el valor de `CORRECT_WEBHOOK_URL`,
`DRIVE_ROOT` y `SB_URL` en `Sin título.js` antes de commitear.

Características principales:

- **Credenciales por Script Properties**, no hardcodeadas en el código
  (`BOT_TOKEN`, `ANTHROPIC_KEY`, `SB_KEY`, `VOYAGE_KEY`). Para levantar un
  deployment nuevo desde cero hay que cargarlas a mano en el editor de Apps
  Script: **Project Settings → Script Properties → Add script property**,
  una por cada nombre de arriba.
- Dispatcher único por polling (`dispatchColas`, cada 1 min) en vez de
  triggers `.after()` — ver el changelog al principio de `Sin título.js`
  (v3.3 a v3.18) para el detalle de cada fix.
- **v3.19 (19/09/2026): entrada por POLLING, no webhook.** `dispatchColas`
  ahora arranca preguntando `getUpdates` a Telegram y procesa lo nuevo en
  serie, en la misma ejecución — se dejó de usar `doPost`/webhook porque
  Apps Script no soporta bien HTTP entrante concurrente (mandar 2-3
  documentos juntos por Telegram devolvía 302 y se perdían en silencio).
  Setup: correr `activarModoPolling()` una vez (ver comentario en `Sin título.js`).

## Archivos

- `Sin título.js` — lógica principal del bot (comandos, colas, polling de Telegram, análisis con Claude). En el editor de Apps Script se llama `Sin título.gs`.
- `sync_drive_supabase.js` — sincronización de documentos Drive → Supabase.
- `sync_causas_notion.js` — sincronización de causas Notion (base CAUSAS) → Supabase `expedientes`, para que el desplegable del Motor Jurisprudencial nunca quede desactualizado. Requiere Script Property `NOTION_TOKEN` — ver setup al principio del archivo.
- `appsscript.json` — manifest del proyecto (servicios avanzados, deployment como web app).

## Setup en un proyecto nuevo

1. Copiar estos 4 archivos al editor de Apps Script y completar los valores reales de `CORRECT_WEBHOOK_URL`, `DRIVE_ROOT` y `SB_URL` en `Sin título.js` (acá están tapados con `xxxx`).
2. Cargar las Script Properties (ver arriba) + `NOTION_TOKEN` si se usa `sync_causas_notion.js`.
3. Correr `una_vez_setup_v134()` una vez desde el editor (instala los triggers periódicos).
4. Correr `activarModoPolling()` una vez (apaga cualquier webhook viejo).
5. (Opcional) Correr `crearTriggerSyncCausas()` una vez si se activa la sincronización de causas.
