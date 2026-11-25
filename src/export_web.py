"""
Export everything the web dashboard (web/) needs into web/data/dashboard.json.

The web dashboard is a static site (deployed on Vercel), so it cannot run
scikit-learn. Instead this script writes:
  - every simulated trip, with the REAL model's prediction at each snapshot
  - the model's error (MAE) at each days_before, from train.py's split
  - the trained model itself (models/demand_model.joblib, Gradient Boosting)
    as plain arrays of trees, so the browser runs the SAME model for trips
    typed in by hand (What-if) or replayed day by day (Live). The browser's
    forecasts match Python's exactly (see check_web_model.py notes in README).
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
from sklearn.metrics import mean_absolute_error

# so "import config" and the other src/ modules work
sys.path.append(str(Path(__file__).resolve().parents[1]))
sys.path.append(str(Path(__file__).resolve().parent))
import config as C  # noqa: E402
import emissions as E  # noqa: E402
import train as T  # noqa: E402

OUT_FILE = C.ROOT / "web" / "data" / "dashboard.json"

ROUTE_CODES = sorted(C.ROUTES)


def encode(df):
    """Same columns the trained pipeline sees: one-hot route, then the rest."""
    cols = [(df["route"] == r).astype(float) for r in ROUTE_CODES]
    rest = [df[f].astype(float) for f in C.FEATURES if f != "route"]
    return np.column_stack(cols + rest)


def feature_names():
    return [f"route_{r}" for r in ROUTE_CODES] + [f for f in C.FEATURES if f != "route"]


def boosting_to_json(model):
    """HistGradientBoostingRegressor: one tree per boosting round. Prediction =
    the model's starting value + the sum of every tree's leaf (the learning rate
    is already applied to the leaves). Leaf nodes have feature -1. Go left when
    x <= threshold. No feature is categorical or missing here."""
    trees = []
    for (predictor,) in model._predictors:
        n = predictor.nodes
        leaf = n["is_leaf"].astype(bool)
        if n["is_categorical"].any():
            raise ValueError("categorical splits are not supported by the browser model")
        trees.append({
            "f": np.where(leaf, -1, n["feature_idx"]).astype(int).tolist(),
            "t": np.where(leaf, 0, n["num_threshold"]).tolist(),
            "l": n["left"].astype(int).tolist(),
            "r": n["right"].astype(int).tolist(),
            "v": n["value"].tolist(),
        })
    return trees


def web_model_trees(bundle):
    """The saved model's trees for logic.js: Gradient Boosting (summed) or, if
    train.py ever picks it, Random Forest (averaged)."""
    pipe = bundle["model"]
    names = [n.split("__", 1)[1] for n in pipe.named_steps["encode"].get_feature_names_out()]
    if names != feature_names():
        raise ValueError(f"model inputs {names} differ from what logic.js builds {feature_names()}")
    est = pipe.named_steps["model"]
    if hasattr(est, "_predictors"):
        p = est.get_params()
        return {"kind": "boosting", "base": float(np.ravel(est._baseline_prediction)[0]),
                "params": {"max_iter": int(est.n_iter_), "learning_rate": p["learning_rate"],
                           "max_leaf_nodes": p["max_leaf_nodes"]},
                "trees": boosting_to_json(est)}
    if hasattr(est, "estimators_"):
        return {"kind": "forest", "base": 0.0,
                "params": {"n_estimators": len(est.estimators_)}, "trees": forest_to_json(est)}
    raise ValueError(f"{bundle['name']} can't be exported to the browser (no trees)")


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
            "v": np.round(t.value[:, 0, 0], 5).tolist(),
        })
    return trees


def export_trips(df):
    """One entry per trip, snapshots ordered from earliest to latest."""
    df = df.copy()
    bundle = T.load_model()
    df["predicted"] = np.asarray(T.predict_rows(bundle, df), dtype=float)
    df["low"], df["high"] = T.apply_margins(bundle["margins"], df["days_before"], df["predicted"])
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
            # [days_before, bookings_so_far, predicted_final, low, high]
            "snaps": [[int(d), int(b), round(float(p), 1), round(float(lo), 1), round(float(hi), 1)]
                      for d, b, p, lo, hi in zip(g["days_before"], g["bookings_so_far"],
                                                 g["predicted"], g["low"], g["high"])],
        })
    return trips


def model_accuracy(df):
    """MAE on unseen trips, same split as train.py."""
    train_df, test_df = T.split_by_trip(df)
    predictions = T.evaluate(train_df, test_df)
    overall = {name: round(mean_absolute_error(test_df[C.TARGET], predictions[name]), 2)
               for name in predictions.columns}
    by_snapshot = T.mae_by_snapshot(test_df, predictions).round(2)
    saved = T.load_model()
    best = saved["name"]
    # forecast range: errors measured on the training trips, checked on the test trips
    low, high = T.apply_margins(T.fit_margins(best, train_df), test_df["days_before"], predictions[best])
    rng = T.range_report(test_df, predictions[best], low, high)
    return {
        "best_model": best,
        # how the model was chosen: 5-fold cross-validation on the training trips only
        "cv_mae": saved.get("cv_mae", {}),
        "range": {"levels": [C.RANGE_LOW, C.RANGE_HIGH], **{k: (round(v, 1) if isinstance(v, float) else v)
                                                         for k, v in rng.items()}},
        "overall": overall,
        "short_trips_pct": T.short_trips(test_df, predictions).round(1).to_dict(),
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
    bundle = T.load_model()   # the trained model, the same one the trips above use
    web = web_model_trees(bundle)

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
            "name": bundle["name"],
            "kind": web["kind"],          # boosting: base + sum of trees; forest: mean of trees
            "base": web["base"],
            "features": feature_names(),
            "params": web["params"],
            # The trees predict log((final + 1) / (baseline + 1)), see train.py
            "baseline_shares": {d: v for d, v in bundle["shares"].items()},
            "correction_range": {d: [lo, hi] for d, (lo, hi) in bundle["correction_range"].items()},
            "days_range": list(T.DAYS_RANGE),
            "offset_range": {str(h): list(r) for h, r in T.OFFSET_RANGE.items()},
            # forecast range: (forecast + 1) * exp(margin) - 1, see train.apply_margins()
            "margins": {d: [lo, hi] for d, (lo, hi) in bundle["margins"].items()},
            "trees": web["trees"],
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
