"""
Step 1: generate a SIMULATED booking dataset for training.

For every travel period in breaks.csv, every route (A, B, C) and every
departure day, the script creates one trip, draws how many students book it,
when each of them books (booking curve) and who does not show up. It then
records the bookings at several points before departure (snapshots).

Each output row = one trip seen at one snapshot:
    route, days_before, bookings_so_far, day_of_week, is_holiday -> final_passengers

Run from the repo root:
    python src/simulate.py
"""

import config as C
import sys
from pathlib import Path

import numpy as np
import pandas as pd

# so "import config" works
sys.path.append(str(Path(__file__).resolve().parents[1]))


def expected_riders(route, is_holiday, rng):
    """Average number of students who would book a bus/van seat on this route for one break."""
    leave = C.LEAVE_RATE * (C.HOLIDAY_LEAVE_FACTOR if is_holiday else 1.0)
    base = C.TOTAL_STUDENTS * leave * C.ROUTE_SHARE[route] * C.BUS_UPTAKE
    # Breaks are never identical: scale demand up or down a little
    return base * rng.lognormal(mean=0.0, sigma=C.EVENT_NOISE)


def sample_booking_days(n, rng):
    """How many days before departure each of n students books (from survey Q12)."""
    buckets = list(C.BOOKING_TIMING.values())
    shares = np.array([b[0] for b in buckets])
    picks = rng.choice(len(buckets), size=n, p=shares / shares.sum())
    return np.array([rng.integers(buckets[i][1], buckets[i][2] + 1) for i in picks], dtype=int)


def simulate():
    rng = np.random.default_rng(C.RANDOM_SEED)
    breaks = pd.read_csv(C.BREAKS_FILE, parse_dates=["first_day", "last_day"])

    offsets = np.array(list(C.DEPARTURE_DAY.keys()))
    day_shares = np.array(list(C.DEPARTURE_DAY.values()))
    day_shares = day_shares / day_shares.sum()

    rows, trip_id = [], 0
    for run in range(C.SIM_REPEATS):
        for _, br in breaks.iterrows():
            is_holiday = int(br["is_holiday"])
            # Short holidays: students don't skip days of lectures, so only
            # the day before, the first day and the day after are used.
            keep = (offsets >= -
                    1) if is_holiday else np.ones_like(offsets, dtype=bool)
            ev_offsets, ev_shares = offsets[keep], day_shares[keep] / \
                day_shares[keep].sum()
            # A, B, C ("Other" has no bus)
            for route in C.ROUTES:
                total = expected_riders(route, is_holiday, rng)
                for offset, share in zip(ev_offsets, ev_shares):
                    dep_date = br["first_day"] + pd.Timedelta(days=int(offset))
                    dow = dep_date.dayofweek
                    mean = total * share * C.DAY_OF_WEEK_FACTOR[dow]

                    n_booked = rng.poisson(mean)
                    book_days = sample_booking_days(n_booked, rng)
                    no_shows = rng.binomial(n_booked, C.NO_SHOW_RATE)
                    final = n_booked - no_shows

                    for d in C.SNAPSHOT_DAYS:
                        rows.append({
                            "trip_id": trip_id,
                            "sim_run": run,
                            "event_name": br["event_name"],
                            "departure_date": dep_date.date(),
                            "route": route,
                            "days_before": d,
                            "bookings_so_far": int((book_days >= d).sum()),
                            "day_of_week": dow,
                            "is_holiday": is_holiday,
                            "final_passengers": int(final),
                        })
                    trip_id += 1

    df = pd.DataFrame(rows)
    C.SIM_DIR.mkdir(parents=True, exist_ok=True)
    df.to_csv(C.SIM_FILE, index=False)
    return df


if __name__ == "__main__":
    df = simulate()
    print(
        f"Saved {len(df):,} rows ({df.trip_id.nunique():,} trips) to {C.SIM_FILE}")
    print("\nAverage final passengers per trip:")
    trips = df.drop_duplicates("trip_id")
    print(trips.groupby(["route", "is_holiday"]).final_passengers.mean().round(1).unstack()
          .rename(columns={0: "sem_break", 1: "public_holiday"}))
    print("\nAverage bookings seen at each snapshot (booking curve):")
    print(df.groupby("days_before").bookings_so_far.mean().round(
        1).sort_index(ascending=False))
