"""
Step 2: train the demand model on the SIMULATED booking data.

The model learns how bookings seen early relate to the final passengers:
    route, days_before, bookings_so_far, day_of_week, is_holiday -> final_passengers

Three approaches are compared on trips the model has not seen:
  - Baseline: bookings so far / usual share of bookings made by that day
  - Linear Regression
  - Random Forest

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
import pandas as pd  # noqa: E402
from sklearn.compose import ColumnTransformer  # noqa: E402
from sklearn.ensemble import RandomForestRegressor  # noqa: E402
from sklearn.linear_model import LinearRegression  # noqa: E402
from sklearn.metrics import mean_absolute_error  # noqa: E402
from sklearn.model_selection import GroupShuffleSplit  # noqa: E402
from sklearn.pipeline import Pipeline  # noqa: E402
from sklearn.preprocessing import OneHotEncoder  # noqa: E402

# so "import config" works
sys.path.append(str(Path(__file__).resolve().parents[1]))
import config as C  # noqa: E402

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
    return df["bookings_so_far"] / df["days_before"].map(shares)


def make_models():
    """The two machine learning models. Route is a letter, so it is one-hot encoded."""
    def pipeline(model):
        encode = ColumnTransformer(
            [("route", OneHotEncoder(handle_unknown="ignore"), ["route"])],
            remainder="passthrough")
        return Pipeline([("encode", encode), ("model", model)])

    return {
        "Linear Regression": pipeline(LinearRegression()),
        "Random Forest": pipeline(RandomForestRegressor(
            n_estimators=100, min_samples_leaf=5, n_jobs=-1,
            random_state=C.RANDOM_SEED)),
    }


def evaluate(train, test):
    """Predict the test trips with every approach. Returns one column per approach."""
    predictions = pd.DataFrame(index=test.index)
    predictions[BASELINE] = predict_baseline(fit_baseline(train), test)
    for name, model in make_models().items():
        model.fit(train[C.FEATURES], train[C.TARGET])
        predictions[name] = model.predict(test[C.FEATURES])
    return predictions


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
    save_chart(by_snapshot)

    # Keep the better machine learning model, retrained on every trip
    best_name = overall.drop(BASELINE).idxmin()
    best = make_models()[best_name].fit(df[C.FEATURES], df[C.TARGET])
    MODEL_FILE.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(best, MODEL_FILE)
    print(f"\nSaved {best_name} to {MODEL_FILE}")
    print(f"Chart saved to {CHART_DIR / 'mae_by_days_before.png'}")


@lru_cache(maxsize=1)
def load_model():
    return joblib.load(MODEL_FILE)


def predict_final(route, days_before, bookings_so_far, departure_date, is_holiday):
    """Estimated final passengers for one trip. This is an estimate, not a guarantee."""
    row = pd.DataFrame([{
        "route": route,
        "days_before": days_before,
        "bookings_so_far": bookings_so_far,
        "day_of_week": pd.Timestamp(departure_date).dayofweek,
        "is_holiday": int(is_holiday),
    }])
    return max(0.0, float(load_model().predict(row[C.FEATURES])[0]))


if __name__ == "__main__":
    train()
