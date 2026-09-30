/**
 * salesOrderCounterStore.js
 * -------------------------
 * Hands out Sales Order # values one at a time, atomically. This exists
 * specifically to fix a real bug: the previous design had each browser
 * tab compute "the next number" locally from whatever POs it had loaded,
 * which meant two people creating orders around the same time (or a
 * browser with slightly stale data) could independently land on the same
 * number — a genuine duplicate once both changes synced.
 *
 * The fix is to make the SERVER the only thing that ever decides "what's
 * next" — nextValue() reads the current counter and writes the
 * incremented value back within one synchronous block, with no `await`
 * in between. Node runs JavaScript single-threaded, so two concurrent
 * requests literally cannot interleave inside that synchronous section —
 * each one fully completes its read-increment-write before the next
 * request's handler code runs. That's what actually rules out the race,
 * not just makes it less likely.
 */

const fs = require("fs");
const path = require("path");

const DATA_FILE = process.env.SALES_ORDER_COUNTER_DATA_FILE || path.join(__dirname, "data", "salesOrderCounter.json");
const DEFAULT_START = 999; // first issued value is 1000

function ensureDataFile() {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, JSON.stringify({ current: DEFAULT_START }), "utf8");
}

function readCurrent() {
  ensureDataFile();
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    const n = Number(parsed.current);
    return Number.isFinite(n) ? n : DEFAULT_START;
  } catch {
    return DEFAULT_START;
  }
}

// The atomic operation itself — see the file-level comment for why this
// is safe under concurrent requests.
function nextValue() {
  ensureDataFile();
  const next = readCurrent() + 1;
  fs.writeFileSync(DATA_FILE, JSON.stringify({ current: next }, null, 2), "utf8");
  return next;
}

// One-time migration helper: bumps the counter up to `min` if it's
// currently lower, so numbering continues forward from whatever the
// highest already-assigned number is (from before this atomic counter
// existed) rather than colliding with history. Never moves it backward.
function ensureAtLeast(min) {
  ensureDataFile();
  const current = readCurrent();
  if (Number(min) > current) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ current: Number(min) }, null, 2), "utf8");
  }
  return readCurrent();
}

module.exports = { nextValue, readCurrent, ensureAtLeast };
