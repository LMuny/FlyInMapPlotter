# Fly-in Map Plotter

Visual map editor for the Fly-in project: place hubs, connect them, check the map and export the `.txt` file.

## Run
Double-click `fly-in-map-plotter.html`. No installation or internet connection needed.

This file contains the whole app, so you can move it or send it on its own. Your current map is saved automatically in the browser.

## Start a map
1. Click **New**, then click the grid: the first hub becomes the start and the second becomes the end.
2. Press **L** and drag from one hub to another to connect them.
3. Press **Ctrl+S** to save the `.txt` file.

To open an existing map, drop its `.txt` file onto the window or paste its contents with **Ctrl+V**.

## Shortcuts
V select · H add a hub · L connect · Delete remove · arrow keys move · Ctrl+Z / Ctrl+Y undo / redo · Ctrl+S save · Ctrl+O import · Ctrl+V paste a map

## Change the code
- `index.html` — page structure
- `css/style.css` — styling (automatic light / dark theme)
- `js/core.js` — map logic: parsing, export, checks, shortest path
- `js/app.js` — interface: drawing, tools, inspector, import / export
- `build.py` — regenerates `fly-in-map-plotter.html`

`index.html` opens directly during development. After making a change, run `python3 build.py` to update the single file.
