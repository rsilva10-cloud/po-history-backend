/**
 * flexportMatchStore.js
 * ---------------------
 * Which catalog SKU # each Flexport item line belongs to, shared by everyone,
 * so the Reorder Forecast's "In transit (Flexport)" column is the same for all.
 *
 * A line is matched by its supplier code when Flexport has one
 * ("code:M.02.06.0020"), otherwise by its exact description
 * ("desc:100% polyester blank tie"). Keys are lower-case with spaces collapsed.
 *
 * Each match is set or removed on its own (never the whole file from a
 * browser), inside one synchronous block, so two people matching different
 * lines can't overwrite each other and an old browser tab can't wipe matches.
 */

const fs = require("fs");
const path = require("path");

const DATA_FILE = process.env.FLEXPORT_MATCHES_DATA_FILE || path.join(__dirname, "data", "flexportMatches.json");

// Lopo's lunch-box codes, from the supplier packing list (confirmed by Rick, 2026-10).
const INITIAL = {
  "code:m.02.06.0020": "210017", // Stainless
  "code:m.02.06.0022": "210015", // Black
  "code:m.02.06.0019": "210016", // Red
  "code:m.02.06.0016": "210021", // Blue
  "code:m.02.06.0017": "210019", // Green
  "code:m.02.06.0018": "210020", // Light Blue
  "code:m.02.06.0021": "210018", // White
};

const norm = (s) => String(s == null ? "" : s).trim().replace(/\s+/g, " ").toLowerCase();

// The key for a Flexport item line: its code if it has one, else its description.
function keyFor({ code, description }) {
  const c = norm(code);
  if (c) return `code:${c}`;
  const d = norm(description);
  return d ? `desc:${d}` : null;
}

function validKey(key) {
  return typeof key === "string" && /^(code|desc):\S.{0,199}$/.test(key) && key === key.toLowerCase() && !/\s{2}/.test(key);
}

function read() {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    const at = new Date().toISOString();
    const matches = {};
    for (const [k, v] of Object.entries(INITIAL)) matches[k] = { skuNumber: v, setBy: "Lopo packing list", setAt: at };
    fs.writeFileSync(DATA_FILE, JSON.stringify({ matches }, null, 2), "utf8");
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    // Never silently start over from a damaged file: that would drop everyone's matches.
    throw Object.assign(new Error("The Flexport matches file is damaged; nothing was changed."), { code: 500 });
  }
  if (!parsed || typeof parsed.matches !== "object" || !parsed.matches) {
    throw Object.assign(new Error("The Flexport matches file is damaged; nothing was changed."), { code: 500 });
  }
  return parsed;
}

// Set (skuNumber given) or remove (skuNumber null) one match. catalogSkuNumbers:
// the SKU #s in the saved catalog; a number not in it is refused.
function setMatch({ key, skuNumber, by, catalogSkuNumbers }) {
  if (!validKey(key)) throw Object.assign(new Error("A match needs a key like code:<supplier code> or desc:<description>."), { code: 400 });
  const data = read(); // synchronous from here to the write: no await, so requests can't interleave
  if (skuNumber == null || String(skuNumber).trim() === "") {
    delete data.matches[key];
  } else {
    const sku = String(skuNumber).trim();
    if (!catalogSkuNumbers.has(sku)) throw Object.assign(new Error(`SKU # ${sku} isn't in the Item Catalog.`), { code: 400 });
    data.matches[key] = { skuNumber: sku, setBy: String(by || "unknown"), setAt: new Date().toISOString() };
  }
  data.updatedAt = new Date().toISOString();
  const tmp = `${DATA_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmp, DATA_FILE); // a crash mid-write leaves the old file, not half of a new one
  return data;
}

module.exports = { read, setMatch, keyFor, validKey, norm, INITIAL };
