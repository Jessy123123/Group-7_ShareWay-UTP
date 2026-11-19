"""
End-to-end demo scenarios. Every number printed here comes from the real
functions, run on the SIMULATED data:

    predict_final() -> recommend() -> match() -> co2_saved()

  1. Southbound on 15 December (peak travel before the Sept 2026 sem break)
  2. A low-demand trip that is cancelled
  3. A full vehicle: last bus almost full, so a standby bus is added
  4. Carpool to Teluk Intan (off-route, too few students for a bus)

Scenarios 1-3 pick trips from data/simulated/bookings.csv, so they still work
after simulate.py is re-run. Scenario 4 uses made-up students (SIMULATED).

Run from the repo root, after simulate.py and train.py:
    python src/scenarios.py
"""

import math
import sys
from pathlib import Path

import pandas as pd

# so "import config" and the other src/ modules work
sys.path.append(str(Path(__file__).resolve().parents[1]))
sys.path.append(str(Path(__file__).resolve().parent))
import config as C  # noqa: E402
from carpool import match  # noqa: E402
from decide import recommend  # noqa: E402
from emissions import co2_saved, distance_km, stop_km  # noqa: E402
from train import load_model, predict_final, predict_rows  # noqa: E402

DEMO_RUN = 0  # which simulation run to take trips from


def describe(rec):
    if rec["action"] == "cancel":
        return "CANCEL (offer carpools)"
    if rec["action"] == "van":
        return "1 van"
    plural = "es" if rec["buses"] > 1 else ""
    return f"{rec['buses']} bus{plural}" + (" + 1 standby" if rec["standby"] else "")


def heading(title):
    print("\n" + "-" * 70)
    print(title)
    print("-" * 70)


def forecast_row(row):
    """predict_final() for one row of bookings.csv."""
    return predict_final(row["route"], int(row["days_before"]), int(row["bookings_so_far"]),
                         row["departure_date"], bool(row["is_holiday"]))


def print_trip(row, predicted):
    rec = recommend(predicted)
    actual = int(row["final_passengers"])
    print(f"  Trip {row['trip_id']}: route {row['route']} ({C.ROUTES[row['route']]['name']}), "
          f"{row['departure_date']}, {row['event_name']}")
    print(f"  {int(row['days_before'])} days before departure: "
          f"{int(row['bookings_so_far'])} bookings so far")
    print(f"  Forecast final passengers: {predicted:.1f}  ->  plan: {describe(rec)}")
    print(f"  Actual final (simulated):  {actual}  ->  ideal plan: {describe(recommend(actual))}")
    return rec, actual


def scenario_peak(df):
    heading("Scenario 1: Southbound on 15 December (peak travel)")
    rows = df[(df["route"] == "B") & (df["departure_date"] == "2026-12-15")
              & (df["sim_run"] == DEMO_RUN)]
    if rows.empty:
        print("  No Southbound trip on 2026-12-15 in the simulated data.")
        return
    for days in (14, 7, 3):
        print()
        row = rows[rows["days_before"] == days].iloc[0]
        print_trip(row, forecast_row(row))

    actual = int(rows.iloc[0]["final_passengers"])
    km = stop_km("B", "Kuala Lumpur")
    for baseline in ("car", "ehailing"):
        s = co2_saved(actual, km, "bus", baseline)
        print(f"  Saved vs {baseline:<8} (UTP -> Kuala Lumpur): "
              f"{s['kg_co2']:,.0f} kg CO2, RM {s['rm_saved']:,.0f}")


def scenario_cancel(snap):
    heading("Scenario 2: low-demand trip that is cancelled")
    cancelled = snap[snap["plan"].map(lambda r: r["action"]) == "cancel"]
    if cancelled.empty:
        print(f"  No trip forecast under {C.MIN_PASSENGERS} passengers in this run.")
        return
    row = cancelled.sort_values("predicted").iloc[0]
    print_trip(row, forecast_row(row))
    print(f"  Fewer than {C.MIN_PASSENGERS} passengers expected, so the trip is cancelled.")
    first_stop = list(C.ROUTES[row["route"]]["stops"])[0]
    s = co2_saved(int(row["final_passengers"]), stop_km(row["route"], first_stop), "bus", "car")
    print(f"  Running the bus anyway (UTP -> {first_stop}) would save {s['kg_co2']:.0f} kg CO2 "
          "vs these students driving alone (negative = the near-empty bus emits more).")
    print("  The booked students are offered carpools instead (see scenario 4).")


