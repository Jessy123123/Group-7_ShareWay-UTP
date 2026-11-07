"""
Step 0: turn the survey responses into the # SURVEY values for config.py.

Charts are saved to outputs/survey/.

Bases used for percentages:
  - 70 (every response in the survey window) for Q3.
  - 67 for questions after Q3, because the 3 students who answered
    "Rarely or never" were branched past them (Q4 to Q20).

"""

import re
import sys
from pathlib import Path

import matplotlib
matplotlib.use("Agg")  # save charts without opening a window
import matplotlib.pyplot as plt  # noqa: E402
import pandas as pd  # noqa: E402

# so "import config" works
sys.path.append(str(Path(__file__).resolve().parents[1]))
import config as C  # noqa: E402

CHART_DIR = C.ROOT / "outputs" / "survey"

SURVEY_START = "2026-10-25"
SURVEY_END = "2026-11-07"

BASE_ALL = 70      # every response in the survey window
BASE_TRAVEL = 67   # 70 minus the 3 who rarely or never leave campus

# Part of each question's header in the export (case is ignored).
COLUMNS = {
    "Q3":  "how often do you leave campus",
    "Q4":  "where is your home region",
    "Q5":  "which route would take you home",
    "Q7":  "compared with the first day of the break",
    "Q12": "when do you usually confirm your travel date",
    "Q13": "have you ever booked transport and not used it",
    "Q14_bus": "reserve a seat on a university bus or van",
    "Q14_carpool": "join a carpool with another utp student",
}

# Q3: chance that a student in each group leaves campus for a given break
LEAVE_WEIGHTS = {"Every time": 1.0, "Most times": 0.75,
                 "Sometimes": 0.5, "Rarely or never": 0.0}

# Q14: saying 4 or 5 in a survey is not the same as booking. Only this share
# of stated interest is assumed to turn into real bookings.
STATED_TO_ACTUAL = 0.50

# Q13: share of a student's bookings that go unused, by answer
MISS_RATE = {"Never": 0.0, "Once": 0.10, "Several times": 0.30}

# Q4 free-text answers -> region option
REGION_ALIASES = {
    "perlis": "Northern (Perlis, Kedah, Penang)",
    "kedah": "Northern (Perlis, Kedah, Penang)",
    "penang": "Northern (Perlis, Kedah, Penang)",
    "pulau pinang": "Northern (Perlis, Kedah, Penang)",
    "kl": "Central (KL, Selangor, Putrajaya)",
    "kuala lumpur": "Central (KL, Selangor, Putrajaya)",
    "selangor": "Central (KL, Selangor, Putrajaya)",
    "putrajaya": "Central (KL, Selangor, Putrajaya)",
    "negeri sembilan": "Southern (Negeri Sembilan, Melaka, Johor)",
    "melaka": "Southern (Negeri Sembilan, Melaka, Johor)",
    "malacca": "Southern (Negeri Sembilan, Melaka, Johor)",
    "johor": "Southern (Negeri Sembilan, Melaka, Johor)",
    "kelantan": "East Coast (Kelantan, Terengganu)",
    "terengganu": "East Coast (Kelantan, Terengganu)",
    "sabah": "East Malaysia (Sabah, Sarawak, Labuan)",
    "sarawak": "East Malaysia (Sabah, Sarawak, Labuan)",
    "labuan": "East Malaysia (Sabah, Sarawak, Labuan)",
    "perak": "Perak (outside Seri Iskandar)",
    "pahang": "Pahang",
}
OVERSEAS = "Overseas"

# Loading and cleaning

def tidy_text(value):
    """Trim stray spaces (including non-breaking ones and newlines)."""
    if not isinstance(value, str):
        return value
    value = re.sub(r"\s+", " ", value.replace(" ", " ")).strip()
    return value if value else None


