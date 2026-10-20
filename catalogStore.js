/**
 * catalogStore.js
 * ---------------
 * Stores the item catalog + inventory + incoming-inventory as one JSON
 * blob, separate from the POs array in store.js. Unlike POs (individual
 * records with CRUD), the catalog is a single shared document that the
 * whole team edits together — so it's just read/replace, not per-record
 * operations.
 */

const fs = require("fs");
const path = require("path");

const DATA_FILE = process.env.CATALOG_DATA_FILE || path.join(__dirname, "data", "catalog.json");

function ensureDataFile() {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ catalog: null, inventory: null, incomingInventory: null }), "utf8");
  }
}

function read() {
  ensureDataFile();
  const raw = fs.readFileSync(DATA_FILE, "utf8");
  try {
    return JSON.parse(raw);
  } catch {
    return { catalog: null, inventory: null, incomingInventory: null };
  }
}

// Every write gets the next version number. A browser saves with the version it
// loaded (see catalogProtect.putHandler), so a tab holding an old copy is refused
// instead of overwriting newer work. Files written before versions existed count as 0.
const versionOf = (doc) => (doc && Number.isInteger(doc.version) ? doc.version : 0);

function write(data) {
  ensureDataFile();
  let current = null;
  try {
    current = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    current = null;
  }
  fs.writeFileSync(
    DATA_FILE,
    JSON.stringify(
      {
        catalog: data.catalog ?? null,
        inventory: data.inventory ?? null,
        incomingInventory: data.incomingInventory ?? null,
        updatedAt: new Date().toISOString(),
        version: versionOf(current) + 1,
      },
      null,
      2
    ),
    "utf8"
  );
  return read();
}

module.exports = { read, write, versionOf };
