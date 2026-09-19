// @ts-nocheck
// ============================================================
// TELEGRAM-JURIDICO-v3 — INLINE KEYBOARD BUTTONS
// ============================================================
// FIXES v3.3 (v108): Split ejecutarAnalisisPendiente en 2 triggers
// FIXES v3.4 (v109): Insert respuesta_pendiente con log + fallback directo
//   si el insert a Supabase falla (chars especiales, payload grande, etc.)
//   enviarRespuestaPendiente sigue existiendo para el caso feliz.
// FIXES v3.5 (v110): enviarAnalisisDirecto ahora tiene try/catch propio +
//   logging detallado en cada paso + mensaje de error visible en Telegram
//   si algo revienta (antes: header llegaba, cuerpo se perdía en silencio).
//   Se eliminó la función agenteCallClaude duplicada (quedaba solo una,
//   la de más abajo, por hoisting — ahora hay una sola definición).
// FIXES v3.6 (v111): BOT_TOKEN, ANTHROPIC_KEY, SB_KEY y VOYAGE_KEY ahora
//   se leen desde Script Properties (PropertiesService) en vez de estar
//   hardcodeadas. Para rotar una key: Project Settings → Script Properties
//   → editar valor → guardar. NO hace falta Ctrl+S ni redeploy.
//   Setup inicial: correr una_vez_setup_properties() una sola vez (Run).
// FIXES v3.7/v3.8 (v114→v115): BUG DE CONCURRENCIA REAL — procesarDocumentoAsync,
//   ejecutarAnalisisPendiente y enviarRespuestaPendiente "autodestruían" su
//   propio trigger borrando TODOS los triggers que compartieran su nombre de
//   función. Si se mandaban 2+ documentos/análisis dentro de la misma ventana
//   de tiempo (~30-60s), el primero en disparar borraba el trigger del
//   segundo ANTES de que llegara a ejecutarse — quedaba encolado en Supabase
//   sin ningún trigger vivo, perdido en silencio (síntoma: "hay que hacer
//   nuclearReset entre cada documento").
//   Intento v114 (con e.triggerUid) no fue confiable: ese dato no siempre
//   viene poblado en triggers de una sola vez, y caía en un fallback que
//   reproducía el bug. FIX REAL v115: se ELIMINÓ el autoborrado manual por
//   completo — los triggers .after(ms) se autoeliminan solos al ejecutarse,
//   es comportamiento nativo de Apps Script. No hacía falta borrar nada.
// FIXES v3.9 (v116): guardarEnSupabase no logueaba nada cuando el insert
//   fallaba SIN lanzar excepción (ej. Supabase responde 400/409 por
//   validación o duplicado). El usuario veía "❌ Error al guardar en
//   Supabase. Revisá los logs." pero los logs estaban vacíos. Ahora
//   loguea código de respuesta + body + payload enviado en ese caso.
// FIXES v3.10 (v117): BUG DE RAÍZ REAL — encolarDocumento, encolarAnalisis
//   y el insert de respuesta_pendiente usaban "Prefer: resolution=
//   merge-duplicates" al escribir en bot_estado. Ese header le dice a
//   Supabase "si ya existe una fila con este chat_id+tipo, sobrescribila".
//   Perfecto para estados de sesión únicos (analisis/lista), pero un
//   desastre para una COLA: si se mandaban 2 documentos/análisis seguidos
//   desde el mismo chat, el segundo insert PISABA al primero antes de que
//   el trigger llegara a procesarlo — el primero se perdía en silencio,
//   sin error, sin log (síntoma real detrás de "el segundo documento no
//   hizo nada"). Fix: se sacó merge-duplicates de las 3 colas, y el
//   chat_id de cada tarea ahora es compuesto (chatId + timestamp) para que
//   cada una quede en su propia fila. Los borrados correspondientes
//   (procesarDocumentoAsync, ejecutarAnalisisPendiente, enviarRespuesta-
//   Pendiente) se actualizaron para borrar por "id" único de fila en vez
//   de reconstruir el chat_id viejo (que ya no coincide).
// FIXES v3.11 (v118): doPost instrumentado — loguea SIEMPRE qué update
//   entra (tipo, update_id, chat_id) antes de procesar nada, así se sabe
//   si un mensaje perdido nunca llegó a entrar o si entró y falló en
//   silencio. El catch general ahora también intenta avisar por Telegram
//   (antes solo Logger.log, invisible para el usuario). Se logueó también
//   el descarte silencioso por antigüedad >300s (posible causa de
//   documentos "perdidos" si hay demora de entrega de Telegram).
// FIXES v3.14 (v121): BUG DE RAÍZ DEFINITIVO — confirmado vía consulta
//   directa a Supabase: la tabla bot_estado NO TIENE columna "id" (su única
//   clave es chat_id). Desde v117, borrarFilaBotEstado (y antes, el DELETE
//   inline en las 3 funciones de cola) intentaba "id=eq...." contra una
//   columna inexistente — Supabase devolvía 400 en cada intento, y como
//   nadie chequeaba el código de respuesta, se ignoraba en silencio. Ninguna
//   fila de cola se borró NUNCA desde v117. Consecuencia real observada:
//   cada análisis/documento nuevo volvía a disparar TODAS las tareas viejas
//   sin borrar, generando un trigger nuevo en cada reproceso, hasta topar
//   el límite de triggers de Apps Script ("This script has too many
//   triggers. Triggers must be deleted before more can be added.").
//   FIX: borrarFilaBotEstado ahora borra por chat_id (la clave real), no
//   por id. Las 3 funciones de cola (procesarDocumentoAsync, ejecutarAnalisis-
//   Pendiente, enviarRespuestaPendiente) actualizadas para pasar
//   tarea.chat_id / fila.chat_id en vez de tarea.id / fila.id.
// FIXES v3.13 (v120): BUG DE RAÍZ REAL — las 3 colas (tarea_documento,
//   tarea_analisis, respuesta_pendiente) se borraban de bot_estado con un
//   UrlFetchApp.fetch(method:"delete", muteHttpExceptions:true) SIN
//   chequear el código de respuesta. Si ese DELETE fallaba en silencio
//   (timeout, rate limit, error transitorio de Supabase), la fila NO se
//   borraba pero el bot ya la había "procesado" mentalmente — y quedaba
//   viva para siempre en la tabla. Cualquier ejecución FUTURA y TOTALMENTE
//   NO RELACIONADA de enviarRespuestaPendiente/ejecutarAnalisisPendiente/
//   procesarDocumentoAsync volvía a encontrar esa fila vieja (tipo=eq.X
//   sin ningún filtro de antigüedad) y la reenviaba mezclada con el
//   documento nuevo del momento — síntoma real detectado: el análisis de
//   "documento-1.pdf" (de una sesión anterior) reapareciendo pegado al
//   análisis recién pedido de "documento-10.pdf".
//   FIX: (1) nueva función borrarFilaBotEstado() que SÍ verifica el código
//   de respuesta y loguea si el borrado falla. (2) esFilaVieja(): cualquier
//   fila de cola con más de EDAD_MAXIMA_COLA_MIN (15 min) de antigüedad se
//   considera huérfana — se descarta y loguea en vez de procesarla/
//   reenviarla a destiempo. (3) nuevo trigger periódico (crearTrigger-
//   LimpiezaPeriodica) que corre limpiarBotEstadoViejos() cada 15 min sola,
//   sin depender de que Javier la corra a mano.
// FIXES v3.12 (v119): REDISENO - el menu de opciones (1-5) ya no depende
//   de un unico "casillero" de estado compartido por chat (tipo="analisis").
//   Antes, si se procesaban 2+ documentos casi juntos, cada uno pisaba el
//   estado "pendiente" del anterior - al tocar una opcion, podia aplicarse
//   al documento equivocado, o decir "sesion expiro" sin motivo real.
//   Ahora cada documento en danza tiene su propio docId unico, guardado en
//   su propia fila de bot_estado, y metido directo en el callback_data de
//   sus botones ("op_<opcion>_<docId>"). El reply por texto plano (sin
//   boton) sigue existiendo como fallback, tomando el documento pendiente
//   mas reciente - si hay varios en danza a la vez, usar los botones es
//   lo confiable.
// FIXES v3.17 (v133): BUG DE RAÍZ REAL — asegurarTriggerUnico hacía
//   "borrar CUALQUIER trigger existente con ese nombre + crear uno nuevo"
//   cada vez que llegaba un documento/análisis. Si 2-3 documentos llegaban
//   casi juntos (2-3 ejecuciones de doPost casi simultáneas), cada una
//   borraba el trigger que la ejecución anterior acababa de crear, y creaba
//   el suyo — en el peor caso, si dos de estas ejecuciones se pisaban en
//   el instante exacto (una intentando borrar un trigger que la otra YA
//   había borrado un microsegundo antes), eso podía cortar la función
//   ANTES de llegar a crear el trigger nuevo. Si les pasaba a las 3 casi
//   a la vez, terminaba sin ningún trigger vivo — los documentos quedaban
//   en la cola de Supabase sin nadie que los fuera a procesar nunca
//   (síntoma real: mandar 3 documentos juntos y no recibir ni ack ni
//   error para ninguno).
//   FIX: nueva función asegurarTriggerSiNoExiste() — en vez de "borro y
//   creo siempre", ahora es "creo SOLO si no existe ninguno todavía". Si
//   2-3 documentos llegan juntos y ya hay un trigger vivo esperando, las
//   ejecuciones siguientes no tocan nada (no hay nada que borrar, no hay
//   carrera posible). Peor caso aceptado: si el trigger existente resultó
//   estar "Disabled" por Google, la tarea espera hasta el próximo ciclo
//   del trigger de salud (máximo 10 min, ver v3.16/v132) en vez de
//   perderse para siempre. encolarDocumento, encolarAnalisis y las
//   re-agendas internas de las 3 funciones de cola ahora usan esta nueva
//   función. El trigger de salud (saludTriggersProcesamiento) sigue
//   usando asegurarTriggerUnico (borrar y recrear a la fuerza), porque
//   ahí sí es intencional refrescar el trigger sin importar su estado.
// FIXES v3.16 (v132): Google Apps Script deshabilita automáticamente un
//   trigger cuando falla repetidamente (mecanismo de la plataforma, no del
//   código). Causa sospechada: procesarDocumentoAsync/ejecutarAnalisis-
//   Pendiente procesaban TODAS las tareas pendientes en un solo forEach —
//   si se acumulaban varias (documentos mandados juntos), cada una con
//   OCR + Claude + embeddings, la ejecución podía superar el límite de
//   tiempo de Apps Script y morir a mitad de camino. Repetido varias veces,
//   Google apaga el trigger solo (síntoma real: procesarDocumentoAsync,
//   ejecutarAnalisisPendiente y enviarRespuestaPendiente aparecían
//   "Disabled" en la pantalla de Triggers sin que Javier hiciera nada).
//   FIX: (1) las 3 funciones de cola ahora procesan UNA sola tarea por
//   ejecución — si queda más de una pendiente, se agenda otro trigger
//   corto (5s) para seguir con la siguiente, en vez de encadenarlas todas
//   en una sola corrida larga. (2) nuevo trigger periódico de "salud"
//   (crearTriggerSaludProcesamiento, cada 10 min) que recrea los 3
//   triggers de procesamiento SIEMPRE, estén disabled o no — así el
//   sistema se autorepara solo sin que Javier tenga que entrar a mano a
//   borrar triggers "Disabled" en la UI.
// FIXES v3.15 (v131): CORRECT_WEBHOOK_URL apuntaba a un deployment VIEJO
//   (AKfycbxNFepEbxd8WZncFZGqLgx2KyGqikJ5RhEfktZp4awR-ozYrGS78mjBvUSXUzmtSpWRXA),
//   distinto del deployment activo real (Version 130, terminado en
//   ...LwtktQ). Hoy no rompía nada porque el webhook fue apuntado a mano
//   desde "Deploy", pero el día que se corriera nuclearReset() o
//   setWebhook(), habrían revertido el webhook de Telegram hacia el
//   deployment viejo — desactualizado, sin ninguno de los fixes v119-v130 —
//   en silencio. FIX: se actualizó CORRECT_WEBHOOK_URL a la URL del
//   deployment activo real, confirmada vía getWebhookInfo().
// FIXES v3.18 (v134): LATENCIA DE 10-20 MINUTOS EN LOS ANÁLISIS.
//   Síntoma: apretar "Resumen ejecutivo" y recibir la respuesta 10-20 min
//   después (o nunca, cuando pasaba los 15 min de EDAD_MAXIMA_COLA_MIN).
//   CAUSA: asegurarTriggerSiNoExiste() (v133) no crea nada si ya hay un
//   trigger con ese nombre, pero getProjectTriggers() también devuelve
//   triggers YA DISPARADOS y los que Google marcó "Disabled" — y la API no
//   permite distinguirlos de uno vivo. Como el trigger de salud de v132
//   (cada 10 min) dejaba esos nombres permanentemente en la lista, el
//   encolado nunca creaba un trigger vivo: el trabajo sólo avanzaba en el
//   tick de salud. Y como el análisis tenía 2 etapas (tarea_analisis →
//   respuesta_pendiente), esperaba DOS ticks de 10 min.
//   FIX, en tres partes:
//   (1) Se eliminó la dependencia de triggers efímeros. Ahora hay UN
//       trigger periódico permanente, dispatchColas cada 1 min, que es el
//       piso de servicio garantizado (un everyMinutes nunca queda
//       "gastado"). Los kicks .after(1s) quedan como acelerador opcional:
//       si se pierden, el trabajo NO se pierde. Las carreras que
//       persiguieron v115/v117/v133 dejan de importar, porque el trabajo
//       vive en Supabase y asegurarDispatchVivo() siempre termina CREANDO.
//   (2) Se colapsaron las 2 etapas del análisis: ejecutarAnalisisPendiente
//       ahora manda el texto a Telegram en la misma ejecución. El split de
//       v108 existía por el límite de 6 min de Apps Script, pero con Haiku
//       4.5 el análisis tarda ~15s — el round-trip extra sólo agregaba un
//       ciclo de espera entero. respuesta_pendiente queda como red si el
//       envío falla.
//   (3) Triple auto-reparación del periódico: saludDispatch (cada 5 min),
//       doPost (debounceado a 5 min, es la única ejecución garantizada), y
//       el propio setup manual.
//   Latencia: ~15-30s típico, ~80s peor caso (antes 10-20 min).
//   SETUP: correr una_vez_setup_v134() UNA vez desde el editor (Run).
// ============================================================

