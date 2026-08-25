require("dotenv").config();
const express = require("express");
const cors = require("cors");
const ExcelJS = require("exceljs");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const store = require("./store");
const catalogStore = require("./catalogStore");
const customerStore = require("./customerStore");
const userStore = require("./userStore");
const { verifyGoogleToken, issueSessionToken, requireAuth, requireAdmin } = require("./auth");
const { flattenPOs, toCsv } = require("./exportRows");

// Customer PO document attachments — stored on the same persistent disk as
// pos.json/catalog.json/customers.json, under data/po-attachments/{poId}/.
// Metadata (original filename, size, upload date) lives on the PO record
// itself (customerPoAttachment field) so the frontend never has to make a
// separate call just to know whether one exists.
const ATTACHMENTS_DIR = process.env.ATTACHMENTS_DIR || path.join(__dirname, "data", "po-attachments");
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(ATTACHMENTS_DIR, req.params.id);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      // Keep a human-readable name on disk too, sanitized against path
      // traversal / weird characters — the ORIGINAL filename (unsanitized)
      // is preserved separately in the PO record for display and download.
      const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-100);
      cb(null, `${Date.now()}-${safe}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB — plenty for a PO document, small enough not to eat the shared disk
});


const app = express();
app.use(express.json({ limit: "5mb" }));

// Defense in depth: Node's default behavior for an unhandled promise
// rejection is to crash the entire process. For a shared team backend,
// that means one overlooked async error anywhere could take down PO
// creation, catalog access, and everything else until Render restarts the
// service. Log and keep running instead — every route handler should
// still have its own try/catch, but this is the safety net if one doesn't.
process.on("unhandledRejection", (err) => {
  console.error("Unhandled rejection (server kept running):", err);
});
process.on("uncaughtException", (err) => {
  console.error("Uncaught exception (server kept running):", err);
});

const allowedOrigins = (process.env.ALLOWED_ORIGINS || "*").split(",").map((s) => s.trim());
app.use(
  cors({
    origin: allowedOrigins.includes("*") ? true : allowedOrigins,
  })
);

app.get("/api/health", (req, res) => {
  res.json({ ok: true, count: store.readAll().length });
});

// Bootstrap problem: the allowlist starts empty, which would mean nobody —
// including whoever's setting this up — could ever log in. If it's still
// empty at startup, seed it from INITIAL_ADMIN_EMAIL + INITIAL_ADMIN_PASSWORD
// (set once in Render's env vars) so there's a way in. After that first
// login, use the in-app "Manage Users" panel to add teammates — this
// bootstrap only ever matters once. Wrapped in an async IIFE since this
// file is CommonJS (no top-level await) and userStore.add now hashes the
// password, which is async.
(async () => {
  if (process.env.INITIAL_ADMIN_EMAIL && process.env.INITIAL_ADMIN_PASSWORD && userStore.readAllPublic().length === 0) {
    await userStore.add(process.env.INITIAL_ADMIN_EMAIL, "Initial admin", process.env.INITIAL_ADMIN_PASSWORD, true);
    console.log(`Seeded initial admin account for ${process.env.INITIAL_ADMIN_EMAIL}`);
  }
})();

/* ---------------------------------------------------------
   AUTH
   Login itself is intentionally NOT behind requireAuth — that would be
   circular. Everything else in this file is.
--------------------------------------------------------- */

app.post("/api/auth/google", async (req, res) => {
  try {
    const { idToken } = req.body || {};
    if (!idToken) return res.status(400).json({ error: "idToken is required" });
    const googleUser = await verifyGoogleToken(idToken);
    const authorized = userStore.findByEmail(googleUser.email);
    if (!authorized) {
      return res.status(403).json({
        error: `${googleUser.email} isn't authorized to use this tool yet. Ask someone already using it to add you under Settings.`,
      });
    }
    const token = issueSessionToken(googleUser);
    res.json({ token, user: googleUser });
  } catch (err) {
    res.status(401).json({ error: err.message || "Google sign-in failed" });
  }
});

// The active login path for now — built ourselves rather than Google
// Sign-In, since that needs IT's involvement in Google Cloud Console
// first. The route above is kept working and ready for whenever that
// happens; switching later won't require touching sessions/permissions at
// all, since those don't care which method proved someone's identity.
app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: "email and password are required" });
    const user = await userStore.verifyPassword(email, password);
    if (!user) return res.status(401).json({ error: "Incorrect email or password" });
    const token = issueSessionToken(user);
    res.json({ token, user });
  } catch (err) {
    res.status(500).json({ error: err.message || "Login failed" });
  }
});

app.get("/api/auth/users", requireAuth, requireAdmin, (req, res) => {
  res.json(userStore.readAllPublic());
});

app.post("/api/auth/users", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { email, name, password, isAdmin } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: "email and password are required" });
    if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" });
    const users = await userStore.add(email, name, password, isAdmin);
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message || "Failed to add user" });
  }
});

