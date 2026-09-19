// @ts-nocheck
// ============================================================
// SYNC CAUSAS NOTION → SUPABASE EXPEDIENTES — v1 (19/09/2026)
// ============================================================
// PROBLEMA QUE RESUELVE: la base "CAUSAS" de Notion es donde se
// trabaja cada causa con Claude, pero la tabla `expedientes` de
// Supabase (la que alimenta el desplegable del Motor Jurisprudencial)
// no tenía ningún puente automático — cargar una causa nueva ahí
// dependía de que alguien se acordara de pedirlo a mano. Pasó de
// verdad con "Salto-Cardoso" y "Rossi-Castillo" (quedaron listas en
// Notion pero tardaron en llegar a Supabase) y de nuevo con
// "PÉREZ c/ ACEVEDO" (agregada el 16/09, todavía sin cargar el 19/09
// cuando se escribió este archivo).
//
// QUÉ HACE: cada 6 horas (ver crearTriggerSyncCausas), lee todas las
// filas de la base CAUSAS de Notion y las compara contra `expedientes`
// por `numero_expediente` (campo EXPEDIENTE en Notion). Si encuentra
// una causa en Notion que todavía no tiene fila en Supabase, la
// inserta. NUNCA actualiza ni borra una fila existente — así no pisa
// ediciones manuales hechas directo en Supabase (ej. link_drive_carpeta,
// que hoy no tiene equivalente en la base de Notion). Si cargó algo
// nuevo, avisa por Telegram.
//
// SETUP (una sola vez):
// 1. En notion.so/profile/integrations, crear una integración interna
//    (o reusar el "Notion Token" que ya figura en AYUDA MEMORIA) y
//    copiar el token ("secret_..." o "ntn_...").
// 2. En Apps Script → Project Settings → Script Properties → agregar
//    NOTION_TOKEN con ese valor.
// 3. En Notion, abrir la base CAUSAS → "..." → Connections → conectar
//    esa misma integración (si no, la API devuelve 404 aunque el token
//    sea válido — Notion exige compartir cada base explícitamente).
// 4. Correr crearTriggerSyncCausas() UNA vez desde el editor (Run).
// ============================================================

var NOTION_CAUSAS_DB_ID = "34db730571b480d4a91fe0411a50f5bc";

function syncCausasNotionASupabase() {
  try {
    var notionToken = PROPS.getProperty("NOTION_TOKEN");
    if (!notionToken) {
      Logger.log("syncCausasNotionASupabase: falta NOTION_TOKEN en Script Properties — ver setup al principio de este archivo.");
      return;
    }

    var causasNotion = obtenerCausasNotion(notionToken);
    if (!causasNotion.length) {
      Logger.log("syncCausasNotionASupabase: 0 causas leídas de Notion (o hubo un error — ver log de obtenerCausasNotion).");
      return;
    }

    var existentesRes = UrlFetchApp.fetch(
      SB_URL + "/rest/v1/expedientes?select=numero_expediente",
      { headers: { "apikey": SB_KEY, "Authorization": "Bearer " + SB_KEY }, muteHttpExceptions: true }
    );
    var existentes = parseJsonSafe(existentesRes.getContentText(), []);
    var numerosExistentes = {};
    (existentes || []).forEach(function(f) {
      if (f.numero_expediente) numerosExistentes[String(f.numero_expediente).trim()] = true;
    });

    var nuevas = [];
    causasNotion.forEach(function(c) {
      if (numerosExistentes[c.numero_expediente.trim()]) return;

      var payload = JSON.stringify({
        numero_expediente: c.numero_expediente,
        caratula: c.caratula,
        fuero_juzgado: c.fuero_juzgado,
        estado: c.estado,
        materia: c.materia,
        observaciones: c.observaciones,
        link_notion_pagina: c.url
      });
      var insertRes = UrlFetchApp.fetch(SB_URL + "/rest/v1/expedientes", {
        method: "post",
        headers: { "apikey": SB_KEY, "Authorization": "Bearer " + SB_KEY, "Content-Type": "application/json" },
        payload: payload,
        muteHttpExceptions: true
      });
      if (insertRes.getResponseCode() === 201) {
        nuevas.push(c.caratula || c.numero_expediente);
        Logger.log("syncCausasNotionASupabase: cargada " + c.numero_expediente + " — " + c.caratula);
      } else {
        Logger.log("syncCausasNotionASupabase: error insertando " + c.numero_expediente + " — code=" + insertRes.getResponseCode() + " body=" + insertRes.getContentText().substring(0, 300));
      }
    });

    if (nuevas.length > 0) {
      sendMessage(CHAT_ID_ALERTAS,
        "📂 <b>" + nuevas.length + " causa(s) nueva(s) cargada(s) automáticamente en Supabase</b>\n\n" +
        nuevas.map(function(n) { return "• " + escaparHTML(n); }).join("\n") +
        "\n\nYa aparecen en el desplegable del Motor Jurisprudencial.");
    }
  } catch (err) {
    Logger.log("syncCausasNotionASupabase: excepción — " + err.message + " | stack: " + err.stack);
  }
}