// ============================================================
// CREDENCIALES — leídas desde Script Properties (Project Settings)
// v3.6 (v111): antes estaban hardcodeadas como const. Ahora viven en
// Script Properties para poder rotarlas sin tocar el editor ni redeployar
// (las Script Properties se leen en tiempo real por cualquier deployment).
// Cómo cargarlas la primera vez: correr la función una_vez_setup_properties()
// UNA sola vez desde el editor (Run), con los valores actuales pegados ahí.
// Después de esa corrida inicial, para rotar cualquier key:
//   Project Settings → Script Properties → editar el valor → guardar.
//   No hace falta Ctrl+S en el editor ni Deploy nuevo.
// ============================================================
const PROPS = PropertiesService.getScriptProperties();
const BOT_TOKEN = PROPS.getProperty("BOT_TOKEN");
const TELEGRAM_API = "https://api.telegram.org/bot" + BOT_TOKEN;
const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_KEY = PROPS.getProperty("ANTHROPIC_KEY");
const SB_URL = "https://nqwybjfrsnqpgdaecubg.supabase.co";
const SB_KEY = PROPS.getProperty("SB_KEY");
const DRIVE_ROOT = "1IfPreFIXWtSNsgpxRYjqot6KjoQQhBAJ";
const INBOX_NAME = "INBOX-TELEGRAM";
const CORRECT_WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbyLHjfsnEflasjEaqkZDWOQeA8V8IsNVU760Q8-oSu8RrLbYqI25vBMp5iZRzg7LwtktQ/exec";
const VOYAGE_KEY = PROPS.getProperty("VOYAGE_KEY");
const VOYAGE_API = "https://api.voyageai.com/v1/embeddings";
function verificarPropiedades() {
  ["BOT_TOKEN", "ANTHROPIC_KEY", "SB_KEY", "VOYAGE_KEY"].forEach(function(nombre) {
    Logger.log(nombre + ": " + (PROPS.getProperty(nombre) ? "configurada" : "FALTA"));
  });
}
// ============================================================
// MONITOREO DE WEBHOOK — avisa por Telegram si Telegram reporta
// error entregando updates (ej. el "302 Found" que ya pasó 2 veces).
// Corre cada 30 min via trigger. Solo avisa una vez por error nuevo,
// no reavisa en cada tick mientras persista el mismo error.
// ============================================================
var CHAT_ID_ALERTAS = 184855747; // tu chat_id

function monitorearWebhook() {
  try {
    var res = UrlFetchApp.fetch(TELEGRAM_API + "/getWebhookInfo", { muteHttpExceptions: true });
    var data = JSON.parse(res.getContentText());
    if (!data.ok) { Logger.log("monitorearWebhook: getWebhookInfo no-ok: " + res.getContentText()); return; }
    var info = data.result;
    var errorActual = info.last_error_message || null;
    var pendientes = info.pending_update_count || 0;
    var ultimoAvisado = PROPS.getProperty("ULTIMO_ERROR_WEBHOOK_AVISADO");

    if (errorActual && errorActual !== ultimoAvisado) {
      sendMessage(CHAT_ID_ALERTAS,
        "⚠️ <b>Alerta: webhook con error</b>\n\n" +
        "Error: " + escaparHTML(errorActual) + "\n" +
        "Mensajes pendientes: " + pendientes + "\n\n" +
        "Solución: Deploy → Manage deployments → New version, y después correr nuclearReset().");
      PROPS.setProperty("ULTIMO_ERROR_WEBHOOK_AVISADO", errorActual);
      Logger.log("monitorearWebhook: alerta enviada — " + errorActual);
    } else if (!errorActual && ultimoAvisado) {
      PROPS.deleteProperty("ULTIMO_ERROR_WEBHOOK_AVISADO");
    }
  } catch (e) {
    Logger.log("monitorearWebhook: excepción — " + e.message);
  }
}

function crearTriggerMonitoreoWebhook() {
  asegurarTriggerUnico("monitorearWebhook", { everyMinutes: 30 });
  Logger.log("✅ Trigger de monitorearWebhook creado (cada 30 min).");
}



