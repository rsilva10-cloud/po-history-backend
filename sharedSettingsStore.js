/**
 * sharedSettingsStore.js
 * ----------------------
 * PO Control settings that everyone shares: the backend URLs and the S&S and
 * LAT style/color lists. Admins change them; everyone else reads them. Before
 * this, each browser kept its own copy.
 *
 * Every save names the version it was loaded from. If someone saved in
 * between, the save is refused, so an old open tab can't overwrite newer
 * settings.
 */

const fs = require("fs");
const path = require("path");

const DATA_FILE = process.env.SHARED_SETTINGS_DATA_FILE || path.join(__dirname, "data", "sharedSettings.json");

// The only settings accepted, with their limits. Anything else is refused.
const URL_KEYS = ["saiaBackendUrl", "fidelitoneBackendUrl", "stanleyStellaBackendUrl", "latBackendUrl", "ssActivewearBackendUrl", "flexportBackendUrl"];
const TEXT_KEYS = ["ssStyles", "latStyles"];
const MAX_TEXT = 50000;

function damaged() {
  return Object.assign(new Error("The shared settings file is damaged; nothing was changed."), { code: 500 });
}

// { settings, version, updatedAt, updatedBy }, or version 0 and settings null if never saved.
function read() {
  if (!fs.existsSync(DATA_FILE)) return { settings: null, version: 0, updatedAt: null, updatedBy: null };
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    throw damaged(); // never fall back to "no settings": every browser would quietly go back to its own
  }
  if (!parsed || typeof parsed.settings !== "object" || !parsed.settings || !Number.isInteger(parsed.version)) throw damaged();
  return parsed;
}

function validate(settings) {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) throw Object.assign(new Error("Settings must be an object."), { code: 400 });
  const unknown = Object.keys(settings).filter((k) => !URL_KEYS.includes(k) && !TEXT_KEYS.includes(k));
  if (unknown.length) throw Object.assign(new Error(`Unknown setting: ${unknown.join(", ")}.`), { code: 400 });
  const clean = {};
  for (const k of URL_KEYS) {
    const v = settings[k] == null ? "" : settings[k];
    if (typeof v !== "string") throw Object.assign(new Error(`${k} must be text.`), { code: 400 });
    const t = v.trim();
    if (t && !/^https?:\/\/[^\s/]+[^\s]*$/i.test(t)) throw Object.assign(new Error(`${k} must be a web address starting with https://.`), { code: 400 });
    if (t.length > 500) throw Object.assign(new Error(`${k} is too long.`), { code: 400 });
    clean[k] = t;
  }
  for (const k of TEXT_KEYS) {
    const v = settings[k] == null ? "" : settings[k];
    if (typeof v !== "string") throw Object.assign(new Error(`${k} must be text.`), { code: 400 });
    if (v.length > MAX_TEXT) throw Object.assign(new Error(`${k} is too long.`), { code: 400 });
    clean[k] = v;
  }
  return clean;
}

// Save all settings at once. baseVersion: the version the editor loaded.
function save({ settings, baseVersion, by }) {
  const clean = validate(settings);
  const current = read(); // synchronous from here to the write: no await, so saves can't interleave
  if (baseVersion !== current.version) {
    throw Object.assign(
      new Error(`Someone (${current.updatedBy || "another admin"}) saved the settings after you opened them. Reload to see their changes, then make yours again.`),
      { code: 409, current }
    );
  }
  const next = { settings: clean, version: current.version + 1, updatedAt: new Date().toISOString(), updatedBy: String(by || "unknown") };
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${DATA_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), "utf8");
  fs.renameSync(tmp, DATA_FILE); // a crash mid-write leaves the old file, not half of a new one
  return next;
}

module.exports = { read, save, validate, URL_KEYS, TEXT_KEYS };
