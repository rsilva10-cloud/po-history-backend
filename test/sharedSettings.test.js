// Runs the real server.js on a throwaway data folder. Why each test matters is in its name.
const test = require("node:test");
const assert = require("node:assert");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const jwt = require("jsonwebtoken");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shared-settings-"));
const env = { ...process.env, PORT: "3918", SESSION_SECRET: "s", SHARED_SETTINGS_DATA_FILE: path.join(dir, "ss.json"), USER_DATA_FILE: path.join(dir, "users.json") };
fs.writeFileSync(env.USER_DATA_FILE, JSON.stringify([{ email: "rick@zazzle.com", name: "Rick", role: "admin" }, { email: "nicole@zazzle.com", name: "Nicole", role: "orderEntry" }]));
const base = "http://127.0.0.1:3918";
const admin = jwt.sign({ email: "rick@zazzle.com", name: "Rick" }, "s");
const entry = jwt.sign({ email: "nicole@zazzle.com", name: "Nicole" }, "s");
const SETTINGS = {
  saiaBackendUrl: "https://saia-backend.onrender.com",
  fidelitoneBackendUrl: "https://fidelitone-backend.onrender.com",
  stanleyStellaBackendUrl: "",
  latBackendUrl: "https://lat-backend.onrender.com",
  ssActivewearBackendUrl: "https://ssactivewear-backend.onrender.com",
  flexportBackendUrl: "https://flexport-backend.onrender.com",
  ssStyles: "Gildan 5000: White, Black",
  latStyles: "2616: black",
};
let child;
const api = async (method, body, t) => {
  const r = await fetch(base + "/api/shared-settings", { method, headers: { "Content-Type": "application/json", ...(t ? { Authorization: `Bearer ${t}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json() };
};

test.before(async () => {
  child = spawn(process.execPath, ["server.js"], { cwd: path.join(__dirname, ".."), env, stdio: "ignore" });
  for (let i = 0; i < 50; i++) {
    try { await fetch(base + "/api/shared-settings"); return; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
});
test.after(() => child.kill());

test("settings need a login to read", async () => {
  assert.equal((await api("GET", null, null)).status, 401);
});

test("before the first save there are no shared settings, so each browser keeps its own until an admin saves", async () => {
  const r = await api("GET", null, entry);
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.settings, r.body.version], [null, 0]);
});

test("a non-admin can't change settings", async () => {
  const r = await api("PUT", { settings: SETTINGS, baseVersion: 0 }, entry);
  assert.equal(r.status, 403);
  assert.equal((await api("GET", null, entry)).body.settings, null);
});

test("an admin's save reaches every user, with who saved it", async () => {
  const r = await api("PUT", { settings: SETTINGS, baseVersion: 0 }, admin);
  assert.equal(r.status, 200);
  const seen = (await api("GET", null, entry)).body;
  assert.deepEqual(seen.settings, SETTINGS);
  assert.deepEqual([seen.version, seen.updatedBy], [1, "Rick"]);
});

test("a save from an out-of-date copy is refused, so an old tab can't undo newer settings", async () => {
  const r = await api("PUT", { settings: { ...SETTINGS, ssStyles: "old list" }, baseVersion: 0 }, admin);
  assert.equal(r.status, 409);
  assert.match(r.body.error, /saved the settings after you opened them/);
  assert.equal(r.body.current.version, 1);
  assert.equal((await api("GET", null, entry)).body.settings.ssStyles, "Gildan 5000: White, Black");
});

test("two admins saving from the same version: one wins, the other is told, nothing is silently lost", async () => {
  const [a, b] = await Promise.all([
    api("PUT", { settings: { ...SETTINGS, latStyles: "A" }, baseVersion: 1 }, admin),
    api("PUT", { settings: { ...SETTINGS, latStyles: "B" }, baseVersion: 1 }, admin),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  const winner = a.status === 200 ? "A" : "B";
  assert.equal((await api("GET", null, entry)).body.settings.latStyles, winner);
});

test("bad values are refused: unknown settings, non-web addresses, wrong types", async () => {
  const v = (await api("GET", null, admin)).body.version;
  for (const bad of [{ ...SETTINGS, secretKey: "x" }, { ...SETTINGS, flexportBackendUrl: "javascript:alert(1)" }, { ...SETTINGS, ssStyles: 5 }, null]) {
    assert.equal((await api("PUT", { settings: bad, baseVersion: v }, admin)).status, 400, JSON.stringify(bad));
  }
  assert.equal((await api("GET", null, admin)).body.version, v, "nothing was saved");
});

test("addresses are trimmed, since a pasted space breaks every call", async () => {
  const v = (await api("GET", null, admin)).body.version;
  const r = await api("PUT", { settings: { ...SETTINGS, flexportBackendUrl: "  https://flexport-backend.onrender.com \n" }, baseVersion: v }, admin);
  assert.equal(r.body.settings.flexportBackendUrl, "https://flexport-backend.onrender.com");
});

test("a damaged settings file is reported, never treated as 'no settings'", async () => {
  fs.writeFileSync(env.SHARED_SETTINGS_DATA_FILE, "{oops");
  assert.equal((await api("GET", null, entry)).status, 500);
  assert.equal((await api("PUT", { settings: SETTINGS, baseVersion: 0 }, admin)).status, 500);
  assert.equal(fs.readFileSync(env.SHARED_SETTINGS_DATA_FILE, "utf8"), "{oops");
});
