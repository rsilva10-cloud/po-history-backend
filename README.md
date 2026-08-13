# PO History Backend

Persistent storage for every purchase order created in PO Control, plus
Excel/CSV export of the full history. This is what makes the standalone
deployed app actually remember data between page loads and across your
whole team, instead of losing everything on refresh.

- `GET /api/pos` \u2014 list all purchase orders
- `GET /api/pos/:id` \u2014 get one
- `POST /api/pos` \u2014 create
- `PUT /api/pos/:id` \u2014 update
- `DELETE /api/pos/:id` \u2014 delete
- `GET /api/pos/export.csv` \u2014 download full history as CSV (one row per line item)
- `GET /api/pos/export.xlsx` \u2014 same, as an Excel file

## Storage: a JSON file, on purpose

This uses a plain JSON file (`data/pos.json`) instead of a database server.
For a small internal tool like this, that's a genuine, deliberate choice:
zero native dependencies to install, easy to open and read/back up by hand,
and no separate database to provision or pay for. It won't hold up under
heavy concurrent write traffic, but that's not this tool's situation.

## Important: disk persistence depends on where you deploy

A JSON file only survives as long as the disk it's sitting on does.

- **Render's free tier has an ephemeral filesystem** \u2014 every redeploy or
  restart wipes it. Fine for testing, **not fine for real history** you
  care about keeping.
- **Railway** offers persistent volumes on its free/starter tiers \u2014 a much
  better fit if you want this to actually last.
- A **small VPS** (or your own server) with a normal disk works fine too.
- If this ever needs to survive server migrations, scale to multiple
  instances, or you just want real durability guarantees, the next step
  up is a real hosted database (e.g. a free-tier Postgres from Neon or
  Supabase) instead of this file. Ask if you want that built \u2014 it's a
  moderate change, not a rewrite, since all the data already goes through
  this same `store.js` module.

**Practical recommendation:** for anything beyond initial testing, use
Railway (or attach a persistent disk on Render's paid tier) rather than
Render's free tier, or plan to move to a real database once this becomes a
tool people depend on daily.

## How the front end uses this

The PO Control app enriches each line item with the item name and
warehouse name before saving (this backend doesn't have your item catalog,
so it can't look those up itself) \u2014 that's why exported rows have readable
names instead of just SKU codes.

Once you paste this backend's URL into PO Control's Settings panel, every
new PO, edit, and delete syncs here automatically, and the Export buttons
pull from this backend (the full saved history) rather than just whatever
happens to be loaded in your browser at the moment.

## Local setup

```bash
cd po-history-backend
cp .env.example .env
npm install
npm start
```

Runs on `http://localhost:3003` by default. Test it:

```bash
curl http://localhost:3003/api/health
# {"ok":true,"count":0}
```

## Deploying

Push this folder to a GitHub repo, then either:

- **Railway** (recommended for real persistence): New Project \u2192 Deploy
  from repo \u2192 attach a volume mounted at a path, and set `DATA_FILE` to a
  path inside that volume.
- **Render**: New Web Service \u2192 connect repo \u2192 build `npm install`,
  start `npm start`. Fine for testing; see the durability note above
  before relying on it for real data.

Once deployed, paste the URL into PO Control's Settings panel under
"PO History backend URL."