// ============================================================
// ESCAPAR HTML
// ============================================================
function escaparHTML(texto) {
  if (!texto) return "";
  return String(texto)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ============================================================
// WEBHOOK ENTRY POINT
// ============================================================
function doGet(e) {
  return ContentService.createTextOutput(JSON.stringify({ status: "ok" }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  var output = ContentService.createTextOutput(JSON.stringify({status: "ok"})).setMimeType(ContentService.MimeType.JSON);
  var chatIdParaError = null;
  try {
    var update = JSON.parse(e.postData.contents);

    // v3.11 (v118): log de entrada — para saber SIEMPRE qué llegó, incluso
    // si algo después falla en silencio.
    var tipoUpdate = update.callback_query ? "callback_query" : (update.message && update.message.document ? "documento" : (update.message ? "mensaje_texto" : "otro"));
    Logger.log("doPost: entrada tipo=" + tipoUpdate + " update_id=" + update.update_id + (update.message ? " chat_id=" + update.message.chat.id : (update.callback_query ? " chat_id=" + update.callback_query.message.chat.id : "")));

    // v3.18 (v134): tercera red de la auto-reparación. doPost es la única
    // ejecución GARANTIZADA (corre cada vez que Javier toca algo), así que
    // es el mejor lugar para verificar que el dispatcher periódico esté
    // vivo. Debounceado a 1 vez cada 5 min, así no encarece cada mensaje.
    // Va ANTES de handleUpdate para no borrar el kick que ese encolado cree.
    asegurarDispatchVivoSiHaceFalta();

    if (update.callback_query) {
      chatIdParaError = update.callback_query.message.chat.id;
      var cbId = String(update.callback_query.id);
      var cbCache = CacheService.getScriptCache();
      if (cbCache.get("cb_" + cbId)) { Logger.log("doPost: callback_query duplicado (ya procesado), ignorado"); return output; }
      cbCache.put("cb_" + cbId, "1", 300);
      handleCallbackQuery(update.callback_query);
      return output;
    }

    if (update.message) chatIdParaError = update.message.chat.id;

    var msgDate = update.message ? update.message.date : 0;
    var ahora = Math.floor(Date.now() / 1000);
    if (msgDate && (ahora - msgDate) > 300) {
      Logger.log("doPost: DESCARTADO por antigüedad — mensaje de hace " + (ahora - msgDate) + "s (límite 300s). update_id=" + update.update_id);
      return output;
    }

    var updateId = String(update.update_id);
    var cache = CacheService.getScriptCache();
    if (cache.get("processed_" + updateId)) { Logger.log("doPost: update_id duplicado (ya procesado), ignorado: " + updateId); return output; }
    cache.put("processed_" + updateId, "1", 300);
    handleUpdate(update);
    Logger.log("doPost: FIN OK, tipo=" + tipoUpdate);
  } catch(err) {
    Logger.log("doPost: EXCEPCIÓN — " + err.message + " | stack: " + err.stack);
    try {
      if (chatIdParaError) sendMessage(chatIdParaError, "⚠️ Error interno procesando tu mensaje: " + escaparHTML(err.message) + "\n\nProbá reenviarlo de nuevo.");
    } catch(err2) { Logger.log("doPost: no se pudo avisar el error por Telegram: " + err2.message); }
  }
  return output;
}

// ============================================================
// HANDLER DE CALLBACK QUERY (botones inline)
// ============================================================
function handleCallbackQuery(cbq) {
  var chatId = cbq.message.chat.id;
  var data = cbq.data;

  answerCallbackQuery(cbq.id);

  if (data.startsWith("doc_")) {
    var idx = parseInt(data.replace("doc_", ""));
    var lista = getPendienteLista(chatId);
    if (!lista || idx >= lista.length) {
      sendMessage(chatId, "⚠️ La sesión expiró. Usá /analizar nuevamente.");
      return;
    }
    var doc = lista[idx];
    clearPendienteLista(chatId);

    var textoDoc = doc.resumen || doc.titulo || "";
    try {
      var match = (doc.url || "").match(/\/d\/([a-zA-Z0-9_-]{25,})/);
      var fileId = match ? match[1] : null;
      if (fileId) {
        var leido = leerTextoDriveParaResumen(fileId);
        if (leido && leido.length > 50) textoDoc = leido;
      }
    } catch(e) { Logger.log("Error leyendo Drive en callback: " + e.message); }

    // v3.12 (v119): cada documento en danza tiene su propio docId único,
    // guardado en su propia fila de bot_estado y metido en el callback_data
    // de sus botones — así el menú de ESTE documento nunca se confunde con
    // el de otro que se esté procesando en simultáneo.
    var docId = generarDocId();
    setPendienteAnalisis(chatId, docId, { texto: textoDoc, titulo: doc.titulo, docId: docId });
    mostrarMenuAnalisis(chatId, doc.titulo, docId);
    return;
  }

  if (data.startsWith("op_")) {
    // v3.12 (v119): callback_data ahora es "op_<opcion>_<docId>".
    var resto = data.replace("op_", "");
    var sep = resto.indexOf("_");
    var opcion = parseInt(resto.substring(0, sep));
    var docId = resto.substring(sep + 1);

    var pendiente = getPendienteAnalisis(chatId, docId);
    if (!pendiente) {
      sendMessage(chatId, "⚠️ La sesión expiró para este documento. Usá /analizar nuevamente.");
      return;
    }
    clearPendienteAnalisis(chatId, docId);
    if (opcion === 5) {
      sendMessage(chatId, "✅ Guardado. Sin análisis adicional.");
    } else {
      encolarAnalisis(chatId, pendiente.texto, pendiente.titulo, opcion);
    }
    return;
  }
}

// ============================================================
// ROUTER DE MENSAJES
// ============================================================
function handleUpdate(update) {
  if (!update.message) return;
  var msg = update.message;
  var chatId = msg.chat.id;
  var text = msg.text ? msg.text.trim() : "";

  if (msg.document) {
    sendMessage(chatId, "📥 Recibí el documento. Lo estoy registrando para procesarlo...");
    encolarDocumento(chatId, msg);
    return;
  }

  if (text === "/start") {
    sendMessage(chatId, "⚖️ <b>Estudio Castro — Bot Jurídico</b>\n\nHola! Estoy activo.\n\n/causas — causas activas\n/ayuda — comandos\n\n📌 Reenviame PDFs o textos de canales jurídicos y los guardo automáticamente.");
    return;
  }
  if (text === "/ayuda") {
    sendMessage(chatId, "📋 <b>Comandos:</b>\n\n/analizar [tema] — buscar y analizar documentos\n/buscar [tema] — búsqueda semántica\n/causas — causas activas\n/argumentar [tema] — generar argumento\n/redactar [tipo] — borrador de escrito\n/ley [norma] — consultar artículo\n/sync — sincronizar Drive");
    return;
  }
  if (text === "/causas") {
    sendMessage(chatId, "📂 <b>Causas activas:</b>\n\n• Rodríguez c/ Holcim y otros — Expte. 15905/2026 — JNT N°16 CNAT");
    return;
  }
  if (text.toLowerCase().startsWith("/busqueda")) {
    var query = text.replace(/^\/busqueda\s*/i, "").trim();
    if (!query) { sendMessage(chatId, "🔍 Usá: /busqueda [tema]"); return; }
    buscarSemantico(chatId, query); return;
  }
  if (text === "/agente")                                           { cmdAgente(chatId); return; }
  if (text.toLowerCase().startsWith("/buscar"))                    { cmdBuscar(chatId, text.replace(/^\/buscar\s*/i,"").trim()); return; }
  if (text.toLowerCase().startsWith("/argumentar"))                { cmdArgumentar(chatId, text.replace(/^\/argumentar\s*/i,"").trim()); return; }
  if (text.toLowerCase().startsWith("/causa") && text.length > 6) { cmdCausa(chatId, text.replace(/^\/causa\s*/i,"").trim()); return; }
  if (text.toLowerCase().startsWith("/redactar"))                  { cmdRedactar(chatId, text.replace(/^\/redactar\s*/i,"").trim()); return; }
  if (text.toLowerCase().startsWith("/ley"))                       { cmdLey(chatId, text.replace(/^\/ley\s*/i,"").trim()); return; }
  if (text.toLowerCase().startsWith("/sync"))                      { cmdSync(chatId); return; }
  if (text.toLowerCase().startsWith("/analizar")) {
    var q = text.replace(/^\/analizar\s*/i, "").trim();
    if (!q) { sendMessage(chatId, "🔍 Usá: /analizar [nombre o tema]"); return; }
    cmdAnalizar(chatId, q); return;
  }
  if (text.startsWith("/")) { sendMessage(chatId, "❓ Comando no reconocido. /ayuda para ver los comandos."); return; }
  if (text) { procesarTexto(chatId, text); }
}

// ============================================================
// PROCESAR DOCUMENTO ENVIADO POR TELEGRAM
// ============================================================
function procesarDocumento(chatId, msg) {
  try {
    var doc = msg.document;
    var fileName = doc.file_name || "documento_" + new Date().getTime();
    var fileId = doc.file_id;
    Logger.log("procesarDocumento: iniciando chatId=" + chatId + " fileName=" + fileName + " fileId=" + fileId);
    var fileInfoRes = UrlFetchApp.fetch(TELEGRAM_API + "/getFile?file_id=" + fileId);
    var fileInfo = JSON.parse(fileInfoRes.getContentText());
    if (!fileInfo.ok) { sendMessage(chatId, "❌ No pude obtener el archivo de Telegram."); return; }
    var filePath = fileInfo.result.file_path;
    var fileSize = fileInfo.result.file_size || 0;
    if (fileSize > 20 * 1024 * 1024) { sendMessage(chatId, "⚠️ Archivo demasiado grande (" + Math.round(fileSize/1024/1024) + " MB). Límite: 20 MB."); return; }
    var downloadUrl = "https://api.telegram.org/file/bot" + BOT_TOKEN + "/" + filePath;
    var fileBlob = UrlFetchApp.fetch(downloadUrl).getBlob();
    fileBlob.setName(fileName);
    var pdfText = "";
    try {
      var mimeType = doc.mime_type || "";
      if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
        var gdocFile = Drive.Files.insert(
          { title: "temp_doc", mimeType: MimeType.GOOGLE_DOCS },
          fileBlob
        );
        var gdoc = DocumentApp.openById(gdocFile.id);
        pdfText = gdoc.getBody().getText().substring(0, 1500);
        DriveApp.getFileById(gdocFile.id).setTrashed(true);
      } else {
        fileBlob.setContentType("application/pdf");
        var ocrFile = Drive.Files.insert(
          { title: "ocr_temp", mimeType: MimeType.GOOGLE_DOCS },
          fileBlob
        );
        var ocrDoc = DocumentApp.openById(ocrFile.id);
        pdfText = ocrDoc.getBody().getText().substring(0, 1500);
        DriveApp.getFileById(ocrFile.id).setTrashed(true);
      }
    } catch(e) { Logger.log("Error extraccion texto: " + e.message); }
    var inboxFolder = getOrCreateInbox();
    var mdFileName = fileName.replace(/\.[^/.]+$/, "") + ".md";
    var mdContent = "# " + fileName + "\n\n**Fuente:** Telegram @mujeresabogadas\n\n" + pdfText;
    var mdBlob = Utilities.newBlob(mdContent, "text/plain", mdFileName);
    var driveFile = inboxFolder.createFile(mdBlob);
    var driveUrl = driveFile.getUrl();
    var caption = msg.caption || "";
    var textoParaClasificar = (pdfText && pdfText.length > 50 ? "Contenido del documento: " + pdfText.substring(0, 1800) + "\n\n" : "") + "Nombre del archivo: " + fileName + (caption ? "\nDescripción del usuario: " + caption : "");
    var clasificacion = clasificarTextoConClaude(textoParaClasificar);
    if (!clasificacion) clasificacion = { tipo: "MODELO", area: "GENERAL", titulo: fileName, resumen: "" };
    if (pdfText && pdfText.length > 50 && clasificacion.tipo !== "JURISPRUDENCIA") {
      var tienePartes = pdfText.indexOf(" vs. ") !== -1 || pdfText.indexOf(" vs ") !== -1 || pdfText.indexOf(" c/ ") !== -1 || pdfText.indexOf(" c/") !== -1;
      if (tienePartes) { clasificacion.tipo = "JURISPRUDENCIA"; if (!clasificacion.area || clasificacion.area === "GENERAL") clasificacion.area = "LABORAL"; }
    }
    var tabla = clasificacion.tipo === "JURISPRUDENCIA" ? "jurisprudencia" : clasificacion.tipo === "DOCTRINA" ? "doctrina" : "modelos";
    var guardado = guardarEnSupabase(tabla, clasificacion, driveUrl, fileName);
    var emoji = tabla === "jurisprudencia" ? "⚖️" : tabla === "doctrina" ? "📚" : "📝";
    if (guardado) {
      sendMessage(chatId, emoji + " <b>Guardado exitosamente</b>\n\n<b>Archivo:</b> " + escaparHTML(fileName) + "\n<b>Tabla:</b> " + tabla + "\n<b>Área:</b> " + escaparHTML(clasificacion.area) + "\n<b>Drive:</b> <a href=\"" + driveUrl + "\">Ver archivo</a>");
      var docId = generarDocId();
      setPendienteAnalisis(chatId, docId, { texto: pdfText, titulo: fileName, docId: docId });
      mostrarMenuAnalisis(chatId, fileName, docId);
    } else {
      sendMessage(chatId, "❌ Error al guardar en Supabase. Revisá los logs.");
    }
  } catch(err) {
    Logger.log("Error procesarDocumento: " + err.message);
    sendMessage(chatId, "❌ Error al procesar el documento: " + escaparHTML(err.message));
  }
}

// ============================================================
// ENCOLAR DOCUMENTO — retorna inmediato, procesa async
// ============================================================
function encolarDocumento(chatId, msg) {
  var doc = msg.document;
  var fileName = doc.file_name || "documento_" + new Date().getTime();
  var payload = JSON.stringify({
    chat_id: String(chatId) + "_" + new Date().getTime() + "_" + Math.floor(Math.random() * 1000000),
    tipo: "tarea_documento",
    payload: {
      chatId: chatId,
      file_id: doc.file_id,
      file_name: fileName,
      mime_type: doc.mime_type || "",
      file_size: doc.file_size || 0,
      caption: msg.caption || ""
    },
    updated_at: new Date().toISOString()
  });
  Logger.log("encolarDocumento: insertando tarea_documento para chatId=" + chatId + " fileName=" + fileName);
  var res = UrlFetchApp.fetch(SB_URL + "/rest/v1/bot_estado", {
    method: "post",
    headers: { "apikey": SB_KEY, "Authorization": "Bearer " + SB_KEY, "Content-Type": "application/json" },
    payload: payload,
    muteHttpExceptions: true
  });
  Logger.log("encolarDocumento: insert bot_estado code=" + res.getResponseCode() + " body=" + res.getContentText().substring(0, 400));
  if (res.getResponseCode() !== 201 && res.getResponseCode() !== 200 && res.getResponseCode() !== 204) {
    Logger.log("encolarDocumento: ERROR al insertar en bot_estado; no se creó la cola.");
    sendMessage(chatId, "⚠️ No pude registrar el documento para procesarlo. Revisá los logs.");
    return;
  }
  kickDispatch("encolarDocumento");
  sendMessage(chatId, "📥 Recibí el documento. Procesando... te aviso en un momento.");
}

// ============================================================
// PROCESAR DOCUMENTO ASYNC
// ============================================================
function procesarDocumentoAsync(e) {
  var res = UrlFetchApp.fetch(
    SB_URL + "/rest/v1/bot_estado?tipo=eq.tarea_documento",
    { headers: { "apikey": SB_KEY, "Authorization": "Bearer " + SB_KEY }, muteHttpExceptions: true }
  );
  Logger.log("procesarDocumentoAsync: respuesta Supabase code=" + res.getResponseCode() + " body=" + String(res.getContentText()).substring(0, 400));
  var tareas = parseJsonSafe(res.getContentText(), []);
  if (!Array.isArray(tareas) || tareas.length === 0) {
    Logger.log("procesarDocumentoAsync: no hay tareas_documento pendientes");
    return;
  }
  Logger.log("procesarDocumentoAsync: tareas encontradas=" + tareas.length);
  // v3.16 (v132): procesar UNA sola tarea por ejecución, no todas juntas.
  // Si hubiera varios documentos en cola (OCR + Claude + embeddings cada
  // uno), procesarlos todos en un solo forEach podía hacer que la
  // ejecución superase el límite de tiempo de Apps Script — y eso,
  // repetido, es lo que llevaba a que Google deshabilitara el trigger
  // solo. Si queda más de 1 pendiente, se agenda otro trigger corto (5s)
  // para seguir con la siguiente en la próxima corrida.
  var tarea = tareas[0];
  Logger.log("procesarDocumentoAsync: procesando tarea chat_id=" + tarea.chat_id + " payload=" + (tarea.payload ? JSON.stringify(tarea.payload).substring(0, 300) : "{}"));
  try {
    if (esFilaVieja(tarea)) {
      Logger.log("procesarDocumentoAsync: fila VIEJA descartada, chat_id=" + tarea.chat_id + " chatId=" + (tarea.payload ? tarea.payload.chatId : "?"));
      borrarFilaBotEstado(tarea.chat_id, "procesarDocumentoAsync/vieja");
    } else {
      var p = tarea.payload;
      borrarFilaBotEstado(tarea.chat_id, "procesarDocumentoAsync");
      var msgFake = {
        document: { file_id: p.file_id, file_name: p.file_name, mime_type: p.mime_type, file_size: p.file_size },
        caption: p.caption
      };
      procesarDocumento(p.chatId, msgFake);
    }
  } catch(e) { Logger.log("Error procesarDocumentoAsync: " + e.message); }

  if (tareas.length > 1) {
    Logger.log("procesarDocumentoAsync: quedan " + (tareas.length - 1) + " tareas más — agendando siguiente corrida");
    kickDispatch("procesarDocumentoAsync/quedan-" + (tareas.length - 1));
  }
}

// ============================================================
// PROCESAR TEXTO LIBRE
// ============================================================
function procesarTexto(chatId, texto) {
  var pendiente = getUltimoPendienteAnalisis(chatId);

  if (pendiente && /^\d+$/.test(texto.trim())) {
    var opcion = parseInt(texto.trim());
    if (opcion >= 1 && opcion <= 5) {
      clearPendienteAnalisis(chatId, pendiente.docId);
      if (opcion === 5) {
        sendMessage(chatId, "✅ Guardado. Sin análisis adicional.");
      } else {
        sendMessage(chatId, "⏳ Analizando documento... puede tardar unos segundos.");
        encolarAnalisis(chatId, pendiente.texto, pendiente.titulo, opcion);
      }
      return;
    }
  }

  if (texto.length < 150 && texto === texto.toUpperCase()) {
    sendMessage(chatId, "ℹ️ Parece el título de un documento.\n\nPara clasificarlo correctamente, reenviá el PDF y escribí esta descripción en el campo de texto que aparece debajo del archivo antes de enviarlo.");
    return;
  }
  var clasificacion = clasificarTextoConClaude(texto);
  if (!clasificacion || clasificacion.tipo === "IGNORAR") {
    sendMessage(chatId, "ℹ️ No pude clasificar este texto como contenido jurídico guardable.\n\nSi es la descripción de un PDF, incluila como caption al momento de reenviar el archivo.");
    return;
  }
  var tabla = clasificacion.tipo === "JURISPRUDENCIA" ? "jurisprudencia" : clasificacion.tipo === "DOCTRINA" ? "doctrina" : "modelos";
  var guardado = guardarEnSupabase(tabla, clasificacion, null, clasificacion.titulo);
  var emoji = tabla === "jurisprudencia" ? "⚖️" : tabla === "doctrina" ? "📚" : "📝";
  if (guardado) {
    sendMessage(chatId, emoji + " <b>Guardado en " + tabla + "</b>\n\n<b>Título:</b> " + escaparHTML(clasificacion.titulo) + "\n<b>Área:</b> " + escaparHTML(clasificacion.area));
  } else {
    sendMessage(chatId, "❌ Error al guardar en Supabase.");
  }
}

// ============================================================
// ESTADO — SUPABASE (bot_estado)
// ============================================================

function parseJsonSafe(texto, fallback) {
  if (!texto) return fallback;
  try {
    return JSON.parse(texto);
  } catch (e) {
    Logger.log("parseJsonSafe: no se pudo parsear JSON — " + e.message + " | texto=" + String(texto).substring(0, 200));
    return fallback;
  }
}

function asegurarTriggerUnico(handler, opciones) {
  var triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function(t) {
    if (t.getHandlerFunction() === handler) {
      ScriptApp.deleteTrigger(t);
      Logger.log("asegurarTriggerUnico: eliminado trigger previo para " + handler);
    }
  });

  if (opciones && opciones.everyMinutes) {
    ScriptApp.newTrigger(handler).timeBased().everyMinutes(opciones.everyMinutes).create();
  } else if (opciones && opciones.afterMs) {
    ScriptApp.newTrigger(handler).timeBased().after(opciones.afterMs).create();
  } else {
    ScriptApp.newTrigger(handler).timeBased().everyMinutes(15).create();
  }
  Logger.log("asegurarTriggerUnico: creado trigger para " + handler);
}

// ============================================================
// v3.18 (v134): DISPATCHER ÚNICO PERIÓDICO — REEMPLAZA TODO EL
// ESQUEMA DE TRIGGERS .after() DE v108-v133
// ============================================================
// Por qué se rehizo de cero:
//
// Hasta v133, cada encolado creaba un trigger .after() de una sola vez, y
// que el trabajo avanzara dependía de que ESE trigger puntual existiera y
// estuviera vivo. Ese diseño falló de tres formas distintas:
//   - v115: los handlers se autoborraban el trigger entre sí (carrera) y
//     quedaban tareas encoladas sin ningún trigger vivo.
//   - v133: asegurarTriggerSiNoExiste() no creaba nada si ya había un
//     trigger con ese nombre. Pero getProjectTriggers() también devuelve
//     triggers YA DISPARADOS y triggers que Google marcó "Disabled", y no
//     hay forma en la API de distinguirlos de uno vivo. Como el trigger de
//     salud (cada 10 min) dejaba esos nombres permanentemente presentes en
//     la lista, el encolado NUNCA creaba un trigger vivo: el trabajo sólo
//     avanzaba cuando pasaba el tick de salud. Y como el análisis tenía dos
//     etapas, esperaba DOS ticks. De ahí los 10-20 minutos.
//
// La raíz común de los tres bugs es la misma: el trabajo dependía de un
// trigger EFÍMERO. v134 lo invierte:
//
//   1. PISO GARANTIZADO: un único trigger PERIÓDICO permanente
//      (dispatchColas, cada 1 min). Un trigger everyMinutes nunca queda
//      "gastado", así que no puede desaparecer solo.
//   2. ACELERADOR: cada encolado dispara un "kick" .after(1s) para no
//      esperar el minuto. Si el kick se pierde, NO se pierde el trabajo —
//      el periódico lo levanta en ≤60s.
//   3. AUTO-REPARACIÓN: saludDispatch (cada 5 min) y doPost (debounceado)
//      recrean el periódico desde cero, por si Google lo deshabilitó.
//
// Las carreras dejan de importar porque el trabajo vive en Supabase, no en
// el trigger, y porque asegurarDispatchVivo() siempre termina CREANDO —
// nunca puede dejar cero triggers.
//
// Latencia esperada: ~15-30s típico, ~80s peor caso normal.
// ============================================================

// Todo trigger cuyo handler esté en esta lista es "de cola" y por lo tanto
// descartable/recreable por asegurarDispatchVivo(). Incluye los nombres
// viejos de v108-v133 para que la primera corrida limpie lo que quedó
// acumulado. OJO: "saludDispatch" NO va acá (se borraría a sí mismo).
var HANDLERS_DE_COLA = [
  "dispatchColas",
  "procesarDocumentoAsync",
  "ejecutarAnalisisPendiente",
  "enviarRespuestaPendiente",
  "saludTriggersProcesamiento"
];

var KICK_DEBOUNCE_MS = 10 * 1000;   // no más de 1 kick cada 10s
var MAX_TRIGGERS_DISPATCH = 6;      // tope de seguridad (límite de Apps Script: 20)
var ASEGURAR_DEBOUNCE_MIN = 5;      // cada cuánto doPost se molesta en reparar triggers

// Punto de entrada ÚNICO de todas las colas. Lo llaman tanto el trigger
// periódico de 1 min como los kicks .after(1s).
function dispatchColas(e) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(2000)) {
    Logger.log("dispatchColas: ya hay otra corrida en curso, salteo (no se pierde nada: el periódico reintenta en ≤1 min)");
    return;
  }
  try {
    // Una sola consulta para las 3 colas: así la corrida "en vacío" — que es
    // el caso normal, 1440 veces por día — cuesta un HTTP y no tres. Importa
    // para la cuota de runtime de triggers (90 min/día en cuentas gratuitas).
    var res = UrlFetchApp.fetch(
      SB_URL + "/rest/v1/bot_estado?tipo=in.(tarea_documento,tarea_analisis,respuesta_pendiente)&select=tipo",
      { headers: { "apikey": SB_KEY, "Authorization": "Bearer " + SB_KEY }, muteHttpExceptions: true }
    );
    var filas = parseJsonSafe(res.getContentText(), null);
    if (!Array.isArray(filas)) {
      Logger.log("dispatchColas: respuesta inesperada de Supabase (code=" + res.getResponseCode() + ") — " + String(res.getContentText()).substring(0, 200));
      return;
    }
    if (filas.length === 0) return;

    var tipos = {};
    filas.forEach(function(f) { tipos[f.tipo] = (tipos[f.tipo] || 0) + 1; });
    Logger.log("dispatchColas: pendientes=" + JSON.stringify(tipos));

    // UNA unidad de trabajo por corrida (misma lección que v132: ejecuciones
    // largas hacen que Google deshabilite el trigger). El encadenamiento lo
    // hace el kick de abajo, a ~1s de distancia, así que drenar la cola
    // sigue siendo rápido.
    // Orden deliberado: primero las respuestas ya generadas (baratas y el
    // usuario las está esperando), después trabajo nuevo.
    if (tipos["respuesta_pendiente"])  enviarRespuestaPendiente();
    else if (tipos["tarea_analisis"])  ejecutarAnalisisPendiente();
    else if (tipos["tarea_documento"]) procesarDocumentoAsync();

    if (filas.length > 1) kickDispatch("dispatchColas/quedan-" + (filas.length - 1));
  } catch (err) {
    // Se traga todo a propósito: si dispatchColas lanza excepción repetidas
    // veces, Google deshabilita el trigger periódico y volvemos al problema
    // de v133. Mejor loguear y salir con éxito.
    Logger.log("dispatchColas: EXCEPCIÓN — " + err.message + " | stack: " + err.stack);
  } finally {
    lock.releaseLock();
  }
}

