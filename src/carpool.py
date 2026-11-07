"""
Step 4: match passengers with student drivers who have spare seats.

A passenger can ride with a driver when:
  - the driver is willing to offer seats and still has one free,
  - their departure times differ by at most MAX_TIME_DIFF_HOURS, and
  - dropping the passenger off adds at most MAX_DETOUR_KM to the drive.

Everyone starts at UTP. The detour is the extra distance the driver covers:
    UTP -> passenger -> driver's destination   minus   UTP -> driver's destination

Matches are made in order of smallest time difference, then smallest detour,
so the best pairs are picked first.

Expected columns:
  passengers_df: passenger_id, departure_time, dest_lat, dest_lon
  drivers_df:    driver_id, departure_time, dest_lat, dest_lon,
                 spare_seats (int), willing (True/False)

Run from the repo root for a small demo with made-up data:
    python src/carpool.py
"""

import math
import sys
from pathlib import Path

import pandas as pd

# so "import config" and "import emissions" work
sys.path.append(str(Path(__file__).resolve().parents[1]))
sys.path.append(str(Path(__file__).resolve().parent))
import config as C  # noqa: E402

try:
    from emissions import distance_km  # Muqri's version
except ImportError:
    # PLACEHOLDER until emissions.py has distance_km(). Remove this block
    # once Muqri's version is merged.
    def distance_km(a, b):
        """Straight-line distance in km between two (lat, lon) points."""
        lat1, lon1 = map(math.radians, a)
        lat2, lon2 = map(math.radians, b)
        h = (math.sin((lat2 - lat1) / 2) ** 2
             + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2)
        return 2 * 6371 * math.asin(math.sqrt(h))


def detour_km(passenger_dest, driver_dest):
    """Extra km a driver covers to drop the passenger on the way home."""
    via_passenger = (distance_km(C.UTP, passenger_dest)
                     + distance_km(passenger_dest, driver_dest))
    direct = distance_km(C.UTP, driver_dest)
    return via_passenger - direct


def match(passengers_df, drivers_df):
    """Pair passengers with drivers. Returns one row per match, ranked by
    time difference, then detour. Unmatched passengers are not in the result."""
    drivers = drivers_df[drivers_df["willing"] & (drivers_df["spare_seats"] > 0)]

    # 1. every passenger-driver pair that meets both limits
    candidates = []
    for _, p in passengers_df.iterrows():
        p_dest = (p["dest_lat"], p["dest_lon"])
        for _, d in drivers.iterrows():
            gap = abs(p["departure_time"] - d["departure_time"])
            hours = gap.total_seconds() / 3600
            if hours > C.MAX_TIME_DIFF_HOURS:
                continue
            extra = detour_km(p_dest, (d["dest_lat"], d["dest_lon"]))
            if extra > C.MAX_DETOUR_KM:
                continue
            candidates.append({
                "passenger_id": p["passenger_id"],
                "driver_id": d["driver_id"],
                "time_diff_hours": round(hours, 2),
                "detour_km": round(extra, 1),
            })

    columns = ["passenger_id", "driver_id", "time_diff_hours", "detour_km"]
    if not candidates:
        return pd.DataFrame(columns=columns)

    # 2. best pairs first; each passenger once, each driver up to their seats
    ranked = pd.DataFrame(candidates).sort_values(["time_diff_hours", "detour_km"])
    seats_left = drivers.set_index("driver_id")["spare_seats"].to_dict()
    matched_passengers = set()
    chosen = []
    for _, row in ranked.iterrows():
        if row["passenger_id"] in matched_passengers:
            continue
        if seats_left[row["driver_id"]] == 0:
            continue
        seats_left[row["driver_id"]] -= 1
        matched_passengers.add(row["passenger_id"])
        chosen.append(row)

    return pd.DataFrame(chosen, columns=columns).reset_index(drop=True)


def demo():
    """Small made-up example (SIMULATED, not survey data)."""
    t = pd.Timestamp("2026-12-15 09:00")
    hours = pd.Timedelta(hours=1)
    teluk_intan = (4.0259, 101.0213)
    ipoh = C.ROUTES["C"]["stops"]["Ipoh"]
    kl = C.ROUTES["B"]["stops"]["Kuala Lumpur"]

    drivers = pd.DataFrame([
        # driver_id, departure_time, dest, spare_seats, willing
        {"driver_id": "D1", "departure_time": t, "dest": kl, "spare_seats": 2, "willing": True},
        {"driver_id": "D2", "departure_time": t + 5 * hours, "dest": kl, "spare_seats": 3, "willing": True},
        {"driver_id": "D3", "departure_time": t, "dest": kl, "spare_seats": 3, "willing": False},
        {"driver_id": "D4", "departure_time": t + hours, "dest": ipoh, "spare_seats": 1, "willing": True},
    ])
    passengers = pd.DataFrame([
        {"passenger_id": "P1", "departure_time": t, "dest": kl},
        {"passenger_id": "P2", "departure_time": t + 2 * hours, "dest": kl},
        {"passenger_id": "P3", "departure_time": t + hours, "dest": kl},
        {"passenger_id": "P4", "departure_time": t, "dest": teluk_intan},
        {"passenger_id": "P5", "departure_time": t + hours, "dest": ipoh},
    ])
    for df in (drivers, passengers):
        df["dest_lat"] = df["dest"].str[0]
        df["dest_lon"] = df["dest"].str[1]

    result = match(passengers, drivers)
    print("Carpool matches (SIMULATED demo data)")
    print(result.to_string(index=False))
    unmatched = set(passengers["passenger_id"]) - set(result["passenger_id"])
    print("Unmatched passengers:", sorted(unmatched) or "none")


if __name__ == "__main__":
    demo()
