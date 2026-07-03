# Deploy Atelier as a proper offline iPad app

You only need internet **once** (for the upload + first open on the iPad). After
that the app runs full-screen and fully offline, with no browser bar.

The folder to deploy is **`dist`** (here in `…\Dropbox\Drawing\Atelier\dist`).

## Step 1 — Put it online (on the PC, ~1 min)
1. In a browser on the PC, go to **https://app.netlify.com/drop**
2. Open File Explorer at `C:\Users\Bo\Dropbox\Drawing\Atelier`
3. **Drag the `dist` folder** onto the Netlify Drop box ("Drag and drop your site output folder here").
4. Wait ~10 seconds. Netlify shows a live URL like `https://shiny-name-1234.netlify.app`. Copy it.
5. *(Recommended)* Click **"Sign up to claim"** (free) so the site — and its URL — stays put and you can drop updated versions onto the same site later. Not required just to install.

## Step 2 — Install on the iPad (~1 min, on Wi-Fi)
1. Open **Safari** on the iPad and go to the Netlify URL.
2. The welcome screen should appear. Tap through it once.
3. Tap the **Share** button → **Add to Home Screen** → name it **Atelier** → **Add**.
4. Open it from the new **home-screen icon**. It launches full-screen — no toolbar.

## Step 3 — Confirm it's truly offline
1. Turn on **Airplane Mode** on the iPad.
2. Open the Atelier icon. It should work completely (drills, stats, library).
   If yes, you're done — it'll work anywhere, forever, no PC or internet needed.

## Backups
Your data lives only on the iPad. Every so often: **More → Settings → Export
backup** and save the file to Files/Dropbox. **Restore** brings it back if iOS
ever clears the app's storage or you reinstall.

## Updating later (when Bo's assistant rebuilds the app)
- The `dist` folder gets refreshed.
- If you **claimed** the Netlify site: go to your site's **Deploys** tab and drag
  the new `dist` folder on — same URL. Then open the home-screen icon once on
  Wi-Fi; it updates itself within a few seconds.
- If you **didn't** claim it: just do Step 1 again (you'll get a new URL) and
  re-add to Home Screen.

## Alternatives to Netlify
- **Cloudflare Pages** / **GitHub Pages** also work (free, permanent URLs) — say
  the word and I'll give tailored steps.
- The single-file `Atelier.html` + "Documents by Readdle" still works offline too,
  but it shows that app's toolbar and needs re-importing on each update — the
  Netlify route avoids both.