// Trigger de una sola vez para arrancar el dispatcher en segundos en vez de
// esperar el tick del minuto. Es un ACELERADOR, no el mecanismo de entrega:
// si falla, se loguea y se sigue — el periódico de 1 min cubre igual.
function kickDispatch(motivo) {
  try {
    var ahora = Date.now();
    var ultimo = Number(PROPS.getProperty("ULTIMO_KICK_MS") || 0);
    if (ahora - ultimo < KICK_DEBOUNCE_MS) {
      Logger.log("kickDispatch(" + motivo + "): debounce — ya hubo un kick hace " + Math.round((ahora - ultimo) / 1000) + "s");
      return;
    }
    var cuantos = ScriptApp.getProjectTriggers().filter(function(t) {
      return t.getHandlerFunction() === "dispatchColas";
    }).length;
    if (cuantos >= MAX_TRIGGERS_DISPATCH) {
      Logger.log("kickDispatch(" + motivo + "): ya hay " + cuantos + " triggers de dispatchColas, no creo más (el periódico procesa igual)");
      return;
    }
    PROPS.setProperty("ULTIMO_KICK_MS", String(ahora));
    ScriptApp.newTrigger("dispatchColas").timeBased().after(1000).create();
    Logger.log("kickDispatch(" + motivo + "): kick creado");
  } catch (err) {
    Logger.log("kickDispatch(" + motivo + "): no se pudo crear el kick (" + err.message + ") — el periódico de 1 min lo cubre");
  }
}

// Deja el proyecto con EXACTAMENTE un dispatchColas periódico de 1 min, y
// borra todo trigger de cola sobrante (nombres viejos de v108-v133, kicks
// gastados, triggers deshabilitados por Google).
//
// A diferencia del viejo asegurarTriggerUnico, acá borrar-y-crear no puede
// perder trabajo: lo ÚLTIMO que hace es crear, así que nunca quedan cero
// triggers, y las tareas viven en Supabase. Si dos corridas se cruzan, el
// peor caso son 2 periódicos — inofensivo, dispatchColas tiene lock.
function asegurarDispatchVivo(motivo) {
  var borrados = 0;
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (HANDLERS_DE_COLA.indexOf(t.getHandlerFunction()) !== -1) {
      ScriptApp.deleteTrigger(t);
      borrados++;
    }
  });
  ScriptApp.newTrigger("dispatchColas").timeBased().everyMinutes(1).create();
  PROPS.setProperty("ULTIMO_ASEGURAR_MS", String(Date.now()));
  Logger.log("asegurarDispatchVivo(" + motivo + "): borrados " + borrados + " triggers de cola, creado dispatchColas cada 1 min");
}

// Versión barata para llamar desde doPost en cada interacción. Sólo hace el
// trabajo caro (listar/borrar/crear triggers, ~1-2s) si pasaron más de
// ASEGURAR_DEBOUNCE_MIN minutos. Es la tercera red: si Google deshabilitó el
// periódico, la próxima vez que toques un botón se repara solo, sin esperar
// al trigger de salud.
function asegurarDispatchVivoSiHaceFalta() {
  try {
    var ultimo = Number(PROPS.getProperty("ULTIMO_ASEGURAR_MS") || 0);
    if (Date.now() - ultimo < ASEGURAR_DEBOUNCE_MIN * 60 * 1000) return;
    asegurarDispatchVivo("doPost/reparación-barata");
  } catch (err) {
    Logger.log("asegurarDispatchVivoSiHaceFalta: " + err.message);
  }
}

// Trigger periódico de salud. Recrea el dispatcher SIEMPRE, sin importar si
// Google lo había marcado "Disabled" — que es justamente el estado que
// getProjectTriggers() no permite detectar.
//
// Va cada 10 min (no cada 1) a propósito: listar+borrar+crear triggers tarda
// ~2s y esto es sólo la red de fondo para cuando NADIE está usando el bot.
// En cuanto Javier toca algo, doPost repara en la misma ejecución, así que
// bajar esta frecuencia no empeora la latencia percibida — y sí importa para
// la cuota (ver nota de cuota en una_vez_setup_v134).
function saludDispatch() {
  asegurarDispatchVivo("saludDispatch/cada-10-min");
}

// ============================================================
// SETUP v134 — correr UNA sola vez desde el editor (Run) después
// de pegar este código. Reemplaza a crearTriggerSaludProcesamiento()
// y crearTriggerLimpiezaPeriodica() de las versiones anteriores.
// ============================================================
// NOTA DE CUOTA: Apps Script en cuenta gratuita permite 90 min/día de
// runtime total de triggers. Este esquema consume, en vacío:
//   dispatchColas    1440 corridas/día × ~1s  ≈ 24 min/día
//   saludDispatch     144 corridas/día × ~2s  ≈  5 min/día
//   limpiarBotEstado   96 corridas/día × ~1s  ≈  2 min/día
//                                        TOTAL ≈ 31 min/día (~35% de cuota)
// El resto queda para el trabajo real. Por eso dispatchColas hace UNA sola
// consulta a Supabase para las 3 colas y sale inmediatamente si no hay nada:
// multiplicado por 1440, cada HTTP de más cuesta ~8 min/día de cuota.
// Si algún día la cuota queda corta, la palanca correcta es bajar
// dispatchColas a everyMinutes(5) — la latencia pasaría a ~5 min de techo,
// pero los kicks seguirían dando los ~20s habituales.
function una_vez_setup_v134() {
  asegurarDispatchVivo("setup manual v134");
  asegurarTriggerUnico("saludDispatch", { everyMinutes: 10 });
  asegurarTriggerUnico("limpiarBotEstadoViejos", { everyMinutes: 15 });
  Logger.log("✅ v134 instalado: dispatchColas cada 1 min + saludDispatch cada 10 min + limpiarBotEstadoViejos cada 15 min");
  verificarPropiedades();
  diagnosticoTriggers();
}

// Para inspeccionar desde el editor qué triggers quedaron vivos.
function diagnosticoTriggers() {
  var ts = ScriptApp.getProjectTriggers();
  Logger.log("diagnosticoTriggers: " + ts.length + " triggers en el proyecto (límite de Apps Script: 20)");
  ts.forEach(function(t) {
    Logger.log("  - " + t.getHandlerFunction() + " [" + t.getEventType() + "] uid=" + t.getUniqueId());
  });
}

function generarDocId() {
  return String(new Date().getTime()) + "_" + Math.floor(Math.random() * 100000);
}

function setPendienteAnalisis(chatId, docId, data) {
  UrlFetchApp.fetch(SB_URL + "/rest/v1/bot_estado", {
    method: "post",
    headers: { "apikey": SB_KEY, "Authorization": "Bearer " + SB_KEY, "Content-Type": "application/json" },
    payload: JSON.stringify({ chat_id: String(chatId) + "_" + docId, tipo: "analisis", payload: data, updated_at: new Date().toISOString() }),
    muteHttpExceptions: true
  });
}

function getPendienteAnalisis(chatId, docId) {
  var cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  var res = UrlFetchApp.fetch(
    SB_URL + "/rest/v1/bot_estado?chat_id=eq." + String(chatId) + "_" + docId + "&tipo=eq.analisis&updated_at=gte." + cutoff,
    { headers: { "apikey": SB_KEY, "Authorization": "Bearer " + SB_KEY }, muteHttpExceptions: true }
  );
  var rows = JSON.parse(res.getContentText());
  return (rows && rows.length > 0) ? rows[0].payload : null;
}

function clearPendienteAnalisis(chatId, docId) {
  UrlFetchApp.fetch(SB_URL + "/rest/v1/bot_estado?chat_id=eq." + String(chatId) + "_" + docId + "&tipo=eq.analisis", {
    method: "delete",
    headers: { "apikey": SB_KEY, "Authorization": "Bearer " + SB_KEY },
    muteHttpExceptions: true
  });
}

function getUltimoPendienteAnalisis(chatId) {
  var cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  var res = UrlFetchApp.fetch(
    SB_URL + "/rest/v1/bot_estado?chat_id=ilike." + String(chatId) + "_%25&tipo=eq.analisis&updated_at=gte." + cutoff + "&order=updated_at.desc&limit=1",
    { headers: { "apikey": SB_KEY, "Authorization": "Bearer " + SB_KEY }, muteHttpExceptions: true }
  );
  var rows = JSON.parse(res.getContentText());
  return (rows && rows.length > 0) ? rows[0].payload : null;
}

function setPendienteLista(chatId, lista) {
  UrlFetchApp.fetch(SB_URL + "/rest/v1/bot_estado", {
    method: "post",
    headers: { "apikey": SB_KEY, "Authorization": "Bearer " + SB_KEY, "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates" },
    payload: JSON.stringify({ chat_id: String(chatId), tipo: "lista", payload: lista, updated_at: new Date().toISOString() }),
    muteHttpExceptions: true
  });
}

function getPendienteLista(chatId) {
  var cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  var res = UrlFetchApp.fetch(
    SB_URL + "/rest/v1/bot_estado?chat_id=eq." + String(chatId) + "&tipo=eq.lista&updated_at=gte." + cutoff,
    { headers: { "apikey": SB_KEY, "Authorization": "Bearer " + SB_KEY }, muteHttpExceptions: true }
  );
  var rows = JSON.parse(res.getContentText());
  return (rows && rows.length > 0) ? rows[0].payload : null;
}

function clearPendienteLista(chatId) {
  UrlFetchApp.fetch(SB_URL + "/rest/v1/bot_estado?chat_id=eq." + String(chatId) + "&tipo=eq.lista", {
    method: "delete",
    headers: { "apikey": SB_KEY, "Authorization": "Bearer " + SB_KEY },
    muteHttpExceptions: true
  });
}

function limpiarBotEstadoViejos() {
  var cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  UrlFetchApp.fetch(
    SB_URL + "/rest/v1/bot_estado?updated_at=lt." + cutoff,
    { method: "delete", headers: { "apikey": SB_KEY, "Authorization": "Bearer " + SB_KEY }, muteHttpExceptions: true }
  );
  Logger.log("bot_estado: limpieza de registros anteriores a " + cutoff);
}