def scenario_full(snap):
    heading("Scenario 3: full vehicle -> standby bus")
    full = snap[snap["plan"].map(lambda r: r["standby"])]
    if full.empty:
        print("  No trip in this run fills its last bus.")
    else:
        row = full.sort_values("predicted").iloc[0]
        rec, _ = print_trip(row, forecast_row(row))
        demand = math.ceil(row["predicted"])   # recommend() rounds up
        last = demand - (rec["buses"] - 1) * C.BUS_CAPACITY
        print(f"  Planned for {demand}: the last bus would carry {last}/{C.BUS_CAPACITY} "
              f"(>= {C.STANDBY_FRACTION:.0%} full), so a standby bus is kept ready.")

    print("\n  Where the plan changes vehicle:")
    standby_from = math.ceil(C.STANDBY_FRACTION * C.BUS_CAPACITY)
    for demand in (C.MIN_PASSENGERS - 1, C.MIN_PASSENGERS, C.VAN_CAPACITY, C.VAN_CAPACITY + 1,
                   standby_from - 1, standby_from, C.BUS_CAPACITY + 1):
        print(f"    {demand:>3} passengers -> {describe(recommend(demand))}")


def scenario_teluk_intan():
    heading("Scenario 4: carpool to Teluk Intan (off-route, SIMULATED students)")
    teluk_intan = (4.0259, 101.0213)
    kl = C.ROUTES["B"]["stops"]["Kuala Lumpur"]
    t = pd.Timestamp("2026-12-15 09:00")
    hour = pd.Timedelta(hours=1)

    drivers = pd.DataFrame([
        {"driver_id": "D1", "departure_time": t, "dest": teluk_intan, "spare_seats": 3, "willing": True},
        {"driver_id": "D2", "departure_time": t + 4 * hour, "dest": teluk_intan, "spare_seats": 2, "willing": True},
        {"driver_id": "D3", "departure_time": t + hour, "dest": kl, "spare_seats": 2, "willing": True},
    ])
    passengers = pd.DataFrame([
        {"passenger_id": "P1", "departure_time": t, "dest": teluk_intan},
        {"passenger_id": "P2", "departure_time": t + hour, "dest": teluk_intan},
        {"passenger_id": "P3", "departure_time": t + 5 * hour, "dest": teluk_intan},
        {"passenger_id": "P4", "departure_time": t + 2 * hour, "dest": (4.0500, 101.0400)},
    ])
    for frame in (drivers, passengers):
        frame["dest_lat"] = frame["dest"].str[0]
        frame["dest_lon"] = frame["dest"].str[1]

    print(f"  {len(passengers)} students going to Teluk Intan, {len(drivers)} student drivers "
          f"(limits: {C.MAX_TIME_DIFF_HOURS} h apart, {C.MAX_DETOUR_KM} km detour)")
    result = match(passengers, drivers)
    print(result.to_string(index=False) if not result.empty else "  No matches.")
    unmatched = sorted(set(passengers["passenger_id"]) - set(result["passenger_id"]))
    print("  Unmatched:", ", ".join(unmatched) or "none")

    km = distance_km(C.UTP, teluk_intan)
    for driver, riders in result.groupby("driver_id"):
        s = co2_saved(len(riders), km, "carpool", "car", riders["detour_km"].max())
        print(f"  {driver} takes {len(riders)} rider(s): saves {s['kg_co2']:.1f} kg CO2 and "
              f"RM {s['rm_saved']:.2f} vs each driving alone "
              f"(each rider pays RM {s['shared_rm'] / len(riders):.2f})")


def run_scenarios():
    print("=" * 70)
    print("SHAREWAY UTP: END-TO-END DEMO SCENARIOS (SIMULATED data)")
    print(f"Demand model: {load_model()['name']}")
    print("=" * 70)

    df = pd.read_csv(C.SIM_FILE)
    df["departure_date"] = df["departure_date"].astype(str)
    snap = df[(df["sim_run"] == DEMO_RUN) & (df["days_before"] == 3)].copy()
    snap["predicted"] = predict_rows(load_model(), snap)
    snap["plan"] = snap["predicted"].map(recommend)

    scenario_peak(df)
    scenario_cancel(snap)
    scenario_full(snap)
    scenario_teluk_intan()


if __name__ == "__main__":
    run_scenarios()
