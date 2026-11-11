"""Build the San Francisco terrain data used by the web page.

1. Elevation: AWS Terrain Tiles (Terrarium PNG encoding; bare-earth USGS 3DEP
   in San Francisco), stitched, lightly smoothed and resampled onto a local
   20 m grid.
2. Hills: every local maximum with its topographic prominence, named from
   OpenStreetMap summit nodes where one is close by.
3. Streets: major OpenStreetMap roads, simplified, for orientation only.

Writes web/data/terrain.json.  Run:  .venv/bin/python pipeline/build_terrain.py
"""

import base64
import csv
import json
import re
import os
import math
import pathlib
import time
import urllib.parse
import urllib.request

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = pathlib.Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
OUT = ROOT / "web" / "data" / "terrain.json"

# City bounding box. The southern edge is the San Francisco / San Mateo county
# line, so anything that climbs south past it is leaving the city.
LON_W, LON_E = -122.5165, -122.3545
LAT_S, LAT_N = 37.7081, 37.8125
ZOOM = 14            # ~7.6 m per source pixel at this latitude
CELL_M = 20.0        # output grid spacing (metres)
SMOOTH_M = float(os.environ.get("SMOOTH_M", 35.0))  # Gaussian smoothing radius: removes street cuts and lot grading, keeps hills

LAND_MIN_M = 0.4     # at or below this is water
TOP_PROM_M = 0.3     # any top with this much prominence is a destination; lower ones are "small bumps"
HILL_PROM_M = 8.0    # unnamed tops with this much prominence are "hills", the rest "rises"
NAME_RADIUS_M = 160  # an OSM summit names a detected hilltop within this distance
EARTH_R = 6378137.0
TILE_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
OVERPASS = "https://overpass-api.de/api/interpreter"
BBOX = f"{LAT_S},{LON_W},{LAT_N},{LON_E}"

# Friendlier names for OSM summits people know by another name.
ALIASES = {
    "Noe Peak": "Twin Peaks · south",
    "Eureka Peak": "Twin Peaks · north",
    "Clarendon Heights": "Sutro Tower hill",
    "Bernal Hill": "Bernal Heights",
    "Visitacion Knob": "McLaren Park",
    "Bay View Hill": "Bayview Hill",
    "Lafayette Heights": "Lafayette Park",
    "Buena Vista Heights": "Buena Vista Park",
    "Alamo Heights": "Alamo Square",
    "Hayes Hill": "Alamo Square",
    "Grand View Hill": "Grand View Park",
    "Edgehill Heights": "Edgehill Mountain",
    "Stony Hill": "Hunters Point",
    "Ignatius Heights": "Lone Mountain · USF",
}
UNNAMED_OSM = {(37.79137, -122.43784): "Alta Plaza"}
# Summits OSM doesn't tag as peaks: (name, lat, lon).
EXTRA_SUMMITS = [
    ("Yerba Buena Island", 37.8097, -122.3659),
    ("Lincoln Park", 37.7846, -122.5005),
]