// Lee la base CAUSAS de Notion y devuelve solo las filas con causa real
// (con Nombre Y número de EXPEDIENTE cargados — descarta filas vacías o
// causas todavía en preparación sin expediente asignado).
function obtenerCausasNotion(notionToken) {
  var causas = [];
  var res = UrlFetchApp.fetch("https://api.notion.com/v1/databases/" + NOTION_CAUSAS_DB_ID + "/query", {
    method: "post",
    headers: {
      "Authorization": "Bearer " + notionToken,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json"
    },
    payload: JSON.stringify({ page_size: 100 }),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) {
    Logger.log("obtenerCausasNotion: error HTTP " + res.getResponseCode() + " — " + res.getContentText().substring(0, 300) + " (¿la integración está conectada a la base CAUSAS en Notion? Ver setup arriba.)");
    return causas;
  }
  var data = parseJsonSafe(res.getContentText(), null);
  if (!data || !Array.isArray(data.results)) return causas;

  data.results.forEach(function(page) {
    var p = page.properties || {};
    var nombre = notionTextDe(p["Nombre"]);
    var expediente = notionTextDe(p["EXPEDIENTE"]);
    if (!nombre || !expediente) return;

    var fuero = (p["FUERO"] && p["FUERO"].select) ? p["FUERO"].select.name : "";
    var juzgado = notionTextDe(p["JUZGADO"]);
    var estadoSel = (p["ESTADO"] && p["ESTADO"].select) ? p["ESTADO"].select.name : "";
    var estrategia = notionTextDe(p["ESTRATEGIA DEFINIDA"]);
    var datosBase = notionTextDe(p["DATOS BASE"]);
    var actorNombre = notionTextDe(p["ACTOR — Nombre"]) || notionTextDe(p["ACTOR - Nombre"]);

    var observaciones = [
      actorNombre ? "Actor/es: " + actorNombre : "",
      datosBase ? "Datos base: " + datosBase : "",
      estrategia ? "Estrategia: " + estrategia : ""
    ].filter(function(s) { return s; }).join("\n\n");

    causas.push({
      numero_expediente: expediente,
      caratula: nombre,
      fuero_juzgado: juzgado,
      estado: estadoSel || "En proceso",
      materia: fuero,
      observaciones: observaciones,
      url: page.url
    });
  });
  return causas;
}

// Extrae el texto plano de una propiedad "title" o "rich_text" de la
// API de Notion (son arrays de "text runs" — hay que concatenarlos).
function notionTextDe(prop) {
  if (!prop) return "";
  var arr = prop.title || prop.rich_text;
  if (!Array.isArray(arr)) return "";
  return arr.map(function(t) { return t.plain_text || ""; }).join("").trim();
}

function crearTriggerSyncCausas() {
  asegurarTriggerUnico("syncCausasNotionASupabase", { everyMinutes: 360 });
  Logger.log("✅ Trigger de syncCausasNotionASupabase creado (cada 6 horas).");
}
