# Mobile dungeon roguelike (installable app)

This is a mobile-friendly ASCII dungeon roguelike that runs in the browser, and can also be installed to your home screen as an app (PWA).

## Play / Install (shareable links)

- **Play in browser (GitHub Pages)**: `https://deaven200.github.io/Mobile-dungeon-game/`
- **Download as a ZIP**: `https://github.com/Deaven200/Mobile-dungeon-game/archive/refs/heads/main.zip`

These are **copy/paste** links. (The GitHub Pages link will work after Pages is enabled and the workflow finishes.)

If you fork this repo, your links will look like:
- `https://<user>.github.io/<repo>/`
- `https://github.com/<user>/<repo>/archive/refs/heads/main.zip`

## What is the game?

You explore a procedurally generated ASCII dungeon, fight enemies by moving into them, find potions/food, avoid traps (some are hidden), and descend via the trapdoor to progress floors. It’s designed primarily for mobile: tap-to-move pathfinding, pinch-to-zoom, and a pause/menu button.

## How to run

- Open `index.html` in a browser, or serve this folder with any static file server.

## Install to your home screen (so tapping the icon opens the game)

- **Android / Chrome**: open the site → browser menu → **Install app** (or **Add to Home screen**).
- **iOS / Safari**: open the site → Share button → **Add to Home Screen**.

Once installed, tapping the home-screen icon opens the game in a standalone app window.

## Publish it on GitHub Pages (so you can install from GitHub)

Installing as an app requires a normal website URL (HTTPS). The easiest option is **GitHub Pages**:

- Push this repo to GitHub
- In your GitHub repo settings: **Settings → Pages**
- Under **Build and deployment**, choose **GitHub Actions**
- After the workflow runs, your game will be available at your Pages URL (something like `https://<user>.github.io/<repo>/`)

Then open that Pages URL on your phone and use the “Add to Home Screen / Install app” steps above.

## What’s new

- **Installable application (PWA)**: includes a web app manifest + icon so you can add it to your home screen.
- **Offline-friendly**: a service worker caches the game files so it can load even with spotty/no connection after the first visit.