# Map labels (show=True) plus extra place names used only to describe unnamed hills.
PLACES = [
    ("Sunset", 37.7530, -122.4950, True),
    ("Richmond", 37.7800, -122.4830, True),
    ("Golden Gate Park", 37.7700, -122.4880, True),
    ("Presidio", 37.7975, -122.4650, True),
    ("Marina", 37.8030, -122.4370, True),
    ("Haight", 37.7700, -122.4480, True),
    ("Castro", 37.7610, -122.4350, True),
    ("Mission", 37.7600, -122.4150, True),
    ("SoMa", 37.7780, -122.4050, True),
    ("Downtown", 37.7920, -122.4020, True),
    ("North Beach", 37.8060, -122.4100, True),
    ("Noe Valley", 37.7500, -122.4330, True),
    ("Glen Park", 37.7340, -122.4340, True),
    ("Excelsior", 37.7230, -122.4280, True),
    ("Bayview", 37.7310, -122.3900, True),
    ("Dogpatch", 37.7590, -122.3880, True),
    ("Ingleside", 37.7230, -122.4520, True),
    ("West Portal", 37.7400, -122.4660, True),
    ("Lake Merced", 37.7220, -122.4930, True),
    ("Merced Heights", 37.7178, -122.4640, False),
    ("Ingleside Heights", 37.7170, -122.4560, False),
    ("Silver Terrace", 37.7345, -122.3990, False),
    ("Crocker-Amazon", 37.7115, -122.4370, False),
    ("Visitacion Valley", 37.7130, -122.4050, False),
    ("Lakeshore", 37.7215, -122.4870, False),
    ("Portola", 37.7270, -122.4070, False),
    ("Pacific Heights", 37.7925, -122.4350, False),
    ("Laurel Heights", 37.7850, -122.4500, False),
    ("Hayes Valley", 37.7760, -122.4240, False),
    ("Potrero Hill", 37.7600, -122.4000, False),
    ("Diamond Heights", 37.7430, -122.4400, False),
    ("Forest Hill", 37.7480, -122.4630, False),
    ("Parkside", 37.7380, -122.4900, False),
    ("Sunnyside", 37.7300, -122.4440, False),
    ("Outer Mission", 37.7180, -122.4450, False),
    ("Ocean Beach", 37.7600, -122.5090, False),
    ("Outer Sunset", 37.7530, -122.5020, False),
    ("Inner Sunset", 37.7600, -122.4660, False),
    ("Outer Richmond", 37.7780, -122.4960, False),
    ("Inner Richmond", 37.7800, -122.4650, False),
    ("Sea Cliff", 37.7870, -122.4900, False),
]

lat0 = (LAT_S + LAT_N) / 2
M_PER_DEG_LAT = math.pi * EARTH_R / 180
M_PER_DEG_LON = M_PER_DEG_LAT * math.cos(math.radians(lat0))


def to_rc(lat, lon):
    """Fractional (row, col) on the output grid; row 0 is the northern edge."""
    return ((LAT_N - lat) * M_PER_DEG_LAT / CELL_M - 0.5,
            (lon - LON_W) * M_PER_DEG_LON / CELL_M - 0.5)


def get(url, path, data=None):
    """Download once into data/raw; retry politely if the server is busy."""
    if path.exists():
        return path.read_bytes()
    path.parent.mkdir(parents=True, exist_ok=True)
    body = urllib.parse.urlencode({"data": data}).encode() if data else None
    for attempt in range(6):
        req = urllib.request.Request(url, data=body, headers={
            "User-Agent": "sf-optimizers/0.1 (personal visualization project)",
            "Accept": "application/json, image/png"})
        try:
            with urllib.request.urlopen(req, timeout=240) as r:
                content = r.read()
            if data and not content.lstrip().startswith(b"{"):
                raise ValueError("Overpass returned a non-JSON response")
            path.write_bytes(content)
            return content
        except Exception as exc:
            wait = 5 * 2 ** attempt
            print(f"  {url}: {exc}; retrying in {wait}s")
            time.sleep(wait)
    raise RuntimeError(f"could not fetch {url}")


def lonlat_to_tile(lon, lat, z):
    n = 2 ** z
    x = (lon + 180.0) / 360.0 * n
    y = (1.0 - np.arcsinh(np.tan(np.radians(lat))) / np.pi) / 2.0 * n
    return x, y


def fetch_tile(z, x, y):
    path = RAW / "terrarium" / str(z) / str(x) / f"{y}.png"
    get(TILE_URL.format(z=z, x=x, y=y), path)
    rgb = np.asarray(Image.open(path).convert("RGB"), dtype=np.float64)
    return rgb[..., 0] * 256 + rgb[..., 1] + rgb[..., 2] / 256 - 32768


def build_mosaic():
    x0, y0 = lonlat_to_tile(LON_W, LAT_N, ZOOM)
    x1, y1 = lonlat_to_tile(LON_E, LAT_S, ZOOM)
    tx = range(int(x0), int(x1) + 1)
    ty = range(int(y0), int(y1) + 1)
    mosaic = np.vstack([np.hstack([fetch_tile(ZOOM, x, y) for x in tx]) for y in ty])
    return mosaic, tx.start, ty.start


