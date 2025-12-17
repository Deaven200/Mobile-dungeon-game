# Mobile dungeon roguelike (installable app)

This is a mobile-friendly ASCII dungeon roguelike that runs in the browser, and can also be installed to your home screen as an app (PWA).

## How to run

- Open `index.html` in a browser, or serve this folder with any static file server.

## Install to your home screen (so tapping the icon opens the game)

- **Android / Chrome**: open the site → browser menu → **Install app** (or **Add to Home screen**).
- **iOS / Safari**: open the site → Share button → **Add to Home Screen**.

Once installed, tapping the home-screen icon opens the game in a standalone app window.

## What’s new

- **Installable application (PWA)**: includes a web app manifest + icon so you can add it to your home screen.
- **Offline-friendly**: a service worker caches the game files so it can load even with spotty/no connection after the first visit.
