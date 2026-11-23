# bluemap-worker

Cloudflare Worker serving the BlueMap 5.7 web client (via Workers Static Assets) and map tiles/metadata from MySQL via Cloudflare Hyperdrive, adapted from BlueMap's `sql.php`.

## Layout
- `public/` — BlueMap 5.7 static web client (`index.html`, `settings.json`, `assets/`, `lang/`)
- `src/index.ts` — Cloudflare Worker serving `/maps/*` from MySQL over Hyperdrive (`mysql2/promise`)
- `reference/sql.php` — Original BlueMap 5.7 PHP SQL bridge for reference

## Setup
1. Install dependencies:
   ```bash
   npm install
   ```
2. Sign in to Cloudflare via Wrangler:
   ```bash
   npx wrangler login
   ```
3. Create a Hyperdrive configuration pointing at your MySQL database (using the read-only `bluemap_ro` user) and paste the returned ID into `wrangler.jsonc`.
4. Deploy:
   ```bash
   npm run deploy
   ```
