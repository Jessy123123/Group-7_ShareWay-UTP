"""
Step 2: train the demand model on the SIMULATED booking data.

The model learns how bookings seen early relate to the final passengers:
    route, days_before, bookings_so_far, day_of_week, is_holiday -> final_passengers

Every approach starts from the same simple forecast (the baseline):
    bookings so far / usual share of bookings made by that day
The machine learning models then learn a CORRECTION to the baseline (how much
the final number tends to be above or below it for this route, day and
break), instead of the final number itself. A tree model that predicts the
final number directly can only repeat numbers it saw in training, so it
mostly ignores bookings that are unusually high or low. Predicting the
correction keeps the forecast tied to the real bookings.

The model is CHOSEN with 5-fold cross-validation on the training trips only,
then every approach is scored once on the test trips (not used for the choice).

Approaches compared:
  - Baseline
  - Linear Regression  (baseline x learned correction)
  - Random Forest      (baseline x learned correction)
  - Gradient Boosting  (baseline x learned correction)

The data is split by trip_id, not by row. Each trip has one row per snapshot,
all with the same final_passengers, so a row split would leak answers into
the test set.

Run from the repo root:
    python src/train.py
"""

import sys
from functools import lru_cache
from pathlib import Path

import joblib
import matplotlib
matplotlib.use("Agg")  # save charts without opening a window
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
from sklearn.compose import ColumnTransformer  # noqa: E402
from sklearn.ensemble import HistGradientBoostingRegressor, RandomForestRegressor  # noqa: E402
from sklearn.linear_model import LinearRegression  # noqa: E402
from sklearn.metrics import mean_absolute_error  # noqa: E402
from sklearn.model_selection import GroupKFold, GroupShuffleSplit  # noqa: E402
from sklearn.pipeline import Pipeline  # noqa: E402
from sklearn.preprocessing import OneHotEncoder  # noqa: E402

# so "import config" and "from decide import ..." work
sys.path.append(str(Path(__file__).resolve().parents[1]))
sys.path.append(str(Path(__file__).resolve().parent))
import config as C  # noqa: E402
from decide import recommend  # noqa: E402

MODEL_FILE = C.ROOT / "models" / "demand_model.joblib"
CHART_DIR = C.ROOT / "outputs" / "model"

BASELINE = "Baseline"


def split_by_trip(df):
    """80/20 split that keeps all the rows of a trip on the same side."""
    splitter = GroupShuffleSplit(n_splits=1, test_size=C.TEST_SIZE,
                                 random_state=C.RANDOM_SEED)
    train_idx, test_idx = next(splitter.split(df, groups=df["trip_id"]))
    return df.iloc[train_idx], df.iloc[test_idx]


def fit_baseline(train):
    """Usual bookings so far, as a share of final passengers, at each snapshot."""
    totals = train.groupby("days_before")[["bookings_so_far", C.TARGET]].sum()
    return totals["bookings_so_far"] / totals[C.TARGET]


def predict_baseline(shares, df):
    """Bookings so far / usual share booked by then. Days between snapshots
    use a share interpolated between the two nearest snapshots."""
    shares = shares.sort_index()
    share = np.interp(df["days_before"], shares.index.astype(float), shares.values)
    return df["bookings_so_far"] / share


# The models learn log((final + 1) / (baseline + 1)). The +1 keeps it defined
# when there are no bookings yet; the log makes "twice as many" and "half as
# many" equally big mistakes.
def to_correction(final, baseline):
    return np.log((final + 1) / (baseline + 1))


def from_correction(correction, baseline):
    return np.maximum(0.0, (baseline + 1) * np.exp(correction) - 1)


# Inputs outside what the simulation covers are moved to the nearest value it
# does cover, so the model is never asked about situations it has not seen.
DAYS_RANGE = (min(C.SNAPSHOT_DAYS), max(C.SNAPSHOT_DAYS))
OFFSET_RANGE = {  # same rule as simulate.py: holidays only use offsets >= -1
    0: (min(C.DEPARTURE_DAY), max(C.DEPARTURE_DAY)),
    1: (max(-1, min(C.DEPARTURE_DAY)), max(C.DEPARTURE_DAY)),
}


def clip_inputs(df):
    df = df.copy()
    df["days_before"] = df["days_before"].clip(*DAYS_RANGE)
    for holiday, (lo, hi) in OFFSET_RANGE.items():
        rows = df["is_holiday"] == holiday
        df.loc[rows, "departure_offset"] = df.loc[rows, "departure_offset"].clip(lo, hi)
    return df


