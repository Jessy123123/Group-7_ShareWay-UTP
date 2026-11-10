"""
Unit tests for src/emissions.py. Uses only the standard library (unittest).

Run from the repo root:
    python -m unittest discover tests -v
"""

import math
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
import emissions as E  # noqa: E402

C = E.C
KL = C.ROUTES["B"]["stops"]["Kuala Lumpur"]
PENANG = C.ROUTES["A"]["stops"]["Penang"]


class TestDistance(unittest.TestCase):
    def test_same_point_is_zero(self):
        self.assertEqual(E.distance_km(C.UTP, C.UTP), 0.0)

    def test_symmetric(self):
        self.assertAlmostEqual(E.distance_km(C.UTP, KL), E.distance_km(KL, C.UTP))

    def test_one_degree_of_latitude(self):
        # 1 degree along a meridian = 2 * pi * R / 360, about 111.19 km
        expected = 2 * math.pi * E.EARTH_RADIUS_KM / 360
        self.assertAlmostEqual(E.distance_km((0, 0), (1, 0)), expected, places=6)

    def test_utp_to_kl_is_realistic(self):
        # About 160 km in a straight line
        self.assertTrue(150 < E.distance_km(C.UTP, KL) < 170)

    def test_first_stop_is_direct_distance(self):
        self.assertAlmostEqual(E.stop_km("A", "Penang"), E.distance_km(C.UTP, PENANG))

    def test_stops_get_further_along_route(self):
        for code, route in C.ROUTES.items():
            kms = [E.stop_km(code, s) for s in route["stops"]]
            self.assertEqual(kms, sorted(kms), f"route {code}")

    def test_route_km_is_last_stop(self):
        self.assertAlmostEqual(E.route_km("B"), E.stop_km("B", "Johor Bahru"))

    def test_unknown_stop(self):
        with self.assertRaises(KeyError):
            E.stop_km("A", "Teluk Intan")


class TestPrices(unittest.TestCase):
    def test_car_cost_per_km(self):
        # 0.16152 / 2.35372 L/km x RM1.99 + RM0.11 toll, about RM0.25/km
        self.assertAlmostEqual(E.car_rm_per_km(), 0.2466, places=3)

    def test_grab_fare_formula(self):
        # 80 km at 80 km/h = 60 minutes
        expected = 2.00 + 0.25 * 80 + 0.43 * 60 + 0.11 * 80
        self.assertAlmostEqual(E.grab_fare(80), expected)


class TestCo2Saved(unittest.TestCase):
    def setUp(self):
        self.km = E.stop_km("B", "Kuala Lumpur")

    def test_returns_expected_keys(self):
        result = E.co2_saved(20, self.km, "bus")
        self.assertEqual(set(result), {"kg_co2", "rm_saved", "solo_kg", "shared_kg",
                                       "solo_rm", "shared_rm", "vehicles"})

    def test_saved_is_solo_minus_shared(self):
        r = E.co2_saved(30, self.km, "bus", "ehailing")
        self.assertAlmostEqual(r["kg_co2"], r["solo_kg"] - r["shared_kg"], delta=0.11)
        self.assertAlmostEqual(r["rm_saved"], r["solo_rm"] - r["shared_rm"], delta=0.011)

    def test_road_factor_applied_once(self):
        r = E.co2_saved(1, 100, "bus")
        self.assertAlmostEqual(r["solo_kg"], 100 * E.ROAD_FACTOR * E.CAR_KG_PER_KM, delta=0.05)

    def test_no_passengers(self):
        for n in (0, -3):
            r = E.co2_saved(n, self.km, "bus")
            self.assertEqual(r["kg_co2"], 0.0)
            self.assertEqual(r["rm_saved"], 0.0)
            self.assertEqual(r["vehicles"], 0)

    def test_bus_count(self):
        cap = C.BUS_CAPACITY
        for n, buses in [(1, 1), (cap, 1), (cap + 1, 2), (2 * cap, 2), (2 * cap + 1, 3)]:
            self.assertEqual(E.co2_saved(n, self.km, "bus")["vehicles"], buses, n)

    def test_van_count(self):
        cap = C.VAN_CAPACITY
        for n, vans in [(1, 1), (cap, 1), (cap + 1, 2)]:
            self.assertEqual(E.co2_saved(n, self.km, "van")["vehicles"], vans, n)

    def test_full_bus_saves_co2_and_money(self):
        r = E.co2_saved(C.BUS_CAPACITY, self.km, "bus")
        self.assertGreater(r["kg_co2"], 0)
        self.assertGreater(r["rm_saved"], 0)

    def test_near_empty_bus_emits_more_than_cars(self):
        self.assertLess(E.co2_saved(4, self.km, "bus")["kg_co2"], 0)

    def test_ehailing_saves_more_than_car(self):
        car = E.co2_saved(20, self.km, "bus", "car")
        grab = E.co2_saved(20, self.km, "bus", "ehailing")
        self.assertGreater(grab["kg_co2"], car["kg_co2"])
        self.assertGreater(grab["rm_saved"], car["rm_saved"])

    def test_more_passengers_save_more(self):
        low = E.co2_saved(20, self.km, "bus")["kg_co2"]
        high = E.co2_saved(40, self.km, "bus")["kg_co2"]
        self.assertGreater(high, low)

    def test_carpool_without_detour_adds_no_co2(self):
        r = E.co2_saved(3, self.km, "carpool")
        self.assertEqual(r["shared_kg"], 0.0)
        self.assertEqual(r["kg_co2"], r["solo_kg"])

    def test_carpool_detour_reduces_saving(self):
        none = E.co2_saved(3, self.km, "carpool")["kg_co2"]
        some = E.co2_saved(3, self.km, "carpool", detour_km=10)["kg_co2"]
        self.assertLess(some, none)

    def test_carpool_riders_share_cost_with_driver(self):
        # 1 rider pays half the trip, so saves half the solo cost
        r = E.co2_saved(1, self.km, "carpool")
        self.assertAlmostEqual(r["shared_rm"], r["solo_rm"] / 2, delta=0.011)

    def test_carpool_too_many_riders(self):
        with self.assertRaises(ValueError):
            E.co2_saved(E.CARPOOL_MAX_RIDERS + 1, self.km, "carpool")

    def test_float_demand_from_model(self):
        # predict_final() returns a float
        self.assertEqual(E.co2_saved(44.4, self.km, "bus")["vehicles"], 2)

    def test_bad_vehicle(self):
        with self.assertRaises(ValueError):
            E.co2_saved(5, self.km, "train")

    def test_bad_baseline(self):
        with self.assertRaises(ValueError):
            E.co2_saved(5, self.km, "bus", baseline="walk")

    def test_negative_distance(self):
        with self.assertRaises(ValueError):
            E.co2_saved(5, -1, "bus")
        with self.assertRaises(ValueError):
            E.co2_saved(2, self.km, "carpool", detour_km=-1)


if __name__ == "__main__":
    unittest.main()
