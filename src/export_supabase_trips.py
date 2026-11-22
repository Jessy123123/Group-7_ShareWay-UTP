"""
Write supabase/trips_seed.sql: one row per bus trip in the break calendar.

The trips are the same ones simulate.py creates (every route, and the same
departure days around each break), so the website can match a real booking
to the trip it shows.

Run from the repo root, then paste the file into Supabase's SQL Editor:
    python src/export_supabase_trips.py
"""

import sys
from pathlib import Path

import pandas as pd

sys.path.append(str(Path(__file__).resolve().parents[1]))
import config as C  # noqa: E402

OUT_FILE = C.ROOT / "supabase" / "trips_seed.sql"


def trips():
    breaks = pd.read_csv(C.BREAKS_FILE, parse_dates=["first_day"])
    offsets = list(C.DEPARTURE_DAY)
    rows = []
    for _, br in breaks.iterrows():
        holiday = bool(br["is_holiday"])
        # same rule as simulate.py: short holidays only use the day before onwards
        keep = [o for o in offsets if o >= -1] if holiday else offsets
        for route in C.ROUTES:
            for o in keep:
                date = (br["first_day"] + pd.Timedelta(days=o)).date()
                rows.append((route, date.isoformat(), br["event_name"], holiday))
    return rows


def main():
    rows = trips()
    values = ",\n".join(
        f"  ('{r}', '{d}', '{e.replace(chr(39), chr(39) * 2)}', {str(h).lower()})" for r, d, e, h in rows)
    sql = ("-- Bus trips from data/calendar/breaks.csv (made by src/export_supabase_trips.py).\n"
           "-- Run after schema.sql. Safe to run again: existing trips are skipped.\n"
           "insert into public.trips (route, departure_date, event_name, is_holiday) values\n"
           f"{values}\non conflict (route, departure_date) do nothing;\n")
    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUT_FILE.write_text(sql, encoding="utf-8")
    print(f"Wrote {len(rows)} trips to {OUT_FILE}")


if __name__ == "__main__":
    main()
