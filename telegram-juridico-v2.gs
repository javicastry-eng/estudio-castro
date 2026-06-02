const BOT_TOKEN = "8831400473:AAG-XIXVu9UWcnxRjr5rtOw3uhwuSACX0Mc";
const TELEGRAM_API = "https://api.telegram.org/bot" + BOT_TOKEN;
const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_KEY = "sk-ant-api03-v7LI7IU6paVxRq5THG9J_WrMnTK1stjQNGOPwWb6j4h8XUM-6RhZMtsOlQmICgwRVYPJNd_GIGJJw7ulb7f5Xw-yd4EHAAA";
const SB_URL = "https://nqwybjfrsnqpgdaecubg.supabase.co";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5xd3liamZyc25xcGdkYWVjdWJnIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODQ2ODk5NywiZXhwIjoyMDk0MDQ0OTk3fQ.73qPxfKv29IbtG_K2hkv8HlpsERucJ1zWnkvfXx2P08";
const DRIVE_ROOT = "1IfPreFIXWtSNsgpxRYjqot6KjoQQhBAJ";
const INBOX_NAME = "INBOX-TELEGRAM";
const CORRECT_WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbxMH1a7KEmA0mLbfNvDT47-eeAd1rNgLFcLPMmTS9HRMi5UnF4CFrZnp8c9wqcgCEBPdA/exec";
const VOYAGE_KEY = "pa-IrStbMvXH8UPJHLeDLjoJhMfK1pmg4lY20e6gKyFoCf";
const VOYAGE_API = "https://api.voyageai.com/v1/embeddings";
// ── POLLING — corre cada 1 minuto via trigger Time-Driven ──
function pollUpdates() {
  var props = PropertiesService.getScriptProperties();
  var lastId = parseInt(props.getProperty("poll_last_update_id") || "0");

  try {
    var url = TELEGRAM_API + "/getUpdates?offset=" + (lastId + 1) + "&limit=10&timeout=0";
    var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    var data = JSON.parse(res.getContentText());

    if (!data.ok || !data.result || data.result.length === 0) return;

    data.result.forEach(function(update) {
      try {
        handleUpdate(update);
      } catch(e) {
        Logger.log("Error handleUpdate id=" + update.update_id + ": " + e.message);
      }
      lastId = update.update_id;
    });

    props.setProperty("poll_last_update_id", String(lastId));
  } catch(e) {
    Logger.log("Error pollUpdates: " + e.message);
  }
}

function doPost(e) {
    var output = ContentService.createTextOutput("OK");
    try {
    var update = JSON.parse(e.postData.contents);
    var updateId = update.update_id || new Date().getTime();
    var cache = CacheService.getScriptCache();
    cache.put("pending_" + updateId, e.postData.contents, 300);
    var existsProcessPending = false;
    var triggers = ScriptApp.getProjectTriggers();
    for (var i = 0; i < triggers.length; i++) {
      if (triggers[i].getHandlerFunction() === "processPending") {
        existsProcessPending = true;
        break;
      }
    }
    if (!existsProcessPending) {
      ScriptApp.newTrigger("processPending").timeBased().after(1000).create();
    }
    PropertiesService.getScriptProperties().setProperty("last_update_id", String(updateId));
  } catch(err) {
    Logger.log("Error en doPost: " + err.message);
  }
  return output;
}
  

 function processPending() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === "processPending") {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  var props = PropertiesService.getScriptProperties();
  var updateId = props.getProperty("last_update_id");
  var lastProcessed = props.getProperty("last_processed_id");
  if (updateId === lastProcessed) {
    Logger.log("Update ya procesado: " + updateId);
    return;
  }
  var cache = CacheService.getScriptCache();
  var raw = cache.get("pending_" + updateId);
  if (!raw) return;
  props.setProperty("last_processed_id", updateId);
  var update = JSON.parse(raw);
 
// Rate limit por archivo
var msg = update.message;
if (msg && msg.document) {
  var fileId = msg.document.file_id;
  var fileIdKey = "fileid_" + fileId;
  var props0 = PropertiesService.getScriptProperties();
  if (props0.getProperty(fileIdKey)) {
    Logger.log("file_id ya procesado: " + fileId);
    return;
  }
  props0.setProperty(fileIdKey, String(new Date().getTime()));
  var fileName = msg.document.file_name || "";
  var rateKey = "rate_" + fileName.replace(/[^a-zA-Z0-9]/g, "");
  var props2 = PropertiesService.getScriptProperties();
  var lastTime = props2.getProperty(rateKey);
  var now = new Date().getTime();
  if (lastTime && (now - parseInt(lastTime)) < 5 * 60 * 1000) {
    Logger.log("Rate limit: " + fileName);
    return;
  }
  props2.setProperty(rateKey, String(now));
}

handleUpdate(update);
cache.remove("pending_" + updateId);
 
};

