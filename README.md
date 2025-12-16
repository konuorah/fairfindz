# Black-Owned Business Discovery (Chrome Extension)

Discover Black-owned alternatives while shopping on Amazon.

## What this project is

This is a Manifest V3 Chrome extension skeleton that runs a content script on Amazon pages. The content script is where you’ll later detect product information and surface Black-owned alternative suggestions.

## Project structure

- `manifest.json`
- `content/`
  - `content.js` (runs on Amazon pages)
  - `content.css` (styles injected by the content script)
- `popup/`
  - `modal.html` (placeholder UI document you can reuse later)
- `data/`
  - `businesses.json` (placeholder for your curated businesses dataset)
- `assets/`
  - `icon.png` (placeholder)

## Getting started (load into Chrome)

1. Open Chrome.
2. Go to `chrome://extensions`.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked**.
5. Select the project folder (the folder that contains `manifest.json`).
6. Visit `https://www.amazon.com/`.

## Next steps

- Add logic to `content/content.js` to detect the current Amazon product/search context.
- Add a UI (injected into the page) to show alternative businesses.
- Populate `data/businesses.json` with a schema you like (name, category, URL, tags, etc.).
