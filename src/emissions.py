"""
Distances, CO2 and money saved by shared transport.

A shared trip (university bus, van or carpool) is compared with every
passenger making the same journey alone, by driving their own car or by
e-hailing:

    saved = what the passengers would emit / pay travelling alone
          - what the shared trip emits / what they pay for it

CO2 counts the whole vehicle, so a near-empty bus can save LESS than
nothing (that is why decide.py cancels small trips). Money is what the
students pay, as the proposal promises lower travel costs for students.

For a carpool the student driver is going home anyway, so the only extra
CO2 is the detour, and the riders split petrol and tolls with the driver.

All distances passed in are straight-line km from distance_km(). They are
turned into road km once, inside co2_saved(), with ROAD_FACTOR.

Labels follow config.py:
  # PUBLISHED   value from a published source (noted next to it)
  # ASSUMPTION  team estimate, no operator data available

Run from the repo root for a demo:
    python src/emissions.py
"""

import math
import sys
from pathlib import Path

# so "import config" works
sys.path.append(str(Path(__file__).resolve().parents[1]))
import config as C  # noqa: E402

# Distances
EARTH_RADIUS_KM = 6371.0  # PUBLISHED: mean Earth radius

# Roads are longer than a straight line. UTP to Kuala Lumpur is about 160 km
# straight and about 205-220 km by road (North-South Expressway).
ROAD_FACTOR = 1.3  # ASSUMPTION

# Emission factors
# Source: UK DESNZ, Greenhouse gas reporting: conversion factors 2026
# (flat file, revised July 2026), Scope 1 / Scope 3 land travel, kg CO2e.
# https://www.gov.uk/government/publications/greenhouse-gas-reporting-conversion-factors-2026
# Malaysia has no equivalent public table, so the UK factors are used.
PETROL_KG_PER_LITRE = 2.35372  # PUBLISHED: Petrol (100% mineral); Malaysian RON95 has no ethanol
DIESEL_KG_PER_LITRE = 2.58354  # PUBLISHED: Diesel (average biofuel blend); Malaysia sells B10/B20
CAR_KG_PER_KM = 0.16152  # PUBLISHED: Average car, petrol, per vehicle-km
VAN_KG_PER_KM = 0.28046  # PUBLISHED: Van class III (1.74-3.5 t), diesel, e.g. Toyota Hiace
TAXI_KG_PER_KM = 0.20806  # PUBLISHED: Regular taxi, per vehicle-km (used for e-hailing)

# DESNZ only gives coaches per passenger-km at UK occupancy, which hides the
# effect of empty seats. So the bus is worked out from its fuel use instead.
BUS_LITRES_PER_KM = 0.30  # ASSUMPTION: 44-seat diesel coach, about 30 L/100 km

CARPOOL_MAX_RIDERS = 4  # ASSUMPTION: 5-seat car, driver plus 4 riders

# Prices and fares
# Source: paultan.org, Malaysian fuel prices 5-11 Nov 2026.
# https://paultan.org/2026/11/04/malaysian-fuel-prices-nov-5-to-11-2026-prices-down-diesel-to-rm5-12-ron95-to-rm4-27-ron97-to-rm4-70/
PETROL_RM_PER_LITRE = 1.99  # PUBLISHED: RON95 under BUDI95 (Malaysian students)

# Source: motorist.my toll list 2026, PLUS Sungai Besi-Skudai, class 1:
# RM33.21 for about 296 km.
# https://www.motorist.my/article/2829/list-of-malaysia-highway-toll-rates-plus-klk-lpt-and-others
TOLL_RM_PER_KM = 0.11  # PUBLISHED (derived): 33.21 / 296

# Source: Grab Malaysia fare structure from Jan 2023 (soyacincau.com):
# RM2 base + RM0.25 per km + RM0.43 per minute.
# https://soyacincau.com/2023/01/17/grab-malaysia-raises-fare-prices-per-minute-this-is-why/
GRAB_BASE_RM = 2.00  # PUBLISHED
GRAB_RM_PER_KM = 0.25  # PUBLISHED
GRAB_RM_PER_MIN = 0.43  # PUBLISHED
HIGHWAY_KMH = 80  # ASSUMPTION: average speed, to turn km into minutes

# A university bus or van seat is priced like a public express bus.
# Source: busonlineticket.com, Seri Iskandar to TBS, Kesatuan Express RM25
# for about 205 road km.
# https://www.busonlineticket.com/booking/seri-iskandar-to-tbs-(terminal-bersepadu-selatan)-bus-tickets
SEAT_RM_PER_KM = 0.12  # PUBLISHED (derived): 25 / 205

BASELINES = ("car", "ehailing")
VEHICLES = ("bus", "van", "carpool")


# Distances

def distance_km(a, b):
    """Straight-line distance in km between two (lat, lon) points (haversine)."""
    lat1, lon1 = map(math.radians, a)
    lat2, lon2 = map(math.radians, b)
    h = (math.sin((lat2 - lat1) / 2) ** 2
         + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2)
    return 2 * EARTH_RADIUS_KM * math.asin(math.sqrt(h))


def stop_km(route, stop):
    """Straight-line km along a route, UTP -> each stop in config order -> stop."""
    points = [C.UTP]
    for name, point in C.ROUTES[route]["stops"].items():
        points.append(point)
        if name == stop:
            return sum(distance_km(a, b) for a, b in zip(points, points[1:]))
    raise KeyError(f"No stop '{stop}' on route {route}")