// v3.14 (v121): BUG DE RAÍZ REAL detectado vía Supabase MCP — la tabla
// bot_estado NO TIENE columna "id". Su única clave es chat_id (que ya es
// compuesto: chatId_timestamp o chatId_docId, único por fila). Desde v117
// todo el código borraba con "id=eq...." — una columna inexistente —
// y Supabase devolvía 400 en CADA intento, silenciosamente ignorado
// (muteHttpExceptions:true sin chequear código). Resultado: ninguna fila
// de cola se borraba NUNCA, así que cada trigger nuevo volvía a encontrar
// TODAS las tareas viejas sin borrar y las re-disparaba de nuevo —
// generando un trigger nuevo por cada re-disparo, hasta topar el límite
// de Apps Script ("This script has too many triggers"). Fix: borrar por
// chat_id, que es la clave real de la tabla.
function borrarFilaBotEstado(chatIdKey, contexto) {
  var res = UrlFetchApp.fetch(
    SB_URL + "/rest/v1/bot_estado?chat_id=eq." + encodeURIComponent(chatIdKey),
    { method: "delete", headers: { "apikey": SB_KEY, "Authorization": "Bearer " + SB_KEY }, muteHttpExceptions: true }
  );
  var code = res.getResponseCode();
  if (code !== 200 && code !== 204) {
    Logger.log("⚠️ borrarFilaBotEstado FALLÓ (" + (contexto || "?") + ") chat_id=" + chatIdKey + " código=" + code + " body=" + res.getContentText().substring(0, 200));
    return false;
  }
  return true;
}

// v3.13 (v120): cualquier fila de cola con más de EDAD_MAXIMA_COLA_MIN
// minutos sin procesarse se considera huérfana (algo falló antes: un
// delete silencioso, un trigger perdido, etc.) y se descarta en vez de
// reenviarla a destiempo mezclada con documentos nuevos.
var EDAD_MAXIMA_COLA_MIN = 15;
function esFilaVieja(fila) {
  var edadMin = (Date.now() - new Date(fila.updated_at).getTime()) / 60000;
  return edadMin > EDAD_MAXIMA_COLA_MIN;
}

// v3.13 (v120): instala un trigger periódico para limpiarBotEstadoViejos,
// así corre sola cada 15 min sin depender de que Javier la ejecute a mano.
// Correr UNA sola vez (Run manual). Si ya existe un trigger para esta
// función, no crea uno nuevo (evita duplicados si se corre 2 veces).
function crearTriggerLimpiezaPeriodica() {
  asegurarTriggerUnico("limpiarBotEstadoViejos", { everyMinutes: 15 });
  Logger.log("✅ Trigger periódico de limpiarBotEstadoViejos creado (cada 15 min).");
}

// ============================================================
// MENÚ DE ANÁLISIS — CON INLINE KEYBOARD
// ============================================================
function mostrarMenuAnalisis(chatId, titulo, docId) {
  var keyboard = [
    [{ text: "1️⃣ Resumen ejecutivo", callback_data: "op_1_" + docId }],
    [{ text: "2️⃣ Estrategia procesal", callback_data: "op_2_" + docId }],
    [{ text: "3️⃣ Argumentación jurídica", callback_data: "op_3_" + docId }],
    [{ text: "4️⃣ Análisis completo", callback_data: "op_4_" + docId }],
    [{ text: "5️⃣ Solo guardar", callback_data: "op_5_" + docId }]
  ];
  sendInlineKeyboard(chatId,
    "📄 <b>" + escaparHTML((titulo || "Documento").substring(0, 60)) + "</b>\n\n¿Qué querés que haga con este documento?",
    keyboard
  );
}

// ============================================================
// COMANDO /analizar — CON INLINE KEYBOARD
// ============================================================
function cmdAnalizar(chatId, query) {
  sendMessage(chatId, "🔍 Buscando <i>" + escaparHTML(query) + "</i>...");
  var resultados = [];
  var tablas = [
    { nombre: "jurisprudencia", url: "DRIVE_URL", resumen: "resumen_doctrina" },
    { nombre: "doctrina",       url: "drive_url",  resumen: "descripcion" },
    { nombre: "modelos",        url: "drive_url",  resumen: "descripcion" }
  ];
  tablas.forEach(function(t) {
    try {
      var r = UrlFetchApp.fetch(
        SB_URL + "/rest/v1/" + t.nombre + "?titulo=ilike.*" + encodeURIComponent(query) + "*&select=titulo," + t.url + "," + t.resumen + "&limit=4",
        { headers: { "apikey": SB_KEY, "Authorization": "Bearer " + SB_KEY }, muteHttpExceptions: true }
      );
      var data = JSON.parse(r.getContentText());
      if (Array.isArray(data)) {
        data.forEach(function(d) {
          resultados.push({ titulo: d.titulo || "Sin título", url: d[t.url] || d["DRIVE_URL"] || null, resumen: d[t.resumen] || "", tabla: t.nombre });
        });
      }
    } catch(e) { Logger.log("Error buscando en " + t.nombre + ": " + e.message); }
  });

  if (resultados.length === 0) {
    sendMessage(chatId, "❌ No encontré documentos con <i>" + escaparHTML(query) + "</i>.\n\nProbá con otras palabras.");
    return;
  }

  setPendienteLista(chatId, resultados);

  var msg = "📂 <b>Encontré " + resultados.length + " documento(s):</b>\n\n";
  resultados.forEach(function(r, i) {
    var icon = r.tabla === "jurisprudencia" ? "⚖️" : r.tabla === "doctrina" ? "📚" : "📝";
    msg += (i + 1) + ". " + icon + " " + escaparHTML(r.titulo.substring(0, 55)) + "\n";
  });
  msg += "\n<i>Tocá el botón para seleccionar:</i>";

  var keyboard = resultados.map(function(r, i) {
    var icon = r.tabla === "jurisprudencia" ? "⚖️" : r.tabla === "doctrina" ? "📚" : "📝";
    return [{ text: icon + " " + (i + 1) + ". " + r.titulo.substring(0, 40), callback_data: "doc_" + i }];
  });

  sendInlineKeyboard(chatId, msg, keyboard);
}

// ============================================================
// ANÁLISIS ASÍNCRONO v110
// ============================================================

function encolarAnalisis(chatId, texto, titulo, opcion) {
  UrlFetchApp.fetch(SB_URL + "/rest/v1/bot_estado", {
    method: "post",
    headers: { "apikey": SB_KEY, "Authorization": "Bearer " + SB_KEY, "Content-Type": "application/json" },
    payload: JSON.stringify({
      chat_id: String(chatId) + "_" + new Date().getTime() + "_" + Math.floor(Math.random() * 1000000),
      tipo: "tarea_analisis",
      payload: { chatId: chatId, texto: texto, titulo: titulo, opcion: opcion },
      updated_at: new Date().toISOString()
    }),
    muteHttpExceptions: true
  });
  kickDispatch("encolarAnalisis");
  sendMessage(chatId, "⏳ Analizando documento... Te aviso en un momento.");
}

function ejecutarAnalisisPendiente(e) {
  var res = UrlFetchApp.fetch(
    SB_URL + "/rest/v1/bot_estado?tipo=eq.tarea_analisis",
    { headers: { "apikey": SB_KEY, "Authorization": "Bearer " + SB_KEY }, muteHttpExceptions: true }
  );
  var tareas = parseJsonSafe(res.getContentText(), []);
  Logger.log("ejecutarAnalisisPendiente: tareas encontradas=" + (Array.isArray(tareas) ? tareas.length : "NO ARRAY: " + String(res.getContentText()).substring(0,200)));
  if (!Array.isArray(tareas) || tareas.length === 0) return;

  // v3.16 (v132): una sola tarea por ejecución (mismo criterio que
  // procesarDocumentoAsync) — evita ejecuciones largas que Google puede
  // interpretar como fallo repetido y deshabilitar el trigger solo.
  var tarea = tareas[0];
  try {
    if (esFilaVieja(tarea)) {
      Logger.log("ejecutarAnalisisPendiente: fila VIEJA descartada, chat_id=" + tarea.chat_id + " chatId=" + (tarea.payload ? tarea.payload.chatId : "?"));
      borrarFilaBotEstado(tarea.chat_id, "ejecutarAnalisisPendiente/vieja");
    } else {
      var p = tarea.payload;
      Logger.log("ejecutarAnalisisPendiente: procesando chatId=" + p.chatId + " opcion=" + p.opcion);

      borrarFilaBotEstado(tarea.chat_id, "ejecutarAnalisisPendiente");

      var respuesta = generarAnalisis(p.chatId, p.texto, p.titulo, p.opcion);
      Logger.log("ejecutarAnalisisPendiente: generarAnalisis devolvió tipo=" + typeof respuesta + " largo=" + (respuesta ? String(respuesta).length : "NULL"));

      // v3.18 (v134): ANTES esto insertaba una fila respuesta_pendiente y
      // dejaba que enviarRespuestaPendiente la mandara en OTRA ejecución.
      // Ese split viene de v108, cuando el análisis podía acercarse al
      // límite de 6 min de Apps Script. Hoy generarAnalisis usa Haiku 4.5 y
      // tarda ~15s, así que el round-trip extra por Supabase sólo agregaba
      // un ciclo de espera COMPLETO sin ningún beneficio. Ahora se manda en
      // la misma ejecución, y respuesta_pendiente queda sólo como red si el
      // envío a Telegram falla (así el análisis ya pagado no se pierde).
      var enviado = enviarAnalisisDirecto(p.chatId, p.titulo, p.opcion, respuesta);

      if (!enviado) {
        Logger.log("ejecutarAnalisisPendiente: falló el envío directo — guardo en respuesta_pendiente para reintentar");
        var insertRes = UrlFetchApp.fetch(SB_URL + "/rest/v1/bot_estado", {
          method: "post",
          headers: {
            "apikey": SB_KEY,
            "Authorization": "Bearer " + SB_KEY,
            "Content-Type": "application/json"
          },
          payload: JSON.stringify({
            chat_id: String(p.chatId) + "_" + new Date().getTime() + "_" + Math.floor(Math.random() * 1000000),
            tipo: "respuesta_pendiente",
            payload: {
              chatId: p.chatId,
              titulo: p.titulo,
              opcion: p.opcion,
              respuesta: respuesta || ""
            },
            updated_at: new Date().toISOString()
          }),
          muteHttpExceptions: true
        });
        Logger.log("Insert respuesta_pendiente (fallback): " + insertRes.getResponseCode() + " — " + insertRes.getContentText().substring(0, 300));
        if (insertRes.getResponseCode() === 201) kickDispatch("fallback-respuesta-pendiente");
      }
    }
  } catch(e) {
    Logger.log("Error ejecutarAnalisisPendiente: " + e.message + " | stack: " + e.stack);
    try {
      if (tarea && tarea.payload && tarea.payload.chatId) {
        sendMessage(tarea.payload.chatId, "⚠️ Error generando el análisis: " + escaparHTML(e.message));
      }
    } catch(e2) { Logger.log("No se pudo avisar el error por Telegram: " + e2.message); }
  }

  if (tareas.length > 1) {
    Logger.log("ejecutarAnalisisPendiente: quedan " + (tareas.length - 1) + " tareas más — agendando siguiente corrida");
    kickDispatch("ejecutarAnalisisPendiente/quedan-" + (tareas.length - 1));
  }
}

function enviarRespuestaPendiente(e) {
  var res = UrlFetchApp.fetch(
    SB_URL + "/rest/v1/bot_estado?tipo=eq.respuesta_pendiente",
    { headers: { "apikey": SB_KEY, "Authorization": "Bearer " + SB_KEY }, muteHttpExceptions: true }
  );
  var filas = parseJsonSafe(res.getContentText(), []);
  Logger.log("enviarRespuestaPendiente: filas encontradas=" + (Array.isArray(filas) ? filas.length : "NO ARRAY: " + String(res.getContentText()).substring(0,200)));
  if (!Array.isArray(filas) || filas.length === 0) return;

  // v3.16 (v132): una sola fila por ejecución, mismo criterio que las
  // otras 2 funciones de cola.
  var fila = filas[0];
  var p = null;
  try {
    if (esFilaVieja(fila)) {
      Logger.log("enviarRespuestaPendiente: fila VIEJA descartada, chat_id=" + fila.chat_id + " chatId=" + (fila.payload ? fila.payload.chatId : "?") + " titulo=" + (fila.payload ? fila.payload.titulo : "?"));
      borrarFilaBotEstado(fila.chat_id, "enviarRespuestaPendiente/vieja");
    } else {
      p = fila.payload;
      borrarFilaBotEstado(fila.chat_id, "enviarRespuestaPendiente");
      enviarAnalisisDirecto(p.chatId, p.titulo, p.opcion, p.respuesta);
    }
  } catch(e) {
    Logger.log("Error enviarRespuestaPendiente: " + e.message + " | stack: " + e.stack);
    try {
      if (p && p.chatId) sendMessage(p.chatId, "⚠️ Error enviando el análisis: " + escaparHTML(e.message));
    } catch(e2) { Logger.log("No se pudo avisar el error por Telegram: " + e2.message); }
  }

  if (filas.length > 1) {
    Logger.log("enviarRespuestaPendiente: quedan " + (filas.length - 1) + " filas más — agendando siguiente corrida");
    kickDispatch("enviarRespuestaPendiente/quedan-" + (filas.length - 1));
  }
}

