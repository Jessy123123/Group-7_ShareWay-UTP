"""
Unit tests for the demand model in src/train.py. Uses only unittest.

The prediction tests need the saved model, so run `python src/train.py`
first; they are skipped if models/demand_model.joblib is missing.

Run from the repo root:
    python -m unittest discover tests -v
"""

import sys
import unittest
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
import train as T  # noqa: E402

C = T.C
SEM_BREAK_EVE = "2026-12-15"   # day before the Sept 2026 sem break


class TestHelpers(unittest.TestCase):
    def test_correction_round_trip(self):
        final = np.array([0.0, 5.0, 120.0])
        base = np.array([3.0, 5.0, 80.0])
        back = T.from_correction(T.to_correction(final, base), base)
        np.testing.assert_allclose(back, final)

    def test_baseline_interpolates_between_snapshots(self):
        shares = pd.Series({7: 0.8, 14: 0.4})
        df = pd.DataFrame({"days_before": [7, 10.5, 14], "bookings_so_far": [80, 60, 40]})
        np.testing.assert_allclose(T.predict_baseline(shares, df), [100, 100, 100])

    def test_inputs_clipped_to_simulated_range(self):
        df = pd.DataFrame({"days_before": [0, 40], "is_holiday": [0, 1],
                           "departure_offset": [9, -5]})
        out = T.clip_inputs(df)
        self.assertEqual(out["days_before"].tolist(), [min(C.SNAPSHOT_DAYS), max(C.SNAPSHOT_DAYS)])
        self.assertEqual(out["departure_offset"].tolist(),
                         [T.OFFSET_RANGE[0][1], T.OFFSET_RANGE[1][0]])

    def test_seats_planned(self):
        self.assertEqual(T.seats_planned(3), 0)                      # cancel
        self.assertEqual(T.seats_planned(8), C.VAN_CAPACITY)         # van
        self.assertEqual(T.seats_planned(44), 2 * C.BUS_CAPACITY)    # 1 bus + standby


@unittest.skipUnless(T.MODEL_FILE.exists(), "run python src/train.py first")
class TestPredictFinal(unittest.TestCase):
    def predict(self, bookings, days=1, date=SEM_BREAK_EVE, route="B"):
        return T.predict_final(route, days, bookings, date, False)

    def test_follows_bookings(self):
        """More bookings must mean a bigger forecast, even for unusual numbers."""
        preds = [self.predict(n) for n in (20, 50, 100, 150, 200)]
        self.assertEqual(preds, sorted(preds))
        self.assertLess(preds[0], 40)     # the old model said 95 here

    def test_one_day_out_close_to_bookings(self):
        """A day before departure almost everyone has booked; no-shows are about 11%."""
        for n in (30, 100, 200):
            self.assertAlmostEqual(self.predict(n), n * (1 - C.NO_SHOW_RATE), delta=0.15 * n)

    def test_no_bookings_close_to_departure(self):
        self.assertLess(self.predict(0, route="C"), C.MIN_PASSENGERS)

    def test_out_of_range_inputs_do_not_crash(self):
        self.assertGreaterEqual(self.predict(50, days=0), 0)
        self.assertGreaterEqual(self.predict(50, days=15), 0)   # between snapshots
        self.assertGreaterEqual(self.predict(50, date="2026-12-25"), 0)   # 9 days in

    def test_beats_baseline_far_out(self):
        df = pd.read_csv(C.SIM_FILE)
        train, test = T.split_by_trip(df)
        test = test[test["days_before"] == max(C.SNAPSHOT_DAYS)]
        pred = T.evaluate(train, test)
        err = (pred.sub(test[C.TARGET], axis=0)).abs().mean()
        self.assertLess(err["Gradient Boosting"], err[T.BASELINE])


if __name__ == "__main__":
    unittest.main()