def find_peaks(elev, land):
    """Local maxima on land with topographic prominence.

    Standard descending flood: visit cells from highest to lowest, merging
    regions with union-find. When two regions meet, the lower region's peak
    gets prominence = its height minus the current (saddle) height. The top of
    each island gets its full height.
    """
    H, W = elev.shape
    flat = elev.ravel()
    landf = land.ravel()
    parent = -np.ones(H * W, dtype=np.int64)
    peak_of, prom, merged_into = {}, {}, {}

    def find(a):
        root = a
        while parent[root] != root:
            root = parent[root]
        while parent[a] != root:
            parent[a], a = root, parent[a]
        return root

    order = np.argsort(-flat, kind="stable")
    rank = np.empty_like(order)
    rank[order] = np.arange(order.size)
    for idx in order:
        if not landf[idx]:
            continue
        parent[idx] = idx
        peak_of[idx] = idx
        r, c = divmod(int(idx), W)
        for dr in (-1, 0, 1):
            for dc in (-1, 0, 1):
                rr, cc = r + dr, c + dc
                if (dr or dc) and 0 <= rr < H and 0 <= cc < W and parent[rr * W + cc] >= 0:
                    a, b = find(idx), find(rr * W + cc)
                    if a == b:
                        continue
                    pa, pb = peak_of[a], peak_of[b]
                    # Break elevation ties by visiting order, so a cell that
                    # arrives later never outranks an equal-height peak.
                    hi, lo = (pa, pb) if rank[pa] < rank[pb] else (pb, pa)
                    if lo != idx and lo not in prom:  # idx joining a region is not a peak meeting a saddle
                        prom[lo] = flat[lo] - flat[idx]
                        merged_into[lo] = hi
                    parent[b] = a
                    peak_of[a] = hi
    for idx in np.flatnonzero(landf):
        if parent[idx] == idx:
            prom.setdefault(peak_of[idx], flat[peak_of[idx]])
    peaks = [{"cell": int(i), "r": int(i) // W, "c": int(i) % W, "elev": float(flat[i]), "prom": float(p),
              "into": int(merged_into[i]) if i in merged_into else None}
             for i, p in prom.items()]
    peaks.sort(key=lambda p: -p["elev"])
    return peaks


def douglas_peucker(pts, tol):
    if len(pts) < 3:
        return pts
    a, b = pts[0], pts[-1]
    ab = b - a
    n = np.hypot(*ab) or 1.0
    rel = pts - a
    d = np.abs(ab[0] * rel[:, 1] - ab[1] * rel[:, 0]) / n
    i = int(np.argmax(d))
    if d[i] <= tol:
        return np.array([a, b])
    return np.vstack([douglas_peucker(pts[: i + 1], tol)[:-1], douglas_peucker(pts[i:], tol)])


STREET_RANK = {"motorway": 0, "trunk": 0, "primary": 1, "secondary": 2,
               "tertiary": 3, "residential": 4, "unclassified": 4, "living_street": 4}


def delta_encode(q10):
    flat = [int(v) for v in q10[0]]
    for d in np.diff(q10, axis=0):
        if d.any():
            flat.extend(int(v) for v in d)
    return flat


def build_streets(names):
    """Named street polylines in tenths of a grid cell, delta-coded:
    [rank, name index or -1, x0, y0, dx1, dy1, ...]."""
    major = (f'[out:json][timeout:180];way["highway"~"^(motorway|trunk|primary|secondary)$"]({BBOX});out geom;')
    minor = (f'[out:json][timeout:180];way["highway"~"^(tertiary|residential|unclassified|living_street)$"]'
             f'({BBOX});out geom;')
    ways = (json.loads(get(OVERPASS, RAW / "osm" / "roads.json", major))["elements"] +
            json.loads(get(OVERPASS, RAW / "osm" / "minor_roads.json", minor))["elements"])
    out = []
    for w in ways:
        g = w.get("geometry") or []
        if len(g) < 2:
            continue
        rank = STREET_RANK[w["tags"]["highway"]]
        name = w["tags"].get("name")
        ni = names.setdefault(name, len(names)) if name else -1
        pts = np.array([to_rc(p["lat"], p["lon"])[::-1] for p in g])  # (col, row)
        pts = douglas_peucker(pts, 0.35 if rank < 3 else 0.25)
        out.append([rank, ni, *delta_encode(np.round(pts * 10).astype(int))])
    return out


