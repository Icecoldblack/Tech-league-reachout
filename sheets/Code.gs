// ===== tech league team sheet backend =====
//
// A small JSON API over one Google Sheet tab. Paste this whole file into
// Extensions > Apps Script on the spreadsheet, then Deploy > New deployment
// > Web app with "Execute as: Me" and "Who has access: Anyone".
//
// "Anyone" is required: the extension calls this without a Google login, so
// anything stricter serves a sign-in page instead of data. SHARED_TOKEN is
// what actually gates access.
//
// Every response is JSON with an `ok` flag, including failures, which come
// back with HTTP 200 rather than an error status — background/sheets.js
// parses the body and never sees a status code it could branch on.

// ===== CONFIG =====
var SHARED_TOKEN = "1111"; // must match the Shared Token in Progsu's Settings
var SHEET_NAME = "Outreach";
var HEADERS = [
  "Profile URL",
  "Name",
  "Date Contacted",
  "Contacted By",
  "Template Used",
  "Last Updated"
];

// ---- Entry points -------------------------------------------------

function doGet(e) {
  return handle((e && e.parameter) || {});
}

function doPost(e) {
  var params = {};
  try {
    // The extension posts text/plain to dodge a CORS preflight, so the body
    // is JSON despite the content type.
    if (e && e.postData && e.postData.contents) {
      params = JSON.parse(e.postData.contents) || {};
    }
  } catch (err) {
    return jsonResponse({ ok: false, error: "Body was not valid JSON" });
  }
  return handle(params);
}

/**
 * One router for both verbs. Anything that throws past here would be served
 * as an HTML error page, which the extension cannot parse, so the whole body
 * is wrapped and reported as JSON instead.
 */
function handle(params) {
  try {
    if (String(params.token || "") !== SHARED_TOKEN) {
      return jsonResponse({ ok: false, error: "Bad or missing token" });
    }

    switch (String(params.action || "")) {
      case "ping":   return jsonResponse(actionPing());
      case "list":   return jsonResponse(actionList(params.since));
      case "check":  return jsonResponse(actionCheck(params.profileUrl));
      case "mark":   return jsonResponse(actionMark(params));
      case "bulk":   return jsonResponse(actionBulk(params.entries));
      case "remove": return jsonResponse(actionRemove(params.profileUrl));
      default:
        return jsonResponse({ ok: false, error: "Unknown action: " + params.action });
    }
  } catch (err) {
    return jsonResponse({ ok: false, error: String((err && err.message) || err) });
  }
}

// ---- Actions ------------------------------------------------------

function actionPing() {
  var sheet = getSheet();
  return {
    ok: true,
    action: "ping",
    sheet: SHEET_NAME,
    rows: Math.max(0, sheet.getLastRow() - 1)
  };
}

/** `since` is an ISO timestamp filtering on Last Updated; omit for everything. */
function actionList(since) {
  var cutoff = since ? new Date(since).getTime() : NaN;
  var entries = {};

  readRows().forEach(function (row) {
    if (!isNaN(cutoff)) {
      var updated = toTime(row.lastUpdated);
      if (!isNaN(updated) && updated < cutoff) return;
    }
    entries[row.key] = toEntry(row);
  });

  return { ok: true, entries: entries };
}

function actionCheck(profileUrl) {
  var key = normalizeUrl(profileUrl);
  if (!key) return { ok: false, error: "Missing profileUrl" };

  var found = findRow(key);
  return found
    ? { ok: true, contacted: true, entry: toEntry(found) }
    : { ok: true, contacted: false };
}

/**
 * First writer wins: a repeat leaves the original row untouched and reports
 * who got there first, so a later duplicate can never overwrite the record
 * of who actually made contact.
 */
function actionMark(params) {
  var key = normalizeUrl(params.profileUrl);
  if (!key) return { ok: false, error: "Missing profileUrl" };

  return withLock(function () {
    var existing = findRow(key);
    if (existing) {
      return { ok: true, duplicate: true, entry: toEntry(existing) };
    }

    var entry = appendEntry(getSheet(), key, params);
    return { ok: true, duplicate: false, entry: entry };
  });
}