function enviarAnalisisDirecto(chatId, titulo, opcion, respuesta) {
  try {
    Logger.log("enviarAnalisisDirecto: chatId=" + chatId + " opcion=" + opcion + " tipo(respuesta)=" + typeof respuesta + " largo=" + (respuesta ? String(respuesta).length : "NULL/UNDEFINED"));

    var titulos = { 1: "RESUMEN EJECUTIVO", 2: "ESTRATEGIA PROCESAL", 3: "ARGUMENTACIÓN JURÍDICA", 4: "ANÁLISIS COMPLETO" };
    var header = "📋 <b>" + (titulos[opcion] || "ANÁLISIS") + "</b> — " + escaparHTML((titulo || "").substring(0, 50));
    sendMessage(chatId, header);

    var texto = (respuesta !== null && respuesta !== undefined) ? String(respuesta) : "";
    if (texto.length === 0) texto = "(sin respuesta de Claude — la respuesta llegó vacía)";
    Logger.log("enviarAnalisisDirecto: texto final a enviar, largo=" + texto.length);

    // v3.18 (v134): ahora devuelve true/false. ejecutarAnalisisPendiente lo
    // usa para decidir si hace falta la red de respuesta_pendiente: si el
    // envío salió bien no hace falta tocar Supabase de nuevo, y si falló no
    // queremos perder un análisis que ya se pagó. Los llamadores viejos que
    // ignoran el valor de retorno siguen funcionando igual.
    var todoOk = true;
    var chunkSize = 3800;
    for (var i = 0; i < texto.length; i += chunkSize) {
      var chunk = texto.substring(i, i + chunkSize);
      var ok = sendMessage(chatId, chunk);
      if (!ok) todoOk = false;
      Logger.log("enviarAnalisisDirecto: chunk " + i + "-" + (i + chunkSize) + " enviado=" + ok);
      if (i + chunkSize < texto.length) Utilities.sleep(500);
    }
    Logger.log("enviarAnalisisDirecto: FIN todoOk=" + todoOk);
    return todoOk;
  } catch (e) {
    Logger.log("enviarAnalisisDirecto: EXCEPCIÓN — " + e.message + " | stack: " + e.stack);
    try { sendMessage(chatId, "⚠️ Error interno enviando el análisis: " + escaparHTML(e.message)); } catch(e2) { Logger.log("No se pudo avisar el error por Telegram: " + e2.message); }
    return false;
  }
}

// ============================================================
// GENERAR ANÁLISIS CON CLAUDE — solo genera, no envía
// ============================================================
function generarAnalisis(chatId, texto, titulo, opcion) {
  var contextoJuri = "";
  try {
    var embRes = UrlFetchApp.fetch(VOYAGE_API, {
      method: "post", contentType: "application/json",
      headers: { "Authorization": "Bearer " + VOYAGE_KEY },
      payload: JSON.stringify({ model: "voyage-4-lite", input: [texto.substring(0, 1000)] }),
      muteHttpExceptions: true
    });
    var embData = JSON.parse(embRes.getContentText());
    if (embData.data && embData.data[0]) {
      var rpcRes = UrlFetchApp.fetch(SB_URL + "/rest/v1/rpc/buscar_juridico", {
        method: "post", contentType: "application/json",
        headers: { "apikey": SB_KEY, "Authorization": "Bearer " + SB_KEY },
        payload: JSON.stringify({ query_embedding: embData.data[0].embedding, match_count: 5 }),
        muteHttpExceptions: true
      });
      var juris = JSON.parse(rpcRes.getContentText());
      if (Array.isArray(juris) && juris.length > 0) {
        contextoJuri = "JURISPRUDENCIA Y DOCTRINA RELACIONADA:\n";
        juris.slice(0, 4).forEach(function(j) {
          contextoJuri += "- " + j.titulo + ": " + (j.resumen || "").substring(0, 200) + "\n";
        });
      }
    }
  } catch(e) { Logger.log("Error embedding generarAnalisis: " + e.message); }

  var instrucciones = {
    1: "Hacé un RESUMEN EJECUTIVO del documento. Identificá: tipo de escrito, partes involucradas, pretensión principal, argumentos clave, y próximos pasos procesales que sugiere. Máximo 400 palabras.",
    2: "Hacé un análisis de ESTRATEGIA PROCESAL PARA CONTESTAR este documento. Incluí: (1) Puntos fuertes del documento que hay que rebatir, (2) Puntos débiles o vulnerables que podemos explotar, (3) Estrategia recomendada para la contestación, (4) Argumentos defensivos principales, (5) Pasos procesales sugeridos. Usá la jurisprudencia disponible. Máximo 500 palabras.",
    3: "Generá una ARGUMENTACIÓN JURÍDICA sólida relacionada con este documento. Incluí: (1) Normas aplicables (LCT, CCCN, leyes especiales), (2) Citas de jurisprudencia relevante de la base disponible, (3) Doctrina aplicable, (4) Argumento central listo para usar en un escrito. Máximo 500 palabras.",
    4: "Hacé un ANÁLISIS COMPLETO del documento que incluya: (1) Resumen ejecutivo, (2) Fortalezas y debilidades, (3) Estrategia procesal para contestar, (4) Argumentación jurídica con citas, (5) Recomendación final. Usá toda la jurisprudencia y doctrina disponible. Máximo 700 palabras."
  };

  var prompt = "Sos el Dr. Javier Castro, abogado laboralista argentino (CPACF T°102 F°174), especialista en CNAT y derecho laboral.\n\nDOCUMENTO A ANALIZAR:\nTítulo: " + titulo + "\n\n" + (texto || "Sin texto disponible").substring(0, 3000) + "\n\n" + contextoJuri + "\n\n" + instrucciones[opcion];

  var resultado = agenteCallClaude(prompt, 4000);
  Logger.log("generarAnalisis: opcion=" + opcion + " resultado tipo=" + typeof resultado + " largo=" + (resultado ? String(resultado).length : "NULL") + " primeros100=" + (resultado ? String(resultado).substring(0,100) : "N/A"));
  return resultado;
}

// ============================================================
// SEND MESSAGE Y SEND INLINE KEYBOARD
// ============================================================
function sendMessage(chatId, text) {
  var payloads = [
    { chat_id: chatId, text: text, parse_mode: "HTML" },
    { chat_id: chatId, text: text }
  ];

  for (var attempt = 0; attempt < 3; attempt++) {
    for (var i = 0; i < payloads.length; i++) {
      try {
        var res = UrlFetchApp.fetch(TELEGRAM_API + "/sendMessage", {
          method: "post", contentType: "application/json",
          payload: JSON.stringify(payloads[i]),
          muteHttpExceptions: true
        });
        var code = res.getResponseCode();
        var body = res.getContentText();
        if (code === 200) return true;
        Logger.log("sendMessage intento=" + (attempt + 1) + " payload=" + (i === 0 ? "HTML" : "plano") + " falló: " + code + " — " + body.substring(0, 300));
        if (code === 429 || code === 500 || code === 502 || code === 503 || code === 504 || String(body).indexOf("Address unavailable") !== -1) {
          Utilities.sleep(1000 * (attempt + 1));
          break;
        }
      } catch (e) {
        Logger.log("sendMessage excepción intento=" + (attempt + 1) + ": " + e.message);
        Utilities.sleep(1000 * (attempt + 1));
      }
    }
  }

  Logger.log("sendMessage: agotados los reintentos para chatId=" + chatId);
  return false;
}

function sendInlineKeyboard(chatId, text, keyboard) {
  var res = UrlFetchApp.fetch(TELEGRAM_API + "/sendMessage", {
    method: "post", contentType: "application/json",
    payload: JSON.stringify({
      chat_id: chatId, text: text, parse_mode: "HTML",
      reply_markup: { inline_keyboard: keyboard }
    }),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) {
    Logger.log("sendInlineKeyboard error: " + res.getContentText());
    UrlFetchApp.fetch(TELEGRAM_API + "/sendMessage", {
      method: "post", contentType: "application/json",
      payload: JSON.stringify({ chat_id: chatId, text: text, reply_markup: { inline_keyboard: keyboard } }),
      muteHttpExceptions: true
    });
  }
}

function answerCallbackQuery(callbackQueryId) {
  UrlFetchApp.fetch(TELEGRAM_API + "/answerCallbackQuery", {
    method: "post", contentType: "application/json",
    payload: JSON.stringify({ callback_query_id: callbackQueryId }),
    muteHttpExceptions: true
  });
}

// ============================================================
// UTILIDADES DRIVE
// ============================================================
function getOrCreateInbox() {
  var root = DriveApp.getFolderById(DRIVE_ROOT);
  var folders = root.getFoldersByName(INBOX_NAME);
  if (folders.hasNext()) return folders.next();
  return root.createFolder(INBOX_NAME);
}

function leerTextoDriveParaResumen(fileId) {
  try {
    var file = DriveApp.getFileById(fileId);
    var mimeType = file.getMimeType();
    var texto = mimeType === "application/vnd.google-apps.document" ? DocumentApp.openById(fileId).getBody().getText() : file.getBlob().getDataAsString("UTF-8");
    return texto.substring(0, 8000);
  } catch(e) { Logger.log("leerTextoDriveParaResumen error: " + e.message); return ""; }
}

// ============================================================
// CLASIFICACIÓN CON CLAUDE
// ============================================================
function clasificarPorNombre(fileName) {
  var payload = { model: "claude-haiku-4-5-20251001", max_tokens: 200, system: "Clasifica archivos juridicos argentinos por su nombre y contenido. Devuelve SOLO JSON sin texto adicional: {\"tipo\": \"JURISPRUDENCIA|DOCTRINA|MODELO|GENERAL\", \"area\": \"LABORAL|CIVIL|CONTRATOS|FAMILIA|SUCESIONES|GENERAL\", \"titulo\": \"titulo limpio sin extension\"}.", messages: [{ role: "user", content: "Clasifica: " + fileName }] };
  try {
    var res = UrlFetchApp.fetch(ANTHROPIC_API, { method: "post", contentType: "application/json", headers: { "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" }, payload: JSON.stringify(payload), muteHttpExceptions: true });
    var data = JSON.parse(res.getContentText());
    if (data && data.content && data.content[0]) return JSON.parse(data.content[0].text.replace(/```json|```/g, "").trim());
  } catch(err) { Logger.log("Error clasificarPorNombre: " + err.message); }
  return { tipo: "GENERAL", area: "GENERAL", titulo: fileName.replace(/\.[^/.]+$/, "") };
}

function clasificarTextoConClaude(texto) {
  var payload = { model: "claude-haiku-4-5-20251001", max_tokens: 300, system: "Clasifica texto juridico argentino. Devuelve SOLO JSON con campos: tipo (JURISPRUDENCIA, DOCTRINA, MODELO o IGNORAR), area (LABORAL, CIVIL, CONTRATOS, FAMILIA, SUCESIONES o GENERAL), titulo y resumen. REGLAS: JURISPRUDENCIA si menciona partes enfrentadas, tribunal, expediente. DOCTRINA si es normativa o resoluciones. MODELO si es escrito procesal. IGNORAR si no es juridico.", messages: [{ role: "user", content: texto }] };
  try {
    var res = UrlFetchApp.fetch(ANTHROPIC_API, { method: "post", contentType: "application/json", headers: { "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" }, payload: JSON.stringify(payload), muteHttpExceptions: true });
    var data = JSON.parse(res.getContentText());
    if (data && data.content && data.content[0]) return JSON.parse(data.content[0].text.replace(/```json|```/g, "").trim());
  } catch(err) { Logger.log("Error clasificarTexto: " + err.message); }
  return null;
}

// ============================================================
// SUPABASE — GUARDAR Y EMBEDDINGS
// ============================================================
function guardarEnSupabase(tabla, clasificacion, driveUrl, nombreArchivo) {
  var payload, textoEmbed;
  if (tabla === "jurisprudencia") {
    payload = { titulo: clasificacion.titulo || nombreArchivo, AREA: clasificacion.area || "GENERAL", resumen_doctrina: clasificacion.resumen || "Documento cargado desde Telegram", DRIVE_URL: driveUrl };
    textoEmbed = (payload.titulo + " " + payload.resumen_doctrina).substring(0, 8000);
  } else if (tabla === "doctrina") {
    payload = { titulo: clasificacion.titulo || nombreArchivo, area: clasificacion.area || "GENERAL", descripcion: clasificacion.resumen || "Documento cargado desde Telegram", tipo: "Doctrina", drive_url: driveUrl };
    textoEmbed = (payload.titulo + " " + payload.descripcion).substring(0, 8000);
  } else {
    payload = { titulo: clasificacion.titulo || nombreArchivo, area: clasificacion.area || "GENERAL", descripcion: clasificacion.resumen || "Documento cargado desde Telegram", tipo_escrito: clasificacion.tipo === "MODELO" ? "Modelo" : (clasificacion.tipo || "Modelo"), drive_url: driveUrl, fecha_carga: new Date().toISOString() };
    textoEmbed = (payload.titulo + " " + payload.descripcion).substring(0, 8000);
  }
  try {
    var res = UrlFetchApp.fetch(SB_URL + "/rest/v1/" + tabla, { method: "post", contentType: "application/json", headers: { "apikey": SB_KEY, "Authorization": "Bearer " + SB_KEY, "Prefer": "return=representation" }, payload: JSON.stringify(payload), muteHttpExceptions: true });
    var code = res.getResponseCode();
    if (code === 201) {
      var inserted = JSON.parse(res.getContentText());
      if (Array.isArray(inserted) && inserted[0] && inserted[0].id) {
        var emb = generarEmbedding(textoEmbed);
        if (emb) guardarEmbedding(tabla, inserted[0].id, emb);
      }
      return true;
    }
    Logger.log("guardarEnSupabase: FALLÓ sin excepción — tabla=" + tabla + " código=" + code + " respuesta=" + res.getContentText().substring(0, 500) + " payload_enviado=" + JSON.stringify(payload).substring(0, 300));
    return false;
  } catch(err) { Logger.log("Error Supabase (excepción): " + err.message + " | tabla=" + tabla); return false; }
}

function generarEmbedding(texto) {
  try {
    var res = UrlFetchApp.fetch(VOYAGE_API, { method: "post", contentType: "application/json", headers: { "Authorization": "Bearer " + VOYAGE_KEY }, payload: JSON.stringify({ model: "voyage-4-lite", input: [texto] }), muteHttpExceptions: true });
    var data = JSON.parse(res.getContentText());
    if (data.data && data.data[0] && data.data[0].embedding) return data.data[0].embedding;
  } catch(e) { Logger.log("Error generarEmbedding: " + e.message); }
  return null;
}

function guardarEmbedding(tabla, id, embedding) {
  try {
    UrlFetchApp.fetch(SB_URL + "/rest/v1/" + tabla + "?id=eq." + id, { method: "patch", contentType: "application/json", headers: { "apikey": SB_KEY, "Authorization": "Bearer " + SB_KEY, "Prefer": "return=minimal" }, payload: JSON.stringify({ embedding: embedding }), muteHttpExceptions: true });
  } catch(e) { Logger.log("Error guardarEmbedding: " + e.message); }
}

// ============================================================
// CLAUDE
// ============================================================
function consultarClaude(texto) {
  try {
    var res = UrlFetchApp.fetch(ANTHROPIC_API, { method: "post", contentType: "application/json", headers: { "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" }, payload: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 400, system: "Sos el asistente jurídico del Estudio Castro, Dr. Javier Horacio Castro (T° 102 F° 174 CPACF), laboralista en Argentina. Respondé en español rioplatense, informal pero profesional. Máximo 3-4 líneas.", messages: [{ role: "user", content: texto }] }), muteHttpExceptions: true });
    var data = JSON.parse(res.getContentText());
    if (data && data.content && data.content[0] && data.content[0].text) return data.content[0].text;
    return "⚠️ Sin respuesta.";
  } catch(err) { return "⚠️ Error: " + err.message; }
}

