// Runs the real server.js on a throwaway data folder. Why each test matters is in its name.
const test = require("node:test");
const assert = require("node:assert");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const jwt = require("jsonwebtoken");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "catalog-version-"));
const env = {
  ...process.env,
  PORT: "3919",
  SESSION_SECRET: "s",
  CATALOG_DATA_FILE: path.join(dir, "catalog.json"),
  CATALOG_BACKUP_DIR: path.join(dir, "backups"),
  USER_DATA_FILE: path.join(dir, "users.json"),
};
fs.writeFileSync(env.USER_DATA_FILE, JSON.stringify([{ email: "rick@zazzle.com", name: "Rick", role: "admin" }]));
// A catalog saved before versions existed: no "version" field.
const items = (n, tag = "") => Array.from({ length: n }, (_, i) => ({ sku: `sku${i}${tag}`, skuNumber: String(100000 + i) }));
fs.writeFileSync(env.CATALOG_DATA_FILE, JSON.stringify({ catalog: items(100), inventory: {}, incomingInventory: {} }));
const base = "http://127.0.0.1:3919";
const tok = jwt.sign({ email: "rick@zazzle.com", name: "Rick" }, "s");
let child;
const call = async (method, p, body) => {
  const r = await fetch(base + p, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json() };
};
const put = (catalog, baseVersion, extra = {}) => call("PUT", "/api/catalog", { catalog, inventory: {}, incomingInventory: {}, ...(baseVersion === undefined ? {} : { baseVersion }), ...extra });

test.before(async () => {
  child = spawn(process.execPath, ["server.js"], { cwd: path.join(__dirname, ".."), env, stdio: "ignore" });
  for (let i = 0; i < 50; i++) {
    try { await fetch(base + "/api/catalog"); return; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
});
test.after(() => child.kill());

test("a catalog saved before versions existed loads as version 0, so the first save after the update works", async () => {
  const r = await call("GET", "/api/catalog");
  assert.equal(r.body.version, undefined);
  const s = await put(items(101), 0);
  assert.equal(s.status, 200);
  assert.equal(s.body.version, 1);
});

test("each save moves the version on and returns it, so the tab that saved can keep saving", async () => {
  const s = await put(items(102), 1);
  assert.deepEqual([s.status, s.body.version], [200, 2]);
});

test("a tab holding an older version is refused, so it can't put back items others removed", async () => {
  const s = await put(items(102, "-old"), 1);
  assert.equal(s.status, 409);
  assert.equal(s.body.code, "CATALOG_STALE");
  assert.equal(s.body.currentVersion, 2);
  assert.match(s.body.error, /Reload the page/);
  assert.ok(!(await call("GET", "/api/catalog")).body.catalog.some((i) => i.sku.endsWith("-old")), "nothing was written");
});

test("a save with no version (an app tab from before this update) is refused too", async () => {
  const s = await put(items(102, "-noversion"), undefined);
  assert.equal(s.status, 409);
  assert.equal(s.body.code, "CATALOG_STALE");
});

test("two tabs saving from the same version: exactly one wins", async () => {
  const [a, b] = await Promise.all([put(items(103, "-a"), 2), put(items(103, "-b"), 2)]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
});

test("the shrink guard still applies on top of the version check", async () => {
  const v = (await call("GET", "/api/catalog")).body.version;
  const s = await put(items(10), v);
  assert.equal(s.status, 409);
  assert.equal(s.body.code, "CATALOG_SHRINK");
  assert.equal((await put(items(10), v, { allowShrink: true })).status, 200);
});

test("a restore moves the version on and returns it, so the restoring tab's next save isn't refused", async () => {
  await call("POST", "/api/catalog/backups");
  const id = (await call("GET", "/api/catalog/backups")).body.backups[0].id;
  const before = (await call("GET", "/api/catalog")).body.version;
  const r = await call("POST", `/api/catalog/backups/${id}/restore`);
  assert.equal(r.status, 200);
  assert.equal(r.body.version, before + 1);
  assert.equal((await put(r.body.doc.catalog, r.body.version)).status, 200);
});