function handleUpdate(update) {
  if (!update.message) return;

  var msg = update.message;
  var chatId = msg.chat.id;
  var text = msg.text ? msg.text.trim() : "";

  // REENVÍO CON DOCUMENTO (PDF, Word, etc.)
  if (msg.document) {
    sendMessage(chatId, "📥 Recibí un documento reenviado. Subiéndolo a Drive...");
    procesarDocumento(chatId, msg);
    return;
  }

   // COMANDOS
  if (text === "/start") {
    sendMessage(chatId, "⚖️ *Estudio Castro — Bot Jurídico*\n\nHola! Estoy activo.\n\n/causas — causas activas\n/ayuda — comandos\n\n📌 Reenviame PDFs o textos de canales jurídicos y los guardo automáticamente.");
    return;
  }
  if (text === "/ayuda") {
    sendMessage(chatId, "📋 *Comandos:*\n\n/causas — causas activas\n/ayuda — este menú\n\n📌 *Flujo de captura:*\n1. Abrís @mujeresabogadas\n2. Reenviás un PDF o texto al bot\n3. El bot lo sube a Drive y registra en Supabase automáticamente.");
    return;
  }
  if (text === "/causas") {
    sendMessage(chatId, "📂 *Causas activas:*\n\n• Rodríguez c/ Holcim y otros — Expte. 15905/2026 — JNT N°16 CNAT");
    return;
  }

  if (text.toLowerCase().startsWith("/busqueda")) {
    var query = text.replace(/^\/busqueda\s*/i, "").trim();
    if (!query) {
      sendMessage(chatId, "🔍 *Buscador jurídico*\n\nEscribí el tema:\n\n`/busqueda despido indirecto`\n`/busqueda art.30 solidaridad`\n`/busqueda ius variandi`\n`/busqueda ley 27802`");
      return;
    }
    buscarSemantico(chatId, query);
    return;
  }

  // ── AGENTE JURÍDICO (add-on) ──
  if (text === "/agente")                                           { cmdAgente(chatId); return; }
  if (text.toLowerCase().startsWith("/buscar"))                    { cmdBuscar(chatId, text.replace(/^\/buscar\s*/i,"").trim()); return; }
  if (text.toLowerCase().startsWith("/argumentar"))                { cmdArgumentar(chatId, text.replace(/^\/argumentar\s*/i,"").trim()); return; }
  if (text.toLowerCase().startsWith("/causa") && text.length > 6) { cmdCausa(chatId, text.replace(/^\/causa\s*/i,"").trim()); return; }
  if (text.toLowerCase().startsWith("/redactar"))                  { cmdRedactar(chatId, text.replace(/^\/redactar\s*/i,"").trim()); return; }
  if (text.toLowerCase().startsWith("/ley"))                       { cmdLey(chatId, text.replace(/^\/ley\s*/i,"").trim()); return; }

  // Comando desconocido
  if (text.startsWith("/")) {
    sendMessage(chatId, "❓ Comando no reconocido.\n\n/ayuda — comandos de captura\n/agente — comandos jurídicos");
    return;
  }

  // TEXTO LIBRE
  if (text) {
    procesarTexto(chatId, text);
  }
}

