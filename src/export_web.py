"""
Export everything the web dashboard (web/) needs into web/data/dashboard.json.

The web dashboard is a static site (deployed on Vercel), so it cannot run
scikit-learn. Instead this script writes:
  - every simulated trip, with the REAL model's prediction at each snapshot
  - the model's error (MAE) at each days_before, from train.py's split
  - a compact Random Forest (few, shallow trees) as plain arrays, so the
    browser can forecast trips typed in by hand. Its error is measured on
    the same test split and shown in the dashboard.
  - the constants from config.py and emissions.py, so the JavaScript copies
    of recommend(), match() and co2_saved() use the same numbers

Run from the repo root, after simulate.py and train.py:
    python src/export_web.py
Re-run it whenever the data, the model or config.py changes.
"""

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_absolute_error

# so "import config" and the other src/ modules work
sys.path.append(str(Path(__file__).resolve().parents[1]))
sys.path.append(str(Path(__file__).resolve().parent))
import config as C  # noqa: E402
import emissions as E  # noqa: E402
import train as T  # noqa: E402

OUT_FILE = C.ROOT / "web" / "data" / "dashboard.json"

# Small enough to load quickly in a browser (a few hundred KB)
COMPACT = {"n_estimators": 30, "max_depth": 10, "min_samples_leaf": 5}
ROUTE_CODES = sorted(C.ROUTES)


def encode(df):
    """Same columns the trained pipeline sees: one-hot route, then the rest."""
    cols = [(df["route"] == r).astype(float) for r in ROUTE_CODES]
    rest = [df[f].astype(float) for f in C.FEATURES if f != "route"]
    return np.column_stack(cols + rest)


def feature_names():
    return [f"route_{r}" for r in ROUTE_CODES] + [f for f in C.FEATURES if f != "route"]


def fit_compact(df):
    model = RandomForestRegressor(**COMPACT, random_state=C.RANDOM_SEED, n_jobs=-1)
    return model.fit(encode(df), df[C.TARGET])


def forest_to_json(model):
    """Each tree as arrays. Leaf nodes have feature -1. Go left when x <= threshold."""
    trees = []
    for est in model.estimators_:
        t = est.tree_
        leaf = t.children_left == -1
        trees.append({
            "f": np.where(leaf, -1, t.feature).tolist(),
            "t": np.where(leaf, 0, np.round(t.threshold, 4)).tolist(),
            "l": t.children_left.tolist(),
            "r": t.children_right.tolist(),
            "v": np.round(t.value[:, 0, 0], 3).tolist(),
        })
    return trees


def export_trips(df):
    """One entry per trip, snapshots ordered from earliest to latest."""
    df = df.copy()
    df["predicted"] = np.maximum(0.0, T.load_model().predict(df[C.FEATURES]))
    trips = []
    for trip_id, g in df.sort_values("days_before", ascending=False).groupby("trip_id", sort=True):
        first = g.iloc[0]
        trips.append({
            "id": int(trip_id),
            "run": int(first["sim_run"]),
            "event": first["event_name"],
            "date": first["departure_date"],
            "route": first["route"],
            "dow": int(first["day_of_week"]),
            "holiday": int(first["is_holiday"]),
            "offset": int(first["departure_offset"]),
            "final": int(first[C.TARGET]),
            # [days_before, bookings_so_far, predicted_final]
            "snaps": [[int(d), int(b), round(float(p), 1)]
                      for d, b, p in zip(g["days_before"], g["bookings_so_far"], g["predicted"])],
        })
    return trips


def model_accuracy(df):
    """MAE on unseen trips, same split as train.py, plus the compact web model."""
    train_df, test_df = T.split_by_trip(df)
    predictions = T.evaluate(train_df, test_df)
    predictions["Web model (compact)"] = fit_compact(train_df).predict(encode(test_df))
    overall = {name: round(mean_absolute_error(test_df[C.TARGET], predictions[name]), 2)
               for name in predictions.columns}
    by_snapshot = T.mae_by_snapshot(test_df, predictions).round(2)
    return {
        "overall": overall,
        "by_days_before": {
            "days": [int(d) for d in by_snapshot.index],
            "series": {name: by_snapshot[name].tolist() for name in by_snapshot.columns},
        },
        "test_trips": int(test_df["trip_id"].nunique()),
        "mean_final": round(float(test_df[C.TARGET].mean()), 1),
    }


def numeric_constants(module):
    return {k: getattr(module, k) for k in dir(module)
            if k.isupper() and isinstance(getattr(module, k), (int, float))
            and not isinstance(getattr(module, k), bool)}


def export():
    df = pd.read_csv(C.SIM_FILE)
    breaks = pd.read_csv(C.BREAKS_FILE)

    print("Measuring model accuracy...")
    accuracy = model_accuracy(df)
    print("Training compact web model on every trip...")
    compact = fit_compact(df)

    data = {
        "generated_from": "SIMULATED data (data/simulated/bookings.csv), not real student bookings",
        "config": {
            "UTP": list(C.UTP),
            "ROUTES": {code: {"name": r["name"], "states": r["states"],
                              "stops": {s: list(p) for s, p in r["stops"].items()}}
                       for code, r in C.ROUTES.items()},
            **{k: getattr(C, k) for k in ["BUS_CAPACITY", "VAN_CAPACITY", "STANDBY_FRACTION",
                                          "MIN_PASSENGERS", "MAX_TIME_DIFF_HOURS",
                                          "MAX_DETOUR_KM", "SNAPSHOT_DAYS"]},
        },
        "emissions": numeric_constants(E),
        "breaks": breaks.to_dict(orient="records"),
        "accuracy": accuracy,
        "web_model": {
            "features": feature_names(),
            "params": COMPACT,
            "trees": forest_to_json(compact),
        },
        "trips": export_trips(df),
    }

    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUT_FILE.write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")
    size_kb = OUT_FILE.stat().st_size / 1024
    print(f"\nMAE on test trips: {accuracy['overall']}")
    print(f"Wrote {len(data['trips'])} trips to {OUT_FILE} ({size_kb:.0f} KB)")


if __name__ == "__main__":
    export()