def route_km(route):
    """Straight-line km of the whole route, to its last stop."""
    last = list(C.ROUTES[route]["stops"])[-1]
    return stop_km(route, last)


# One person travelling alone

def car_rm_per_km():
    """Driving your own car: petrol plus tolls."""
    litres_per_km = CAR_KG_PER_KM / PETROL_KG_PER_LITRE  # about 6.9 L/100 km
    return litres_per_km * PETROL_RM_PER_LITRE + TOLL_RM_PER_KM


def grab_fare(road_km):
    """E-hailing fare for one trip: base + distance + time, plus tolls."""
    minutes = road_km / HIGHWAY_KMH * 60
    return (GRAB_BASE_RM + GRAB_RM_PER_KM * road_km
            + GRAB_RM_PER_MIN * minutes + TOLL_RM_PER_KM * road_km)


def solo(passengers, road_km, baseline):
    """CO2 (kg) and cost (RM) if every passenger travels alone."""
    if baseline == "car":
        return (passengers * road_km * CAR_KG_PER_KM,
                passengers * road_km * car_rm_per_km())
    if baseline == "ehailing":
        return (passengers * road_km * TAXI_KG_PER_KM,
                passengers * grab_fare(road_km))
    raise ValueError(f"baseline must be one of {BASELINES}, not '{baseline}'")


# The shared trip

def shared(passengers, road_km, vehicle, detour_road_km):
    """CO2 (kg), what the passengers pay (RM) and how many vehicles run."""
    if vehicle == "bus":
        count = math.ceil(passengers / C.BUS_CAPACITY)
        kg = count * road_km * BUS_LITRES_PER_KM * DIESEL_KG_PER_LITRE
        return kg, passengers * road_km * SEAT_RM_PER_KM, count
    if vehicle == "van":
        count = math.ceil(passengers / C.VAN_CAPACITY)
        kg = count * road_km * VAN_KG_PER_KM
        return kg, passengers * road_km * SEAT_RM_PER_KM, count
    if vehicle == "carpool":
        if passengers > CARPOOL_MAX_RIDERS:
            raise ValueError(f"a carpool takes at most {CARPOOL_MAX_RIDERS} riders, "
                             f"not {passengers}")
        # The driver goes anyway: only the detour adds CO2.
        kg = detour_road_km * CAR_KG_PER_KM
        # Riders split the driver's petrol and tolls with the driver.
        trip_cost = (road_km + detour_road_km) * car_rm_per_km()
        return kg, trip_cost * passengers / (passengers + 1), 1
    raise ValueError(f"vehicle must be one of {VEHICLES}, not '{vehicle}'")


def co2_saved(passengers, distance_km, vehicle, baseline="car", detour_km=0.0):
    """CO2 and money saved by a shared trip compared with travelling alone.

    passengers  students on the trip (carpool: riders, not the driver)
    distance_km straight-line km from distance_km() or stop_km()
    vehicle     "bus", "van" or "carpool"
    baseline    "car" (drive alone) or "ehailing"
    detour_km   carpool only: detour from carpool.match(), straight-line km

    Returns kg_co2 and rm_saved, plus the numbers behind them for the app.
    """
    if distance_km < 0 or detour_km < 0:
        raise ValueError("distance_km and detour_km cannot be negative")
    if passengers <= 0:
        return {"kg_co2": 0.0, "rm_saved": 0.0, "solo_kg": 0.0, "shared_kg": 0.0,
                "solo_rm": 0.0, "shared_rm": 0.0, "vehicles": 0}

    road = distance_km * ROAD_FACTOR
    solo_kg, solo_rm = solo(passengers, road, baseline)
    shared_kg, shared_rm, count = shared(passengers, road, vehicle,
                                         detour_km * ROAD_FACTOR)
    return {
        "kg_co2": round(solo_kg - shared_kg, 1),
        "rm_saved": round(solo_rm - shared_rm, 2),
        "solo_kg": round(solo_kg, 1),
        "shared_kg": round(shared_kg, 1),
        "solo_rm": round(solo_rm, 2),
        "shared_rm": round(shared_rm, 2),
        "vehicles": count,
    }


def demo():
    print("Estimated road distance from UTP (straight line x ROAD_FACTOR)")
    for code, r in C.ROUTES.items():
        for stop in r["stops"]:
            print(f"  Route {code}  {stop:<17} {stop_km(code, stop) * ROAD_FACTOR:5.0f} km")

    kl = stop_km("B", "Kuala Lumpur")
    teluk_intan = (4.0259, 101.0213)
    ti = distance_km(C.UTP, teluk_intan)
    trips = [  # SIMULATED examples
        ("Southbound to KL, 40 students, bus", 40, kl, "bus", 0),
        ("Southbound to KL, 80 students, bus", 80, kl, "bus", 0),
        ("Southbound to KL, 8 students, van", 8, kl, "van", 0),
        ("Southbound to KL, 4 students, bus", 4, kl, "bus", 0),
        ("Teluk Intan carpool, 3 riders", 3, ti, "carpool", 2),
    ]
    print("\nSaved compared with travelling alone (SIMULATED trips)")
    print(f"  {'trip':<38}{'vs':<10}{'CO2 kg':>9}{'RM':>10}")
    for label, n, km, vehicle, detour in trips:
        for baseline in BASELINES:
            s = co2_saved(n, km, vehicle, baseline, detour)
            print(f"  {label:<38}{baseline:<10}{s['kg_co2']:>9.1f}{s['rm_saved']:>10.2f}")


if __name__ == "__main__":
    demo()
