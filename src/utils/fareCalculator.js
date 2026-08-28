// Dynamic Real-time Distance & Traffic Fare Calculation Engine for Namma Driver

export const VEHICLE_RATES = {
  Mini: {
    baseFare: 60,
    baseKm: 1.5,
    ratePerKm: 13.5,
    minFare: 80,
    hourlyRate: 150
  },
  Sedan: {
    baseFare: 80,
    baseKm: 1.5,
    ratePerKm: 16.5,
    minFare: 110,
    hourlyRate: 190
  },
  SUV: {
    baseFare: 130,
    baseKm: 2.0,
    ratePerKm: 22.0,
    minFare: 180,
    hourlyRate: 280
  },
  Luxury: {
    baseFare: 280,
    baseKm: 3.0,
    ratePerKm: 38.0,
    minFare: 380,
    hourlyRate: 500
  }
}

/**
 * Calculates estimated fare dynamically based on distance in km,
 * traffic duration, car type, and service model.
 */
export function calculateEstimatedFare({
  distanceKm = 0,
  durationMinutes = 0,
  carType = 'Sedan',
  serviceType = 'Point-to-Point'
}) {
  const dist = Math.max(0, parseFloat(distanceKm) || 0)
  const duration = Math.max(0, parseInt(durationMinutes, 10) || 0)
  const rates = VEHICLE_RATES[carType] || VEHICLE_RATES.Sedan

  let calculatedPrice = 0
  let breakdownText = ''
  let perKmText = `₹${rates.ratePerKm}/km`

  if (serviceType === 'Acting Driver') {
    // Acting Driver model: Base fee + driving distance + time rate
    const baseDriver = 220
    const drivingHours = Math.max(1, Math.ceil(duration / 60))
    const hourlyFee = drivingHours * 50
    const kmAllowance = dist * 4 // ₹4/km travel allowance
    calculatedPrice = baseDriver + hourlyFee + kmAllowance
    breakdownText = `₹${rates.ratePerKm}/km • ${dist.toFixed(1)} km (Driver)`
  } else if (serviceType === 'Rental') {
    // Rental model: Scaled by hours and distance driven
    const hours = Math.max(2, Math.ceil(duration / 60))
    const timeCost = hours * rates.hourlyRate
    const kmCost = dist * rates.ratePerKm * 0.8
    calculatedPrice = timeCost + kmCost
    breakdownText = `₹${rates.ratePerKm}/km • ${dist.toFixed(1)} km (${hours}h rental)`
  } else {
    // Point-to-Point transfer (Direct distance-based calculation)
    if (dist <= rates.baseKm) {
      calculatedPrice = rates.baseFare
    } else {
      const extraKm = dist - rates.baseKm
      calculatedPrice = rates.baseFare + extraKm * rates.ratePerKm
    }

    // Traffic congestion adjustment if duration is prolonged
    if (dist > 0 && duration > 0) {
      const normalMinutes = (dist / 35) * 60 // 35 km/h normal traffic
      if (duration > normalMinutes + 10) {
        const delayMin = duration - normalMinutes
        calculatedPrice += Math.min(80, delayMin * 1.5)
      }
    }

    calculatedPrice = Math.max(rates.minFare, calculatedPrice)
    breakdownText = `₹${rates.ratePerKm}/km • ${dist.toFixed(1)} km`
  }

  // Round to nearest integer (or ₹5 interval)
  const roundedAmount = Math.round(calculatedPrice / 5) * 5

  return {
    amount: roundedAmount,
    formatted: `₹${roundedAmount}`,
    breakdown: breakdownText,
    perKmText,
    distanceKm: dist,
    carType,
    serviceType,
    rates
  }
}