def load_survey(path):
    """Read the export, drop blank rows, tidy text, keep the survey window."""
    raw = pd.read_excel(path, header=None)
    raw = raw.dropna(how="all")              # blank first row (and any others)
    raw = raw.dropna(axis=1, how="all")      # empty columns

    df = raw.iloc[1:].copy()
    df.columns = [tidy_text(str(c)) for c in raw.iloc[0]]
    df = df.apply(lambda col: col.map(tidy_text))

    start = pd.to_datetime(df["Start time"])
    in_window = (start >= SURVEY_START) & (
        start < pd.Timestamp(SURVEY_END) + pd.Timedelta(days=1))
    late = df.loc[~in_window, "ID"].tolist()
    return df[in_window].reset_index(drop=True), late


def col(df, key):
    """Find the column whose header contains COLUMNS[key]."""
    for name in df.columns:
        if COLUMNS[key] in name.lower():
            return name
    raise KeyError(f"No column for {key} ('{COLUMNS[key]}'). Columns:\n  "
                   + "\n  ".join(df.columns))


def answers(df, key, base):
    """Non-blank answers to a question, warning if the count is not the base."""
    ans = df[col(df, key)].dropna()
    if len(ans) != base:
        print(f"  ! {key}: {len(ans)} answers, expected {base}.")
    return ans


def print_counts(title, counts, base):
    print(f"\n{title}  (base {base})")
    for answer, n in counts.items():
        print(f"  {str(answer):<45} {n:>3}  ({n / base:.0%})")



# One function per config value
def leave_rate(df):
    """Q3 -> LEAVE_RATE: expected share of students who leave for a break."""
    ans = answers(df, "Q3", BASE_ALL)
    counts = ans.value_counts().reindex(LEAVE_WEIGHTS, fill_value=0)
    print_counts("Q3 How often do you leave campus", counts, BASE_ALL)
    rate = sum(counts[a] * w for a, w in LEAVE_WEIGHTS.items()) / BASE_ALL
    ever = (BASE_ALL - counts["Rarely or never"]) / BASE_ALL
    print(f"  Leave at least sometimes: {ever:.0%}. Weighted by LEAVE_WEIGHTS: {rate:.2f}")
    return round(rate, 2), counts


def tidy_region(answer):
    """Q4: keep the fixed options, map free text (e.g. 'johor') to a region."""
    if "(" in answer or answer == "Pahang":
        return answer
    text = answer.lower()
    for alias in sorted(REGION_ALIASES, key=len, reverse=True):
        if re.search(rf"\b{re.escape(alias)}\b", text):
            return REGION_ALIASES[alias]
    return OVERSEAS   # e.g. Qatar, France


def route_of(answer):
    """Q5: fixed option -> A/B/C. Free text (Sabah, Sarawak, ...) -> Other."""
    fixed = {tidy_text(k): v for k, v in C.Q5_TO_ROUTE.items()}
    return fixed.get(answer, "Other")


def route_share(df):
    """Q5 -> ROUTE_SHARE (base 64)."""
    ans = answers(df, "Q5", BASE_TRAVEL)
    routes = ans.map(route_of)
    counts = routes.value_counts().reindex(["A", "B", "C", "Other"], fill_value=0)
    print_counts("Q5 Route home (Sabah and Sarawak count as Other)", counts, BASE_TRAVEL)
    other = ans[routes == "Other"].value_counts()
    print("  Typed in as Other:", {k: int(v) for k, v in other.items()})
    return {k: round(v / BASE_TRAVEL, 2) for k, v in counts.items()}, counts


def home_regions(df):
    """Q4 (not in config): tidied home regions, and Route B students who may
    be heading to KLIA (East Malaysia or overseas)."""
    regions = answers(df, "Q4", BASE_TRAVEL).map(tidy_region)
    print_counts("Q4 Home region (free text tidied)",
                 regions.value_counts(), BASE_TRAVEL)

    routes = df[col(df, "Q5")].map(route_of, na_action="ignore")
    route_b = regions[routes == "B"]
    far = route_b.isin(["East Malaysia (Sabah, Sarawak, Labuan)", OVERSEAS]).sum()
    print(f"  Route B students: {len(route_b)}, of whom {far} are from East "
          f"Malaysia or overseas (possible KLIA travellers)")
    return regions.value_counts()


