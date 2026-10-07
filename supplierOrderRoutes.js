/**
 * supplierOrderRoutes.js
 * ----------------------
 * HTTP side of supplierOrderLedgerStore. server.js adds one line:
 *   require("./supplierOrderRoutes").mount(app, { requireAuth, requireAdmin });
 * Kept in its own file so it can be tested without the rest of the server.
 */
const ledger = require("./supplierOrderLedgerStore");

const SUPPLIER = /^[a-z0-9-]{2,20}$/;
const bad = (res, error, code = 400) => res.status(code).json({ error });

function mount(app, { requireAuth, requireAdmin }) {
  // Reserve a PO number BEFORE sending it. 409 = already taken (nothing should be sent).
  app.post("/api/supplier-orders/reserve", requireAuth, (req, res) => {
    const { supplier, poNumber, placedBy, summary } = req.body || {};
    if (!SUPPLIER.test(String(supplier || ""))) return bad(res, "supplier is required (letters, numbers, dashes).");
    if (!String(poNumber || "").trim() || String(poNumber).length > 64) return bad(res, "poNumber is required (64 characters at most).");
    try {
      const r = ledger.reserve({ supplier, poNumber, placedBy: placedBy || (req.user && req.user.email) || null, summary });
      if (!r.ok) return res.status(409).json({ error: `PO ${String(poNumber).trim()} is already ${r.existing.status === "sent" ? "sent" : r.existing.status}.`, existing: r.existing });
      res.json({ entry: r.entry });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Record what happened: sent / failed / unknown.
  app.post("/api/supplier-orders/finish", requireAuth, (req, res) => {
    const { supplier, poNumber, status, transactionId, message } = req.body || {};
    if (!SUPPLIER.test(String(supplier || "")) || !String(poNumber || "").trim()) return bad(res, "supplier and poNumber are required.");
    try {
      const r = ledger.finish({ supplier, poNumber, status, transactionId, message: message ? String(message).slice(0, 1000) : null });
      if (!r.ok) return res.status(r.code).json({ error: r.error, ...(r.entry ? { entry: r.entry } : {}) });
      res.json({ entry: r.entry });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/supplier-orders", requireAuth, (req, res) => {
    try {
      res.json({ orders: ledger.list(req.query.supplier) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Admin only: settle an order stuck as pending/unknown, after checking with the supplier.
  app.post("/api/supplier-orders/resolve", requireAuth, requireAdmin, (req, res) => {
    const { supplier, poNumber, resolution, reason } = req.body || {};
    if (!SUPPLIER.test(String(supplier || "")) || !String(poNumber || "").trim()) return bad(res, "supplier and poNumber are required.");
    if (!String(reason || "").trim()) return bad(res, "Say why (e.g. \"LAT confirmed they never received it\").");
    try {
      const r = ledger.resolve({ supplier, poNumber, resolution, by: req.user && req.user.email, reason: String(reason).slice(0, 500) });
      if (!r.ok) return res.status(r.code).json({ error: r.error, ...(r.entry ? { entry: r.entry } : {}) });
      res.json({ entry: r.entry });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}

module.exports = { mount };
