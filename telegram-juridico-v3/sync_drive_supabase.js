// ============================================================
// SYNC DRIVE → SUPABASE v2
// ============================================================

const DRIVE_MD_FOLDER = "1bRaCERhHdwUfA1N12LfOEvtkMv0vKGX4";

function syncDriveASupabase() {
  Logger.log("=== SYNC DRIVE → SUPABASE ===");
  var stats = { procesados: 0, insertados: 0, duplicados: 0, errores: 0 };

  // 1. Obtener títulos existentes en Supabase
  var titulosExistentes = obtenerTitulosSupabase();
  Logger.log("Títulos existentes en Supabase: " + titulosExistentes.length);

  // 2. Listar .md en Drive
  var archivos = listarMdEnDrive(DRIVE_MD_FOLDER);
  Logger.log("Archivos .md en Drive: " + archivos.length);

  // 3. Procesar cada archivo
  for (var i = 0; i < archivos.length; i++) {
    var archivo = archivos[i];
    stats.procesados++;
    try {
      var datos = parsearArchivoMd(archivo);
      if (!datos || !datos.titulo || datos.titulo.length < 5) {
        Logger.log("[SKIP] " + archivo.title + " — sin datos válidos");
        stats.errores++;
        continue;
      }

      // Verificar duplicado
      var esDuplicado = false;
      for (var j = 0; j < titulosExistentes.length; j++) {
        if (titulosExistentes[j] === datos.titulo || titulosExistentes[j] === archivo.viewUrl) {
          esDuplicado = true;
          break;
        }
      }
      if (esDuplicado) {
        Logger.log("[DUP] " + datos.titulo.substring(0, 50));
        stats.duplicados++;
        continue;
      }

      // Insertar en Supabase
      var ok = insertarEnSupabase(datos, archivo.viewUrl);
      if (ok) {
        stats.insertados++;
        titulosExistentes.push(datos.titulo);
        Logger.log("[OK] " + datos.titulo.substring(0, 60));
      } else {
        stats.errores++;
        Logger.log("[ERR] No se pudo insertar: " + datos.titulo.substring(0, 50));
      }

      Utilities.sleep(300);
    } catch(e) {
      stats.errores++;
      Logger.log("[ERROR] " + archivo.title + ": " + e.message);
    }
  }

  Logger.log("=== FIN SYNC ===");
  Logger.log("Procesados: " + stats.procesados + " | Insertados: " + stats.insertados + " | Duplicados: " + stats.duplicados + " | Errores: " + stats.errores);
}

function deduplicarSupabase() {
  Logger.log("=== DEDUPLICANDO SUPABASE ===");
  var tablas = ["jurisprudencia", "doctrina", "modelos"];

  for (var t = 0; t < tablas.length; t++) {
    var tabla = tablas[t];
    try {
      var r = UrlFetchApp.fetch(SB_URL + "/rest/v1/" + tabla + "?select=titulo,id&order=titulo,id.desc&limit=500", {
        headers: { "apikey": SB_KEY, "Authorization": "Bearer " + SB_KEY },
        muteHttpExceptions: true
      });
      var registros = JSON.parse(r.getContentText());
      if (!Array.isArray(registros)) { Logger.log(tabla + ": sin datos"); continue; }

      var visto = {};
      var aEliminar = [];
      for (var i = 0; i < registros.length; i++) {
        var reg = registros[i];
        if (!reg.titulo) continue;
        if (visto[reg.titulo]) {
          aEliminar.push(reg.id);
        } else {
          visto[reg.titulo] = true;
        }
      }

      if (aEliminar.length > 0) {
        Logger.log(tabla + ": eliminando " + aEliminar.length + " duplicados: " + aEliminar.join(", "));
        for (var k = 0; k < aEliminar.length; k++) {
          UrlFetchApp.fetch(SB_URL + "/rest/v1/" + tabla + "?id=eq." + aEliminar[k], {
            method: "delete",
            headers: { "apikey": SB_KEY, "Authorization": "Bearer " + SB_KEY },
            muteHttpExceptions: true
          });
        }
      } else {
        Logger.log(tabla + ": sin duplicados");
      }
    } catch(e) {
      Logger.log("Error deduplicando " + tabla + ": " + e.message);
    }
  }
  Logger.log("=== FIN DEDUPLICACIÓN ===");
}

