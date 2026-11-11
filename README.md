# SF Hill Climbers

Which San Francisco hill does Adam take you to?

An interactive map that races gradient-based optimizers uphill across San Francisco's real terrain (loss = −elevation), plus a territory map for each optimizer: which hilltop it reaches from every starting point in the city.

- **Race:** pick a start by clicking the map or typing an address, intersection or place; SGD, Momentum, Adam and Muon (reduced to 2D) climb side by side, and the map zooms to frame the race (street names and 25 ft contours appear when zoomed in). Any lane can be swapped for Nesterov, RMSprop, Adagrad or Lion.
- **Address search** is offline: `web/src/geocode.js` interpolates between OpenStreetMap address points, intersects street geometries, and matches named places. Nothing typed leaves the browser.
- **Territories:** every start point colored by the summit each optimizer reaches (darker = higher = better optimum), plus a map of where they disagree.
- **Rotation test:** rotate the axes and only the per-coordinate methods (Adam, RMSprop, Adagrad, Lion) change course.
- **Muon's real job:** a 64×64 associative-memory toy where Muon learns rare facts as fast as common ones, and Adam only keeps up when the facts line up with the axes.

## Layout

```
pipeline/build_terrain.py   elevation tiles + OSM summits, streets, addresses, places -> web/data/terrain.json
web/src/core.js             terrain sampling, optimizers, climb/classify, matrix toy (browser + Node)
web/src/geocode.js          offline address / intersection / place search (browser + Node)
web/src/app.js              map rendering, race, territory maps, controls, charts
web/src/style.css           page styles
web/index.html              page template
build.py                    inlines everything into dist/sf-hill-climbers.html
tests/core.test.js          optimizer and toy-problem tests
tests/geocode.test.js       address search tests against the real SF data
tools/                      analysis scripts used to pick defaults and verify page claims
```

## Build

```
python3 -m venv .venv && .venv/bin/pip install numpy scipy pillow
.venv/bin/python pipeline/build_terrain.py   # downloads tiles/OSM once into data/raw (gitignored)
node tests/core.test.js && node tests/geocode.test.js
python3 build.py                              # -> dist/sf-hill-climbers.html
```

`dist/sf-hill-climbers.html` is a page body without `<html>`/`<head>` wrappers (it is published as a Claude artifact, which adds them). To open it locally, wrap it in a minimal HTML document.

## Useful tools

- `node tools/territory_stats.js 120 '{"steps":1000}'`: outcome mix per optimizer and how often they disagree.
- `node tools/try_landmarks.js sgd,momentum,adam,muon '{"rotationDeg":30}'`: where each optimizer goes from well-known places.
- `node tools/tune_memory.js`: learning-rate search for the matrix toy.

## Data

Elevation: AWS Terrain Tiles (bare-earth USGS 3DEP lidar in San Francisco), 20 m grid, smoothed over ~35 m. Summit names and streets © OpenStreetMap contributors (ODbL).
