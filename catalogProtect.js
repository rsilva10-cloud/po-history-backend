/**
 * catalogProtect.js
 * -----------------
 * A safety net around the shared Item Catalog, which the whole team edits as ONE document that every
 * save replaces. Three protections:
 *
 *  1. AUTOMATIC BACKUPS. Before a save overwrites the stored catalog, a copy of what is there is kept
 *     (at most one every 15 minutes, or at once when a save changes 5+ items), in
 *     <data folder>/catalog-backups on the same disk as catalog.json. The newest 40 are kept, plus the newest
 *     of each of the last 30 days. Manual backups and pre-restore copies are kept for 90 days.
 *  2. A SHRINK GUARD. A save that would cut a catalog of 50+ items to under 60% of its size is REFUSED (409)
 *     unless the request says allowShrink. This is what stops a stale or default catalog from silently
 *     replacing the real one. A copy of the real catalog is kept when it triggers.
 *  3. RESTORE. List, download, and (admin only) restore any backup. Restoring first keeps a copy of the
 *     catalog it replaces, so a restore can itself be undone.
 *
 * server.js: replace the PUT /api/catalog handler with catalogProtect.putHandler(catalogStore) and add
 *   catalogProtect.mount(app, { requireAuth, requireAdmin, catalogStore });
 */
const fs = require("fs");
const path = require("path");

const backupDir = () => process.env.CATALOG_BACKUP_DIR || path.join(__dirname, "data", "catalog-backups");
const MIN_GAP_MS = 15 * 60 * 1000;
const KEEP_NEWEST = 40;
const KEEP_DAYS = 30;
const KEEP_SPECIAL_DAYS = 90;
const AUTO_CHANGE_ITEMS = 5;
const SHRINK_FLOOR = 50;
const SHRINK_RATIO = 0.6;
const FILE_RE = /^catalog_(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)_([a-z-]+)_n(\d+)\.json$/;
const stampToIso = (s) => s.replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, "T$1:$2:$3.$4Z");
const isoToStamp = (iso) => iso.replace(/[:.]/g, "-");

function list() {
  const dir = backupDir();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .map((id) => {
      const m = FILE_RE.exec(id);
      return m ? { id, savedAt: stampToIso(m[1]), reason: m[2], items: Number(m[3]) } : null;
    })
    .filter(Boolean)
    .sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1));
}

function prune(now = Date.now()) {
  const all = list();
  const keep = new Set(all.slice(0, KEEP_NEWEST).map((b) => b.id));
  const seenDay = new Set();
  all.forEach((b) => {
    const age = now - Date.parse(b.savedAt);
    if (b.reason !== "auto") {
      if (age <= KEEP_SPECIAL_DAYS * 86400000) keep.add(b.id); // manual / before-restore / before-blocked-save
      return;
    }
    const day = b.savedAt.slice(0, 10);
    if (!seenDay.has(day) && age <= KEEP_DAYS * 86400000) {
      seenDay.add(day);
      keep.add(b.id);
    }
  });
  all.filter((b) => !keep.has(b.id)).forEach((b) => fs.unlinkSync(path.join(backupDir(), b.id)));
}

function snapshot(doc, reason, now = Date.now()) {
  const items = Array.isArray(doc && doc.catalog) ? doc.catalog.length : 0;
  const dir = backupDir();
  fs.mkdirSync(dir, { recursive: true });
  const savedAt = new Date(now).toISOString();
  const id = `catalog_${isoToStamp(savedAt)}_${reason}_n${items}.json`;
  const tmp = path.join(dir, `${id}.${process.pid}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify({ savedAt, reason, items, doc: { catalog: doc.catalog, inventory: doc.inventory, incomingInventory: doc.incomingInventory } }), "utf8");
  fs.renameSync(tmp, path.join(dir, id));
  prune(now);
  return { id, savedAt, reason, items };
}

// Back up the catalog that is about to be replaced, if it is time or if this save changes a lot.
function snapshotIfDue(before, newCount, now = Date.now()) {
  const last = list()[0];
  const changed = Math.abs(newCount - (before.catalog || []).length) >= AUTO_CHANGE_ITEMS;
  if (!last || changed || now - Date.parse(last.savedAt) >= MIN_GAP_MS) return snapshot(before, "auto", now);
  return null;
}

function readBackup(id) {
  if (!FILE_RE.test(id || "")) return null; // only our own file names: no paths, no traversal
  const file = path.join(backupDir(), id);
  if (!fs.existsSync(file)) return null;
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  return parsed && parsed.doc && Array.isArray(parsed.doc.catalog) ? parsed : null;
}

function putHandler(catalogStore) {
  return (req, res) => {
    try {
      const { catalog, inventory, incomingInventory, allowShrink } = req.body || {};
      if (!Array.isArray(catalog)) return res.status(400).json({ error: "catalog (array) is required" });
      let before = null;
      try {
        before = catalogStore.read();
      } catch {
        before = null; // an unreadable stored file can't be backed up, and shouldn't block a good save
      }
      const beforeCount = before && Array.isArray(before.catalog) ? before.catalog.length : 0;
      if (allowShrink !== true && beforeCount >= SHRINK_FLOOR && catalog.length < beforeCount * SHRINK_RATIO) {
        snapshot(before, "before-blocked-save");
        return res.status(409).json({
          code: "CATALOG_SHRINK",
          error: `Refused to save: this would shrink the catalog from ${beforeCount} items to ${catalog.length}. That usually means the app is holding an out-of-date copy. Reload the page; if you really mean to remove that many items, say so and it will go through. A copy of the current catalog was kept.`,
        });
      }
      if (beforeCount > 0) snapshotIfDue(before, catalog.length);
      res.json(catalogStore.write({ catalog, inventory, incomingInventory }));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  };
}

function mount(app, { requireAuth, requireAdmin, catalogStore }) {
  app.get("/api/catalog/backups", requireAuth, (req, res) => {
    try {
      res.json({ dir: backupDir(), backups: list() });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/catalog/backups", requireAuth, (req, res) => {
    try {
      const current = catalogStore.read();
      if (!current || !Array.isArray(current.catalog) || current.catalog.length === 0) return res.status(400).json({ error: "There is no saved catalog to back up yet." });
      res.json(snapshot(current, "manual"));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/catalog/backups/:id", requireAuth, (req, res) => {
    try {
      const b = readBackup(req.params.id);
      if (!b) return res.status(404).json({ error: "Backup not found." });
      res.json(b);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/catalog/backups/:id/restore", requireAuth, requireAdmin, (req, res) => {
    try {
      const b = readBackup(req.params.id);
      if (!b) return res.status(404).json({ error: "Backup not found." });
      let current = null;
      try {
        current = catalogStore.read();
      } catch {
        current = null;
      }
      if (current && Array.isArray(current.catalog) && current.catalog.length > 0) snapshot(current, "before-restore");
      catalogStore.write({ catalog: b.doc.catalog, inventory: b.doc.inventory, incomingInventory: b.doc.incomingInventory });
      res.json({ restored: req.params.id, items: b.doc.catalog.length, doc: b.doc });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}

module.exports = { putHandler, mount, snapshot, snapshotIfDue, list, prune, readBackup, backupDir };
