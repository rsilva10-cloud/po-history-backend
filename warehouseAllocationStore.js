/**
 * warehouseAllocationStore.js
 * ---------------------------
 * Stores historical per-SKU warehouse allocation data (SKU + warehouse +
 * total units) as one shared JSON blob, same read/replace pattern as
 * catalogStore.js/customerStore.js/historicalDemandStore.js.
 *
 * Feeds the Reorder Forecast's warehouse split: for a SKU covered by this
 * data, the forecast splits its total projected demand by historical
 * warehouse share here, rather than by however recent live orders happen
 * to be tagged. Separate from historicalDemandStore.js (which drives the
 * seasonal pattern, not the warehouse split) and from store.js (live POs)
 * — this should never appear as a real order anywhere else in the app.
 */

const fs = require("fs");
const path = require("path");

const DATA_FILE = process.env.WAREHOUSE_ALLOCATION_DATA_FILE || path.join(__dirname, "data", "warehouseAllocation.json");

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