def make_models():
    """The machine learning models. Route is a letter, so it is one-hot encoded."""
    def pipeline(model):
        encode = ColumnTransformer(
            [("route", OneHotEncoder(handle_unknown="ignore"), ["route"])],
            remainder="passthrough")
        return Pipeline([("encode", encode), ("model", model)])

    return {
        "Linear Regression": pipeline(LinearRegression()),
        "Random Forest": pipeline(RandomForestRegressor(
            n_estimators=200, min_samples_leaf=5, n_jobs=-1,
            random_state=C.RANDOM_SEED)),
        "Gradient Boosting": pipeline(HistGradientBoostingRegressor(
            random_state=C.RANDOM_SEED)),
    }


def fit_correction(df):
    """Baseline shares, the correction each training row needs, and the
    smallest and largest correction seen at each snapshot."""
    shares = fit_baseline(df)
    correction = to_correction(df[C.TARGET], predict_baseline(shares, df))
    limits = correction.groupby(df["days_before"]).agg(["min", "max"])
    return {"shares": {int(d): float(v) for d, v in shares.items()},
            "correction_range": {int(d): [float(r["min"]), float(r["max"])]
                                 for d, r in limits.iterrows()}}, correction


def apply_correction(bundle, df, correction):
    """Final passengers from a predicted correction. The correction is kept
    inside the range seen in training for that days_before, so an unusual
    input (e.g. no bookings at all a day before) cannot give a wild forecast."""
    days = pd.Series(bundle["correction_range"]).sort_index()
    lo = np.interp(df["days_before"], days.index.astype(float), [r[0] for r in days])
    hi = np.interp(df["days_before"], days.index.astype(float), [r[1] for r in days])
    baseline = predict_baseline(pd.Series(bundle["shares"]), df)
    return from_correction(np.clip(correction, lo, hi), baseline)


def fit_bundle(name, df):
    """Fit the baseline and one model on df. The result is what gets saved."""
    bundle, correction = fit_correction(df)
    model = make_models()[name]
    model.fit(df[C.FEATURES], correction)
    return {"name": name, "model": model, **bundle}


def predict_rows(bundle, df):
    """Predicted final passengers for every row of df (needs the FEATURES columns)."""
    df = clip_inputs(df)
    return apply_correction(bundle, df, bundle["model"].predict(df[C.FEATURES]))


# Forecast range (safety margin). The range is measured, not guessed: the model
# forecasts trips it was not trained on (cross-validation by trip) and we keep
# how far off it was at each days_before. Errors are kept as
# log((actual + 1) / (forecast + 1)), like the correction, so the range grows
# with the size of the trip. Vehicles are then planned for the high end.

def oof_margins(fit, predict, df):
    """RANGE_LOW and RANGE_HIGH percentiles of the error at each days_before,
    from forecasts of trips the model did not see.
    fit(rows) -> model, predict(model, rows) -> forecasts."""
    forecast = pd.Series(np.nan, index=df.index)
    folds = GroupKFold(n_splits=C.MARGIN_FOLDS)
    for train_idx, test_idx in folds.split(df, groups=df["trip_id"]):
        model = fit(df.iloc[train_idx])
        forecast.iloc[test_idx] = np.asarray(predict(model, df.iloc[test_idx]), dtype=float)
    error = np.log((df[C.TARGET] + 1) / (forecast + 1))
    q = error.groupby(df["days_before"]).quantile([C.RANGE_LOW, C.RANGE_HIGH]).unstack()
    return {int(d): [float(r[C.RANGE_LOW]), float(r[C.RANGE_HIGH])] for d, r in q.iterrows()}


def fit_margins(name, df):
    """Error range of model `name`, measured on trips it was not trained on."""
    return oof_margins(lambda rows: fit_bundle(name, rows), predict_rows, df)


def apply_margins(margins, days_before, forecast):
    """(low, high) around each forecast. Days between snapshots are interpolated."""
    m = pd.Series(margins).sort_index()
    days = np.clip(np.asarray(days_before, dtype=float), *DAYS_RANGE)
    lo = np.interp(days, m.index.astype(float), [r[0] for r in m])
    hi = np.interp(days, m.index.astype(float), [r[1] for r in m])
    forecast = np.asarray(forecast, dtype=float)
    low = np.maximum(0.0, (forecast + 1) * np.exp(lo) - 1)
    high = (forecast + 1) * np.exp(hi) - 1
    return np.minimum(low, forecast), np.maximum(high, forecast)