// ── PROCESAR DOCUMENTO (PDF, Word) ──
function procesarDocumento(chatId, msg) {
  try {
    var doc = msg.document;
    var fileName = doc.file_name || "documento_" + new Date().getTime();
    var fileId = doc.file_id;

    // Obtener URL de descarga de Telegram
    var fileInfoRes = UrlFetchApp.fetch(TELEGRAM_API + "/getFile?file_id=" + fileId);
    var fileInfo = JSON.parse(fileInfoRes.getContentText());
    if (!fileInfo.ok) {
      sendMessage(chatId, "❌ No pude obtener el archivo de Telegram.");
      return;
    }
    var filePath = fileInfo.result.file_path;
    var fileSize = fileInfo.result.file_size || 0;

    // Límite 20MB de Telegram API
    if (fileSize > 20 * 1024 * 1024) {
      sendMessage(chatId, "⚠️ Archivo demasiado grande para descargar via API (" + Math.round(fileSize/1024/1024) + " MB). Límite: 20 MB.");
      return;
    }

    var downloadUrl = "https://api.telegram.org/file/bot" + BOT_TOKEN + "/" + filePath;
    var fileBlob = UrlFetchApp.fetch(downloadUrl).getBlob();
        fileBlob.setName(fileName);

    // Extraer texto del PDF para clasificación y archivo .md
     var pdfText = "";
try {
  var mimeType = doc.mime_type || "";
  if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    // DOCX: convertir a Google Doc para leer texto
    var tempDocx = DriveApp.getRootFolder().createFile(fileBlob);
    var gdocFile = Drive.Files.copy({ title: "temp_doc", mimeType: MimeType.GOOGLE_DOCS }, tempDocx.getId());
    var gdoc = DocumentApp.openById(gdocFile.id);
    pdfText = gdoc.getBody().getText().substring(0, 1500);
    DriveApp.getFileById(gdocFile.id).setTrashed(true);
    tempDocx.setTrashed(true);
    Logger.log("pdfText desde docx: " + pdfText.substring(0, 100));
  } else {
    // PDF y otros: OCR
    var tempPdf = DriveApp.getRootFolder().createFile(fileBlob);
    var ocrFile = Drive.Files.copy({ title: "ocr_temp", mimeType: MimeType.GOOGLE_DOCS }, tempPdf.getId(), { ocr: true, ocrLanguage: "es" });
    var ocrDoc = DocumentApp.openById(ocrFile.id);
    pdfText = ocrDoc.getBody().getText().substring(0, 1500);
    DriveApp.getFileById(ocrFile.id).setTrashed(true);
    tempPdf.setTrashed(true);
    Logger.log("pdfText extraido: " + pdfText.substring(0, 100));
  }
} catch(e) { Logger.log("Error extraccion texto: " + e.message); }

    // Subir como .md a carpeta INBOX-TELEGRAM en Drive
     var inboxFolder = getOrCreateInbox();
     var mdFileName = fileName.replace(/\.[^/.]+$/, "") + ".md";
     var mdContent = "# " + fileName + "\n\n**Fuente:** Telegram @mujeresabogadas\n\n" + pdfText;
     var mdBlob = Utilities.newBlob(mdContent, "text/plain", mdFileName);
     var driveFile = inboxFolder.createFile(mdBlob);
     var driveUrl = driveFile.getUrl(); 

    // Clasificar con Claude usando el nombre del archivo
    var caption = msg.caption || "";
    Logger.log("Caption: [" + caption + "] fileName: [" + fileName + "] pdfText: [" + pdfText.substring(0,100) + "]");
    // pdfText primero — tiene el contenido real del documento (partes, tribunal, etc.)
    var textoParaClasificar = (pdfText && pdfText.length > 50 ? "Contenido del documento: " + pdfText.substring(0, 1800) + "\n\n" : "") + "Nombre del archivo: " + fileName + (caption ? "\nDescripción del usuario: " + caption : "");
    var clasificacion = clasificarTextoConClaude(textoParaClasificar);
    if (!clasificacion) clasificacion = { tipo: "MODELO", area: "GENERAL", titulo: fileName, resumen: "" };

    // Safety net: si el PDF tiene partes enfrentadas → JURISPRUDENCIA sin depender de Claude
    if (pdfText && pdfText.length > 50 && clasificacion.tipo !== "JURISPRUDENCIA") {
      var tienePartes = pdfText.indexOf(" vs. ") !== -1 || pdfText.indexOf(" vs ") !== -1 || pdfText.indexOf(" c/ ") !== -1 || pdfText.indexOf(" c/") !== -1;
      Logger.log("Safety net check — tienePartes: " + tienePartes + " tipo actual: " + clasificacion.tipo);
      if (tienePartes) {
        Logger.log("Override → JURISPRUDENCIA (partes enfrentadas detectadas en pdfText)");
        clasificacion.tipo = "JURISPRUDENCIA";
        if (!clasificacion.area || clasificacion.area === "GENERAL") clasificacion.area = "LABORAL";
      }
    }

    // Guardar en Supabase
    var tabla = clasificacion.tipo === "JURISPRUDENCIA" ? "jurisprudencia"
      : clasificacion.tipo === "DOCTRINA" ? "doctrina"
      : "modelos";

    var guardado = guardarEnSupabase(tabla, clasificacion, driveUrl, fileName);

    var emoji = tabla === "jurisprudencia" ? "⚖️" : tabla === "doctrina" ? "📚" : "📝";
    if (guardado) {
      sendMessage(chatId,
        emoji + " *Guardado exitosamente*\n\n" +
        "*Archivo:* " + fileName + "\n" +
        "*Tabla:* " + tabla + "\n" +
        "*Área:* " + clasificacion.area + "\n" +
        "*Drive:* [Ver archivo](" + driveUrl + ")"
      );
    } else {
      sendMessage(chatId, "❌ Error al guardar en Supabase. Revisá los logs.");
    }

  } catch(err) {
    Logger.log("Error procesarDocumento: " + err.message);
    sendMessage(chatId, "❌ Error al procesar el documento: " + err.message);
  }
}

// ── PROCESAR TEXTO REENVIADO ──
function procesarTexto(chatId, texto) {
  if (texto.length < 20) {
    sendMessage(chatId, "⚠️ Texto muy corto.\n\nSi querés describir un PDF, escribí la descripción *antes de enviarlo* (como caption del archivo), no como mensaje separado.");
    return;
  }
  // Texto corto tipo título — probablemente es caption de un PDF que mandaron separado
  if (texto.length < 150 && texto === texto.toUpperCase()) {
    sendMessage(chatId, "ℹ️ Parece el título de un documento.\n\nPara clasificarlo correctamente, reenviá el PDF y escribí esta descripción *en el campo de texto que aparece debajo del archivo* antes de enviarlo.");
    return;
  }
  var clasificacion = clasificarTextoConClaude(texto);
  if (!clasificacion || clasificacion.tipo === "IGNORAR") {
    sendMessage(chatId, "ℹ️ No pude clasificar este texto como contenido jurídico guardable.\n\nSi es la descripción de un PDF, incluila como caption al momento de reenviar el archivo.");
    return;
  }
  var tabla = clasificacion.tipo === "JURISPRUDENCIA" ? "jurisprudencia"
    : clasificacion.tipo === "DOCTRINA" ? "doctrina"
    : "modelos";
  var guardado = guardarEnSupabase(tabla, clasificacion, null, clasificacion.titulo);
  var emoji = tabla === "jurisprudencia" ? "⚖️" : tabla === "doctrina" ? "📚" : "📝";
  if (guardado) {
    sendMessage(chatId, emoji + " *Guardado en " + tabla + "*\n\n*Título:* " + clasificacion.titulo + "\n*Área:* " + clasificacion.area);
  } else {
    sendMessage(chatId, "❌ Error al guardar en Supabase.");
  }
}

// ── OBTENER O CREAR CARPETA INBOX-TELEGRAM ──
function getOrCreateInbox() {
  var root = DriveApp.getFolderById(DRIVE_ROOT);
  var folders = root.getFoldersByName(INBOX_NAME);
  if (folders.hasNext()) return folders.next();
  return root.createFolder(INBOX_NAME);
}

