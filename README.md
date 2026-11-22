# ShareWay UTP

**AI-powered shared transport planner for UTP student travel**

TEB2023 Artificial Intelligence · September 2026 semester · Group 7

During semester breaks and public holidays, thousands of UTP students leave campus within a few days. Many book late, some don't show up and some never book, so the final number of passengers is only known close to departure. By then it is too late for PMMD to arrange the right number of buses and vans.

ShareWay forecasts that final number weeks ahead, from the bookings made so far, and turns it into a transport plan:

1. **Forecasts final demand early**, with a likely range, while reservations are still open.
2. **Recommends vehicles** for each route and date: buses, a standby bus, a van, or cancel.
3. **Matches carpools** for students a bus or van can't serve (off-route destination, cancelled trip or full vehicle).
4. **Estimates CO₂ and cost saved** compared with each student driving alone or using e-hailing.

| User                                   | What they get                                                                                                     |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **PMMD transport operators** (primary) | Forecasts, likely ranges and vehicle plans for each route and date. The operator always makes the final decision. |
| **UTP students** (secondary)           | Seat booking, a comparison of bus vs carpool vs going alone, and carpool matching.                                |

Supports SDG 9 (Industry, Innovation & Infrastructure), SDG 11 (Sustainable Cities and Communities) and SDG 13 (Climate Action).

> **Demo on simulated data.** PMMD booking records were not available, so all booking history is **simulated** from our survey and team assumptions. Forecasts are estimates, not guarantees.

---

## Real, simulated or assumed

Every value in [`config.py`](config.py) is labelled with where it comes from:

| Label                 | Meaning                                                           | Examples                                                                             |
| --------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `SURVEY`              | Calculated from our Microsoft Forms survey by `analyze_survey.py` | Route share (Q5), booking timing (Q12), departure day (Q7), carpool time limit (Q17) |
| `SURVEY + ASSUMPTION` | Survey answer adjusted by the team                                | Leave rate (Q3), no-show rate (Q13), bus and carpool uptake (Q14 × 0.5)              |
| `ASSUMPTION`          | Team estimate, no operator data                                   | Standby threshold (90%), cancel below 5 passengers, 30 km detour limit               |
| `FIXED`               | Decided by the team                                               | Routes and stops, bus (44) and van (10) capacity, 7,500 students                     |
| `PUBLISHED`           | From a published source (in `emissions.py`)                       | UK DESNZ 2026 emission factors                                                       |

The booking dataset (`data/simulated/bookings.csv`), the carpool students and the dashboard trips are all **SIMULATED**. The survey responses are real but are not in Git, because they are personal data.

---

## How it works

```
Survey (Microsoft Forms)
        │  analyze_survey.py
        ▼
config.py ──► simulate.py ──► data/simulated/bookings.csv
                                        │  train.py
                                        ▼
bookings so far ──► predict_range() ──► low / forecast / high
                                                  │  plan for the high end
                                                  ▼
                                   recommend() ──► buses / standby / van / cancel
                                                  │
              students not served ──► match() ──► carpool pairs
                                                  │
                                   co2_saved() ──► CO₂ and cost saved
                                                  │
                         export_web.py ──► web/ dashboard (Vercel)
                                           app.py (Streamlit, for the team)
```

| Step | File                | What it does                                                                                                                                                                                        |
| ---- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | `analyze_survey.py` | Turns survey responses into the `SURVEY` values in `config.py` and saves charts to `outputs/survey/`                                                                                                |
| 1    | `simulate.py`       | Generates past bookings for every break, route and departure day, recorded at 28, 21, 14, 10, 7, 5, 3 and 1 days before departure                                                                   |
| 2    | `train.py`          | **AI step.** Learns a correction to a booking-curve estimate (bookings so far ÷ usual share booked by that day). Compares Linear Regression, Random Forest and Gradient Boosting and keeps the best |
| 3    | `train.py`          | **AI step.** Forecast range: the 10th–90th percentile of the model's errors on unseen trips. Vehicles are planned for the high end                                                                  |
| 4    | `decide.py`         | Vehicle rules: cancel below 5, a van for 5–10, buses above 10, a standby bus if the last bus is at least 90% full                                                                                   |
| 5    | `carpool.py`        | Matches passengers with student drivers at most 3 h apart and with at most 30 km of detour; best pairs first (time, then detour)                                                                    |
| 6    | `emissions.py`      | Road distance, CO₂ and cost of the shared trip vs everyone travelling alone                                                                                                                         |

