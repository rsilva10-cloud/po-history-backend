/**
 * supplierAvailabilityStore.js
 * -----------------------------
 * Stores supplier stock availability (currently: Stanley/Stella) as one
 * shared JSON blob, same read/replace pattern as catalogStore.js.
 *
 * Deliberately separate from inventory/incomingInventory in
 * catalogStore.js: those represent what YOU have on hand or already
 * ordered at YOUR fulfillment warehouses (IL1/NV1). This represents what
 * a SUPPLIER currently has available to sell you — a different question,
 * kept in its own dataset so the two are never confused or silently
 * overwrite each other.
 */

const fs = require("fs");
const path = require("path");

const DATA_FILE = process.env.SUPPLIER_AVAILABILITY_DATA_FILE || path.join(__dirname, "data", "supplierAvailability.json");

function ensureDataFile() {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ bySku: null }), "utf8");
  }
}

function read() {
  ensureDataFile();
  const raw = fs.readFileSync(DATA_FILE, "utf8");
  try {
    return JSON.parse(raw);
  } catch {
    return { bySku: null };
  }
}

function write(data) {
  ensureDataFile();
  fs.writeFileSync(
    DATA_FILE,
    JSON.stringify({ bySku: data.bySku ?? null, updatedAt: new Date().toISOString() }, null, 2),
    "utf8"
  );
  return read();
}

module.exports = { read, write };
