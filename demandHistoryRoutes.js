/**
 * demandHistoryRoutes.js
 * ----------------------
 * HTTP side of demandHistoryStore. server.js adds one line:
 *   require("./demandHistoryRoutes").mount(app, { requireAuth, requireAdmin });
 * Anyone signed in can read the history (the Reorder Forecast needs it);
 * only an admin can replace it, because it drives every forecast.
 */
const store = require("./demandHistoryStore");

function mount(app, { requireAuth, requireAdmin }) {
  app.get("/api/demand-history", requireAuth, (req, res) => {
    try {
      res.json(store.read());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/demand-history", requireAuth, requireAdmin, (req, res) => {
    try {
      res.json(store.write((req.body || {}).history));
    } catch (err) {
      res.status(err.code === 400 ? 400 : 500).json({ error: err.message });
    }
  });
}

module.exports = { mount };
