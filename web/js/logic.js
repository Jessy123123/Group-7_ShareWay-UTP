// JavaScript copies of the Python logic, so the static site can run on Vercel.
//
//   recommend()      <- src/decide.py
//   match()          <- src/carpool.py
//   co2Saved()       <- src/emissions.py
//   predictFinal()   <- src/train.py (compact forest exported by src/export_web.py)
//
// Every number comes from data/dashboard.json, which src/export_web.py builds
// from config.py and emissions.py. If you change the RULES in the Python files,
// change them here too. If you only change NUMBERS, just re-run export_web.py.

export const VEHICLES = ["bus", "van", "carpool"];
export const BASELINES = ["car", "ehailing"];

/** Python's round(x, n) for display values (ties are rare enough to ignore). */
export function round(x, n = 0) {
  const k = 10 ** n;
  return Math.round(x * k) / k;
}

/** Days between two YYYY-MM-DD strings, as whole days (UTC, no time zones). */
function dayNumber(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
}

/** Monday = 0, like pandas dayofweek. */
export function dayOfWeek(iso) {
  return (new Date(dayNumber(iso) * 86400000).getUTCDay() + 6) % 7;
}

export function createLogic(data) {
  const C = data.config;
  const E = data.emissions;

  // decide.py
  function recommend(demand) {
    demand = Math.max(0, Math.ceil(demand));
    if (demand < C.MIN_PASSENGERS) return { action: "cancel", buses: 0, standby: false };
    if (demand <= C.VAN_CAPACITY) return { action: "van", buses: 0, standby: false };
    const buses = Math.ceil(demand / C.BUS_CAPACITY);
    const lastBusLoad = demand - (buses - 1) * C.BUS_CAPACITY;
    const standby = lastBusLoad >= C.STANDBY_FRACTION * C.BUS_CAPACITY;
    return { action: "bus", buses, standby };
  }

  // train.py: departure_offset()
  function departureOffset(dateIso, isHoliday) {
    let best = null;
    for (const b of data.breaks) {
      if (b.is_holiday !== Number(isHoliday)) continue;
      const days = dayNumber(dateIso) - dayNumber(b.first_day);
      if (best === null || Math.abs(days) < Math.abs(best.days)) best = { days, event: b.event_name };
    }
    return best;
  }

  // train.py: predict_final(), using the compact forest
  function predictTree(tree, x) {
    let node = 0;
    while (tree.f[node] !== -1) {
      node = x[tree.f[node]] <= tree.t[node] ? tree.l[node] : tree.r[node];
    }
    return tree.v[node];
  }

  /** numpy.interp over {day: value}: linear between days, flat outside them. */
  function interp(byDay, day, pick = (v) => v) {
    const pts = Object.entries(byDay).map(([d, v]) => [Number(d), pick(v)]).sort((a, b) => a[0] - b[0]);
    if (day <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++) {
      const [d0, v0] = pts[i - 1];
      const [d1, v1] = pts[i];
      if (day <= d1) return v0 + ((v1 - v0) * (day - d0)) / (d1 - d0);
    }
    return pts[pts.length - 1][1];
  }

  const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v));

  // train.py: predict_final(). The trees learn a correction to the baseline:
  // log((final + 1) / (baseline + 1)), so the forecast follows the bookings.
  function predictFinal(route, daysBefore, bookingsSoFar, dateIso, isHoliday) {
    const W = data.web_model;
    const holiday = Number(isHoliday);
    const days = clamp(daysBefore, W.days_range);   // clip_inputs()
    const offset = clamp(departureOffset(dateIso, isHoliday).days, W.offset_range[holiday]);
    const values = {
      days_before: days,
      bookings_so_far: bookingsSoFar,
      day_of_week: dayOfWeek(dateIso),
      is_holiday: holiday,
      departure_offset: offset,
    };
    const x = W.features.map((f) =>
      f.startsWith("route_") ? Number(f === `route_${route}`) : values[f]);
    // apply_correction(): keep the correction in the range seen in training
    const raw = W.trees.reduce((sum, t) => sum + predictTree(t, x), 0) / W.trees.length;
    const correction = clamp(raw, [interp(W.correction_range, days, (r) => r[0]),
      interp(W.correction_range, days, (r) => r[1])]);
    const baseline = bookingsSoFar / interp(W.baseline_shares, days);   // predict_baseline()
    return Math.max(0, (baseline + 1) * Math.exp(correction) - 1);
  }

  // emissions.py
  function distanceKm(a, b) {
    const rad = (d) => (d * Math.PI) / 180;
    const [lat1, lon1] = a.map(rad);
    const [lat2, lon2] = b.map(rad);
    const h = Math.sin((lat2 - lat1) / 2) ** 2
      + Math.cos(lat1) * Math.cos(lat2) * Math.sin((lon2 - lon1) / 2) ** 2;
    return 2 * E.EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
  }

  function stopKm(route, stop) {
    const points = [C.UTP];
    for (const [name, point] of Object.entries(C.ROUTES[route].stops)) {
      points.push(point);
      if (name === stop) {
        let km = 0;
        for (let i = 1; i < points.length; i++) km += distanceKm(points[i - 1], points[i]);
        return km;
      }
    }
    throw new Error(`No stop '${stop}' on route ${route}`);
  }

  const carRmPerKm = () =>
    (E.CAR_KG_PER_KM / E.PETROL_KG_PER_LITRE) * E.PETROL_RM_PER_LITRE + E.TOLL_RM_PER_KM;

  function grabFare(roadKm) {
    const minutes = (roadKm / E.HIGHWAY_KMH) * 60;
    return E.GRAB_BASE_RM + E.GRAB_RM_PER_KM * roadKm
      + E.GRAB_RM_PER_MIN * minutes + E.TOLL_RM_PER_KM * roadKm;
  }

  function solo(passengers, roadKm, baseline) {
    if (baseline === "car") return [passengers * roadKm * E.CAR_KG_PER_KM, passengers * roadKm * carRmPerKm()];
    if (baseline === "ehailing") return [passengers * roadKm * E.TAXI_KG_PER_KM, passengers * grabFare(roadKm)];
    throw new Error(`baseline must be one of ${BASELINES}, not '${baseline}'`);
  }

  function shared(passengers, roadKm, vehicle, detourRoadKm) {
    if (vehicle === "bus") {
      const count = Math.ceil(passengers / C.BUS_CAPACITY);
      return [count * roadKm * E.BUS_LITRES_PER_KM * E.DIESEL_KG_PER_LITRE,
        passengers * roadKm * E.SEAT_RM_PER_KM, count];
    }
    if (vehicle === "van") {
      const count = Math.ceil(passengers / C.VAN_CAPACITY);
      return [count * roadKm * E.VAN_KG_PER_KM, passengers * roadKm * E.SEAT_RM_PER_KM, count];
    }
    if (vehicle === "carpool") {
      if (passengers > E.CARPOOL_MAX_RIDERS) {
        throw new Error(`a carpool takes at most ${E.CARPOOL_MAX_RIDERS} riders, not ${passengers}`);
      }
      const tripCost = (roadKm + detourRoadKm) * carRmPerKm();
      return [detourRoadKm * E.CAR_KG_PER_KM, (tripCost * passengers) / (passengers + 1), 1];
    }
    throw new Error(`vehicle must be one of ${VEHICLES}, not '${vehicle}'`);
  }

  function co2Saved(passengers, distKm, vehicle, baseline = "car", detourKm = 0) {
    if (distKm < 0 || detourKm < 0) throw new Error("distance_km and detour_km cannot be negative");
    if (passengers <= 0) {
      return { kg_co2: 0, rm_saved: 0, solo_kg: 0, shared_kg: 0, solo_rm: 0, shared_rm: 0, vehicles: 0 };
    }
    const road = distKm * E.ROAD_FACTOR;
    const [soloKg, soloRm] = solo(passengers, road, baseline);
    const [sharedKg, sharedRm, count] = shared(passengers, road, vehicle, detourKm * E.ROAD_FACTOR);
    return {
      kg_co2: round(soloKg - sharedKg, 1),
      rm_saved: round(soloRm - sharedRm, 2),
      solo_kg: round(soloKg, 1),
      shared_kg: round(sharedKg, 1),
      solo_rm: round(soloRm, 2),
      shared_rm: round(sharedRm, 2),
      vehicles: count,
    };
  }

  // carpool.py
  function detourKm(passengerDest, driverDest) {
    return distanceKm(C.UTP, passengerDest) + distanceKm(passengerDest, driverDest)
      - distanceKm(C.UTP, driverDest);
  }

  /**
   * passengers: [{passenger_id, departure_time (ms), dest_lat, dest_lon}]
   * drivers:    [{driver_id, departure_time (ms), dest_lat, dest_lon, spare_seats, willing}]
   * Returns matches ranked by time difference, then detour.
   */
  function match(passengers, drivers) {
    const usable = drivers.filter((d) => d.willing && d.spare_seats > 0);
    const candidates = [];
    for (const p of passengers) {
      for (const d of usable) {
        const hours = Math.abs(p.departure_time - d.departure_time) / 3600000;
        if (hours > C.MAX_TIME_DIFF_HOURS) continue;
        const extra = detourKm([p.dest_lat, p.dest_lon], [d.dest_lat, d.dest_lon]);
        if (extra > C.MAX_DETOUR_KM) continue;
        candidates.push({
          passenger_id: p.passenger_id,
          driver_id: d.driver_id,
          time_diff_hours: round(hours, 2),
          detour_km: round(extra, 1),
        });
      }
    }
    candidates.sort((a, b) => a.time_diff_hours - b.time_diff_hours || a.detour_km - b.detour_km);

    const seatsLeft = Object.fromEntries(usable.map((d) => [d.driver_id, d.spare_seats]));
    const matched = new Set();
    const chosen = [];
    for (const row of candidates) {
      if (matched.has(row.passenger_id) || seatsLeft[row.driver_id] === 0) continue;
      seatsLeft[row.driver_id] -= 1;
      matched.add(row.passenger_id);
      chosen.push(row);
    }
    return chosen;
  }

  return {
    recommend, departureOffset, predictFinal, distanceKm, stopKm, co2Saved, detourKm, match,
  };
}