function instalarTriggerSync() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === "syncDriveASupabase" ||
        triggers[i].getHandlerFunction() === "syncEscritos") {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  ScriptApp.newTrigger("syncDriveASupabase").timeBased().everyHours(6).create();
  ScriptApp.newTrigger("syncEscritos").timeBased().everyHours(6).create();
  Logger.log("Triggers instalados: syncDriveASupabase + syncEscritos cada 6 horas");
}

// ── HELPERS ──

function obtenerTitulosSupabase() {
  var titulos = [];
  var tablas = ["jurisprudencia", "doctrina", "modelos"];
  for (var t = 0; t < tablas.length; t++) {
    try {
      var r = UrlFetchApp.fetch(SB_URL + "/rest/v1/" + tablas[t] + "?select=titulo,DRIVE_URL&limit=500", {
        headers: { "apikey": SB_KEY, "Authorization": "Bearer " + SB_KEY },
        muteHttpExceptions: true
      });
      var data = JSON.parse(r.getContentText());
      if (!Array.isArray(data)) continue;
      for (var i = 0; i < data.length; i++) {
        if (data[i].titulo) titulos.push(data[i].titulo.trim());
        if (data[i].DRIVE_URL) titulos.push(data[i].DRIVE_URL.trim());
        if (data[i].drive_url) titulos.push(data[i].drive_url.trim());
      }
    } catch(e) {
      Logger.log("Error leyendo " + tablas[t] + ": " + e.message);
    }
  }
  return titulos;
}

function listarMdEnDrive(folderId) {
  var archivos = [];
  try {
    var folder = DriveApp.getFolderById(folderId);
    var files = folder.getFilesByType("text/plain");
    while (files.hasNext()) {
      var f = files.next();
      if (f.getName().indexOf(".md") !== -1) {
        try {
          archivos.push({
            id: f.getId(),
            title: f.getName(),
            viewUrl: f.getUrl(),
            content: f.getBlob().getDataAsString("UTF-8")
          });
        } catch(e) {
          Logger.log("Error leyendo archivo " + f.getName() + ": " + e.message);
        }
      }
    }
    // Recursivo en subcarpetas
    var subfolders = folder.getFolders();
    while (subfolders.hasNext()) {
      var sub = subfolders.next();
      var subArchivos = listarMdEnDrive(sub.getId());
      for (var i = 0; i < subArchivos.length; i++) {
        archivos.push(subArchivos[i]);
      }
    }
  } catch(e) {
    Logger.log("Error listando Drive: " + e.message);
  }
  return archivos;
}