def bucket(ans, rules):
    """Put each answer in the first bucket whose regex matches."""
    def which(answer):
        for name, pattern in rules:
            if re.search(pattern, answer.lower()):
                return name
        return None

    buckets = ans.map(which)
    if buckets.isna().any():
        print(f"  ! Not matched: {list(ans[buckets.isna()].unique())}")
    return buckets.value_counts().reindex([n for n, _ in rules], fill_value=0)


def departure_day(df):
    """Q7 -> DEPARTURE_DAY (base 64), keyed by offset from the first day."""
    ans = answers(df, "Q7", BASE_TRAVEL)
    counts = bucket(ans, [
        (-4, r"4 or more days before"),
        (-2, r"2-3 days before"),
        (-1, r"1 day before"),
        (0,  r"on the first day"),
        (1,  r"after the first day"),
    ])
    print_counts("Q7 When do you leave (days from first day of break)", counts, BASE_TRAVEL)
    return {k: round(v / BASE_TRAVEL, 2) for k, v in counts.items()}, counts


def booking_timing(df):
    """Q12 -> BOOKING_TIMING (base 64). Day ranges stay as in config.py."""
    ans = answers(df, "Q12", BASE_TRAVEL)
    counts = bucket(ans, [
        ("More than 3 weeks before", r"more than 3 weeks"),
        ("2-3 weeks before",         r"2-3 weeks"),
        ("1-2 weeks before",         r"1-2 weeks"),
        ("Less than 1 week before",  r"less than 1 week"),
        ("On the day",               r"on the day"),
    ])
    print_counts("Q12 When do you confirm your travel date", counts, BASE_TRAVEL)
    timing = {name: (round(counts[name] / BASE_TRAVEL, 2), lo, hi)
              for name, (_, lo, hi) in C.BOOKING_TIMING.items()}
    return timing, counts


def no_show_rate(df):
    """Q13 -> NO_SHOW_RATE. Shares use base 64; the rate is averaged over
    students who book (those who don't usually book cannot no-show)."""
    ans = answers(df, "Q13", BASE_TRAVEL)
    counts = ans.value_counts()
    print_counts("Q13 Ever booked transport and not used it", counts, BASE_TRAVEL)
    bookers = sum(counts.get(a, 0) for a in MISS_RATE)
    rate = sum(counts.get(a, 0) * r for a, r in MISS_RATE.items()) / bookers
    ever = counts.get("Once", 0) + counts.get("Several times", 0)
    print(f"  Ever missed: {ever}/{BASE_TRAVEL} ({ever / BASE_TRAVEL:.0%}). "
          f"Weighted by MISS_RATE over {bookers} who book: {rate:.2f}")
    return round(rate, 2), counts


def uptake(df, key, label):
    """Q14 -> share rating 4 or 5 (base 64), discounted by STATED_TO_ACTUAL."""
    ratings = answers(df, key, BASE_TRAVEL).astype(float).astype(int)
    counts = ratings.value_counts().reindex(range(1, 6), fill_value=0)
    print_counts(f"Q14 {label} (1 = very unwilling, 5 = very willing)", counts, BASE_TRAVEL)
    stated = (ratings >= 4).sum() / BASE_TRAVEL
    print(f"  Rated 4-5: {stated:.0%}  x  STATED_TO_ACTUAL {STATED_TO_ACTUAL}"
          f"  ->  {stated * STATED_TO_ACTUAL:.2f}")
    return round(stated * STATED_TO_ACTUAL, 2), counts



# Charts
def bar_chart(counts, title, filename, base):
    """Save a horizontal bar chart of answer shares."""
    shares = counts / base * 100
    labels = [str(i) for i in shares.index][::-1]
    values = shares.values[::-1]
    fig, ax = plt.subplots(figsize=(8, 0.5 * len(shares) + 1.5))
    ax.barh(labels, values, color="#2a6f97")
    for y, v in enumerate(values):
        ax.text(v + 1, y, f"{v:.0f}%", va="center")
    ax.set_xlabel(f"% of respondents (n = {base})")
    ax.set_xlim(0, 100)
    ax.set_title(title)
    ax.spines[["top", "right"]].set_visible(False)
    fig.tight_layout()
    fig.savefig(CHART_DIR / filename, dpi=150)
    plt.close(fig)


