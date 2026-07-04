# Deploy Atelier as a proper offline iPad app

You only need internet **once** (for the upload + first open on the iPad). After
that the app runs full-screen and fully offline, with no browser bar.

The source of truth is the GitHub repo (**Boboax/Atelier-App**). The folder to
deploy is **`dist/`** — and `dist/` is only correct after a build:

## Step 0 — Build (after any change to `src/`)

```
node build/build.js
```

This refreshes `dist/` from `src/`, stamps the app version (from
`build/version.json`) and a fresh service-worker cache name (so installed iPads
pick up the update on their next launch), and regenerates the single-file
`Atelier.html`. It fails loudly if the module lists in `index.html` / `sw.js` /
`build.js` ever drift apart. CI (GitHub Actions) runs the unit tests and this
build on every push.

## Step 1 — Put it online (~1 min)

**Option A — Netlify Drop (manual):**
1. Get `dist/` onto your computer (clone the repo, or GitHub → Code → Download ZIP).
2. Go to **https://app.netlify.com/drop** and drag the **`dist` folder** onto the
   drop box. Copy the live URL it gives you.
3. *(Recommended)* Claim the site (free) so future deploys keep the same URL —
   then updates are just a re-drag onto the site's **Deploys** tab.

**Option B — connect the repo to Netlify (no dragging, ever):**
Add new site → Import from GitHub → pick the repo. Build command: **empty**,
publish directory: **`dist`**. Every push then deploys automatically.

## Step 2 — Install on the iPad (~1 min, on Wi-Fi)
1. Open **Safari** on the iPad and go to the URL.
2. Tap the **Share** button → **Add to Home Screen** → name it **Atelier** → **Add**.
3. Open it from the new **home-screen icon**. It launches full-screen — no toolbar.

## Step 3 — Confirm it's truly offline
1. Turn on **Airplane Mode** on the iPad.
2. Open the Atelier icon. It should work completely (drills, stats, library).
   If yes, you're done — it works anywhere, no PC or internet needed.

## Backups
Your data lives only on the iPad. Every so often: **More → Settings → Export
backup** — one tap shares the `.json` straight to Files/Dropbox. **Restore**
brings it back if iOS ever clears the app's storage or you reinstall. (The app
also asks iOS to persist its storage, but a backup is the only guarantee.)

## Updating later
Edit `src/` → `node build/build.js` → commit & push → redeploy `dist/` (drag, or
automatic with Option B). Open the home-screen icon once on Wi-Fi; the new
service-worker cache name makes it self-update within a few seconds.

## Alternative: the single file
`Atelier.html` (rebuilt by the same build) is the whole app in one file — it
still works offline via Files/"Documents by Readdle", but shows that app's
toolbar and needs re-importing on each update. The hosted route avoids both.