/** Same first-writer-wins rule per row. Powers "Upload My List". */
function actionBulk(entries) {
  if (!entries || typeof entries !== "object") {
    return { ok: false, error: "Missing entries" };
  }

  return withLock(function () {
    var sheet = getSheet();
    var seen = existingKeys();
    var added = 0;
    var skipped = 0;

    Object.keys(entries).forEach(function (url) {
      var key = normalizeUrl(url);
      if (!key) return;
      if (seen[key]) { skipped++; return; }

      appendEntry(sheet, key, entries[url] || {});
      seen[key] = true;
      added++;
    });

    return { ok: true, added: added, skipped: skipped };
  });
}

/** Deleting a row unblocks that person for the whole team. */
function actionRemove(profileUrl) {
  var key = normalizeUrl(profileUrl);
  if (!key) return { ok: false, error: "Missing profileUrl" };

  return withLock(function () {
    var found = findRow(key);
    if (!found) return { ok: true, removed: false };

    getSheet().deleteRow(found.rowNumber);
    return { ok: true, removed: true };
  });
}

// ---- Sheet access -------------------------------------------------

function getSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
  } else if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/** Every data row, normalized, with its 1-based sheet row number. */
function readRows() {
  var sheet = getSheet();
  if (sheet.getLastRow() < 2) return [];

  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, HEADERS.length).getValues();

  return values.reduce(function (acc, row, i) {
    var key = normalizeUrl(row[0]);
    if (!key) return acc; // blank or hand-mangled row
    acc.push({
      key: key,
      name: row[1],
      dateContacted: row[2],
      contactedBy: row[3],
      templateUsed: row[4],
      lastUpdated: row[5],
      rowNumber: i + 2
    });
    return acc;
  }, []);
}

function findRow(key) {
  var rows = readRows();
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].key === key) return rows[i];
  }
  return null;
}

function existingKeys() {
  var seen = {};
  readRows().forEach(function (row) { seen[row.key] = true; });
  return seen;
}

function appendEntry(sheet, key, source) {
  var now = new Date().toISOString();
  var entry = {
    name: String((source && source.name) || "Unknown"),
    dateSent: toIso((source && source.dateSent) || "") || now,
    sentBy: String((source && source.sentBy) || "Unknown"),
    templateUsed: String((source && source.templateUsed) || "Unknown")
  };

  sheet.appendRow([
    key,
    entry.name,
    entry.dateSent,
    entry.sentBy,
    entry.templateUsed,
    now
  ]);

  return entry;
}

/**
 * Writes run under a script lock so two simultaneous marks produce one row,
 * not two — the check and the append have to be atomic together.
 */
function withLock(fn) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
  } catch (err) {
    return { ok: false, error: "Sheet was busy — try again" };
  }
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

// ---- Shape --------------------------------------------------------

/** The record shape normalizeEntry() in background/sheets.js expects. */
function toEntry(row) {
  return {
    name: String(row.name || "Unknown"),
    dateSent: toIso(row.dateContacted) || "",
    sentBy: String(row.contactedBy || "Unknown"),
    templateUsed: String(row.templateUsed || "Unknown")
  };
}

/**
 * The primary key of the whole database. Has to stay in step with
 * normalizeKey() in background/sheets.js and normalizeProfileUrl() in
 * content/content.js, or the same person ends up with two rows and
 * neither one blocks the other.
 */
function normalizeUrl(url) {
  // Deliberately matched against the untrimmed string, exactly as
  // normalizeKey() does: trimming first would make this side disagree with
  // the extension on a URL with trailing whitespace, and a key the two sides
  // derive differently is two rows for one person.
  var raw = String(url || "");
  var m = raw.match(/linkedin\.com\/in\/([^/?#]+)/i);
  if (m) {
    return "https://www.linkedin.com/in/" + decodeURIComponent(m[1]).toLowerCase();
  }
  var s = raw.trim();
  return s ? s.toLowerCase() : "";
}

/** Sheets hands back Date objects for date-formatted cells, strings otherwise. */
function toIso(value) {
  if (value instanceof Date) return value.toISOString();
  var s = String(value == null ? "" : value).trim();
  if (!s) return "";
  var t = Date.parse(s);
  return isNaN(t) ? s : new Date(t).toISOString();
}

function toTime(value) {
  if (value instanceof Date) return value.getTime();
  return Date.parse(String(value == null ? "" : value).trim());
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