---

## Results (simulated data)

The models were tested on 207 simulated trips they had not seen during training. The average trip had 124 passengers.

| Approach                         | Average error (passengers) | Trips planned with too few seats |
| -------------------------------- | -------------------------: | -------------------------------: |
| Booking-curve estimate only      |                      11.09 |                             8.9% |
| Linear Regression                |                      20.19 |                             9.2% |
| Random Forest                    |                       7.52 |                             3.9% |
| **Gradient Boosting (selected)** |                   **7.29** |                         **4.2%** |

- The error falls from about 20 passengers four weeks before departure to about 3 passengers the day before (`outputs/model/mae_by_days_before.png`).
- The actual number fell inside the likely range on 80% of test trips.
- Planning for the high end of the range cut trips short of seats from **4.2% to 0.3%**, at a cost of about 17.5 extra seats per trip.

These numbers change if `simulate.py` or `train.py` is re-run. `train.py` prints the current ones.

---

## Project structure

```
Group-7_ShareWay-UTP/
├── app.py                      # Streamlit dashboard (team use)
├── config.py                   # all shared settings, labelled by source (edit via Jessy)
├── requirements.txt
├── simulated_carpool_data.csv  # sample carpool students, from make_carpool_sample.py
├── data/
│   ├── calendar/breaks.csv     # 2026–2027 semester breaks and public holidays
│   ├── raw/                    # survey export (NOT in Git)
│   └── simulated/bookings.csv  # generated by simulate.py
├── models/                     # demand_model.joblib, saved by train.py (NOT in Git)
├── outputs/
│   ├── model/                  # forecast error chart
│   └── survey/                 # survey charts
├── src/
│   ├── analyze_survey.py
│   ├── simulate.py
│   ├── train.py
│   ├── decide.py
│   ├── carpool.py
│   ├── emissions.py
│   ├── scenarios.py            # end-to-end demo scenarios
│   ├── export_web.py           # writes web/data/dashboard.json
│   └── make_carpool_sample.py
├── tests/                      # unit tests (unittest)
└── web/                        # web dashboard (deploy this folder to Vercel)
    ├── index.html
    ├── css/styles.css
    ├── js/app.js               # operator pages and charts
    ├── js/live.js              # Live bookings page
    ├── js/student.js           # student pages
    ├── js/logic.js             # JS copies of recommend(), match(), co2_saved(), predict_range()
    ├── js/ui.js                # shared helpers
    └── data/dashboard.json     # generated by export_web.py
```

---

## Setup

Requires Python 3.10 or newer.

```bash
git clone https://github.com/Jessy123123/Group-7_ShareWay-UTP.git
cd Group-7_ShareWay-UTP
python -m venv .venv
```

Activate the environment:

- **Windows:** `.venv\Scripts\activate`
- **macOS/Linux:** `source .venv/bin/activate`

```bash
pip install -r requirements.txt
```

## Running

Run every command from the **repo root**, in this order:

```bash
python src/analyze_survey.py     # optional: needs data/raw/survey_responses.xlsx (ask Jessy)
python src/simulate.py           # writes data/simulated/bookings.csv
python src/train.py              # compares the models, saves the best to models/
python src/scenarios.py          # runs the demo scenarios end to end
python src/export_web.py         # updates the web dashboard's data
streamlit run app.py             # optional: Streamlit dashboard
```

`analyze_survey.py` is only needed when the survey results change. Its output is already in `config.py`.

Run the tests (the model tests are skipped until `train.py` has been run):

```bash
python -m unittest discover tests -v
```

---

## Web dashboard

`web/` is a static site with two views, switched with the **Operator | Student** button at the top.

**Operator (PMMD)**

