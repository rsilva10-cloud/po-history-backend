/**
 * store.js
 * --------
 * Simple JSON-file-backed storage for purchase order history. No database
 * server, no native compiled dependencies \u2014 just a file on disk. Good
 * enough for a small team's internal tool; read/write is synchronous and
 * whole-file, which is fine at this scale but won't hold up under heavy
 * concurrent write load.
 *
 * IMPORTANT: see the README for a note on disk persistence when deploying
 * to platforms with ephemeral filesystems (e.g. Render's free tier).
 */

const fs = require("fs");
const path = require("path");

const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, "data", "pos.json");

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

function writeAll(pos) {
  ensureDataFile();
  fs.writeFileSync(DATA_FILE, JSON.stringify(pos, null, 2), "utf8");
}

function findById(id) {
  return readAll().find((p) => p.id === id) || null;
}

function insert(po) {
  const pos = readAll();
  // Defense in depth against the id-collision bug that caused real
  // duplicate/cross-contaminated records: reject rather than silently
  // push a second entry sharing an id that's already in use. With the
  // frontend now generating collision-proof ids, this should never
  // actually trigger — but if it somehow does, failing loudly here beats
  // quietly corrupting the data again.
  if (pos.some((p) => p.id === po.id)) {
    const err = new Error(`A PO with id "${po.id}" already exists`);
    err.statusCode = 409;
    throw err;
  }
  const now = new Date().toISOString();
  const record = { ...po, createdAt: now, updatedAt: now };
  pos.push(record);
  writeAll(pos);
  return record;
}

function update(id, po) {
  const pos = readAll();
  const idx = pos.findIndex((p) => p.id === id);
  if (idx === -1) return null;
  const record = { ...po, id, createdAt: pos[idx].createdAt, updatedAt: new Date().toISOString() };
  pos[idx] = record;
  writeAll(pos);
  return record;
}

function remove(id) {
  const pos = readAll();
  const filtered = pos.filter((p) => p.id !== id);
  const removed = filtered.length !== pos.length;
  writeAll(filtered);
  return removed;
}

module.exports = { readAll, findById, insert, update, remove };
