/**
 * sharedSettingsRoutes.js
 * -----------------------
 * HTTP side of sharedSettingsStore. server.js adds one line:
 *   require("./sharedSettingsRoutes").mount(app, { requireAuth, requireAdmin });
 * Everyone signed in reads; only admins save.
 */
const store = require("./sharedSettingsStore");

function mount(app, { requireAuth, requireAdmin }) {
  app.get("/api/shared-settings", requireAuth, (req, res) => {
    try {
      res.json(store.read());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Body: { settings: {...}, baseVersion: <version the editor loaded, 0 if none yet> }
  app.put("/api/shared-settings", requireAuth, requireAdmin, (req, res) => {
    try {
      const { settings, baseVersion } = req.body || {};
      res.json(store.save({ settings, baseVersion, by: (req.user && (req.user.name || req.user.email)) || "unknown" }));
    } catch (err) {
      const status = err.code === 400 || err.code === 409 ? err.code : 500;
      res.status(status).json({ error: err.message, ...(status === 409 ? { current: err.current } : {}) });
    }
  });
}

module.exports = { mount };
