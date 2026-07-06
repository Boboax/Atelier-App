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

## Step 1 — It's already online (GitHub Pages)

The live app is **https://boboax.github.io/Atelier-App/**

Deploys are fully automatic: `.github/workflows/deploy-pages.yml` publishes
`dist/` to GitHub Pages on every push to `main`. There is nothing to drag,
click or configure — merge to `main` and the site updates within a minute or
two (watch the **Actions** tab if you want confirmation).

Requirements (already set up, noted here in case they're ever reset):
- The repo is **public** (Pages is free for public repos).
- Repo **Settings → Pages → Source** is set to **GitHub Actions**.

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
Edit `src/` → `node build/build.js` → commit & merge to `main` → GitHub Pages
redeploys automatically. Open the home-screen icon once on Wi-Fi; the new
service-worker cache name makes it self-update within a few seconds.

## Alternative: the single file
`Atelier.html` (rebuilt by the same build) is the whole app in one file — it
still works offline via Files/"Documents by Readdle", but shows that app's
toolbar and needs re-importing on each update. The hosted route avoids both.
