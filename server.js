require("dotenv").config();
const express = require("express");
const cors = require("cors");
const ExcelJS = require("exceljs");
const store = require("./store");
const { flattenPOs, toCsv } = require("./exportRows");

const app = express();
app.use(express.json({ limit: "5mb" }));

const allowedOrigins = (process.env.ALLOWED_ORIGINS || "*").split(",").map((s) => s.trim());
app.use(
  cors({
    origin: allowedOrigins.includes("*") ? true : allowedOrigins,
  })
);

app.get("/api/health", (req, res) => {
  res.json({ ok: true, count: store.readAll().length });
});

/* ---------------------------------------------------------
   EXPORT
   IMPORTANT: these must be registered BEFORE /api/pos/:id, or Express
   will match "export.csv"/"export.xlsx" as an :id and 404 instead.
--------------------------------------------------------- */

// Filters POs by their createdAt date (the actual system entry date, not
// the business orderDate) — for finance-style reconciliation exports that
// need "everything entered in this window," regardless of what date was
// typed into the order itself. Compares just the date portion (YYYY-MM-DD)
// so timezone differences on the createdAt timestamp don't cause
// off-by-one exclusions at the boundaries. No from/to = no filtering,
// exactly matching the previous unfiltered behavior.
function filterByDateEntered(pos, from, to) {
  if (!from && !to) return pos;
  return pos.filter((po) => {
    const createdDate = po.createdAt ? po.createdAt.slice(0, 10) : null;
    if (!createdDate) return false; // can't verify it's in-range, so exclude
    if (from && createdDate < from) return false;
    if (to && createdDate > to) return false;
    return true;
  });
}

function exportFilename(base, ext, from, to) {
  if (from || to) {
    return `${base}-${from || "start"}-to-${to || "now"}.${ext}`;
  }
  return `${base}.${ext}`;
}

app.get("/api/pos/export.csv", (req, res) => {
  const { from, to } = req.query;
  const rows = flattenPOs(filterByDateEntered(store.readAll(), from, to));
  const csv = toCsv(rows);
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="${exportFilename("po-history", "csv", from, to)}"`);
  res.send(csv);
});

app.get("/api/pos/export.xlsx", async (req, res) => {
  const { from, to } = req.query;
  const rows = flattenPOs(filterByDateEntered(store.readAll(), from, to));
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet("PO History");

  if (rows.length > 0) {
    const headers = Object.keys(rows[0]);
    sheet.columns = headers.map((h) => ({ header: h, key: h, width: Math.max(12, h.length + 2) }));
    rows.forEach((row) => sheet.addRow(row));
    sheet.getRow(1).font = { bold: true };
  }

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${exportFilename("po-history", "xlsx", from, to)}"`);
  await wb.xlsx.write(res);
  res.end();
});

/* ---------------------------------------------------------
   CRUD
--------------------------------------------------------- */

app.get("/api/pos", (req, res) => {
  res.json(store.readAll());
});

app.get("/api/pos/:id", (req, res) => {
  const po = store.findById(req.params.id);
  if (!po) return res.status(404).json({ error: "Not found" });
  res.json(po);
});

app.post("/api/pos", (req, res) => {
  if (!req.body || !req.body.id) {
    return res.status(400).json({ error: "PO body with an id is required" });
  }
  const record = store.insert(req.body);
  res.status(201).json(record);
});

app.put("/api/pos/:id", (req, res) => {
  const record = store.update(req.params.id, req.body || {});
  if (!record) return res.status(404).json({ error: "Not found" });
  res.json(record);
});

app.delete("/api/pos/:id", (req, res) => {
  const removed = store.remove(req.params.id);
  if (!removed) return res.status(404).json({ error: "Not found" });
  res.status(204).end();
});

const port = process.env.PORT || 3003;
app.listen(port, () => {
  console.log(`PO history backend listening on :${port}`);
});