function parsearArchivoMd(archivo) {
  var content = archivo.content || "";
  if (!content || content.length < 50) return null;

  // Título: primera línea con # o nombre del archivo
  var titulo = archivo.title.replace(".md", "").replace(/\\_/g, "_").trim();
  var lines = content.split("\n");
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (line.indexOf("# ") === 0) {
      titulo = line.replace(/^#+\s+/, "").replace(/\.pdf$/, "").replace(/\\_/g, "_").replace(/\*\*/g, "").trim();
      break;
    }
  }

  // Resumen: texto limpio sin markdown
  var resumen = content
    .replace(/^#+\s+.+$/mg, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/\[(.+?)\]\(.+?\)/g, "$1")
    .replace(/\\_/g, "_")
    .replace(/\\#/g, "#")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (resumen.length < 30) return null;
  if (resumen.length > 1500) resumen = resumen.substring(0, 1500);

  // Área
  var area = "LABORAL";
  var cl = content.toLowerCase();
  if (cl.indexOf("sucesion") !== -1 || cl.indexOf("herencia") !== -1) area = "SUCESIONES";
  else if (cl.indexOf("divorcio") !== -1 || cl.indexOf("alimentos") !== -1) area = "FAMILIA";
  else if (cl.indexOf("consumidor") !== -1) area = "CONSUMIDOR";

  // Tribunal
  var tribunal = "";
  var tMatch = content.match(/(CNAT|CNTrab|Sala\s+[IVX]+|Cámara Nacional|Tribunal|Juzgado)[^.\n]{0,80}/i);
  if (tMatch) tribunal = tMatch[0].trim().substring(0, 100);

  // Tabla destino
  var tabla = "jurisprudencia";
  var tl = titulo.toLowerCase();
  if (tl.indexOf("modelo") !== -1 || cl.indexOf("modelo de escrito") !== -1) tabla = "modelos";
  else if (tl.indexOf("doctrina") !== -1) tabla = "doctrina";

  return { titulo: titulo, resumen: resumen, area: area, tribunal: tribunal, tabla: tabla };
}

function insertarEnSupabase(datos, driveUrl) {
  try {
    var payload;
    var tabla = datos.tabla || "jurisprudencia";

    if (tabla === "modelos") {
      payload = {
        titulo: datos.titulo,
        descripcion: datos.resumen,
        area: datos.area,
        tipo_escrito: "Modelo",
        drive_url: driveUrl
      };
    } else if (tabla === "doctrina") {
      payload = {
        titulo: datos.titulo,
        descripcion: datos.resumen,
        area: datos.area,
        tipo: "Doctrina",
        drive_url: driveUrl
      };
    } else {
      payload = {
        titulo: datos.titulo,
        tribunal: datos.tribunal || null,
        resumen_doctrina: datos.resumen,
        AREA: datos.area,
        DRIVE_URL: driveUrl
      };
    }

    var r = UrlFetchApp.fetch(SB_URL + "/rest/v1/" + tabla, {
      method: "post",
      headers: {
        "apikey": SB_KEY,
        "Authorization": "Bearer " + SB_KEY,
        "Content-Type": "application/json",
        "Prefer": "return=minimal"
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    var code = r.getResponseCode();
    if (code !== 201) {
      Logger.log("Supabase error " + code + ": " + r.getContentText().substring(0, 100));
    }
    return code === 201;
  } catch(e) {
    Logger.log("insertarEnSupabase error: " + e.message);
    return false;
  }
}

// ============================================================
// SYNC ESCRITOS DE CAUSAS → documentos_causa
// ============================================================

var CARPETAS_ESCRITOS = [
  { expediente_id: "d8d0e5f8-fb2f-449c-939b-35d36c099923", folder_id: "1fy4OLR-D71X8CYmXboaBYrObDCyMHK9D" }
];

function syncEscritos() {
  Logger.log("=== SYNC ESCRITOS → documentos_causa ===");

  var CARPETAS_ESCRITOS = [
    { expediente_id: "d8d0e5f8-fb2f-449c-939b-35d36c099923", folder_id: "1fy4OLR-D71X8CYmXboaBYrObDCyMHK9D" }
  ];
  var BATCH_SIZE = 20;
  var props = PropertiesService.getScriptProperties();

  // Obtener títulos ya cargados
  var r = UrlFetchApp.fetch(SB_URL + "/rest/v1/documentos_causa?select=titulo&limit=500", {
    headers: { "apikey": SB_KEY, "Authorization": "Bearer " + SB_KEY },
    muteHttpExceptions: true
  });
  var existentes = JSON.parse(r.getContentText());
  var titulosExistentes = existentes.map(function(e) { return e.titulo; });

  for (var c = 0; c < CARPETAS_ESCRITOS.length; c++) {
    var config = CARPETAS_ESCRITOS[c];
    var folder = DriveApp.getFolderById(config.folder_id);
    var files = folder.getFiles();

    while (files.hasNext()) {
      var file = files.next();
      var nombre = file.getName();
      var mime = file.getMimeType();
      var esDocx = nombre.indexOf(".docx") !== -1;
      var esGDoc = mime === "application/vnd.google-apps.document";
      if (!esDocx && !esGDoc) continue;

      Logger.log("Archivo: " + nombre);

      // Obtener offset guardado
      var offsetKey = "offset_" + file.getId();
      var offset = parseInt(props.getProperty(offsetKey) || "0");
      Logger.log("Offset actual: " + offset);

      try {
        // Leer contenido
        var contenido;
        if (esDocx) {
          var exportUrl = "https://docs.google.com/feeds/download/documents/export/Export?id=" + file.getId() + "&exportFormat=txt";
          var token = ScriptApp.getOAuthToken();
          var resp = UrlFetchApp.fetch(exportUrl, {
            headers: { "Authorization": "Bearer " + token },
            muteHttpExceptions: true
          });
          contenido = resp.getContentText("UTF-8");
        } else {
          contenido = file.getBlob().getDataAsString("UTF-8");
        }

        // Detectar tipo y versión
        var tipo = "escrito";
        var nl = nombre.toLowerCase();
        if (nl.indexOf("demanda") !== -1) tipo = "demanda";
        else if (nl.indexOf("oficio") !== -1) tipo = "oficio";
        else if (nl.indexOf("pericia") !== -1) tipo = "pericia";
        var version = "";
        var vm = nombre.match(/v(\d+)/i);
        if (vm) version = "v" + vm[1];

        // Generar todos los chunks
        var CHUNK = 3500;
        var allChunks = [];
        for (var i = 0; i < contenido.length; i += CHUNK) {
          allChunks.push(contenido.substring(i, i + CHUNK));
        }
        var total = allChunks.length;
        Logger.log("Total chunks: " + total + " | Procesando desde: " + offset);

        // Procesar batch
        var insertados = 0;
        var fin = Math.min(offset + BATCH_SIZE, total);
        for (var k = offset; k < fin; k++) {
          var tituloChunk = total === 1
            ? nombre.replace(".docx","")
            : nombre.replace(".docx","") + " (parte " + (k+1) + "/" + total + ")";

          var isDup = titulosExistentes.indexOf(tituloChunk) !== -1;
          if (isDup) { Logger.log("[DUP] " + tituloChunk); continue; }

          var payload = {
            expediente_id: config.expediente_id,
            tipo: tipo,
            titulo: tituloChunk,
            contenido: allChunks[k],
            version: version,
            DRIVE_URL: file.getUrl(),
            etiquetas: ["HOLCIM", "RODRIGUEZ"]
          };

          var resp2 = UrlFetchApp.fetch(SB_URL + "/rest/v1/documentos_causa", {
            method: "post",
            headers: {
              "apikey": SB_KEY,
              "Authorization": "Bearer " + SB_KEY,
              "Content-Type": "application/json",
              "Prefer": "return=minimal"
            },
            payload: JSON.stringify(payload),
            muteHttpExceptions: true
          });

          if (resp2.getResponseCode() === 201) {
            titulosExistentes.push(tituloChunk);
            insertados++;
          } else {
            Logger.log("[ERR] " + resp2.getContentText().substring(0,100));
          }
          Utilities.sleep(200);
        }

        // Guardar nuevo offset
        if (fin >= total) {
          props.deleteProperty(offsetKey);
          Logger.log("[COMPLETO] " + nombre + " — " + total + " chunks totales");
        } else {
          props.setProperty(offsetKey, String(fin));
          Logger.log("[PARCIAL] " + nombre + " — insertados " + insertados + " | próximo offset: " + fin + "/" + total);
        }

      } catch(e) {
        Logger.log("[ERROR] " + nombre + ": " + e.message);
      }
    }
  }
  Logger.log("=== FIN SYNC ESCRITOS ===");
}




