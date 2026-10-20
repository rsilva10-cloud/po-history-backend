// Runs the real server.js on a throwaway data folder. Why each test matters is in its name.
const test = require("node:test");
const assert = require("node:assert");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const jwt = require("jsonwebtoken");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flexmatch-"));
const env = { ...process.env, PORT: "3917", SESSION_SECRET: "s", FLEXPORT_MATCHES_DATA_FILE: path.join(dir, "m.json"), CATALOG_DATA_FILE: path.join(dir, "catalog.json") };
fs.writeFileSync(env.CATALOG_DATA_FILE, JSON.stringify({ catalog: [{ sku: "lunchbox_black", skuNumber: "210015" }, { sku: "tie", skuNumber: 220000 }, { sku: "lunchbox_stainl", skuNumber: "210017" }], inventory: {}, incomingInventory: {} }));
const base = "http://127.0.0.1:3917";
const tok = jwt.sign({ email: "rick@zazzle.com", name: "Rick" }, "s");
let child;
const api = async (method, body, t = tok) => {
  const r = await fetch(base + "/api/flexport-matches", { method, headers: { "Content-Type": "application/json", ...(t ? { Authorization: `Bearer ${t}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json() };
};

test.before(async () => {
  child = spawn(process.execPath, ["server.js"], { cwd: path.join(__dirname, ".."), env, stdio: "ignore" });
  for (let i = 0; i < 50; i++) {
    try { await fetch(base + "/api/flexport-matches"); return; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
});
test.after(() => child.kill());

test("matches need a PO Control login", async () => {
  assert.equal((await api("GET", null, null)).status, 401);
  assert.equal((await api("PUT", { key: "code:x", skuNumber: "210015" }, null)).status, 401);
});

test("the seven Lopo lunch-box codes are there from the start, as confirmed from the packing list", async () => {
  const m = (await api("GET")).body.matches;
  assert.equal(m["code:m.02.06.0020"].skuNumber, "210017");
  assert.equal(m["code:m.02.06.0022"].skuNumber, "210015");
  assert.equal(Object.keys(m).length, 7);
});

test("a match by description is saved with who set it, so the blank ties can be matched without a code", async () => {
  const r = await api("PUT", { key: "desc:100% polyester blank tie", skuNumber: 220000 });
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.matches["desc:100% polyester blank tie"].skuNumber, r.body.matches["desc:100% polyester blank tie"].setBy], ["220000", "Rick"]);
});

test("a SKU # that isn't in the catalog is refused, so a typo can't send units to nowhere", async () => {
  const r = await api("PUT", { key: "code:abc", skuNumber: "999999" });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /isn't in the Item Catalog/);
  assert.equal((await api("GET")).body.matches["code:abc"], undefined);
});

test("badly formed keys are refused", async () => {
  for (const key of ["", "abc", "CODE:X", "code:", "code:a  b", null]) assert.equal((await api("PUT", { key, skuNumber: "210015" })).status, 400, String(key));
});

test("removing one match leaves every other match alone", async () => {
  await api("PUT", { key: "code:m.02.06.0021", skuNumber: null });
  const m = (await api("GET")).body.matches;
  assert.equal(m["code:m.02.06.0021"], undefined);
  assert.equal(m["code:m.02.06.0020"].skuNumber, "210017");
  assert.ok(m["desc:100% polyester blank tie"]);
});

test("simultaneous matches from different people all land; none overwrites another", async () => {
  const keys = Array.from({ length: 20 }, (_, i) => `code:test-${i}`);
  await Promise.all(keys.map((key) => api("PUT", { key, skuNumber: "210015" })));
  const m = (await api("GET")).body.matches;
  assert.ok(keys.every((k) => m[k] && m[k].skuNumber === "210015"));
});

test("a damaged matches file is reported, never silently replaced with an empty one", async () => {
  fs.writeFileSync(env.FLEXPORT_MATCHES_DATA_FILE, "{not json");
  const r = await api("GET");
  assert.equal(r.status, 500);
  assert.equal(fs.readFileSync(env.FLEXPORT_MATCHES_DATA_FILE, "utf8"), "{not json");
  assert.equal((await api("PUT", { key: "code:x", skuNumber: "210015" })).status, 500);
  assert.equal(fs.readFileSync(env.FLEXPORT_MATCHES_DATA_FILE, "utf8"), "{not json");
});

test("keyFor uses the code when there is one, else the description, normalized", () => {
  const { keyFor } = require("../flexportMatchStore");
  assert.equal(keyFor({ code: " M.02.06.0020 ", description: "x" }), "code:m.02.06.0020");
  assert.equal(keyFor({ code: null, description: "100%  POLYESTER Blank TIE " }), "desc:100% polyester blank tie");
  assert.equal(keyFor({}), null);
});