| Page               | What it shows                                                                                                                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Overview           | Forecast vs actual for each trip of a break, the likely range, the booking curve and the vehicle plan                                                                                            |
| Live bookings      | One trip replayed day by day from 28 days before departure. Bookings arrive on their own and the forecast and vehicle plan update automatically, as the full system would run with no data entry |
| What-if forecast   | Try any route, date and number of bookings and see the forecast and plan. Also shows how accurate each model is                                                                                  |
| Carpool matching   | Edit passengers and drivers and see the matches on a map                                                                                                                                         |
| CO₂ and cost saved | A shared trip compared with every student driving alone or using e-hailing                                                                                                                       |

**Student**

| Page         | What it shows                                                                        |
| ------------ | ------------------------------------------------------------------------------------ |
| Plan my trip | Bus vs carpool vs going alone, with cost, CO₂ and how full the bus is expected to be |
| Carpool      | Find a ride or offer your spare seats                                                |
| My trips     | Your bookings and what you've saved                                                  |

The other carpool students are **SIMULATED**, and bookings are only saved in the viewer's own browser: nothing is sent anywhere. A seat booked in the student view is also counted on the operator's Live bookings page for the same trip.

### How the browser version relates to the Python code

- Forecasts on the Overview page come from the trained model and are worked out ahead of time by `export_web.py`.
- Forecasts on the Live bookings and What-if pages are worked out in the browser by a small Random Forest (30 trees) that learns the same correction as the trained model. Its error is measured and shown on the What-if page.
- On the Live bookings page, bookings between the snapshot days are interpolated in a straight line.
- `js/logic.js` is a JavaScript copy of `recommend()`, `match()`, `co2_saved()` and `predict_range()`. All the numbers come from `config.py` and `emissions.py` through `dashboard.json`, so **changing a number only needs `python src/export_web.py`**. Changing a _rule_ in `decide.py`, `carpool.py` or `emissions.py` also needs the same change in `logic.js`.

### Preview locally

The dashboard needs a server, because opening `index.html` directly will not load the data:

```bash
python -m http.server 8765 -d web
```

Then open http://localhost:8765.

### Deploy on Vercel

1. Run `python src/export_web.py` and push `web/data/dashboard.json` with your changes.
2. On vercel.com: **Add New → Project**, then import this GitHub repo.
3. Set **Root Directory** to `web` and **Framework Preset** to **Other**. Leave the build command empty.
4. Deploy. Each push to `main` redeploys automatically.

Or, with the Vercel CLI from the repo root: `vercel deploy web` (add `--prod` for production).

---

## Shared functions

Code to these signatures so everyone can work in parallel:

```python
# train.py      (Jessy)
predict_final(route, days_before, bookings_so_far, departure_date, is_holiday) -> float
predict_range(route, days_before, bookings_so_far, departure_date, is_holiday) -> (low, forecast, high)
                                                  # plan vehicles for `high` (safety margin)
# decide.py     (Nadh)
recommend(demand) -> {"action": "bus|van|cancel", "buses": int, "standby": bool}

# carpool.py    (Chua)
match(passengers_df, drivers_df) -> DataFrame    # ranked by time diff, then detour

# emissions.py  (Muqri)
distance_km(a, b) -> float                        # a, b = (lat, lon), straight line
co2_saved(passengers, distance_km, vehicle, baseline="car", detour_km=0.0)
    -> {"kg_co2": float, "rm_saved": float, ...}  # vehicle: bus | van | carpool
                                                  # baseline: car | ehailing
```

---

## Limitations

- All booking history is simulated, so the accuracy above shows the method works on data shaped like our survey, not on real PMMD bookings.
- The simulation treats every day of the week the same, so the model cannot learn weekday patterns yet.
- The thresholds (standby at 90%, cancel below 5, 30 km detour) are team assumptions that the operator can change.
- Carpooling depends on enough student drivers volunteering.

---

## Team

Jessy Pang Xin Yuan · Chua Xin Ying · Tengku Ameera Nadhirah Binti Tengku Azmi · Nur Natasya Dania Binti Yaromar · Tengku Muqri bin Tengku Nazri
