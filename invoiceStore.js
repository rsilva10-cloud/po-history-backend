/**
 * invoiceStore.js
 * ---------------
 * Persistent log of every invoice generated through PO Control, separate
 * from the PO records themselves in store.js. Same plain-JSON-file
 * approach as the rest of this backend — see store.js's comment for why
 * that's a deliberate choice at this scale.
 *
 * One record per invoice number. Regenerating the same invoice (clicking
 * "Generate invoice" again on a PO that already has one) upserts the
 * existing record instead of creating a duplicate — so if the order's
 * total or customer changed since the invoice was first generated, the
 * log reflects the latest values rather than accumulating stale copies.
 */

const fs = require("fs");
const path = require("path");

const DATA_FILE = process.env.INVOICE_DATA_FILE || path.join(__dirname, "data", "invoices.json");

function ensureDataFile() {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, "[]", "utf8");
}

function readAll() {
  ensureDataFile();
  const raw = fs.readFileSync(DATA_FILE, "utf8");
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll(invoices) {
  ensureDataFile();
  fs.writeFileSync(DATA_FILE, JSON.stringify(invoices, null, 2), "utf8");
}

function upsert(record) {
  if (!record || !record.invoiceNumber) {
    const err = new Error("invoiceNumber is required");
    err.statusCode = 400;
    throw err;
  }
  const invoices = readAll();
  const idx = invoices.findIndex((inv) => inv.invoiceNumber === record.invoiceNumber);
  const now = new Date().toISOString();

  if (idx === -1) {
    const saved = { ...record, createdAt: now, updatedAt: now };
    invoices.push(saved);
    writeAll(invoices);
    return saved;
  }

  const saved = { ...invoices[idx], ...record, createdAt: invoices[idx].createdAt, updatedAt: now };
  invoices[idx] = saved;
  writeAll(invoices);
  return saved;
}

module.exports = { readAll, upsert };