def main():
    if not C.SURVEY_FILE.exists():
        sys.exit(f"Survey file not found: {C.SURVEY_FILE}\n"
                 "Ask Jessy for survey_responses.xlsx and put it in data/raw/.")

    df, late = load_survey(C.SURVEY_FILE)
    print(f"Loaded {len(df)} responses from {SURVEY_START} to {SURVEY_END}")
    if late:
        print(f"  Left out {len(late)} responses outside the survey window (IDs {late})")
    if len(df) != BASE_ALL:
        print(f"  ! Expected {BASE_ALL} responses.")

    leave, q3 = leave_rate(df)
    q4 = home_regions(df)
    shares, q5 = route_share(df)
    day, q7 = departure_day(df)
    timing, q12 = booking_timing(df)
    no_show, q13 = no_show_rate(df)
    bus, q14_bus = uptake(df, "Q14_bus", "Reserve a seat on a university bus or van")
    carpool, q14_car = uptake(df, "Q14_carpool", "Join a carpool with another UTP student")

    CHART_DIR.mkdir(parents=True, exist_ok=True)
    bar_chart(q3, "Q3 How often students leave campus", "q3_leave.png", BASE_ALL)
    bar_chart(q4, "Q4 Home region", "q4_home_region.png", BASE_TRAVEL)
    bar_chart(q5, "Q5 Route home", "q5_route.png", BASE_TRAVEL)
    bar_chart(q7, "Q7 Departure day (days from first day of break)",
              "q7_departure_day.png", BASE_TRAVEL)
    bar_chart(q12, "Q12 When students confirm their travel date",
              "q12_booking_timing.png", BASE_TRAVEL)
    bar_chart(q13, "Q13 Ever booked transport and not used it",
              "q13_no_show.png", BASE_TRAVEL)
    bar_chart(q14_bus, "Q14 Willing to reserve a bus/van seat (1-5)",
              "q14_bus.png", BASE_TRAVEL)
    bar_chart(q14_car, "Q14 Willing to join a carpool (1-5)",
              "q14_carpool.png", BASE_TRAVEL)

    # ---- values for config.py (copy-paste ready) ----
    print("\n" + "=" * 70)
    print("Values for config.py")
    print("=" * 70)
    print(f"LEAVE_RATE = {leave}   # SURVEY Q3 x ASSUMPTION LEAVE_WEIGHTS (base {BASE_ALL})")
    print(f"\nROUTE_SHARE = {shares}   # SURVEY Q5 (base {BASE_TRAVEL})")
    print(f"\nBUS_UPTAKE = {bus}   # SURVEY Q14 x ASSUMPTION {STATED_TO_ACTUAL} (base {BASE_TRAVEL})")
    print(f"CARPOOL_UPTAKE = {carpool}   # SURVEY Q14 x ASSUMPTION {STATED_TO_ACTUAL} (base {BASE_TRAVEL})")
    print(f"\nBOOKING_TIMING = {{  # SURVEY Q12 (base {BASE_TRAVEL}); day ranges FIXED")
    for name, (share, lo, hi) in timing.items():
        key = f'"{name}":'
        print(f"    {key:<28}({share:.2f}, {lo}, {hi}),")
    print("}")
    print(f"\nDEPARTURE_DAY = {{  # SURVEY Q7 (base {BASE_TRAVEL})")
    for offset, share in day.items():
        print(f"    {offset}: {share:.2f},")
    print("}")
    print(f"\nNO_SHOW_RATE = {no_show}   # SURVEY Q13 x ASSUMPTION MISS_RATE")
    print("\nRounded shares may not add to exactly 1.00.")
    print(f"Charts saved to {CHART_DIR}")


if __name__ == "__main__":
    main()
