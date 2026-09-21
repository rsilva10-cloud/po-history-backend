/**
 * historicalDemandStore.js
 * ------------------------
 * Stores historical monthly sales-volume data (SKU + year + month + units
 * sold) as one shared JSON blob, same read/replace pattern as
 * catalogStore.js and customerStore.js — the whole team uploads to and
 * reads from one shared dataset, not per-record CRUD like POs.
 *
 * Deliberately separate from store.js (live Purchase Orders): this data
 * represents historical demand from an outside system (e.g. end-consumer
 * order volume), imported purely to compute a seasonal adjustment for the
 * Reorder Forecast. It should never appear as a real order anywhere else
 * in the app.
 */

const fs = require("fs");
const path = require("path");

const DATA_FILE = process.env.HISTORICAL_DEMAND_DATA_FILE || path.join(__dirname, "data", "historicalDemand.json");

function ensureDataFile() {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ rows: null }), "utf8");
  }
}

function read() {
  ensureDataFile();
  const raw = fs.readFileSync(DATA_FILE, "utf8");
  try {
    return JSON.parse(raw);
  } catch {
    return { rows: null };
  }
}

function write(data) {
  ensureDataFile();
  fs.writeFileSync(
    DATA_FILE,
    JSON.stringify({ rows: data.rows ?? null, updatedAt: new Date().toISOString() }, null, 2),
    "utf8"
  );
  return read();
}

module.exports = { read, write };
