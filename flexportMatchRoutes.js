/**
 * flexportMatchRoutes.js
 * ----------------------
 * HTTP side of flexportMatchStore. server.js adds one line:
 *   require("./flexportMatchRoutes").mount(app, { requireAuth, catalogStore });
 * Anyone signed in can read and set matches; each records who set it and when.
 */
const store = require("./flexportMatchStore");

function mount(app, { requireAuth, catalogStore }) {
  app.get("/api/flexport-matches", requireAuth, (req, res) => {
    try {
      res.json(store.read());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Body: { key: "code:m.02.06.0020", skuNumber: "210017" }  (skuNumber null removes the match)
  app.put("/api/flexport-matches", requireAuth, (req, res) => {
    try {
      const { key, skuNumber } = req.body || {};
      const catalog = (catalogStore.read() || {}).catalog || [];
      const catalogSkuNumbers = new Set(catalog.map((i) => (i && i.skuNumber != null ? String(i.skuNumber).trim() : "")).filter(Boolean));
      res.json(store.setMatch({ key, skuNumber, by: (req.user && (req.user.name || req.user.email)) || "unknown", catalogSkuNumbers }));
    } catch (err) {
      res.status(err.code === 400 ? 400 : 500).json({ error: err.message });
    }
  });
}

module.exports = { mount };
