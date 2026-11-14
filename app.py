# Streamlit dashboard for both operators and students

#Run from repo root:
#streamlit run app.py

import sys
from pathlib import Path

import pandas as pd
import streamlit as st

# so import config works
sys.path.append(str(Path(__file__).resolve().parents[1]))

from train import predict_final
from decide import recommend
from carpool import match
from emissions import distance_km, co2_saved

BOOKINGS_CSV = Path(__file__).resolve().parent / "data" / "simulated" / "bookings.csv"

st.set_page_config(page_title="ShareWay UTP", page_icon="🚍", layout="wide")
st.title("ShareWay UTP")
st.caption("AI-powered shared transport for UTP student travel")
#to label simulated data on screen
st.warning("This is a demo using simulated data and not real student bookings.")

@st.cache_data
def load_routes():
    if BOOKINGS_CSV.exists():
        df = pd.read_csv(BOOKINGS_CSV)
        if "route" in df.columns:
            return sorted(df["route"].unique())
    return ["A", "B", "C"]

def load_bookings():
    if BOOKINGS_CSV.exists():
        return pd.read_csv(BOOKINGS_CSV, parse_dates=["departure_date"])
    return None

view = st.sidebar.radio("Select View", ["Operator", "Student"])

# Operator View
if view == "Operator":
    st.header("Operator view")
    df = load_bookings()
    mode = st.radio("Input", ["Simulated trip", "Manual"], horizontal=True)
    actual = None

    if mode == "Simulated trip" and df is not None:
        c1, c2, c3 = st.columns(3)
        route = c1.selectbox("Route", sorted(df["route"].unique()))
        events = sorted(df[df["route"] == route]["event_name"].unique())
        event = c2.selectbox("Event", events)
        trips = df[(df["route"] == route) & (df["event_name"] == event)]
        keys = sorted({(int(t), int(s)) for t, s in zip(trips["trip_id"], trips["sim_run"])})
        trip_id, sim_run = c3.selectbox("Trip (id, run)", keys)
        trip = trips[(trips["trip_id"] == trip_id) & (trips["sim_run"] == sim_run)]

        days_before = int(st.select_slider(
            "Days before departure",
            options=sorted(trip["days_before"].unique(), reverse=True)))
        row = trip[trip["days_before"] == days_before].iloc[0]

        date = row["departure_date"].date()
        is_holiday = bool(row["is_holiday"])
        bookings_so_far = int(row["bookings_so_far"])
        actual = int(row["final_passengers"])
        st.write(f"**Date:** {date} | **Holiday:** {is_holiday} | "
                 f"**Bookings so far:** {bookings_so_far}")
    else:
        c1, c2, c3 = st.columns(3)
        route = c1.selectbox("Route", load_routes())
        date = c2.date_input("Departure date")
        is_holiday = c3.checkbox("Public holiday / break", value=True)
        days_before = st.slider("Days before departure", 0, 30, 7)
        bookings_so_far = st.number_input("Bookings so far", 0, 500, 20)

    if st.button("Forecast", type="primary"):
        predicted = predict_final(route, days_before, bookings_so_far, date, is_holiday)
        rec = recommend(predicted)

        m1, m2, m3, m4 = st.columns(4)
        m1.metric("Predicted final", f"{predicted:.0f}")
        if actual is not None:
            m2.metric("Actual final (simulated)", actual,
                      delta=f"{predicted - actual:+.0f} error", delta_color="off")
        m3.metric("Action", rec["action"].upper())
        m4.metric("Buses", rec["buses"])
        if rec["standby"]:
            st.info("Standby bus recommended (last bus is almost full).")
        if rec["action"] == "cancel":
            st.error("Trip recommended for cancellation - students will be offered carpools.")

#Student View

else:
    st.header("Student Dashboard")

    """ Alternative: Load data from CSV (simulated data) (if we have one)
    passengers_df = pd.read_csv("data/simulated/passengers.csv", parse_dates=["departure_time"])
    drivers_df = pd.read_csv("data/simulated/drivers.csv", parse_dates=["departure_time"])
    drivers_df["willing"] = drivers_df["willing"].astype(bool)
    """
    #LOADED USING MOCK DATA FOR PASSENGERS AND DRIVERS
    passengers_df = pd.DataFrame({
        "passenger_id": ["P1", "P2", "P3", "P4"],
        "dest_lat": [4.5975, 4.6100, 3.1390, 5.4141],       # Ipoh, Ipoh, KL, Penang
        "dest_lon": [101.0901, 101.1000, 101.6869, 100.3288],
        "departure_time": pd.to_datetime([
            "2026-12-19 08:00", "2026-12-19 09:00",
            "2026-12-19 08:30", "2026-12-19 08:00"]),
    })
    drivers_df = pd.DataFrame({
        "driver_id": ["D1", "D2"],
        "willing": [True, True],
        "spare_seats": [2, 3],
        "dest_lat": [4.6000, 3.1500],
        "dest_lon": [101.0950, 101.6900],
        "departure_time": pd.to_datetime(["2026-12-19 08:30", "2026-12-19 09:00"]),
    })

    st.write("Passengers needing a ride", passengers_df)
    st.write("Student drivers", drivers_df)

    if st.button("Find carpools"):
        matches = match(passengers_df, drivers_df)
        if matches.empty:
            st.warning("No carpool matches found.")
        else:
            st.success(f"{len(matches)} passenger(s) matched.")
            st.dataframe(matches, use_container_width=True)
            unmatched = set(passengers_df["passenger_id"]) - set(matches["passenger_id"])
            if unmatched:
                st.caption(f"Not matched: {', '.join(sorted(unmatched))}")

    st.subheader("CO2 Emissions and Cost Saved")
    n = st.number_input("Passengers", 1,5,3)
    dist = st.number_input("Distance (km)", 1.0, 1000.0, 120.0)
    vehicle = st.selectbox("Vehicle Type", ["Bus", "Van", "Car"])
    saved = co2_saved(n, dist, vehicle)
    a,b = st.columns(2)
    a.metric("CO2 Emissions Saved (kg)", f"{saved['kg_co2']:.1f}")
    b.metric("Cost Saved (MYR)", f"{saved['cost_myr']:.2f}")

