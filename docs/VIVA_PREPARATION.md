# HIT-Tracker Technical Viva Preparation

This guide describes the behavior implemented in the current source. In particular, the barometric simulator is a demonstration model; passing tests or seeing stable display values does not establish real-world sensor accuracy.

## Hypsometric altitude formula

The implementation estimates relative altitude from pressure using the hypsometric relation for an ideal gas in a layer with a constant temperature lapse rate. Start with hydrostatic balance and the ideal-gas law:

```text
dP/dz = -ρg
ρ = P/(RT)
T(z) = T₀ - Lz
```

Substituting density into hydrostatic balance and integrating from the reference `(P₀, T₀)` to `(P, T)` gives:

```text
ln(P/P₀) = (g/(RL)) ln(T/T₀)
T/T₀ = (P/P₀)^(RL/g)
z = (T₀/L) [1 - (P/P₀)^(RL/g)]
```

`hypsometricAltitude` implements the last expression as:

```text
altitude = (tempK / L) * (1 - (pressureHpa / p0Hpa)^(R*L/g))
```

The constants in `shared/src/barometric.js` are:

| Constant | Implemented value | Meaning |
|---|---:|---|
| `ISA_STANDARD_TEMP_K` | 288.15 K | Defined as standard temperature at sea level; `hypsometricAltitude` currently computes its temperature as `tempC + 273.15` rather than referencing this constant |
| `ISA_LAPSE_RATE_K_PER_M` | 0.0065 K/m | Assumed tropospheric temperature lapse rate |
| `GAS_CONSTANT_DRY_AIR` | 287.05287 J/(kg·K) | Specific gas constant for dry air |
| `STANDARD_GRAVITY` | 9.80665 m/s² | Standard gravity |

The function's `tempC` argument defaults to 15 °C and is converted to Kelvin for `tempK`; the live `FloorEstimator` also defaults to 15 °C. The exponent is `g/(R*L)` and the power in the altitude expression is its inverse, `R*L/g`. The function returns zero for non-positive pressure inputs and for equal pressure/reference pressure. This is a model-based relative altitude estimate, not a surveyed altitude measurement.

## Kalman filter and floor decision

The live `FloorEstimator` constructs `KalmanFilter1D` with `q = 0.05` and `r = 0.5` unless overridden.

- **Q (`q`)** is the process-noise term added to the predicted estimate covariance on each update: `P_predicted = P + Q`. A larger Q makes the filter less confident in its prior estimate and generally more responsive to new measurements.
- **R (`r`)** is the measurement-noise covariance used in the gain: `K = P_predicted / (P_predicted + R)`. A larger R gives each new altitude measurement less weight. These are scalar tuning values in the implementation; the code does not attach explicit physical units or document them as statistically calibrated sensor variances.
- On the first measurement, the filter returns that measurement directly and sets covariance to R. Subsequent updates blend the previous estimate with the new measurement using K and update covariance.

The floor state machine uses a **3.5 m** nominal floor spacing. Its **±0.4 m** hysteresis band is applied around the midpoint between the current floor and its neighbor. For example, from ground (0 m), the upward threshold is `1.75 + 0.4 = 2.15 m`; from floor 1 (3.5 m), the downward threshold is `1.75 - 0.4 = 1.35 m`. The altitude must remain beyond the relevant threshold for **2000 ms** before the candidate transition is committed. Returning inside the current floor's hysteresis region clears the candidate. The state machine clamps labels to B2 through floor 5.

## Differential barometry and drift correction

The gateway tracks a reference-station pressure and records a per-soldier reference baseline when it first observes that soldier. For a packet, shared logic calculates:

```text
ambientDrift = referenceNow - referenceAtEntry
correctedPressure = soldierPressure - ambientDrift
```

Subtracting the reference change aims to cancel pressure drift common to the reference station and soldier sensor. If either reference is missing or is not numeric, `correctedPressure` returns the soldier pressure unchanged. The estimator then applies the hypsometric formula, Kalman filter, and floor hysteresis in that order. The gateway additionally calculates a raw altitude from uncorrected soldier pressure so the dashboard can compare raw and corrected values.

With `SIM_DRIFT=1`, the simulator applies a shared drift that rises by about 0.8 hPa per 30 seconds to soldier and ICP reference readings. The dashboard toggle chooses whether the displayed floor/altitude uses corrected server values or raw altitude with a rounded 3.5 m floor conversion. It **does not disable server-side correction**; the corrected stream continues to be calculated.

