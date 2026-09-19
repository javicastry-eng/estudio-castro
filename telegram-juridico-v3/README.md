# TELEGRAM-JURIDICO-v3

Espejo del proyecto de Google Apps Script `TELEGRAM-JURIDICO-v3` (bot de Telegram
`@EstudioCastroJHC_bot`), sincronizado desde Drive el 2026-09-12.

Sucesor de `telegram-juridico-v2.gs` (raíz del repo). Cambios principales frente a v2:

- **Credenciales por Script Properties**, no hardcodeadas en el código
  (`BOT_TOKEN`, `ANTHROPIC_KEY`, `SB_KEY`, `VOYAGE_KEY`). Para levantar un
  deployment nuevo desde cero hay que cargarlas a mano en el editor de Apps
  Script: **Project Settings → Script Properties → Add script property**,
  una por cada nombre de arriba. Los valores son los mismos que usa el bot
  en producción (Supabase/Drive/Telegram compartidos con v2).
- Dispatcher único por polling (`dispatchColas`, cada 1 min) en vez del
  esquema de triggers `.after()` de v2 — ver el changelog al principio de
  `Code.gs` (v3.3 a v3.18) para el detalle de cada fix.
- **v3.19 (19/09/2026): entrada por POLLING, no webhook.** `dispatchColas`
  ahora arranca preguntando `getUpdates` a Telegram y procesa lo nuevo en
  serie, en la misma ejecución — se dejó de usar `doPost`/webhook porque
  Apps Script no soporta bien HTTP entrante concurrente (mandar 2-3
  documentos juntos por Telegram devolvía 302 y se perdían en silencio).
  Setup: correr `activarModoPolling()` una vez (ver comentario en `Code.gs`).

## Archivos

- `Code.gs` — lógica principal del bot (comandos, colas, polling de Telegram, análisis con Claude).
- `sync_drive_supabase.gs` — sincronización de documentos Drive → Supabase.
- `sync_causas_notion.gs` — sincronización de causas Notion (base CAUSAS) → Supabase `expedientes`, para que el desplegable del Motor Jurisprudencial nunca quede desactualizado. Requiere Script Property `NOTION_TOKEN` — ver setup al principio del archivo.
- `appsscript.json` — manifest del proyecto (servicios avanzados, deployment como web app).

## Setup en un proyecto nuevo

1. Copiar estos 4 archivos al editor de Apps Script.
2. Cargar las Script Properties (ver arriba) + `NOTION_TOKEN` si se usa `sync_causas_notion.gs`.
3. Correr `una_vez_setup_v134()` una vez desde el editor (instala los triggers periódicos).
4. Correr `activarModoPolling()` una vez (apaga cualquier webhook viejo).
5. (Opcional) Correr `crearTriggerSyncCausas()` una vez si se activa la sincronización de causas.
