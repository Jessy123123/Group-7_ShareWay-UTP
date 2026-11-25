"""
Fetch the real road path of each bus route (UTP -> its stops, in order) and
save it for the dashboard's route map: web/data/route_paths.json.

The paths come from OSRM (https://project-osrm.org), a free router built on
OpenStreetMap road data. This only needs to run again when a route or a stop
in config.py changes; the website reads the saved file, so the map never
depends on OSRM being up.

Run from the repo root:
    python src/fetch_route_paths.py
"""

import json
import sys
import urllib.request
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parents[1]))
import config as C  # noqa: E402

OUT_FILE = C.ROOT / "web" / "data" / "route_paths.json"
OSRM = "https://router.project-osrm.org/route/v1/driving/{coords}?overview=full&geometries=geojson"
TOLERANCE_DEG = 0.002   # simplify: drop points closer than ~200 m to the line (file stays small)


def simplify(points, tol):
    """Douglas-Peucker line simplification on [lat, lon] points."""
    if len(points) < 3:
        return points
    (y1, x1), (y2, x2) = points[0], points[-1]
    dx, dy = x2 - x1, y2 - y1
    norm = (dx * dx + dy * dy) ** 0.5 or 1e-12
    far, far_i = 0.0, 0
    for i, (y, x) in enumerate(points[1:-1], start=1):
        d = abs(dy * x - dx * y + x2 * y1 - y2 * x1) / norm
        if d > far:
            far, far_i = d, i
    if far <= tol:
        return [points[0], points[-1]]
    return simplify(points[:far_i + 1], tol)[:-1] + simplify(points[far_i:], tol)


def road_path(stops):
    """[lat, lon] stops -> (road km, [lat, lon] path) along the roads."""
    coords = ";".join(f"{lon},{lat}" for lat, lon in stops)
    req = urllib.request.Request(OSRM.format(coords=coords), headers={"User-Agent": "shareway-utp-route-map"})
    with urllib.request.urlopen(req, timeout=60) as res:
        body = json.load(res)
    if body.get("code") != "Ok":
        raise RuntimeError(f"OSRM: {body.get('code')} {body.get('message', '')}")
    route = body["routes"][0]
    path = [[round(lat, 5), round(lon, 5)] for lon, lat in route["geometry"]["coordinates"]]
    return route["distance"] / 1000, simplify(path, TOLERANCE_DEG)


def main():
    routes = {}
    for code, r in C.ROUTES.items():
        stops = [C.UTP, *r["stops"].values()]
        km, path = road_path(stops)
        routes[code] = {"km": round(km, 1), "path": path}
        print(f"Route {code}: {km:.0f} km by road, {len(path)} points")
    OUT_FILE.write_text(json.dumps({
        "source": "OSRM (project-osrm.org), road data (c) OpenStreetMap contributors",
        "routes": routes,
    }, separators=(",", ":")), encoding="utf-8")
    print(f"Saved {OUT_FILE} ({OUT_FILE.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
