# SF Hill Climbers

**https://www.kaleybrauer.com/sf-hill-climbers/**

Which San Francisco hill does Adam take you to?

An interactive map that races gradient-based optimizers uphill across San Francisco's real terrain (loss = −elevation), plus each optimizer's basins of attraction: which hilltop (local minimum of the loss) it reaches from every starting point in the city.

- **Race:** pick a start by clicking the map or typing an address, intersection or place; SGD, Momentum, Adam and Muon (reduced to 2D) climb side by side, and the map zooms to frame the race (street names and 25 ft contours appear when zoomed in). Any lane can be swapped for Nesterov, RMSprop, Lion or simulated annealing.
- **Address search** is offline: `web/src/geocode.js` interpolates between OpenStreetMap address points, intersects street geometries, and matches named places. Nothing typed leaves the browser.
- **Basins of attraction:** every start point colored by the summit each optimizer reaches (darker = higher = lower loss), plus a map of where they disagree.
- **Simulated annealing:** a gradient-free climber you can swap into any lane. It tries random nearby points and sometimes accepts a step downhill, which gets it to the highest summits far more often than any gradient method.
- **Rotation test:** rotate the axes and only the per-coordinate methods (Adam, RMSprop, Lion) change course.
- **Muon's real job:** a 64×64 associative-memory toy where Muon learns rare facts as fast as common ones, and Adam only keeps up when the facts line up with the axes.

## Layout

```
pipeline/build_terrain.py   elevation tiles + OSM summits, streets, addresses, places -> web/data/terrain.json
web/src/core.js             terrain sampling, optimizers, climb/classify, matrix toy (browser + Node)
web/src/geocode.js          offline address / intersection / place search (browser + Node)
web/src/app.js              map rendering, race, basin maps, controls, charts
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
python3 build.py                              # -> docs/index.html and dist/sf-hill-climbers.html
```

`docs/` is build output (gitignored): `docs/index.html` is the complete page, and `docs/preview.png` is the link-preview card. `tools/make_preview.py` redraws that card from the built page (it needs Chrome and Pillow); the workflow runs it on every deploy, and `web/preview.png` is the fallback copy. Open it directly to view the page locally. `dist/sf-hill-climbers.html` is the same page without `<html>`/`<head>` wrappers, for publishing as a Claude artifact.

## Publishing

Every push to `main` publishes the site: `.github/workflows/publish.yml` runs both test suites, runs `build.py`, redraws the link-preview card, and deploys `docs/` to GitHub Pages (https://www.kaleybrauer.com/sf-hill-climbers/). That includes edits made in GitHub's web editor, so to fix wording, edit `web/index.html` on GitHub and the site updates a minute or two later. If a test fails, nothing is deployed and the current site stays up; the Actions tab shows each run.

## Useful tools

- `node tools/territory_stats.js 120 '{"steps":1000}'`: outcome mix per optimizer and how often they disagree.
- `node tools/try_landmarks.js sgd,momentum,adam,muon '{"rotationDeg":30}'`: where each optimizer goes from well-known places.
- `node tools/tune_memory.js`: learning-rate search for the matrix toy.
- `node tools/flow_basins.js 180`: how close each optimizer's basin map is to the terrain's own basins (steepest ascent in tiny steps).
- `node tools/global_reach.js 120`: how often each optimizer reaches the highest summits at its best settings, and whether the "Anneal Momentum" preset still works if the highest peak is somewhere else.

## Data

Elevation: AWS Terrain Tiles (bare-earth USGS 3DEP lidar in San Francisco), 20 m grid, smoothed over ~35 m. Summit names and streets © OpenStreetMap contributors (ODbL).