def build_addresses(names):
    """Address anchors for the page's offline geocoder. For each street, side
    (odd/even) and hundred-block, keep the lowest and highest numbered address.
    Returns {name index: [n, x, y, dn, dx, dy, ...]} sorted by number, with
    positions in tenths of a grid cell."""
    q = (f'[out:csv(::lat,::lon,"addr:housenumber","addr:street";false;"|")][timeout:240];'
         f'nwr["addr:housenumber"]["addr:street"]({BBOX});out center;')
    text = get(OVERPASS, RAW / "osm" / "addresses.csv", q).decode()
    blocks = {}
    for row in csv.reader(text.splitlines(), delimiter="|"):
        if len(row) != 4 or not row[0]:
            continue
        m = re.match(r"\d+", row[2].strip())
        if not m:
            continue
        n = int(m.group())
        blocks.setdefault((row[3].strip(), n % 2, n // 100), []).append((n, float(row[0]), float(row[1])))
    per_street = {}
    for (street, _, _), pts in blocks.items():
        pts.sort()
        keep = [pts[0]] if pts[0][0] == pts[-1][0] else [pts[0], pts[-1]]
        ni = names.setdefault(street, len(names))
        for n, la, lo in keep:
            r, c = to_rc(la, lo)
            per_street.setdefault(ni, []).append((n, round(c * 10), round(r * 10)))
    out = {}
    for ni, pts in per_street.items():
        pts.sort()
        flat = list(pts[0])
        for a, b in zip(pts, pts[1:]):
            flat.extend((b[0] - a[0], b[1] - a[1], b[2] - a[2]))
        out[str(ni)] = flat
    return out, sum(len(v) for v in per_street.values())


POI_KINDS = {"railway": "station", "amenity": "campus", "tourism": "landmark", "leisure": "park", "place": "neighborhood"}


def build_pois():
    """Named places for the search box: parks, stations, landmarks, campuses,
    neighbourhoods. [name, kind, x, y] in tenths of a grid cell."""
    q = (f'[out:json][timeout:180];(nwr["leisure"="park"]["name"]({BBOX});nwr["railway"="station"]["name"]({BBOX});'
         f'nwr["tourism"~"^(attraction|museum|viewpoint)$"]["name"]({BBOX});nwr["amenity"~"^(university|college)$"]["name"]({BBOX});'
         f'node["place"~"^(neighbourhood|suburb|quarter)$"]["name"]({BBOX}););out center tags;')
    elems = json.loads(get(OVERPASS, RAW / "osm" / "pois.json", q))["elements"]
    seen, out = set(), []
    order = ["station", "park", "landmark", "campus", "neighborhood"]
    rows = []
    for e in elems:
        t = e.get("tags", {})
        kind = next((POI_KINDS[k] for k in POI_KINDS if k in t), None)
        la, lo = (e["lat"], e["lon"]) if "lat" in e else (e.get("center", {}).get("lat"), e.get("center", {}).get("lon"))
        if kind is None or la is None:
            continue
        r, c = to_rc(la, lo)
        if not (0 <= r < (LAT_N - LAT_S) * M_PER_DEG_LAT / CELL_M and 0 <= c < (LON_E - LON_W) * M_PER_DEG_LON / CELL_M):
            continue
        rows.append((order.index(kind), t["name"], kind, round(c * 10), round(r * 10)))
    for _, name, kind, x, y in sorted(rows):
        if name.lower() in seen:
            continue
        seen.add(name.lower())
        out.append([name, kind, x, y])
    return out


def main():
    mosaic, tx0, ty0 = build_mosaic()
    print(f"mosaic {mosaic.shape}, elevation {mosaic.min():.1f} .. {mosaic.max():.1f} m")

    W = int(round((LON_E - LON_W) * M_PER_DEG_LON / CELL_M))
    H = int(round((LAT_N - LAT_S) * M_PER_DEG_LAT / CELL_M))
    px_m = 2 * math.pi * EARTH_R * math.cos(math.radians(lat0)) / (256 * 2 ** ZOOM)

    # Grid cell centres -> mosaic pixel coordinates.
    lon = LON_W + (np.arange(W) + 0.5) * CELL_M / M_PER_DEG_LON
    lat = LAT_N - (np.arange(H) + 0.5) * CELL_M / M_PER_DEG_LAT
    LON, LAT = np.meshgrid(lon, lat)
    tx, ty = lonlat_to_tile(LON, LAT, ZOOM)
    px, py = (tx - tx0) * 256 - 0.5, (ty - ty0) * 256 - 0.5

    def mosaic_at(la, lo):
        x, y = lonlat_to_tile(np.array(lo), np.array(la), ZOOM)
        return float((y - ty0) * 256 - 0.5), float((x - tx0) * 256 - 0.5)

    smooth = ndimage.gaussian_filter(np.maximum(mosaic, 0.0), SMOOTH_M / px_m)
    elev = ndimage.map_coordinates(smooth, [py, px], order=1)
    land = ndimage.map_coordinates((mosaic > LAND_MIN_M).astype(float), [py, px], order=1) > 0.5
    lbl, nl = ndimage.label(land)
    sizes = ndimage.sum(land, lbl, range(1, nl + 1))
    land = np.isin(lbl, 1 + np.flatnonzero(sizes >= 40))  # drop piers and rocks
    elev = np.where(land, np.maximum(elev, LAND_MIN_M), 0.0)
    elev = np.round(elev * 100) / 100  # the page sees centimetre precision; find peaks on the same values
    print(f"grid {W} x {H} at {CELL_M:.0f} m, land {land.mean():.0%}, highest {elev.max() * 3.28084:.0f} ft (smoothed)")

    peaks = find_peaks(elev, land)

    # Name hilltops from OSM summits: closest pairs first, each used once.
    q = f'[out:json][timeout:60];(node["natural"="peak"]({BBOX});node["natural"="hill"]({BBOX}););out;'
    osm = json.loads(get(OVERPASS, RAW / "osm" / "peaks.json", q))["elements"]
    osm += [{"lat": la, "lon": lo, "tags": {"name": n}} for n, la, lo in EXTRA_SUMMITS]
    claims = []
    for j, o in enumerate(osm):
        orow, ocol = to_rc(o["lat"], o["lon"])
        for i, p in enumerate(peaks):
            d = math.hypot(orow - p["r"], ocol - p["c"]) * CELL_M
            if d <= NAME_RADIUS_M and p["prom"] >= 1.0:  # skip flat-top artifacts
                claims.append((d, i, j))
    claims.sort()
    named, used = {}, set()
    for d, i, j in claims:
        if i in named or j in used:
            continue
        o = osm[j]
        raw = o["tags"].get("name") or UNNAMED_OSM.get((round(o["lat"], 5), round(o["lon"], 5)))
        if not raw:
            continue
        name = ALIASES.get(raw, raw)
        if name in {v[0] for v in named.values()}:
            continue
        try:
            summit_m = float(o["tags"]["ele"].split()[0])
        except (KeyError, ValueError):
            summit_m = None
        named[i] = (name, summit_m, o["lat"], o["lon"])
        used.add(j)

    def raw_summit(la, lo, radius_m):
        y, x = mosaic_at(la, lo)
        k = int(radius_m / px_m)
        return float(mosaic[int(y) - k:int(y) + k + 1, int(x) - k:int(x) + k + 1].max())

    by_cell = {p["cell"]: i for i, p in enumerate(peaks)}

    def place_near(r, c):
        return min(PLACES, key=lambda p: math.hypot(*(np.subtract(to_rc(p[1], p[2]), (r, c)))))[0]

    def summit_height(osm_m, lidar_m):
        # Use the mapped OSM height when it agrees with the lidar to within
        # 10 ft. Otherwise take the higher one: bare-earth lidar clips rocky
        # summits (Corona Heights) and some OSM heights are low (Twin Peaks).
        if osm_m is None:
            return lidar_m
        return osm_m if abs(osm_m - lidar_m) <= 3.0 else max(osm_m, lidar_m)

    def describe(i):
        p = peaks[i]
        if p["prom"] >= HILL_PROM_M:
            return f"Hill near {place_near(p['r'], p['c'])}"
        # A minor top: name it after the hill it merges into, if that is close.
        j = i
        while peaks[j]["into"] is not None and j not in named and peaks[j]["prom"] < HILL_PROM_M:
            j = by_cell[peaks[j]["into"]]
        dist = math.hypot(peaks[j]["r"] - p["r"], peaks[j]["c"] - p["c"]) * CELL_M
        if j != i and dist <= 700:
            parent = named[j][0] if j in named else f"the hill near {place_near(peaks[j]['r'], peaks[j]['c'])}"
            return f"Shoulder of {parent}"
        return f"Rise near {place_near(p['r'], p['c'])}"

    hills = []
    for i, p in enumerate(peaks):
        edge = p["r"] >= H - 2 or p["c"] <= 1 or p["c"] >= W - 2 or p["r"] <= 1
        if i not in named and p["prom"] < (3.0 if edge else TOP_PROM_M):
            continue
        name, summit_m, ola, olo = named.get(i, (None, None, None, None))
        if ola is not None:
            lidar_m = raw_summit(ola, olo, 40)  # at the mapped summit
        else:
            lidar_m = raw_summit(LAT_N - (p["r"] + 0.5) * CELL_M / M_PER_DEG_LAT, LON_W + (p["c"] + 0.5) * CELL_M / M_PER_DEG_LON, 70)
        if edge and i not in named:
            name = "City line, toward Daly City" if p["r"] >= H - 2 else "Edge of the map"
        hills.append({
            "name": name or describe(i),
            "named": i in named,
            "edge": bool(edge),
            "r": p["r"], "c": p["c"],
            "elev": round(p["elev"], 2),
            "prom": round(p["prom"], 1),
            "summit_ft": round(summit_height(summit_m, lidar_m) * 3.28084),
        })
    for h in hills:
        print(f"  {h['name']:30s} {h['summit_ft']:5d} ft  prom {h['prom'] * 3.28084:5.0f} ft  {'edge' if h['edge'] else ''}")
    print(f"{len(hills)} destinations ({sum(h['named'] for h in hills)} named, "
          f"{sum(h['prom'] >= HILL_PROM_M for h in hills)} hills); "
          f"{len(peaks) - len(hills)} minor bumps; unmatched OSM: "
          f"{[o['tags'].get('name') for j, o in enumerate(osm) if j not in used]}")

    places = []
    for name, la, lo, show in PLACES:
        if show:
            r, c = to_rc(la, lo)
            places.append({"name": name, "r": round(r, 1), "c": round(c, 1)})

    names = {}
    streets = build_streets(names)
    print(f"{len(streets)} street segments, {sum(len(s) for s in streets) // 2} points")
    addresses, n_anchor = build_addresses(names)
    print(f"{n_anchor} address anchors on {len(addresses)} streets")
    pois = build_pois()
    print(f"{len(pois)} named places")

    cm = np.clip(np.round(elev * 100), 0, 65535).astype("<u2")  # centimetres
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({
        "width": W, "height": H, "cell_m": CELL_M, "smooth_m": SMOOTH_M,
        "bbox": {"west": LON_W, "east": LON_E, "south": LAT_S, "north": LAT_N},
        "elev_cm_b64": base64.b64encode(cm.tobytes()).decode(),
        "hills": hills,
        "places": places,
        "streets": streets,
        "street_names": list(names),
        "addresses": addresses,
        "pois": pois,
    }, separators=(",", ":")))
    print(f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size / 1e6:.2f} MB)")


if __name__ == "__main__":
    main()
