// ===== CONFIG =====
const SHARED_TOKEN = "1111"; // must match what you enter in Progsu's Settings
const SHEET_NAME = "Contacts"; // the tab name that will store the outreach list

// GET requests: check who has already been contacted
function doGet(e) {
  if (e.parameter.token !== SHARED_TOKEN) {
    return jsonResponse({ error: "Unauthorized" });
  }

  const sheet = getSheet();
  const data = sheet.getDataRange().getValues();
  const headers = data[0];

  const rows = data.slice(1).map(function(row) {
    const obj = {};
    headers.forEach(function(h, i) { obj[h] = row[i]; });
    return obj;
  });

  return jsonResponse({ contacts: rows });
}

// POST requests: add a new "already contacted" entry
function doPost(e) {
  const body = JSON.parse(e.postData.contents);

  if (body.token !== SHARED_TOKEN) {
    return jsonResponse({ error: "Unauthorized" });
  }

  const sheet = getSheet();
  sheet.appendRow([body.profileUrl, body.contactedBy, new Date()]);

  return jsonResponse({ success: true });
}

function getSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(["Profile URL", "Contacted By", "Date"]);
  }
  return sheet;
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
function doGet(e) {
  e = e || { parameter: {} }; // fallback so manual Run doesn't crash
  if (e.parameter.token !== SHARED_TOKEN) {
    return jsonResponse({ error: "Unauthorized" });
  }
  // ...
}