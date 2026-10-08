/**
 * demandHistoryStore.js
 * ---------------------
 * The weekly units-shipped history behind the Reorder Forecast: one shared
 * document, replaced whole on import (same read/replace pattern as the other
 * shared datasets), but with three differences:
 *   - it is checked strictly on the way in, because a bad history quietly
 *     corrupts every forecast built on it;
 *   - it is written atomically (temp file, then rename), so a crash mid-write
 *     can't leave half a file;
 *   - a damaged file is reported, never silently treated as "no history".
 *
 * Shape: { version: 1, through: "YYYY-MM-DD", channels: [4 names],
 *          rows: [[skuNumber, weekStartMonday, channelIndex, units], ...],
 *          moveIn?: [envelope SKU numbers], moveInFrom?: "YYYY-MM-DD" (envelope history before this is incomplete and ignored), leadTimes?: { default: [median, p90], bySku: { sku: [median, p90, receipts] } } }
 */
const fs = require("fs");
const path = require("path");

const DATA_FILE = process.env.DEMAND_HISTORY_DATA_FILE || path.join(__dirname, "data", "demandHistory.json");
const MAX_ROWS = 500000;
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s));

// Returns an error message, or null when the history is acceptable.
function validate(h) {
  if (!h || typeof h !== "object") return "history is required.";
  if (h.version !== 1) return "history.version must be 1.";
  if (!isDate(h.through)) return "history.through must be a date (YYYY-MM-DD).";
  if (!Array.isArray(h.channels) || h.channels.length !== 4) return "history.channels must list 4 channel names.";
  if (!Array.isArray(h.rows) || h.rows.length === 0) return "history.rows must be a non-empty array.";
  if (h.rows.length > MAX_ROWS) return `history.rows is too large (${MAX_ROWS.toLocaleString()} rows at most).`;
  for (let i = 0; i < h.rows.length; i++) {
    const r = h.rows[i];
    if (!Array.isArray(r) || r.length !== 4 || !Number.isFinite(Number(r[0])) || !isDate(r[1]) || ![0, 1, 2, 3].includes(Number(r[2])) || !Number.isFinite(Number(r[3])) || Number(r[3]) < 0) {
      return `Row ${i + 1} is malformed, so nothing was saved.`;
    }
  }
  if (h.moveInFrom !== undefined && !isDate(h.moveInFrom)) return "history.moveInFrom must be a date (YYYY-MM-DD).";
  if (h.moveIn !== undefined && (!Array.isArray(h.moveIn) || h.moveIn.some((x) => !Number.isFinite(Number(x))))) return "history.moveIn must be a list of SKU numbers.";
  if (h.leadTimes !== undefined) {
    const pair = (a) => Array.isArray(a) && a.length >= 2 && Number.isFinite(Number(a[0])) && Number.isFinite(Number(a[1])) && Number(a[0]) >= 0 && Number(a[1]) >= 0;
    const lt = h.leadTimes;
    if (!lt || typeof lt !== "object" || !pair(lt.default) || !lt.bySku || typeof lt.bySku !== "object" || Object.values(lt.bySku).some((e) => !pair(e))) return "history.leadTimes is malformed.";
  }
  return null;
}

function read() {
  if (!fs.existsSync(DATA_FILE)) return { history: null, updatedAt: null };
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    throw new Error("The demand history file is unreadable. Re-import it, or restore the file.");
  }
  return { history: parsed.history || null, updatedAt: parsed.updatedAt || null };
}

function write(history) {
  const problem = validate(history);
  if (problem) throw Object.assign(new Error(problem), { code: 400 });
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  const tmp = `${DATA_FILE}.${process.pid}.tmp`;
  const updatedAt = new Date().toISOString();
  fs.writeFileSync(tmp, JSON.stringify({ history, updatedAt }), "utf8");
  fs.renameSync(tmp, DATA_FILE);
  return { rows: history.rows.length, through: history.through, updatedAt };
}

module.exports = { read, write, validate, DATA_FILE };
