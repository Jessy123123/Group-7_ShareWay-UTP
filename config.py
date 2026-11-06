from pathlib import Path

ROOT = Path(__file__).resolve().parent
RAW_DIR = ROOT / "data" / "raw"
CALENDAR_DIR = ROOT / "data" / "calendar"
SIM_DIR = ROOT / "data" / "simulated"
SIM_FILE = SIM_DIR / "bookings.csv"
BREAKS_FILE = CALENDAR_DIR / "breaks.csv"

RANDOM_SEED = 42

UTP = (4.3850, 100.9775)  # (lat, lon)

ROUTES = {
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

Q5_TO_ROUTE = {
    "Route A: Northbound (Penang, Kedah, Perlis)": "A",
    "Route B: Southbound (Selangor, KL, Putrajaya, Negeri Sembilan, Melaka, Johor)": "B",
    "Route C: East Coast (Kelantan, Terengganu)": "C",
}

BUS_CAPACITY = 44
VAN_CAPACITY = 10

STANDBY_FRACTION = 0.90
MIN_PASSENGERS = 5

TOTAL_STUDENTS = 6000
LEAVE_RATE = 0.70

ROUTE_SHARE = {"A": 0.25, "B": 0.45, "C": 0.15, "Other": 0.15}   # SURVEY Q5

BUS_UPTAKE = 0.40
CARPOOL_UPTAKE = 0.30

BOOKING_TIMING = {  # bucket: (share, min_days, max_days)
    "More than 3 weeks before": (0.10, 22, 28),
    "2-3 weeks before":         (0.20, 14, 21),
    "1-2 weeks before":         (0.30, 7, 13),
    "Less than 1 week before":  (0.30, 1, 6),
    "On the day":               (0.10, 0, 0),
}

DEPARTURE_DAY = {
    -4: 0.10,   # 4 or more days before
    -2: 0.20,   # 2-3 days before
    -1: 0.30,   # 1 day before
    0: 0.30,   # on the first day
    1: 0.10,   # after the first day
}

NO_SHOW_RATE = 0.10

HOLIDAY_LEAVE_FACTOR = 0.5
DAY_OF_WEEK_FACTOR = {0: 1.0, 1: 1.0, 2: 1.0, 3: 1.0,
                      4: 1.0, 5: 1.0, 6: 1.0}

SNAPSHOT_DAYS = [28, 21, 14, 10, 7, 5, 3, 1]
SIM_REPEATS = 5
EVENT_NOISE = 0.15

MAX_TIME_DIFF_HOURS = 3
MAX_DETOUR_KM = 30

FEATURES = ["route", "days_before",
            "bookings_so_far", "day_of_week", "is_holiday"]
TARGET = "final_passengers"
TEST_SIZE = 0.20

SURVEY_FILE = RAW_DIR / "survey_responses.xlsx"
