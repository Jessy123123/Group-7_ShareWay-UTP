"""Vehicle rules based on predicted demand"""

import math
import sys
from pathlib import Path

# so import config works
sys.path.append(str(Path(__file__).resolve().parents[1]))

from config import BUS_CAPACITY, VAN_CAPACITY, STANDBY_FRACTION, MIN_PASSENGERS 
# import the shared constants from config.py

def recommend(demand):
    demand = max(0, math.ceil(demand))    # round up to nearest integer, and ensure non-negative

    # If demand is less than the minimum passengers, cancel the trip
    if demand < MIN_PASSENGERS:
        return {"action": "cancel", "buses":0, "standby": False}

    # If demand is less than or equal to the van capacity, recommend one van
    if demand <= VAN_CAPACITY:
        return {"action": "van", "buses":0, "standby": False}

    # If demand is greater than the van capacity, recommend buses
    buses = math.ceil(demand/BUS_CAPACITY)  # round up to nearest integer
    last_bus_load = demand - (buses-1)* BUS_CAPACITY  # calculate the load of the last bus
    standby = last_bus_load >= STANDBY_FRACTION * BUS_CAPACITY  # check if the last bus is full enough to require a standby bus
    return {"action": "bus", "buses": buses, "standby": standby}

#Test Runs using mock data: Run from repo root to see test results. 
#python src/decide.py

if __name__ == "__main__":
    # (demand, action, buses, standby)
    cases = [
        (4,  "cancel", 0, False),
        (5,  "van",    0, False),
        (10, "van",    0, False),
        (11, "bus",    1, False),
        (39, "bus",    1, False),
        (40, "bus",    1, True),
        (44, "bus",    1, True),
        (45, "bus",    2, False),
    ]
    for demand, action, buses, standby in cases:
        result = recommend(demand)
        expected = {"action": action, "buses": buses, "standby": standby}
        status = "PASS" if result == expected else "FAIL"
        print(f"{status}  demand={demand:>2}  got={result}  expected={expected}")