def range_report(test, forecast, low, high):
    """How the range performs on unseen trips: how often the real number falls
    inside it, and what planning for the high end costs and saves."""
    actual = test[C.TARGET].to_numpy()
    seats_forecast = np.array([seats_planned(p) for p in forecast])
    seats_high = np.array([seats_planned(p) for p in high])
    days = test["days_before"].to_numpy()
    inside = (actual >= low) & (actual <= high)
    by_days = pd.DataFrame({"days": days, "inside": inside, "width": high - low}) \
        .groupby("days").mean().sort_index(ascending=False)
    return {
        "inside_pct": 100 * float(inside.mean()),
        "short_pct_forecast": 100 * float(np.mean(seats_forecast < actual)),
        "short_pct_high": 100 * float(np.mean(seats_high < actual)),
        "extra_seats": float(np.mean(seats_high - seats_forecast)),
        "by_days": {int(d): {"inside_pct": round(100 * r["inside"], 1), "width": round(r["width"], 1)}
                    for d, r in by_days.iterrows()},
    }


def choose_model(train):
    """Pick the best model with cross-validation on the TRAINING trips only
    (folds split by trip), so the test trips are used just once, for the final
    score. Returns (best name, average error of every model across the folds)."""
    folds = GroupKFold(n_splits=C.MARGIN_FOLDS)
    errors = {name: [] for name in make_models()}
    for fit_idx, val_idx in folds.split(train, groups=train["trip_id"]):
        fit_rows, val_rows = train.iloc[fit_idx], train.iloc[val_idx]
        for name in errors:
            forecast = predict_rows(fit_bundle(name, fit_rows), val_rows)
            errors[name].append(mean_absolute_error(val_rows[C.TARGET], forecast))
    cv_mae = pd.Series({name: float(np.mean(e)) for name, e in errors.items()})
    return cv_mae.idxmin(), cv_mae


def evaluate(train, test):
    """Predict the test trips with every approach. Returns one column per approach."""
    predictions = pd.DataFrame(index=test.index)
    predictions[BASELINE] = predict_baseline(fit_baseline(train), test)
    for name in make_models():
        predictions[name] = predict_rows(fit_bundle(name, train), test)
    return predictions


def seats_planned(demand):
    """Seats the vehicle plan provides for a forecast, standby bus included."""
    rec = recommend(demand)
    if rec["action"] == "van":
        return C.VAN_CAPACITY
    return (rec["buses"] + rec["standby"]) * C.BUS_CAPACITY


def short_trips(test, predictions):
    """Share of test rows (%) where the plan made from the forecast has fewer
    seats than the passengers who actually turned up."""
    return pd.Series({name: 100 * np.mean([seats_planned(p) < y for p, y
                                           in zip(predictions[name], test[C.TARGET])])
                      for name in predictions.columns})


def mae_by_snapshot(test, predictions):
    """Average error in passengers at each days_before, one column per approach."""
    rows = {}
    for days, idx in test.groupby("days_before").groups.items():
        rows[days] = {name: mean_absolute_error(test.loc[idx, C.TARGET], predictions.loc[idx, name])
                      for name in predictions.columns}
    return pd.DataFrame(rows).T.sort_index(ascending=False)


def save_chart(by_snapshot):
    CHART_DIR.mkdir(parents=True, exist_ok=True)
    fig, ax = plt.subplots(figsize=(8, 4.5))
    for name in by_snapshot.columns:
        ax.plot(by_snapshot.index, by_snapshot[name], marker="o", label=name)
    ax.invert_xaxis()   # time runs towards departure
    ax.set_xlabel("Days before departure")
    ax.set_ylabel("Average error (passengers)")
    ax.set_title("Forecast error as departure gets closer (simulated data)")
    ax.spines[["top", "right"]].set_visible(False)
    ax.legend(frameon=False)
    fig.tight_layout()
    fig.savefig(CHART_DIR / "mae_by_days_before.png", dpi=150)
    plt.close(fig)


