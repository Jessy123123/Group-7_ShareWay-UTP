import numpy as np
import pandas as pd

# Set random seed for reproducible simulation output
np.random.seed(42)

def generate_carpool_sample(num_samples=100, output_filename="simulated_carpool_data.csv"):
    """
    Generates synthetic dataset for drivers and passengers based on survey shares.
    """
    # 1. Generate Student IDs
    student_ids = [f"UTP{i:05d}" for i in range(1, num_samples + 1)]
    
    # 2. Assign Role (Driver vs Passenger) based on survey shares (e.g., 25% drivers, 75% passengers)
    roles = np.random.choice(
        ["Driver", "Passenger"], 
        size=num_samples, 
        p=[0.25, 0.75]
    )
    
    # 3. Destination Cities (Common UTP holiday travel hubs)
    destinations_list = ["Ipoh", "Kuala Lumpur", "Penang", "Alor Setar", "Kota Bharu", "Johor Bahru"]
    destinations = np.random.choice(destinations_list, size=num_samples)
    
    # 4. Empty Seats (Only applicable for Drivers; 0 for passengers)
    empty_seats = []
    for role in roles:
        if role == "Driver":
            seats = np.random.choice([1, 2, 3, 4], p=[0.20, 0.40, 0.30, 0.10])
            empty_seats.append(seats)
        else:
            empty_seats.append(0)
            
    # 5. Willingness to Share/Ride (Survey share: 85% Yes, 15% No)
    willingness = np.random.choice(["Yes", "No"], size=num_samples, p=[0.85, 0.15])
    
    # 6. Build Dataframe
    df = pd.DataFrame({
        "student_id": student_ids,
        "role": roles,
        "destination": destinations,
        "empty_seats": empty_seats,
        "willingness_to_share": willingness,
        "data_type": "simulated"  # Clear label for testing
    })
    
    # Save to CSV
    df.to_csv(output_filename, index=False)
    print(f"Successfully generated {num_samples} simulated records -> '{output_filename}'")
    return df

if __name__ == "__main__":
    generate_carpool_sample(num_samples=100)