function agenteCallClaude(prompt, maxTokens) {
  try {
    var raw = UrlFetchApp.fetch(ANTHROPIC_API, {
      method: "post", contentType: "application/json",
      headers: { "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
      payload: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: maxTokens || 600, messages: [{ role: "user", content: prompt }] }),
      muteHttpExceptions: true
    });
    Logger.log("agenteCallClaude: HTTP " + raw.getResponseCode());
    if (raw.getResponseCode() !== 200) {
      Logger.log("agenteCallClaude: body error: " + raw.getContentText().substring(0, 500));
      return "";
    }
    var data = JSON.parse(raw.getContentText());
    return (data.content || []).map(function(b) { return b.text || ""; }).join("").trim();
  } catch(e) {
    Logger.log("agenteCallClaude error: " + e.message);
    return "";
  }
}

// ============================================================
// BÚSQUEDA SEMÁNTICA
// ============================================================
function buscarSemantico(chatId, query) {
  try {
    var embRes = UrlFetchApp.fetch(VOYAGE_API, { method: "post", contentType: "application/json", headers: { "Authorization": "Bearer " + VOYAGE_KEY }, payload: JSON.stringify({ model: "voyage-4-lite", input: [query] }), muteHttpExceptions: true });
    var embData = JSON.parse(embRes.getContentText());
    if (embData.data && embData.data[0] && embData.data[0].embedding) {
      var embedding = embData.data[0].embedding;
      var rpcRes = UrlFetchApp.fetch(SB_URL + "/rest/v1/rpc/buscar_juridico", { method: "post", contentType: "application/json", headers: { "apikey": SB_KEY, "Authorization": "Bearer " + SB_KEY }, payload: JSON.stringify({ query_embedding: embedding, match_count: 5 }), muteHttpExceptions: true });
      var results = JSON.parse(rpcRes.getContentText());
      var rpcRes2 = UrlFetchApp.fetch(SB_URL + "/rest/v1/rpc/match_documentos_causa", { method: "post", contentType: "application/json", headers: { "apikey": SB_KEY, "Authorization": "Bearer " + SB_KEY }, payload: JSON.stringify({ query_embedding: embedding, match_threshold: 0.2, match_count: 3 }), muteHttpExceptions: true });
      var resCausa = JSON.parse(rpcRes2.getContentText());
      if (Array.isArray(resCausa) && resCausa.length > 0) {
        results = resCausa.map(function(r) { return { titulo: r.titulo, resumen: r.contenido.substring(0, 150), score: r.similarity, tabla: "causa_propia", url: r["DRIVE_URL"] || null }; }).concat(results);
      }
      var msg = "🔍 <b>Resultados para: <i>" + escaparHTML(query) + "</i></b>\n\n";
      results.slice(0, 8).forEach(function(r) {
        if (!r) return;
        var score = Math.round((r.score || 0) * 100);
        var icon = r.tabla === "jurisprudencia" ? "⚖️" : r.tabla === "doctrina" ? "📚" : r.tabla === "causa_propia" ? "📄" : "📝";
        msg += icon + " <b>" + escaparHTML((r.titulo || "Sin título").substring(0, 70)) + "</b>\n";
        if (r.resumen) msg += "<i>" + escaparHTML(r.resumen.substring(0, 130)) + "</i>\n";
        var url = r.url || r.drive_url || r["DRIVE_URL"] || null;
        msg += "Relevancia: " + score + "%" + (url ? " · <a href=\"" + url + "\">📂 Abrir</a>" : "") + "\n\n";
      });
      sendMessage(chatId, msg); return;
    }
  } catch(e) { Logger.log("Error búsqueda semántica: " + e.message); }
  try {
    var fbRes = UrlFetchApp.fetch(SB_URL + "/rest/v1/jurisprudencia?or=(titulo.ilike.*" + encodeURIComponent(query) + "*,resumen_doctrina.ilike.*" + encodeURIComponent(query) + "*)&select=titulo,resumen_doctrina,tribunal&limit=5", { headers: { "apikey": SB_KEY, "Authorization": "Bearer " + SB_KEY }, muteHttpExceptions: true });
    var fbData = JSON.parse(fbRes.getContentText());
    if (Array.isArray(fbData) && fbData.length > 0) {
      var msg2 = "🔍 <b>" + fbData.length + " resultado(s) para:</b> <i>" + escaparHTML(query) + "</i>\n\n";
      fbData.forEach(function(r) { msg2 += "⚖️ <b>" + escaparHTML((r.titulo || "Sin título").substring(0, 70)) + "</b>\n"; if (r.resumen_doctrina) msg2 += "<i>" + escaparHTML(r.resumen_doctrina.substring(0, 130)) + "</i>\n"; msg2 += "\n"; });
      sendMessage(chatId, msg2);
    } else { sendMessage(chatId, "❌ Sin resultados para: <i>" + escaparHTML(query) + "</i>\n\nProbá con otras palabras."); }
  } catch(e2) { sendMessage(chatId, "❌ Error en la búsqueda: " + escaparHTML(e2.message)); }
}

// ============================================================
// COMANDOS JURÍDICOS
// ============================================================
function cmdBuscar(chatId, tema) { if (!tema) { sendMessage(chatId, "🔍 Usá: /buscar [tema]"); return; } buscarSemantico(chatId, tema); }

function cmdAgente(chatId) {
  sendMessage(chatId, "🤖 <b>Modo Agente</b>\n\nEsta función está en desarrollo.\n\nPor ahora usá:\n• /analizar — buscar y analizar documentos\n• /argumentar — generar argumentos\n• /buscar — búsqueda semántica");
}

function cmdArgumentar(chatId, tema) {
  if (!tema) { sendMessage(chatId, "⚖️ Usá: /argumentar [tema]"); return; }
  sendMessage(chatId, "⚖️ Generando argumento sobre: <i>" + escaparHTML(tema) + "</i>...");
  var fallos = agenteBuscarLocal(tema);
  var contexto = fallos.length > 0 ? "JURISPRUDENCIA:\n" + fallos.slice(0, 5).map(function(f) { return "- " + f.titulo + ": " + (f.resumen_doctrina || f.descripcion || "").substring(0, 200); }).join("\n") : "Sin jurisprudencia específica. Elaborar desde normativa vigente.";
  var argumento = agenteCallClaude("Sos el Dr. Javier Castro, abogado laboralista argentino (CPACF T°102 F°174).\n\nTEMA: " + tema + "\n\n" + contexto + "\n\nRedactá un argumento jurídico en estilo escrito judicial. Incluí fundamento normativo, jurisprudencia y conclusión. Máximo 350 palabras.", 700);
  sendMessage(chatId, "⚖️ <b>ARGUMENTO: " + escaparHTML(tema.substring(0, 50).toUpperCase()) + "</b>\n\n" + escaparHTML(argumento));
}

function cmdCausa(chatId, nombre) {
  sendMessage(chatId, "📁 Buscando causa...");
  try {
    var url = nombre && nombre.length > 2 ? SB_URL + "/rest/v1/expedientes?caratula=ilike.*" + encodeURIComponent(nombre) + "*&select=*&limit=5" : SB_URL + "/rest/v1/expedientes?select=*&order=fecha_inicio.desc&limit=10";
    var causas = JSON.parse(UrlFetchApp.fetch(url, { headers: { "apikey": SB_KEY, "Authorization": "Bearer " + SB_KEY }, muteHttpExceptions: true }).getContentText());
    if (!Array.isArray(causas) || causas.length === 0) { sendMessage(chatId, "⚠️ No encontré causas."); return; }
    var msg = "📁 <b>CAUSAS ACTIVAS:</b>\n\n";
    causas.forEach(function(c, i) { msg += (i + 1) + ". <b>" + escaparHTML((c.caratula || "Sin carátula").substring(0, 60)) + "</b>\n"; if (c.numero_expediente) msg += "   📋 " + escaparHTML(c.numero_expediente) + "\n"; if (c.estado) msg += "   📌 " + escaparHTML(c.estado) + "\n"; msg += "\n"; });
    sendMessage(chatId, msg);
  } catch(e) { sendMessage(chatId, "❌ Error: " + escaparHTML(e.message)); }
}

function cmdRedactar(chatId, tipo) {
  if (!tipo) { sendMessage(chatId, "📝 Usá: /redactar [tipo de escrito]"); return; }
  sendMessage(chatId, "📝 Redactando: <i>" + escaparHTML(tipo) + "</i>...");
  var borrador = agenteCallClaude("Sos el Dr. Javier Castro, abogado laboralista argentino. Redactá un borrador de: " + tipo + ". Formato escrito judicial argentino. Dejá en [CORCHETES] los datos a completar. Máximo 450 palabras.", 900);
  sendMessage(chatId, "📝 <b>BORRADOR: " + escaparHTML(tipo.toUpperCase().substring(0, 40)) + "</b>\n\n" + escaparHTML(borrador) + "\n\n---\n<i>Completá los campos en [CORCHETES] antes de usar.</i>");
}

function cmdLey(chatId, consulta) {
  if (!consulta) { sendMessage(chatId, "📖 Usá: /ley [norma] [artículo]"); return; }
  sendMessage(chatId, "📖 Consultando: <i>" + escaparHTML(consulta) + "</i>...");
  var respuesta = agenteCallClaude("Sos un asistente jurídico argentino. El abogado consulta: " + consulta + ". Respondé con: 1. TEXTO DEL ARTÍCULO, 2. ÚLTIMA MODIFICACIÓN, 3. APLICACIÓN PRÁCTICA laboral.", 600);
  sendMessage(chatId, "📖 <b>" + escaparHTML(consulta.toUpperCase()) + "</b>\n\n" + escaparHTML(respuesta));
}

function agenteBuscarLocal(tema) {
  var palabras = tema.toLowerCase().replace(/[.,;:()\[\]¿?¡!]/g, " ").split(/\s+/).filter(function(w) { return w.length > 4; }).slice(0, 3);
  if (!palabras.length) return [];
  var resultados = [], vistos = {};
  palabras.forEach(function(p) {
    try { JSON.parse(UrlFetchApp.fetch(SB_URL + "/rest/v1/jurisprudencia?or=(titulo.ilike.*" + p + "*,resumen_doctrina.ilike.*" + p + "*)&select=titulo,tribunal,resumen_doctrina&limit=3", { headers: { "apikey": SB_KEY, "Authorization": "Bearer " + SB_KEY }, muteHttpExceptions: true }).getContentText()).forEach(function(f) { if (!vistos[f.titulo]) { vistos[f.titulo] = true; resultados.push(f); } }); } catch(e) {}
    try { JSON.parse(UrlFetchApp.fetch(SB_URL + "/rest/v1/doctrina?or=(titulo.ilike.*" + p + "*,descripcion.ilike.*" + p + "*)&select=titulo,descripcion&limit=2", { headers: { "apikey": SB_KEY, "Authorization": "Bearer " + SB_KEY }, muteHttpExceptions: true }).getContentText()).forEach(function(f) { if (!vistos[f.titulo]) { vistos[f.titulo] = true; resultados.push(f); } }); } catch(e) {}
  });
  return resultados.slice(0, 6);
}

// ============================================================
// SYNC DRIVE → SUPABASE
// ============================================================
var CARPETAS_JURIDICAS = [
  { id: "1bRaCERhHdwUfA1N12LfOEvtkMv0vKGX4", nombre: "CLAUDE-BASE-JURIDICA", tabla: "auto" },
  { id: "1fbbQzsehdMbA8fYhWGJ3_zXnjyhGtj__", nombre: "JURISPRUDENCIA PROPIA", tabla: "jurisprudencia" },
  { id: "10hw_28OFkSMW1esn6WvoWcSQpes1w64O",  nombre: "MODELOS DE ESCRITOS",  tabla: "modelos" },
  { id: "1Qs8udr4SMwjXYOe5VKf4K9OLhlhTombG",  nombre: "DOCTRINA",             tabla: "doctrina" },
  { id: "19uymHDr7PdOEA4I4NYsYAQPQMdLhlbeC",  nombre: "APLICACION LEY 27802", tabla: "jurisprudencia" },
  { id: "1Yd-wcY2pTlpeVec8-kQgRwMBDTVxbdWM",  nombre: "15905 RODRIGUEZ C/HOLCIM", tabla: "jurisprudencia" },
  { id: "1oEZyo75P6a5GEolzi-0aodmnmrSbB7vJ",  nombre: "FORMULARIOS TELEGRAMAS", tabla: "modelos" }
];