def train():
    df = pd.read_csv(C.SIM_FILE)
    train_df, test_df = split_by_trip(df)
    print(
        f"Training trips: {train_df.trip_id.nunique()}, test trips: {test_df.trip_id.nunique()}")

    # Choose the model with cross-validation on the training trips only
    best_name, cv_mae = choose_model(train_df)
    print(f"\nModel choice ({C.MARGIN_FOLDS}-fold cross-validation on the training trips, MAE):")
    print(cv_mae.round(2).to_string())
    print(f"Chosen: {best_name}")

    # Test trips: used once, for the final scores
    predictions = evaluate(train_df, test_df)
    overall = pd.Series({name: mean_absolute_error(test_df[C.TARGET], predictions[name])
                         for name in predictions.columns})
    by_snapshot = mae_by_snapshot(test_df, predictions)

    print(
        f"\nAverage final passengers per test row: {test_df[C.TARGET].mean():.1f}")
    print("\nAverage error (MAE, passengers), all snapshots:")
    print(overall.round(1).to_string())
    print("\nAverage error (MAE, passengers) at each days_before:")
    print(by_snapshot.round(1).to_string())
    print("\nTrips planned with too few seats (%), all snapshots:")
    print(short_trips(test_df, predictions).round(1).to_string())
    save_chart(by_snapshot)

    # Forecast range: errors measured on the training trips only, checked on the test trips
    low, high = apply_margins(fit_margins(best_name, train_df), test_df["days_before"],
                              predictions[best_name])
    rep = range_report(test_df, predictions[best_name], low, high)
    print(f"\nForecast range ({best_name}, {C.RANGE_LOW:.0%} to {C.RANGE_HIGH:.0%} of past errors), test trips:")
    print(f"  Real number inside the range: {rep['inside_pct']:.1f}%")
    print(f"  Trips short of seats: {rep['short_pct_forecast']:.1f}% planning for the forecast, "
          f"{rep['short_pct_high']:.1f}% planning for the high end")
    print(f"  Cost: {rep['extra_seats']:.1f} extra seats per trip on average")
    print("  At each days_before (range width in passengers, % inside):")
    for d, r in rep["by_days"].items():
        print(f"    {d:>2}  width {r['width']:>5.1f}  inside {r['inside_pct']:>5.1f}%")

    # Retrain on every trip and measure the range on every trip for the saved model
    best = fit_bundle(best_name, df)
    best["margins"] = fit_margins(best_name, df)
    best["range"] = [C.RANGE_LOW, C.RANGE_HIGH]
    best["cv_mae"] = cv_mae.round(2).to_dict()
    MODEL_FILE.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(best, MODEL_FILE)
    print(f"\nSaved {best_name} to {MODEL_FILE}")
    print(f"Chart saved to {CHART_DIR / 'mae_by_days_before.png'}")


@lru_cache(maxsize=1)
def load_model():
    """The model saved by train(): a dict with its name, the model and the
    baseline shares. Run `python src/train.py` first if it is missing."""
    if not MODEL_FILE.exists():
        raise FileNotFoundError(
            f"No trained model at {MODEL_FILE}. Run `python src/train.py` from the repo root first.")
    bundle = joblib.load(MODEL_FILE)
    if not isinstance(bundle, dict) or "margins" not in bundle:
        raise RuntimeError(
            f"{MODEL_FILE} was saved by an older train.py. Run `python src/train.py` again.")
    return bundle


@lru_cache(maxsize=1)
def load_breaks():
    return pd.read_csv(C.BREAKS_FILE, parse_dates=["first_day"])


def departure_offset(departure_date, is_holiday):
    """Days from the first day of the nearest break (-1 = the day before it)."""
    breaks = load_breaks()
    breaks = breaks[breaks["is_holiday"] == int(is_holiday)]
    days = (pd.Timestamp(departure_date) - breaks["first_day"]).dt.days
    return int(days.loc[days.abs().idxmin()])


def predict_final(route, days_before, bookings_so_far, departure_date, is_holiday):
    """Estimated final passengers for one trip. This is an estimate, not a guarantee."""
    row = pd.DataFrame([{
        "route": route,
        "days_before": days_before,
        "bookings_so_far": bookings_so_far,
        "day_of_week": pd.Timestamp(departure_date).day_of_week,
        "is_holiday": int(is_holiday),
        "departure_offset": departure_offset(departure_date, is_holiday),
    }])
    return float(np.asarray(predict_rows(load_model(), row))[0])


def predict_range(route, days_before, bookings_so_far, departure_date, is_holiday):
    """(low, forecast, high) final passengers for one trip. Plan vehicles for
    `high`: the real number was above it in only about RANGE_HIGH of past
    unseen trips' errors, so fewer trips end up short of seats."""
    forecast = predict_final(route, days_before, bookings_so_far, departure_date, is_holiday)
    low, high = apply_margins(load_model()["margins"], [days_before], [forecast])
    return float(low[0]), forecast, float(high[0])


if __name__ == "__main__":
    train()