// ── CLASIFICAR POR NOMBRE DE ARCHIVO CON CLAUDE ──
function clasificarPorNombre(fileName) {
  var payload = {
    model: "claude-haiku-4-5-20251001",
    max_tokens: 200,
    system: "Clasifica archivos juridicos argentinos por su nombre y contenido. Devuelve SOLO JSON sin texto adicional: {\"tipo\": \"JURISPRUDENCIA|DOCTRINA|MODELO|GENERAL\", \"area\": \"LABORAL|CIVIL|CONTRATOS|FAMILIA|SUCESIONES|GENERAL\", \"titulo\": \"titulo limpio sin extension\"}. SUCESIONES incluye declaratorias, testamentos, intestato. LABORAL incluye despidos, ART, SECLO, LCT. JURISPRUDENCIA son fallos y sentencias. DOCTRINA son resoluciones y normativa. MODELO son escritos y presentaciones.",
    messages: [{ role: "user", content: "Clasifica este archivo juridico argentino.Si el nombre dice CUMPLE, INTIMACION, ESCRITO, DEMANDA, CONTESTA, ALEGA, ACOMPAÑA: tipo MODELO. Si dice FALLO, SENTENCIA, RESOLUCION: tipo JURISPRUDENCIA. Si dice DECLARATORIA, SUCESION, INTESTATO: area SUCESIONES." + fileName }]
  };
  var options = {
    method: "post", contentType: "application/json",
    headers: { "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
    payload: JSON.stringify(payload), muteHttpExceptions: true
  };
  try {
    var res = UrlFetchApp.fetch(ANTHROPIC_API, options);
    var data = JSON.parse(res.getContentText());
    if (data && data.content && data.content[0]) {
      var txt = data.content[0].text.replace(/```json|```/g, "").trim();
      return JSON.parse(txt);
    }
  } catch(err) { Logger.log("Error clasificarPorNombre: " + err.message); }
  return { tipo: "GENERAL", area: "GENERAL", titulo: fileName.replace(/\.[^/.]+$/, "") };
}

// ── CLASIFICAR TEXTO CON CLAUDE ──
function clasificarTextoConClaude(texto) {
  var payload = {
    model: "claude-haiku-4-5-20251001",
    max_tokens: 300,
    system: "Clasifica texto juridico argentino. Devuelve SOLO JSON con campos: tipo (JURISPRUDENCIA, DOCTRINA, MODELO o IGNORAR), area (LABORAL, CIVIL, CONTRATOS, FAMILIA, SUCESIONES o GENERAL), titulo y resumen. REGLAS DE TIPO — aplicar en este orden: (1) JURISPRUDENCIA: el texto menciona partes enfrentadas (apellido vs., apellido c/, contra empresa), tribunal, sala, cámara, juzgado, número de expediente, sentencia, fallo, resolución judicial — aunque el usuario describa los temas tratados. (2) DOCTRINA: resoluciones ARCA AFIP MTEySS ANSES, normativa, circulares, leyes comentadas. (3) MODELO: escritos procesales redactados en primera persona (demanda, recurso, apelación, contesta, alega, acompaña). (4) IGNORAR: contenido claramente no juridico. REGLAS DE AREA: LCT, despido, jornada, salario, empleador, trabajador, ART, SECLO, CNAT → LABORAL. Sucesion, heredero, testamento, declaratoria → SUCESIONES.",
    messages: [{ role: "user", content: texto }]
  };
  var options = {
    method: "post", contentType: "application/json",
    headers: { "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
    payload: JSON.stringify(payload), muteHttpExceptions: true
  };
  try {
    var res = UrlFetchApp.fetch(ANTHROPIC_API, options);
    var data = JSON.parse(res.getContentText());
    if (data && data.content && data.content[0]) {
      var txt = data.content[0].text.replace(/```json|```/g, "").trim();
      return JSON.parse(txt);
    }
  } catch(err) { Logger.log("Error clasificarTexto: " + err.message); }
  return null;
}

// ── GUARDAR EN SUPABASE + EMBEDDING AUTOMÁTICO ──
function guardarEnSupabase(tabla, clasificacion, driveUrl, nombreArchivo) {
  var payload, textoEmbed;

  if (tabla === "jurisprudencia") {
    payload = {
      titulo: clasificacion.titulo || nombreArchivo,
      AREA: clasificacion.area || "GENERAL",
      resumen_doctrina: clasificacion.resumen || "Documento cargado desde Telegram",
      DRIVE_URL: driveUrl
    };
    textoEmbed = (payload.titulo + " " + payload.resumen_doctrina).substring(0, 8000);
  } else if (tabla === "doctrina") {
    payload = {
      titulo: clasificacion.titulo || nombreArchivo,
      area: clasificacion.area || "GENERAL",
      descripcion: clasificacion.resumen || "Documento cargado desde Telegram",
      tipo: "Doctrina",
      fuente: "Telegram @mujeresabogadas",
      drive_url: driveUrl
    };
    textoEmbed = (payload.titulo + " " + payload.descripcion).substring(0, 8000);
  } else {
    payload = {
      titulo: clasificacion.titulo || nombreArchivo,
      area: clasificacion.area || "GENERAL",
      descripcion: clasificacion.resumen || "Documento cargado desde Telegram",
      tipo_escrito: clasificacion.tipo === "MODELO" ? "Modelo" : (clasificacion.tipo || "Modelo"),
      drive_url: driveUrl,
      FUENTE: "Telegram @mujeresabogadas",
      fecha_carga: new Date().toISOString()
    };
    textoEmbed = (payload.titulo + " " + payload.descripcion).substring(0, 8000);
  }

  var options = {
    method: "post",
    contentType: "application/json",
    headers: {
      "apikey": SB_KEY,
      "Authorization": "Bearer " + SB_KEY,
      "Prefer": "return=representation"
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  try {
    var res = UrlFetchApp.fetch(SB_URL + "/rest/v1/" + tabla, options);
    var code = res.getResponseCode();
    Logger.log("Supabase " + tabla + ": " + code);
    if (code !== 201) Logger.log("Supabase error body: " + res.getContentText().substring(0, 300));

    if (code === 201) {
      var inserted = JSON.parse(res.getContentText());
      if (Array.isArray(inserted) && inserted[0] && inserted[0].id) {
        var newId = inserted[0].id;
        var emb = generarEmbedding(textoEmbed);
        if (emb) {
          guardarEmbedding(tabla, newId, emb);
          Logger.log("✅ Embedding generado — " + tabla + " id=" + newId);
        }
      }
      return true;
    }
    return false;
  } catch(err) {
    Logger.log("Error Supabase: " + err.message);
    return false;
  }
}

// ── GENERAR EMBEDDING CON VOYAGE AI ──
function generarEmbedding(texto) {
  try {
    var res = UrlFetchApp.fetch(VOYAGE_API, {
      method: "post",
      contentType: "application/json",
      headers: { "Authorization": "Bearer " + VOYAGE_KEY },
      payload: JSON.stringify({ model: "voyage-4-lite", input: [texto] }),
      muteHttpExceptions: true
    });
    var data = JSON.parse(res.getContentText());
    if (data.data && data.data[0] && data.data[0].embedding) {
      return data.data[0].embedding;
    }
    Logger.log("Voyage sin embedding: " + res.getContentText().substring(0, 200));
  } catch(e) {
    Logger.log("Error generarEmbedding: " + e.message);
  }
  return null;
}

// ── GUARDAR EMBEDDING EN SUPABASE ──
function guardarEmbedding(tabla, id, embedding) {
  try {
    var res = UrlFetchApp.fetch(SB_URL + "/rest/v1/" + tabla + "?id=eq." + id, {
      method: "patch",
      contentType: "application/json",
      headers: {
        "apikey": SB_KEY,
        "Authorization": "Bearer " + SB_KEY,
        "Prefer": "return=minimal"
      },
      payload: JSON.stringify({ embedding: embedding }),
      muteHttpExceptions: true
    });
    Logger.log("Embedding PATCH " + tabla + " id=" + id + " → " + res.getResponseCode());
  } catch(e) {
    Logger.log("Error guardarEmbedding: " + e.message);
  }
}

// ── CLAUDE TEXTO LIBRE ──
function consultarClaude(texto) {
  var payload = {
    model: "claude-haiku-4-5-20251001",
    max_tokens: 400,
    system: "Sos el asistente jurídico del Estudio Castro, Dr. Javier Horacio Castro (T° 102 F° 174 CPACF), laboralista en Argentina. Respondé en español rioplatense, informal pero profesional. Máximo 3-4 líneas.",
    messages: [{ role: "user", content: texto }]
  };
  var options = {
    method: "post", contentType: "application/json",
    headers: { "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
    payload: JSON.stringify(payload), muteHttpExceptions: true
  };
  try {
    var res = UrlFetchApp.fetch(ANTHROPIC_API, options);
    var data = JSON.parse(res.getContentText());
    if (data && data.content && data.content[0] && data.content[0].text) return data.content[0].text;
    if (data && data.error) return "⚠️ Error API: " + data.error.message;
    return "⚠️ Sin respuesta.";
  } catch(err) { return "⚠️ Error: " + err.message; }
}

function sendMessage(chatId, text) {
  var payload = { chat_id: chatId, text: text, parse_mode: "Markdown" };
  var options = { method: "post", contentType: "application/json", payload: JSON.stringify(payload), muteHttpExceptions: true };
  UrlFetchApp.fetch(TELEGRAM_API + "/sendMessage", options);
}

function setWebhook() {
  var WEBAPP_URL = "https://script.google.com/macros/s/AKfycbxtBV0fKa63fs-BmN47B0bM4ian6KZ7T73OCZ4Exvp_yWduEGuZS-0FPl2KIpR6-oVyRw/exec";
  Logger.log(UrlFetchApp.fetch(TELEGRAM_API + "/setWebhook?url=" + encodeURIComponent(WEBAPP_URL)).getContentText());
}

function deleteWebhook() {
  Logger.log(UrlFetchApp.fetch(TELEGRAM_API + "/deleteWebhook?drop_pending_updates=true").getContentText());
}

function getWebhookInfo() {
  Logger.log(UrlFetchApp.fetch(TELEGRAM_API + "/getWebhookInfo").getContentText());
}

function limpiarCache() {
  var cache = CacheService.getScriptCache();
  cache.remove("pending_update");
  var props = PropertiesService.getScriptProperties();
  props.deleteProperty("last_update_id");
  Logger.log("Cache y props limpiados");
}

function limpiarTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === "processPending") {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  Logger.log("Triggers eliminados: " + triggers.length);
} 
 

function checkAndFixWebhook() {
  try {
    // 1. Consultar webhook actual
    const infoUrl = `https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo`;
    const infoRes = JSON.parse(UrlFetchApp.fetch(infoUrl).getContentText());
    const currentUrl = infoRes.result.url;

    Logger.log("Webhook actual: " + currentUrl);

    // 2. Comparar con la URL correcta
    if (currentUrl === CORRECT_WEBHOOK_URL) {
      Logger.log("✅ Webhook OK — no se requiere acción");
      return;
    }

    // 3. Si difiere → corregir automáticamente
    Logger.log("⚠️ Webhook desactualizado — corrigiendo...");
    const setUrl = `https://api.telegram.org/bot${BOT_TOKEN}/setWebhook?url=${encodeURIComponent(CORRECT_WEBHOOK_URL)}`;
    const setRes = JSON.parse(UrlFetchApp.fetch(setUrl).getContentText());

    if (setRes.ok) {
      Logger.log("✅ Webhook corregido exitosamente");
    } else {
      Logger.log("❌ Error al corregir webhook: " + JSON.stringify(setRes));
    }

  } catch (err) {
    Logger.log("❌ Error en checkAndFixWebhook: " + err.message);
  }
}

function createWebhookTrigger() {
  // Eliminar triggers anteriores del mismo nombre para no duplicar
  ScriptApp.getProjectTriggers().forEach(trigger => {
    if (trigger.getHandlerFunction() === "checkAndFixWebhook") {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  // Crear trigger cada 6 horas
  ScriptApp.newTrigger("checkAndFixWebhook")
    .timeBased()
    .everyHours(6)
    .create();

  Logger.log("✅ Trigger creado — checkAndFixWebhook correrá cada 6 horas");
}

function limpiarFileIds() {
  var props = PropertiesService.getScriptProperties();
  var all = props.getKeys();
  all.forEach(function(key) {
    if (key.startsWith("fileid_")) {
      props.deleteProperty(key);
    }
  });
  Logger.log("✅ file_ids limpiados: " + all.length);
}

function resetearTodo() {
  PropertiesService.getScriptProperties().deleteAllProperties();
  CacheService.getScriptCache().removeAll(['pending_' + '348822255', 'pending_' + '348822261']);
  Logger.log("✅ Todo reseteado");
}

// ── BÚSQUEDA SEMÁNTICA CON VOYAGE AI ──
function buscarSemantico(chatId, query) {
  try {
    // Generar embedding con Voyage AI
    var embRes = UrlFetchApp.fetch(VOYAGE_API, {
      method: "post",
      contentType: "application/json",
      headers: { "Authorization": "Bearer " + VOYAGE_KEY },
      payload: JSON.stringify({ model: "voyage-4-lite", input: [query] }),
      muteHttpExceptions: true
    });

    var embData = JSON.parse(embRes.getContentText());

    if (embData.data && embData.data[0] && embData.data[0].embedding) {
      var embedding = embData.data[0].embedding;

      // Llamar RPC buscar_juridico en Supabase
      var rpcRes = UrlFetchApp.fetch(SB_URL + "/rest/v1/rpc/buscar_juridico", {
        method: "post",
        contentType: "application/json",
        headers: { "apikey": SB_KEY, "Authorization": "Bearer " + SB_KEY },
        payload: JSON.stringify({ query_embedding: embedding, match_count: 5 }),
        muteHttpExceptions: true
      });

      var results = JSON.parse(rpcRes.getContentText());

      if (Array.isArray(results) && results.length > 0) {
        var msg = "⚖️ *" + results.length + " resultado(s) para:* _" + query + "_\n\n";
        results.slice(0, 5).forEach(function(r) {
          var score = Math.round((r.score || 0) * 100);
          var icon = r.tabla === "jurisprudencia" ? "⚖️" : r.tabla === "doctrina" ? "📚" : "📝";
          msg += icon + " *" + (r.titulo || "Sin título").substring(0, 70) + "*\n";
          if (r.resumen) msg += "_" + r.resumen.substring(0, 130) + "_\n";
          msg += "Relevancia: " + score + "%\n\n";
        });
        sendMessage(chatId, msg);
        return;
      }
    }
  } catch(e) {
    Logger.log("Error búsqueda semántica Voyage: " + e.message);
  }

  // Fallback: búsqueda por palabras clave
  try {
    var fbRes = UrlFetchApp.fetch(
      SB_URL + "/rest/v1/jurisprudencia?or=(titulo.ilike.*" + encodeURIComponent(query) + "*,resumen_doctrina.ilike.*" + encodeURIComponent(query) + "*)&select=titulo,resumen_doctrina,tribunal&limit=5",
      { headers: { "apikey": SB_KEY, "Authorization": "Bearer " + SB_KEY }, muteHttpExceptions: true }
    );
    var fbData = JSON.parse(fbRes.getContentText());

    if (Array.isArray(fbData) && fbData.length > 0) {
      var msg = "🔍 *" + fbData.length + " resultado(s) para:* _" + query + "_ (palabras clave)\n\n";
      fbData.forEach(function(r) {
        msg += "⚖️ *" + (r.titulo || "Sin título").substring(0, 70) + "*\n";
        if (r.resumen_doctrina) msg += "_" + r.resumen_doctrina.substring(0, 130) + "_\n";
        msg += "\n";
      });
      sendMessage(chatId, msg);
    } else {
      sendMessage(chatId, "❌ Sin resultados para: _" + query + "_\n\nProbá con otras palabras.");
    }
  } catch(e2) {
    Logger.log("Error fallback keyword: " + e2.message);
    sendMessage(chatId, "❌ Error en la búsqueda: " + e2.message);
  }
}

// ============================================================
// AGENTE JURÍDICO — ADD-ON v1.0
// Bloque independiente — no modifica funciones existentes
// Comandos: /agente /buscar /argumentar /causa /redactar /ley
// ============================================================

function cmdAgente(chatId) {
  sendMessage(chatId,
    "🤖 *AGENTE JURÍDICO — Estudio Castro*\n\n" +
    "*Comandos disponibles:*\n\n" +
    "🔍 `/busqueda [tema]` — Busca fallos por similitud semántica\n" +
    "⚖️ `/argumentar [tema]` — Genera argumento con citas listo para escrito\n" +
    "📁 `/causa [nombre]` — Ficha de la causa desde Supabase\n" +
    "📝 `/redactar [tipo]` — Borrador de escrito judicial\n" +
    "📖 `/ley [norma] [art]` — Texto actualizado del artículo\n\n" +
    "*Ejemplos:*\n" +
    "• `/busqueda solidaridad art.30 LCT`\n" +
    "• `/argumentar fraude laboral interposición personas`\n" +
    "• `/causa holcim`\n" +
    "• `/redactar intimacion despido indirecto`\n" +
    "• `/ley LCT 245`"
  );
}

function cmdBuscar(chatId, tema) {
  if (!tema) {
    sendMessage(chatId, "🔍 Usá: `/buscar despido indirecto ius variandi`\n\nO usá `/busqueda [tema]` para búsqueda semántica.");
    return;
  }
  // Redirige a la búsqueda semántica existente con Voyage AI
  buscarSemantico(chatId, tema);
}

function cmdArgumentar(chatId, tema) {
  if (!tema) {
    sendMessage(chatId,
      "⚖️ *GENERAR ARGUMENTO*\n\n" +
      "Usá: `/argumentar solidaridad art.30 LCT`\n\n" +
      "Ejemplos:\n" +
      "• `/argumentar despido indirecto cambio horario`\n" +
      "• `/argumentar fraude laboral interposición personas`\n" +
      "• `/argumentar deuda de valor CCCN 772`"
    );
    return;
  }

  sendMessage(chatId, "⚖️ Buscando jurisprudencia y generando argumento sobre: _" + tema + "_...");

  // Buscar fallos locales relevantes
  var fallos = agenteBuscarLocal(tema);
  var contexto = "";
  if (fallos.length > 0) {
    contexto = "JURISPRUDENCIA DE LA BASE:\n";
    fallos.slice(0, 5).forEach(function(f) {
      contexto += "- " + f.titulo + " (" + (f.tribunal || "") + "): " + (f.resumen_doctrina || f.descripcion || "").substring(0, 200) + "\n";
    });
  } else {
    contexto = "Sin jurisprudencia específica en la base local. Elaborar desde normativa vigente.";
  }

  var prompt =
    "Sos el Dr. Javier Castro, abogado laboralista argentino (CPACF T°102 F°174), especialista en CNAT.\n\n" +
    "TEMA: " + tema + "\n\n" +
    "JURISPRUDENCIA DISPONIBLE:\n" + contexto + "\n\n" +
    "Redactá un argumento jurídico en estilo escrito judicial argentino. Incluí:\n" +
    "1. Fundamento normativo (artículos y leyes)\n" +
    "2. Citas de jurisprudencia con tribunal\n" +
    "3. Conclusión aplicada al caso\n" +
    "Máximo 350 palabras. Listo para copiar en un escrito.";

  var argumento = agenteCallClaude(prompt, 700);
  sendMessage(chatId,
    "⚖️ *ARGUMENTO: " + tema.substring(0, 50).toUpperCase() + "*\n\n" +
    argumento + "\n\n" +
    "---\n💡 Para un escrito completo: `/redactar [tipo]`"
  );
}

function cmdCausa(chatId, nombre) {
  sendMessage(chatId, "📁 Buscando causa...");
  try {
    var url = SB_URL + "/rest/v1/expedientes?select=*&order=fecha_inicio.desc&limit=10";
    if (nombre && nombre.length > 2) {
      url = SB_URL + "/rest/v1/expedientes?caratula=ilike.*" + encodeURIComponent(nombre) + "*&select=*&limit=5";
    }
    var r = UrlFetchApp.fetch(url, {
      headers: { "apikey": SB_KEY, "Authorization": "Bearer " + SB_KEY },
      muteHttpExceptions: true
    });
    var causas = JSON.parse(r.getContentText());
    if (!Array.isArray(causas) || causas.length === 0) {
      sendMessage(chatId, "⚠️ No encontré causas" + (nombre ? " con '" + nombre + "'" : "") + ".\n\nUsá: `/causa holcim` o `/causa rodriguez`");
      return;
    }
    var msg = "📁 *CAUSAS ACTIVAS:*\n\n";
    causas.forEach(function(c, i) {
      msg += (i + 1) + ". *" + (c.caratula || "Sin carátula").substring(0, 60) + "*\n";
      if (c.numero_expediente) msg += "   📋 Expte: " + c.numero_expediente + "\n";
      if (c.fuero_juzgado)     msg += "   🏛 " + c.fuero_juzgado + "\n";
      if (c.estado)            msg += "   📌 " + c.estado + "\n";
      if (c.observaciones)     msg += "   📝 " + c.observaciones.substring(0, 100) + "...\n";
      msg += "\n";
    });
    sendMessage(chatId, msg);
  } catch(e) {
    sendMessage(chatId, "❌ Error buscando causas: " + e.message);
  }
}

function cmdRedactar(chatId, tipo) {
  if (!tipo) {
    sendMessage(chatId,
      "📝 *REDACTAR ESCRITO*\n\n" +
      "Usá: `/redactar [tipo de escrito]`\n\n" +
      "Ejemplos:\n" +
      "• `/redactar intimacion despido indirecto`\n" +
      "• `/redactar TCL registracion laboral`\n" +
      "• `/redactar recurso apelacion`\n" +
      "• `/redactar excepcion prescripcion`\n" +
      "• `/redactar fracaso SECLO`\n\n" +
      "_El bot genera un borrador con campos en [MAYÚSCULAS] para completar._"
    );
    return;
  }

  sendMessage(chatId, "📝 Redactando: _" + tipo + "_...\n_Puede tardar unos segundos._");

  var prompt =
    "Sos el Dr. Javier Castro, abogado laboralista argentino (CPACF T°102 F°174).\n\n" +
    "Redactá un borrador de: *" + tipo + "*\n\n" +
    "Aplicá la normativa laboral argentina vigente (LCT, CCCN, leyes especiales).\n" +
    "Formato: escrito judicial argentino con encabezado, desarrollo y petitorio.\n" +
    "Dejá en [MAYÚSCULAS ENTRE CORCHETES] los datos que el abogado debe completar.\n" +
    "Máximo 450 palabras.";

  var borrador = agenteCallClaude(prompt, 900);
  sendMessage(chatId,
    "📝 *BORRADOR: " + tipo.toUpperCase().substring(0, 40) + "*\n\n" +
    borrador + "\n\n" +
    "---\n_Completá los campos en [CORCHETES] antes de usar._"
  );
}

function cmdLey(chatId, consulta) {
  if (!consulta) {
    sendMessage(chatId,
      "📖 *CONSULTAR ARTÍCULO*\n\n" +
      "Usá: `/ley [norma] [artículo]`\n\n" +
      "Ejemplos:\n" +
      "• `/ley LCT 245` — Indemnización por despido\n" +
      "• `/ley LCT 30` — Solidaridad laboral\n" +
      "• `/ley LCT 242` — Despido con justa causa\n" +
      "• `/ley CCCN 772` — Deuda de valor\n" +
      "• `/ley 27802 55` — Ley modernización art.55"
    );
    return;
  }

  // Abreviaturas de leyes
  var leyes = { "LCT":"20744", "LRT":"24557", "LNE":"24013", "LCCT":"14250", "CCCN":"26994" };
  var consultaNorm = consulta.toUpperCase();
  Object.keys(leyes).forEach(function(k) {
    consultaNorm = consultaNorm.replace(k, "Ley " + leyes[k]);
  });

  sendMessage(chatId, "📖 Consultando: _" + consulta + "_...");

  var prompt =
    "Sos un asistente jurídico especializado en derecho argentino.\n\n" +
    "El abogado consulta: " + consulta + "\n\n" +
    "Respondé con:\n" +
    "1. TEXTO DEL ARTÍCULO (completo, transcribilo)\n" +
    "2. ÚLTIMA MODIFICACIÓN relevante (si la hubo)\n" +
    "3. APLICACIÓN PRÁCTICA en el fuero laboral (1-2 líneas)\n\n" +
    "Si no conocés el artículo exacto, indicalo claramente.";

  var respuesta = agenteCallClaude(prompt, 600);
  sendMessage(chatId, "📖 *" + consulta.toUpperCase() + "*\n\n" + respuesta);
}

// ── HELPERS DEL AGENTE ──

function agenteBuscarLocal(tema) {
  var palabras = tema.toLowerCase()
    .replace(/[.,;:()\[\]¿?¡!]/g, " ")
    .split(/\s+/)
    .filter(function(w) { return w.length > 4; })
    .slice(0, 3);
  if (!palabras.length) return [];
  var resultados = [], vistos = {};
  palabras.forEach(function(p) {
    try {
      var r = UrlFetchApp.fetch(
        SB_URL + "/rest/v1/jurisprudencia?or=(titulo.ilike.*" + p + "*,resumen_doctrina.ilike.*" + p + "*)&select=titulo,tribunal,resumen_doctrina&limit=3",
        { headers: { "apikey": SB_KEY, "Authorization": "Bearer " + SB_KEY }, muteHttpExceptions: true }
      );
      JSON.parse(r.getContentText()).forEach(function(f) {
        if (!vistos[f.titulo]) { vistos[f.titulo] = true; resultados.push(f); }
      });
    } catch(e) {}
    try {
      var r2 = UrlFetchApp.fetch(
        SB_URL + "/rest/v1/doctrina?or=(titulo.ilike.*" + p + "*,descripcion.ilike.*" + p + "*)&select=titulo,descripcion&limit=2",
        { headers: { "apikey": SB_KEY, "Authorization": "Bearer " + SB_KEY }, muteHttpExceptions: true }
      );
      JSON.parse(r2.getContentText()).forEach(function(f) {
        if (!vistos[f.titulo]) { vistos[f.titulo] = true; resultados.push(f); }
      });
    } catch(e) {}
  });
  return resultados.slice(0, 6);
}

function agenteCallClaude(prompt, maxTokens) {
  try {
    var r = UrlFetchApp.fetch(ANTHROPIC_API, {
      method: "post",
      contentType: "application/json",
      headers: { "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
      payload: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: maxTokens || 600,
        messages: [{ role: "user", content: prompt }]
      }),
      muteHttpExceptions: true
    });
    var data = JSON.parse(r.getContentText());
    return (data.content || []).map(function(b) { return b.text || ""; }).join("").trim();
  } catch(e) {
    return "Error generando respuesta: " + e.message;
  }
}

// ── FIN AGENTE JURÍDICO ──