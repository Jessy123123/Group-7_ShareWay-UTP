"""
ShareWay UTP: shared settings for every script.

Labels show where each value comes from (the brief requires this):
  # FIXED               decided by the team, keep as is
  # SURVEY              calculated from our survey by analyze_survey.py
  # SURVEY + ASSUMPTION survey answers adjusted by a team assumption
  # ASSUMPTION          team estimate, no operator data available
"""

from pathlib import Path

ROOT = Path(__file__).resolve().parent
RAW_DIR = ROOT / "data" / "raw"
CALENDAR_DIR = ROOT / "data" / "calendar"
SIM_DIR = ROOT / "data" / "simulated"
SIM_FILE = SIM_DIR / "bookings.csv"
BREAKS_FILE = CALENDAR_DIR / "breaks.csv"
SURVEY_FILE = RAW_DIR / "survey_responses.xlsx"  # real responses (not in Git)

RANDOM_SEED = 42  # FIXED

UTP = (4.3850, 100.9775)  # FIXED: (lat, lon)

ROUTES = {  # FIXED
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

Q5_TO_ROUTE = {  # FIXED: survey Q5 answer -> route code
    "Route A: Northbound (Penang, Kedah, Perlis)": "A",
    "Route B: Southbound (Selangor, KL, Putrajaya, Negeri Sembilan, Melaka, Johor)": "B",
    "Route C: East Coast (Kelantan, Terengganu)": "C",
}

# Vehicles and decision rules
BUS_CAPACITY = 44  # FIXED: maximum seats on a bus
VAN_CAPACITY = 10  # ASSUMPTION

STANDBY_FRACTION = 0.90  # ASSUMPTION: last bus this full -> add a standby bus
MIN_PASSENGERS = 5  # ASSUMPTION: below this -> cancel the trip

# Simulation inputs
TOTAL_STUDENTS = 6000  # ASSUMPTION
LEAVE_RATE = 0.78  # SURVEY + ASSUMPTION: Q3 x LEAVE_WEIGHTS in analyze_survey.py

ROUTE_SHARE = {"A": 0.19, "B": 0.63, "C": 0.13, "Other": 0.04}   # SURVEY Q5

BUS_UPTAKE = 0.41  # SURVEY + ASSUMPTION: Q14 rated 4-5 (82%) x 0.5
CARPOOL_UPTAKE = 0.35  # SURVEY + ASSUMPTION: Q14 rated 4-5 (70%) x 0.5

BOOKING_TIMING = {  # SURVEY Q12: bucket: (share, min_days, max_days)
    "More than 3 weeks before": (0.19, 22, 28),
    "2-3 weeks before":         (0.31, 14, 21),
    "1-2 weeks before":         (0.36, 7, 13),
    "Less than 1 week before":  (0.12, 1, 6),
    "On the day":               (0.01, 0, 0),
}

DEPARTURE_DAY = {  # SURVEY Q7: days from the first day of the break
    -4: 0.36,   # 4 or more days before
    -2: 0.30,   # 2-3 days before
    -1: 0.13,   # 1 day before
    0: 0.18,   # on the first day
    1: 0.03,   # after the first day
}

NO_SHOW_RATE = 0.11  # SURVEY + ASSUMPTION: Q13 x MISS_RATE in analyze_survey.py

HOLIDAY_LEAVE_FACTOR = 0.5  # ASSUMPTION
DAY_OF_WEEK_FACTOR = {0: 1.0, 1: 1.0, 2: 1.0, 3: 1.0,  # ASSUMPTION: 0 = Monday
                      4: 1.0, 5: 1.0, 6: 1.0}

SNAPSHOT_DAYS = [28, 21, 14, 10, 7, 5, 3, 1]  # FIXED
SIM_REPEATS = 5  # FIXED
EVENT_NOISE = 0.15  # FIXED

# Carpool matching
MAX_TIME_DIFF_HOURS = 3  # SURVEY Q17: median answer
MAX_DETOUR_KM = 30  # ASSUMPTION

# Model
FEATURES = ["route", "days_before",  # FIXED
            "bookings_so_far", "day_of_week", "is_holiday"]
TARGET = "final_passengers"  # FIXED
TEST_SIZE = 0.20  # FIXED