## Likely technical viva questions

1. **Why use pressure to estimate a floor?**  
   Pressure generally decreases with altitude. The project converts a pressure reading relative to a reference into an estimated relative altitude, then maps that altitude to a discrete floor label.

2. **What assumptions are in the hypsometric calculation?**  
   It uses hydrostatic balance, ideal-gas behavior for dry air, standard gravity, and a constant temperature lapse rate. The code uses a fixed/default reference temperature of 15 °C unless a caller supplies another value.

3. **What does P₀ mean in this application?**  
   It is the pressure reference passed to the altitude calculation. In the gateway, each soldier's estimator is initialized with that soldier's first accepted pressure reading. Differential correction separately uses an ICP reference-pressure baseline captured when that soldier is first observed.

4. **Why correct pressure using a reference station?**  
   A common weather-related pressure change can look like an altitude change. The implementation estimates that common change from the ICP reference and subtracts it from soldier pressure before estimating altitude.

5. **What happens if the reference reading is unavailable?**  
   The shared `correctedPressure` helper returns the unadjusted soldier pressure if either reference value is not numeric. The estimator can therefore continue using the soldier reading without differential correction.

6. **What do Q = 0.05 and R = 0.5 do?**  
   Q is added to predicted covariance, representing process uncertainty in this scalar filter. R is the measurement covariance used in the Kalman gain. Their chosen values tune responsiveness versus smoothing; the source does not claim they are field-calibrated physical variances.

7. **What is the initial Kalman update?**  
   The first measurement initializes the state and is returned directly. The covariance is set to R. The prediction and measurement blending equations are used from the second update onward.

8. **Why use hysteresis for floors?**  
   A single threshold can make noise near a boundary cause rapid floor toggling. Separate up/down thresholds around the midpoint create a band in which the current floor is retained.

9. **What do ±0.4 m and 2000 ms mean?**  
   The 0.4 m margin is added above or subtracted below the midpoint boundary. A candidate floor must persist beyond that threshold for at least 2000 ms before it becomes the current floor.

10. **Does the weather-correction toggle switch off correction in the server?**  
    No. The gateway continues correcting and publishing the estimates. The UI toggle selects raw or corrected values for display, including the display floor calculation when raw mode is selected.

11. **How is the simulator's weather drift generated?**  
    When `SIM_DRIFT=1`, elapsed time since simulator startup is used to add a linearly increasing drift at about 0.8 hPa per 30 seconds. The same drift term is included in the soldier and reference pressures, with independent small random noise also present.

12. **How do you demonstrate that drift correction works?**  
    Run the simulator with drift enabled, compare the raw and corrected traces in the barometer modal, and switch the dashboard display between them. This demonstrates the implemented synthetic scenario; it is not a real-world calibration test.

13. **Why can a floor transition appear late?**  
    The altitude is smoothed by the Kalman filter and the floor state machine requires 2000 ms beyond its threshold. Both behaviors intentionally resist brief noisy changes, so the display need not change immediately at a physical or simulated boundary.

14. **What does Mission Analytics report?**  
    It calculates per-soldier floor time, horizontal x/y distance, observed floor transitions, and signal-loss intervals from mission telemetry. It has a mission analytics API, dashboard, and JSON export. Its detailed fields and rules are in [V5 Mission Analytics](V5_MISSION_ANALYTICS.md).

15. **How should analytics treat a telemetry gap?**  
    The shared calculation uses the existing 10-second signal-loss timeout. It caps floor-time attribution at that timeout, does not bridge distance across a gap longer than the timeout, and infers a signal-loss interval after the timeout from the recorded timestamps and mission boundary.

16. **Does the analytics report include rooms cleared?**  
    No. V4 room-clear integration/data is unavailable in the current implementation, so rooms-cleared values are not reported.

## Limitations to state in a review

- Simulator pressure drift and noise are synthetic. The tests and demo do not verify real-world barometer accuracy, sensor alignment, thermal effects, or calibration quality.
- Differential correction assumes the ICP reference and soldier sensors share enough ambient drift for subtraction to be useful. Their baseline is per soldier and captured on first observation; it is not a surveyed ground-floor calibration.
- Q and R are implementation tuning parameters, not values shown to be optimal by a field calibration study.
- Floor labels are inferred from estimated altitude and delayed by smoothing, hysteresis, and dwell time.
- Analytics derives metrics from accepted stored telemetry. It cannot reconstruct precise routes during signal loss, and rooms-cleared metrics are not implemented.