function syncDriveCompleto() {
  Logger.log("=== SYNC DRIVE COMPLETO ===");
  var stats = { procesados: 0, insertados: 0, duplicados: 0, errores: 0 };
  var existentes = obtenerExistentesCompleto();
  for (var c = 0; c < CARPETAS_JURIDICAS.length; c++) {
    var carpeta = CARPETAS_JURIDICAS[c];
    var archivos = listarArchivosJuridicos(carpeta.id);
    for (var i = 0; i < archivos.length; i++) {
      var archivo = archivos[i]; stats.procesados++;
      try {
        var esDup = existentes.some(function(e) { return e === archivo.title || e === archivo.viewUrl; });
        if (esDup) { stats.duplicados++; continue; }
        var texto = extraerTextoArchivo(archivo);
        if (!texto || texto.length < 50) { stats.errores++; continue; }
        var resumen = generarResumenConClaude(archivo.title, texto, carpeta.nombre) || texto.substring(0, 500);
        var tabla = carpeta.tabla === "auto" ? detectarTabla(archivo.title, texto) : carpeta.tabla;
        var embedding = null;
        try { embedding = generarEmbeddingVoyageCompleto(archivo.title + " " + resumen); } catch(e) {}
        if (insertarRegistro(tabla, archivo.title, resumen, carpeta.nombre, archivo.viewUrl, embedding)) { stats.insertados++; existentes.push(archivo.title); } else stats.errores++;
        Utilities.sleep(800);
      } catch(e) { stats.errores++; Logger.log("[ERROR] " + archivo.title + ": " + e.message); }
    }
  }
  Logger.log("=== FIN === Procesados: " + stats.procesados + " | Insertados: " + stats.insertados + " | Duplicados: " + stats.duplicados + " | Errores: " + stats.errores);
}

function listarArchivosJuridicos(folderId) {
  var archivos = [];
  try {
    var folder = DriveApp.getFolderById(folderId);
    var types = ["application/pdf", "text/plain", "application/vnd.google-apps.document", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"];
    var mimes = ["pdf", "txt", "gdoc", "docx"];
    for (var t = 0; t < types.length; t++) { var it = folder.getFilesByType(types[t]); while (it.hasNext()) { var f = it.next(); archivos.push({ id: f.getId(), title: f.getName(), mimeType: mimes[t], viewUrl: f.getUrl() }); } }
    var subs = folder.getFolders(); while (subs.hasNext()) { listarArchivosJuridicos(subs.next().getId()).forEach(function(a) { archivos.push(a); }); }
  } catch(e) { Logger.log("Error listando carpeta: " + e.message); }
  return archivos;
}

function extraerTextoArchivo(archivo) {
  try {
    if (archivo.mimeType === "txt") return DriveApp.getFileById(archivo.id).getBlob().getDataAsString("UTF-8").substring(0, 3000);
    if (archivo.mimeType === "gdoc") return DocumentApp.openById(archivo.id).getBody().getText().substring(0, 3000);
    if (archivo.mimeType === "pdf" || archivo.mimeType === "docx") {
      try {
        var blob = DriveApp.getFileById(archivo.id).getBlob();
        var folder = DriveApp.getFolderById("1bRaCERhHdwUfA1N12LfOEvtkMv0vKGX4");
        blob.setContentType(archivo.mimeType === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
        var tempDoc = Drive.Files.insert({ title: archivo.title + "_temp", mimeType: "application/vnd.google-apps.document", parents: [{ id: folder.getId() }] }, blob);
        Utilities.sleep(archivo.mimeType === "pdf" ? 2000 : 1000);
        var texto = DocumentApp.openById(tempDoc.id).getBody().getText().substring(0, 3000);
        DriveApp.getFileById(tempDoc.id).setTrashed(true);
        return texto;
      } catch(e) { return archivo.title; }
    }
  } catch(e) { Logger.log("Error extrayendo texto: " + e.message); }
  return null;
}

function generarResumenConClaude(titulo, texto, carpetaNombre) {
  try {
    var data = JSON.parse(UrlFetchApp.fetch(ANTHROPIC_API, { method: "post", headers: { "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01", "Content-Type": "application/json" }, payload: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 400, messages: [{ role: "user", content: "Resumí en 2-3 oraciones este documento jurídico argentino.\n\nCarpeta: " + carpetaNombre + "\nTítulo: " + titulo + "\n\nTexto:\n" + texto.substring(0, 2000) }] }), muteHttpExceptions: true }).getContentText());
    return (data.content || []).map(function(b) { return b.text || ""; }).join("").trim();
  } catch(e) { return null; }
}

function detectarTabla(titulo, texto) {
  var tl = titulo.toLowerCase(), cl = texto.toLowerCase();
  if (tl.indexOf("modelo") !== -1 || tl.indexOf("formulario") !== -1 || tl.indexOf("telegrama") !== -1) return "modelos";
  if (tl.indexOf("doctrina") !== -1 || cl.indexOf("autor:") !== -1) return "doctrina";
  return "jurisprudencia";
}

function generarEmbeddingVoyageCompleto(texto) {
  var data = JSON.parse(UrlFetchApp.fetch("https://api.voyageai.com/v1/embeddings", {
    method: "post",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + VOYAGE_KEY },
    payload: JSON.stringify({ model: "voyage-4-lite", output_dimension: 1024, input: [texto.substring(0, 2000)], input_type: "document" }),
    muteHttpExceptions: true
  }).getContentText());
  return data.data && data.data[0] ? data.data[0].embedding : null;
}

function obtenerExistentesCompleto() {
  var existentes = [];
  ["jurisprudencia", "doctrina", "modelos"].forEach(function(tabla) {
    try {
      var data = JSON.parse(UrlFetchApp.fetch(SB_URL + "/rest/v1/" + tabla + "?select=titulo,DRIVE_URL,drive_url&limit=500", { headers: { "apikey": SB_KEY, "Authorization": "Bearer " + SB_KEY }, muteHttpExceptions: true }).getContentText());
      if (Array.isArray(data)) data.forEach(function(d) { if (d.titulo) existentes.push(d.titulo.trim()); if (d.DRIVE_URL) existentes.push(d.DRIVE_URL.trim()); if (d.drive_url) existentes.push(d.drive_url.trim()); });
    } catch(e) {}
  });
  return existentes;
}

function insertarRegistro(tabla, titulo, resumen, area, driveUrl, embedding) {
  try {
    var payload = tabla === "modelos" ? { titulo: titulo, descripcion: resumen, area: area, tipo_escrito: "Modelo", drive_url: driveUrl, embedding: embedding || null } : tabla === "doctrina" ? { titulo: titulo, descripcion: resumen, area: area, tipo: "Doctrina", drive_url: driveUrl, embedding: embedding || null } : { titulo: titulo, resumen_doctrina: resumen, AREA: area, DRIVE_URL: driveUrl, embedding: embedding || null };
    var r = UrlFetchApp.fetch(SB_URL + "/rest/v1/" + tabla, { method: "post", headers: { "apikey": SB_KEY, "Authorization": "Bearer " + SB_KEY, "Content-Type": "application/json", "Prefer": "return=minimal" }, payload: JSON.stringify(payload), muteHttpExceptions: true });
    return r.getResponseCode() === 201;
  } catch(e) { return false; }
}

function cargarEmbeddingsPendientes() {
  const SUPABASE_URL = SB_URL, SUPABASE_KEY = SB_KEY, VOYAGE_KEY_LOCAL = VOYAGE_KEY;
  const TABLAS = [{ tabla: 'jurisprudencia', titulo: 'titulo', texto: 'resumen_doctrina' }, { tabla: 'doctrina', titulo: 'titulo', texto: 'descripcion' }, { tabla: 'modelos', titulo: 'titulo', texto: 'descripcion' }, { tabla: 'documentos_causa', titulo: 'titulo', texto: 'contenido' }];
  TABLAS.forEach(({ tabla, titulo, texto }) => {
    Logger.log(`=== ${tabla} ===`);
    const registros = JSON.parse(UrlFetchApp.fetch(`${SUPABASE_URL}/rest/v1/${tabla}?embedding=is.null&select=id,${titulo},${texto}`, { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }).getContentText());
    Logger.log(`Sin embedding: ${registros.length}`);
    registros.forEach(reg => {
      try {
        const textoCompleto = `${reg[titulo] || ''}. ${reg[texto] || ''}`.trim();
        const voyageData = JSON.parse(UrlFetchApp.fetch('https://api.voyageai.com/v1/embeddings', { method: 'post', contentType: 'application/json', headers: { 'Authorization': `Bearer ${VOYAGE_KEY_LOCAL}` }, payload: JSON.stringify({ model: 'voyage-4-lite', input: [textoCompleto] }) }).getContentText());
        if (!voyageData.data || !voyageData.data[0]) return;
        UrlFetchApp.fetch(`${SUPABASE_URL}/rest/v1/${tabla}?id=eq.${reg.id}`, { method: 'patch', contentType: 'application/json', headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Prefer': 'return=minimal' }, payload: JSON.stringify({ embedding: voyageData.data[0].embedding }) });
        Logger.log(`ID ${reg.id}: OK`);
        Utilities.sleep(300);
      } catch(e) { Logger.log(`ID ${reg.id}: ERROR — ${e.message}`); }
    });
  });
  Logger.log('=== Carga completada. ===');
}

function cmdSync(chatId) {
  sendMessage(chatId, "⏳ Sincronizando...");
  try { syncDriveCompleto(); cargarEmbeddingsPendientes(); sendMessage(chatId, "✅ Sync completado."); }
  catch(e) { sendMessage(chatId, "❌ Error: " + escaparHTML(e.message)); }
}

// ============================================================
// WEBHOOK Y MANTENIMIENTO
// ============================================================
function setWebhook() {
  Logger.log(UrlFetchApp.fetch(TELEGRAM_API + "/setWebhook?url=" + encodeURIComponent(CORRECT_WEBHOOK_URL) + "&drop_pending_updates=true").getContentText());
}
function deleteWebhook() { Logger.log(UrlFetchApp.fetch(TELEGRAM_API + "/deleteWebhook?drop_pending_updates=true").getContentText()); }
function getWebhookInfo() { Logger.log(UrlFetchApp.fetch(TELEGRAM_API + "/getWebhookInfo").getContentText()); }

function nuclearReset() {
  var del = UrlFetchApp.fetch(TELEGRAM_API + "/deleteWebhook?drop_pending_updates=true");
  Logger.log("Delete: " + del.getContentText());
  CacheService.getScriptCache().removeAll(["lastUpdateId"]);
  Utilities.sleep(2000);
  var set = UrlFetchApp.fetch(TELEGRAM_API + "/setWebhook?url=" + encodeURIComponent(CORRECT_WEBHOOK_URL) + "&drop_pending_updates=true");
  Logger.log("Set: " + set.getContentText());
}

function limpiarCache() { CacheService.getScriptCache().remove("pending_update"); Logger.log("Cache limpiado"); }
function limpiarTriggers() { var triggers = ScriptApp.getProjectTriggers(); for (var i = 0; i < triggers.length; i++) { if (triggers[i].getHandlerFunction() === "processPending") ScriptApp.deleteTrigger(triggers[i]); } Logger.log("Triggers eliminados"); }
function resetearTodo() { PropertiesService.getScriptProperties().deleteAllProperties(); Logger.log("✅ Todo reseteado"); }

// ============================================================
// TESTS
// ============================================================
function testOCRDriveAPI() {
  var root = DriveApp.getFolderById(DRIVE_ROOT);
  var archivos = root.getFilesByType(MimeType.PDF);
  if (!archivos.hasNext()) {
    Logger.log("No hay ningún PDF directamente dentro de la carpeta DRIVE_ROOT.");
    return;
  }

  var pdf = archivos.next();
  Logger.log("Probando OCR con: " + pdf.getName() + " | fileId=" + pdf.getId());

  var ocrFile = null;
  try {
    var texto;
    if (pdf.getMimeType() === MimeType.GOOGLE_DOCS) {
      Logger.log("El archivo ya es un Documento de Google; se lee directamente, sin OCR.");
      texto = DocumentApp.openById(pdf.getId()).getBody().getText();
    } else {
      var pdfBlob = pdf.getBlob();
      pdfBlob.setContentType("application/pdf");
      ocrFile = Drive.Files.insert(
        { title: "test_ocr_temp", mimeType: MimeType.GOOGLE_DOCS },
        pdfBlob
      );
      texto = DocumentApp.openById(ocrFile.id).getBody().getText();
    }

    Logger.log("OCR OK. Caracteres extraídos: " + texto.length);
    Logger.log(texto.substring(0, 1000));
  } finally {
    if (ocrFile && ocrFile.id) DriveApp.getFileById(ocrFile.id).setTrashed(true);
  }
}

function testSendMessage() {
  var chatId = 184855747;
  var res = UrlFetchApp.fetch(TELEGRAM_API + "/sendMessage", {
    method: "post", contentType: "application/json",
    payload: JSON.stringify({ chat_id: chatId, text: "TEST desde editor ✅", parse_mode: "HTML" }),
    muteHttpExceptions: true
  });
  Logger.log("Código: " + res.getResponseCode());
  Logger.log("Respuesta: " + res.getContentText());
}

function testInlineKeyboard() {
  var chatId = 184855747;
  var keyboard = [
    [{ text: "⚖️ 1. Documento de prueba", callback_data: "doc_0" }],
    [{ text: "📝 2. Otro documento", callback_data: "doc_1" }]
  ];
  sendInlineKeyboard(chatId, "🧪 <b>TEST inline keyboard</b>\n\nTocá un botón:", keyboard);
  Logger.log("Test inline keyboard enviado");
}

function testCmdAnalizar() { cmdAnalizar(184855747, "demanda"); }
function getWebhookInfoTest() { getWebhookInfo(); }

function testEnviarAnalisisDirecto() {
  enviarAnalisisDirecto(184855747, "Test manual v110", 1, "Este es un texto de prueba para confirmar que el cuerpo del análisis llega completo después del header, incluyendo varias líneas y algo de largo para simular una respuesta real de Claude.");
}

function limpiarTodosLosTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function(t) { ScriptApp.deleteTrigger(t); });
  Logger.log("Eliminados: " + triggers.length + " triggers");
}
