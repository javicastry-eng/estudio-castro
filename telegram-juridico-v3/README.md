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

## Archivos

- `Code.gs` — lógica principal del bot (webhook, comandos, colas, análisis con Claude).
- `sync_drive_supabase.gs` — sincronización de documentos Drive → Supabase.
- `appsscript.json` — manifest del proyecto (servicios avanzados, deployment como web app).

## Setup en un proyecto nuevo

1. Copiar estos 3 archivos al editor de Apps Script.
2. Cargar las Script Properties (ver arriba).
3. Correr `una_vez_setup_v134()` una vez desde el editor (instala los triggers periódicos).
4. Deploy como Web App y correr `setWebhook()` para apuntar Telegram al deployment activo.