app.delete("/api/auth/users/:email", requireAuth, requireAdmin, (req, res) => {
  // Safety net: removing the last admin would lock everyone out of user
  // management entirely, with no way back in short of resetting the
  // whole data file.
  const allUsers = userStore.readAllPublic();
  const target = allUsers.find((u) => u.email.toLowerCase() === req.params.email.toLowerCase());
  const remainingAdmins = allUsers.filter((u) => u.isAdmin && u.email.toLowerCase() !== req.params.email.toLowerCase());
  if (target?.isAdmin && remainingAdmins.length === 0) {
    return res.status(400).json({ error: "Can't remove the last remaining admin" });
  }
  res.json(userStore.remove(req.params.email));
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

app.get("/api/pos/export.csv", requireAuth, (req, res) => {
  const { from, to } = req.query;
  const rows = flattenPOs(filterByDateEntered(store.readAll(), from, to));
  const csv = toCsv(rows);
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="${exportFilename("po-history", "csv", from, to)}"`);
  res.send(csv);
});

app.get("/api/pos/export.xlsx", requireAuth, async (req, res) => {
  try {
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
  } catch (err) {
    // CRITICAL: Express 4 does not auto-catch errors thrown inside async
    // route handlers — an unhandled rejection here would crash the entire
    // process (Node's default behavior), taking down every team member's
    // access until Render restarts the service. Always catch explicitly.
    console.error("Excel export failed:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Excel export failed" });
    } else {
      res.end();
    }
  }
});

/* ---------------------------------------------------------
   CRUD
--------------------------------------------------------- */

app.get("/api/pos", requireAuth, (req, res) => {
  res.json(store.readAll());
});

/* ---------------------------------------------------------
   CATALOG / INVENTORY
   Single shared document, not individual records — the whole team edits
   the same catalog, so this is read/replace rather than CRUD-per-item.
--------------------------------------------------------- */

app.get("/api/catalog", requireAuth, (req, res) => {
  res.json(catalogStore.read());
});

app.put("/api/catalog", requireAuth, (req, res) => {
  const { catalog, inventory, incomingInventory } = req.body || {};
  if (!Array.isArray(catalog)) {
    return res.status(400).json({ error: "catalog (array) is required" });
  }
  const saved = catalogStore.write({ catalog, inventory, incomingInventory });
  res.json(saved);
});

/* ---------------------------------------------------------
   CUSTOMERS / PARTNERS
   Same shared-document pattern as catalog — the whole team adds to and
   reads from one list, not per-record CRUD like POs.
--------------------------------------------------------- */

app.get("/api/customers", requireAuth, (req, res) => {
  res.json(customerStore.read());
});

app.put("/api/customers", requireAuth, (req, res) => {
  const { customers } = req.body || {};
  if (!Array.isArray(customers)) {
    return res.status(400).json({ error: "customers (array) is required" });
  }
  const saved = customerStore.write({ customers });
  res.json(saved);
});

app.get("/api/pos/:id", requireAuth, (req, res) => {
  const po = store.findById(req.params.id);
  if (!po) return res.status(404).json({ error: "Not found" });
  res.json(po);
});

app.post("/api/pos", requireAuth, (req, res) => {
  if (!req.body || !req.body.id) {
    return res.status(400).json({ error: "PO body with an id is required" });
  }
  try {
    const record = store.insert(req.body);
    res.status(201).json(record);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || "Failed to save PO" });
  }
});

app.put("/api/pos/:id", requireAuth, (req, res) => {
  const record = store.update(req.params.id, req.body || {});
  if (!record) return res.status(404).json({ error: "Not found" });
  res.json(record);
});

app.delete("/api/pos/:id", requireAuth, (req, res) => {
  const removed = store.remove(req.params.id);
  if (!removed) return res.status(404).json({ error: "Not found" });
  // Clean up any attached file too, so deleted POs don't leave orphaned
  // files slowly eating the shared disk over time.
  const dir = path.join(ATTACHMENTS_DIR, req.params.id);
  fs.rm(dir, { recursive: true, force: true }, () => {}); // best-effort, don't fail the delete over this
  res.status(204).end();
});

/* ---------------------------------------------------------
   CUSTOMER PO ATTACHMENTS
   One file per PO — uploading a new one replaces the old, matching how
   most people think of "the customer's PO document" as a single thing,
   not a list of versions.
--------------------------------------------------------- */

app.post("/api/pos/:id/attachment", requireAuth, (req, res) => {
  const po = store.findById(req.params.id);
  if (!po) return res.status(404).json({ error: "PO not found" });

  upload.single("file")(req, res, (err) => {
    if (err) {
      const statusCode = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
      return res.status(statusCode).json({ error: err.message || "Upload failed" });
    }
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    // Replacing an existing attachment — remove the old file from disk so
    // it doesn't just sit there unreferenced.
    if (po.customerPoAttachment?.storedAs) {
      const oldPath = path.join(ATTACHMENTS_DIR, req.params.id, po.customerPoAttachment.storedAs);
      fs.rm(oldPath, { force: true }, () => {});
    }

    const attachment = {
      filename: req.file.originalname,
      storedAs: req.file.filename,
      size: req.file.size,
      uploadedAt: new Date().toISOString(),
    };
    const updated = store.update(req.params.id, { ...po, customerPoAttachment: attachment });
    res.json(updated);
  });
});

app.get("/api/pos/:id/attachment", requireAuth, (req, res) => {
  const po = store.findById(req.params.id);
  if (!po || !po.customerPoAttachment) return res.status(404).json({ error: "No attachment found" });
  const filePath = path.join(ATTACHMENTS_DIR, req.params.id, po.customerPoAttachment.storedAs);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: "Attachment file is missing on disk" });
  res.download(filePath, po.customerPoAttachment.filename);
});

app.delete("/api/pos/:id/attachment", requireAuth, (req, res) => {
  const po = store.findById(req.params.id);
  if (!po) return res.status(404).json({ error: "PO not found" });
  if (po.customerPoAttachment?.storedAs) {
    const filePath = path.join(ATTACHMENTS_DIR, req.params.id, po.customerPoAttachment.storedAs);
    fs.rm(filePath, { force: true }, () => {});
  }
  const updated = store.update(req.params.id, { ...po, customerPoAttachment: null });
  res.json(updated);
});

const port = process.env.PORT || 3003;
app.listen(port, () => {
  console.log(`PO history backend listening on :${port}`);
});
