"""
ShareWay UTP: shared settings for every script.

Labels used below (as the brief requires):
  # FIXED     decided by the team, keep as is
  # PMMD      placeholder, replace with PMMD's aggregated records
  # SURVEY    placeholder, replace with numbers from analyze_survey.py
"""

from pathlib import Path

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
ROOT = Path(__file__).resolve().parent
RAW_DIR = ROOT / "data" / "raw"              # survey export (not in Git)
CALENDAR_DIR = ROOT / "data" / "calendar"    # breaks.csv, holidays.csv
SIM_DIR = ROOT / "data" / "simulated"
SIM_FILE = SIM_DIR / "bookings.csv"
BREAKS_FILE = CALENDAR_DIR / "breaks.csv"

RANDOM_SEED = 42                             # FIXED: same data every run

# ---------------------------------------------------------------------------
# Routes (must match the survey map and Q5)
# ---------------------------------------------------------------------------
UTP = (4.3850, 100.9775)                     # (lat, lon)

ROUTES = {                                   # FIXED
    "A": {
        "name": "Northbound",
        "states": ["Pulau Pinang", "Kedah", "Perlis"],
        "stops": {"Penang": (5.3900, 100.4000), "Alor Setar": (6.1248, 100.3678)},
    },
    "B": {
        "name": "Southbound",
        "states": ["Selangor", "Kuala Lumpur", "Putrajaya",
                   "Negeri Sembilan", "Melaka", "Johor"],
        "stops": {"Kuala Lumpur": (3.1390, 101.6869), "Seremban": (2.7297, 101.9381),
                  "Melaka": (2.2501, 102.2501), "Johor Bahru": (1.4927, 103.7414)},
    },
    "C": {
        "name": "East Coast",
        "states": ["Kelantan", "Terengganu"],
        "stops": {"Ipoh": (4.5975, 101.0901), "Kota Bharu": (6.1254, 102.2381),
                  "Kuala Terengganu": (5.3302, 103.1408)},
    },
}

# Survey Q5 answer text -> route code
Q5_TO_ROUTE = {                              # FIXED
    "Route A: Northbound (Penang, Kedah, Perlis)": "A",
    "Route B: Southbound (Selangor, KL, Putrajaya, Negeri Sembilan, Melaka, Johor)": "B",
    "Route C: East Coast (Kelantan, Terengganu)": "C",
}                                            # anything else counts as "Other"

# ---------------------------------------------------------------------------
# Vehicles and decision rules (Step 3)
# ---------------------------------------------------------------------------
# FIXED (as stated in the proposal)
BUS_CAPACITY = 44
VAN_CAPACITY = 10                            # PMMD: confirm van seat count

STANDBY_FRACTION = 0.90   # PMMD: demand >= 90% of booked bus seats -> add a standby bus
MIN_PASSENGERS = 5        # PMMD: below this, even a van is not worth running -> cancel
# Rules in decide.py:
#   demand < MIN_PASSENGERS             -> cancel
#   demand <= VAN_CAPACITY              -> van
#   otherwise                           -> ceil(demand / BUS_CAPACITY) buses,
#                                          + standby bus if last bus is >= STANDBY_FRACTION full

# ---------------------------------------------------------------------------
# Simulation parameters (Step 1)
# ---------------------------------------------------------------------------
TOTAL_STUDENTS = 6000          # PMMD: number of students who could use the service
LEAVE_RATE = 0.70              # SURVEY Q3: share who leave campus during a break

ROUTE_SHARE = {"A": 0.25, "B": 0.45, "C": 0.15, "Other": 0.15}   # SURVEY Q5

BUS_UPTAKE = 0.40              # SURVEY Q14 row 1: share rating 4-5 for bus/van
CARPOOL_UPTAKE = 0.30          # SURVEY Q14 row 2: share rating 4-5 for carpool

# SURVEY Q12: when students confirm their travel date -> days before departure
BOOKING_TIMING = {             # bucket: (share, min_days, max_days)
    "More than 3 weeks before": (0.10, 22, 28),
    "2-3 weeks before":         (0.20, 14, 21),
    "1-2 weeks before":         (0.30, 7, 13),
    "Less than 1 week before":  (0.30, 1, 6),
    "On the day":               (0.10, 0, 0),
}

# SURVEY Q7: departure day relative to first day of the break
DEPARTURE_DAY = {              # offset in days: share
    -4: 0.10,   # 4 or more days before
    -2: 0.20,   # 2-3 days before
    -1: 0.30,   # 1 day before
    0: 0.30,   # on the first day
    1: 0.10,   # after the first day
}

# SURVEY Q13 (calibrate with PMMD records if available)
NO_SHOW_RATE = 0.10

# PMMD: public-holiday trips draw fewer students than sem breaks
HOLIDAY_LEAVE_FACTOR = 0.5
DAY_OF_WEEK_FACTOR = {0: 1.0, 1: 1.0, 2: 1.0, 3: 1.0,   # PMMD: e.g. Friday departures busier
                      4: 1.0, 5: 1.0, 6: 1.0}           # 0 = Monday ... 6 = Sunday

# FIXED: days before departure we "look" at bookings
SNAPSHOT_DAYS = [28, 21, 14, 10, 7, 5, 3, 1]
SIM_REPEATS = 5                # FIXED: simulated past runs of each break
EVENT_NOISE = 0.15             # FIXED: random variation in demand between breaks

# ---------------------------------------------------------------------------
# Carpool matching (Step 4)
# ---------------------------------------------------------------------------
MAX_TIME_DIFF_HOURS = 3        # SURVEY Q17: how far apart departure times may be
MAX_DETOUR_KM = 30             # FIXED for now: extra distance a driver accepts

# ---------------------------------------------------------------------------
# Model (Step 2)
# ---------------------------------------------------------------------------
FEATURES = ["route", "days_before",
            "bookings_so_far", "day_of_week", "is_holiday"]
TARGET = "final_passengers"
TEST_SIZE = 0.20               # FIXED: 80/20 train-test split
