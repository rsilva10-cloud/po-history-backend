/**
 * supplierOrderLedgerStore.js
 * ---------------------------
 * A record of purchase orders sent to suppliers whose APIs can't tell us
 * what they already have (LAT: no test mode, no lookup, no cancel). It exists
 * to make "send the same PO twice" impossible, and to leave a trail.
 *
 * The key operation, reserve(), checks for an existing entry and writes the
 * new one inside one synchronous block with no `await` in between — the same
 * technique as salesOrderCounterStore.js. Node runs JavaScript on one thread,
 * so two requests for the same PO cannot interleave inside it: exactly one
 * wins, the other is told the PO is taken. That is a guarantee, not a
 * reduction in odds.
 *
 * Life of an entry:  reserve -> "pending" -> finish -> "sent" | "failed" | "unknown"
 *   pending / sent / unknown  block a new send of that PO number.
 *   failed (LAT definitely refused it) and released (an admin cleared it)
 *   allow the PO number to be tried again.
 *   "unknown" means LAT never answered, so the order MAY exist; only an admin
 *   can resolve it, after checking with the supplier.
 */

const fs = require("fs");
const path = require("path");

const DATA_FILE = process.env.SUPPLIER_ORDER_LEDGER_DATA_FILE || path.join(__dirname, "data", "supplierOrderLedger.json");
const BLOCKING = new Set(["pending", "sent", "unknown"]);
const FINISH_STATUSES = new Set(["sent", "failed", "unknown"]);

const keyOf = (supplier, poNumber) => `${String(supplier).trim().toLowerCase()}|${String(poNumber).trim().toLowerCase()}`;

function read() {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, JSON.stringify({ orders: {} }), "utf8");
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    return parsed && typeof parsed.orders === "object" && parsed.orders ? parsed : { orders: {} };
  } catch {
    // Never silently start over from a damaged file: an empty ledger would let duplicates through.
    throw new Error("The supplier order record is unreadable, so no order can be reserved. Fix or restore the file first.");
  }
}
const write = (data) => fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf8");

function reserve({ supplier, poNumber, placedBy, summary }) {
  const data = read();
  const key = keyOf(supplier, poNumber);
  const existing = data.orders[key];
  if (existing && BLOCKING.has(existing.status)) return { ok: false, existing };
  const now = new Date().toISOString();
  const entry = {
    supplier: String(supplier).trim().toLowerCase(),
    poNumber: String(poNumber).trim(),
    status: "pending",
    placedBy: placedBy || null,
    reservedAt: now,
    finishedAt: null,
    transactionId: null,
    message: null,
    summary: summary || null,
    attempts: (existing ? existing.attempts || 1 : 0) + 1,
    history: [...(existing ? existing.history || [] : []), { at: now, status: "pending", note: existing ? `retry after ${existing.status}` : "reserved" }],
  };
  data.orders[key] = entry;
  write(data);
  return { ok: true, entry };
}

function finish({ supplier, poNumber, status, transactionId, message }) {
  if (!FINISH_STATUSES.has(status)) return { ok: false, code: 400, error: `status must be one of: ${[...FINISH_STATUSES].join(", ")}` };
  const data = read();
  const entry = data.orders[keyOf(supplier, poNumber)];
  if (!entry) return { ok: false, code: 404, error: "No such order record." };
  if (entry.status !== "pending") return { ok: false, code: 409, error: `This order is already marked "${entry.status}".`, entry };
  const now = new Date().toISOString();
  Object.assign(entry, { status, finishedAt: now, transactionId: transactionId || null, message: message || null });
  entry.history.push({ at: now, status, note: message || null });
  write(data);
  return { ok: true, entry };
}

// An admin's decision after checking with the supplier: the order did NOT go
// through ("released": the PO number may be used again) or it DID ("sent").
function resolve({ supplier, poNumber, resolution, by, reason }) {
  if (resolution !== "released" && resolution !== "sent") return { ok: false, code: 400, error: 'resolution must be "released" or "sent".' };
  const data = read();
  const entry = data.orders[keyOf(supplier, poNumber)];
  if (!entry) return { ok: false, code: 404, error: "No such order record." };
  if (entry.status === "sent" && resolution === "released") return { ok: false, code: 409, error: "This order was sent. A sent order can't be released — use a new PO number for a new order.", entry };
  if (entry.status === "released" || (entry.status === "sent" && resolution === "sent")) return { ok: false, code: 409, error: `This order is already "${entry.status}".`, entry };
  const now = new Date().toISOString();
  entry.status = resolution;
  entry.finishedAt = now;
  entry.history.push({ at: now, status: resolution, note: `${by || "admin"}: ${reason || "no reason given"}` });
  write(data);
  return { ok: true, entry };
}

function list(supplier) {
  const s = String(supplier || "").trim().toLowerCase();
  return Object.values(read().orders)
    .filter((o) => !s || o.supplier === s)
    .sort((a, b) => String(b.reservedAt).localeCompare(String(a.reservedAt)));
}

module.exports = { reserve, finish, resolve, list };
