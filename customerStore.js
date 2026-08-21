/**
 * customerStore.js
 * ----------------
 * Stores the customer/partner directory as one JSON blob, same pattern as
 * catalogStore.js — a single shared document the whole team adds to, not
 * individual CRUD records like POs.
 */

const fs = require("fs");
const path = require("path");

const DATA_FILE = process.env.CUSTOMER_DATA_FILE || path.join(__dirname, "data", "customers.json");

function ensureDataFile() {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ customers: null }), "utf8");
  }
}

function read() {
  ensureDataFile();
  const raw = fs.readFileSync(DATA_FILE, "utf8");
  try {
    return JSON.parse(raw);
  } catch {
    return { customers: null };
  }
}

function write(data) {
  ensureDataFile();
  fs.writeFileSync(
    DATA_FILE,
    JSON.stringify({ customers: data.customers ?? null, updatedAt: new Date().toISOString() }, null, 2),
    "utf8"
  );
  return read();
}

module.exports = { read, write };
