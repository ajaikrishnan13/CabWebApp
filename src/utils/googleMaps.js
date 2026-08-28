// Google Maps JavaScript API Client with Resilient Fallback Routing and Reverse Geocoding

const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || ''
export const isGoogleMapsConfigured = Boolean(GOOGLE_MAPS_API_KEY)

let googleMapsPromise = null
let placesServiceInstance = null
let geocoderInstance = null

/**
 * Loads the Google Maps JavaScript API script.
 */
export function loadGoogleMapsScript() {
  if (typeof window !== 'undefined' && window.google && window.google.maps) {
    return Promise.resolve(window.google.maps)
  }

  if (googleMapsPromise) return googleMapsPromise

  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || ''

  googleMapsPromise = new Promise((resolve, reject) => {
    if (!apiKey) {
      reject(new Error('Google Maps API key is missing in .env.'))
      return
    }

    const callbackName = `__googleMapsCallback_${Date.now()}`
    window[callbackName] = () => {
      delete window[callbackName]
      resolve(window.google.maps)
    }

    const script = document.createElement('script')
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=places,geometry&callback=${callbackName}`
    script.async = true
    script.defer = true
    script.onerror = () => {
      delete window[callbackName]
      googleMapsPromise = null
      reject(new Error('Failed to load Google Maps script.'))
    }
    document.head.appendChild(script)
  }).catch((err) => {
    googleMapsPromise = null
    throw err
  })

  return googleMapsPromise
}

/**
 * Fetches driving directions between two coordinates [lat, lng] using Google Maps DirectionsService
 * with real-time traffic considerations and automatic fallback to OSRM routing.
 */
export async function getGoogleDirections(fromCoords, toCoords) {
  // 1. Try Google Maps DirectionsService
  try {
    const maps = await loadGoogleMapsScript()
    const directionsService = new maps.DirectionsService()

    const origin = new maps.LatLng(fromCoords[0], fromCoords[1])
    const destination = new maps.LatLng(toCoords[0], toCoords[1])

    const googleResult = await new Promise((resolve, reject) => {
      directionsService.route(
        {
          origin,
          destination,
          travelMode: maps.TravelMode.DRIVING,
          unitSystem: maps.UnitSystem.METRIC
        },
        (result, status) => {
          if (status === maps.DirectionsStatus.OK && result && result.routes && result.routes[0]) {
            const route = result.routes[0]
            const leg = route.legs[0]

            const distMeters = leg.distance ? leg.distance.value : 0
            const distKm = parseFloat((distMeters / 1000).toFixed(1))

            const trafficSec = leg.duration_in_traffic ? leg.duration_in_traffic.value : (leg.duration ? leg.duration.value : 0)
            const normalSec = leg.duration ? leg.duration.value : trafficSec
            const durMin = Math.ceil(trafficSec / 60)
            const normalDurMin = Math.ceil(normalSec / 60)

            const hasTrafficDelay = durMin > normalDurMin + 2

            let formattedDuration = ''
            if (durMin >= 60) {
              const h = Math.floor(durMin / 60)
              const m = durMin % 60
              formattedDuration = m > 0 ? `${h}h ${m}m` : `${h}h`
            } else {
              formattedDuration = `${durMin} min`
            }

            resolve({
              directionsResult: result,
              distance: `${distKm} km`,
              distanceKm: distKm,
              duration: formattedDuration,
              durationMinutes: durMin,
              normalDurationMinutes: normalDurMin,
              hasTrafficDelay,
              trafficText: leg.duration_in_traffic ? leg.duration_in_traffic.text : (leg.duration ? leg.duration.text : formattedDuration),
              summary: route.summary ? `via ${route.summary}` : 'Optimal Route',
              isGoogleMaps: true
            })
          } else {
            reject(new Error(`Google Directions failed with status: ${status}`))
          }
        }
      )
    })

    return googleResult
  } catch (googleErr) {
    console.warn('Google Directions error, using fallback routing:', googleErr)
  }

  // 2. Fallback: High-precision OSRM driving calculation
  try {
    const coordinates = `${fromCoords[1]},${fromCoords[0]};${toCoords[1]},${toCoords[0]}`
    const response = await fetch(`https://router.project-osrm.org/route/v1/driving/${coordinates}?overview=full&geometries=geojson`)
    if (!response.ok) throw new Error(`OSRM returned ${response.status}`)
    const data = await response.json()

    if (data.routes && data.routes[0]) {
      const route = data.routes[0]
      const distKm = parseFloat((route.distance / 1000).toFixed(1))
      const durMin = Math.ceil(route.duration / 60)

      let formattedDuration = ''
      if (durMin >= 60) {
        const h = Math.floor(durMin / 60)
        const m = durMin % 60
        formattedDuration = m > 0 ? `${h}h ${m}m` : `${h}h`
      } else {
        formattedDuration = `${durMin} min`
      }

      return {
        directionsResult: null,
        distance: `${distKm} km`,
        distanceKm: distKm,
        duration: formattedDuration,
        durationMinutes: durMin,
        normalDurationMinutes: durMin,
        hasTrafficDelay: false,
        trafficText: formattedDuration,
        summary: route.legs?.[0]?.summary ? `via ${route.legs[0].summary}` : 'Direct Route',
        isGoogleMaps: false
      }
    }
  } catch (osrmErr) {
    console.error('OSRM route calculation error:', osrmErr)
  }

  // 3. Mathematical distance fallback (Haversine formula) so estimation never fails
  const rad = (x) => (x * Math.PI) / 180
  const R = 6371 // Earth radius in km
  const dLat = rad(toCoords[0] - fromCoords[0])
  const dLon = rad(toCoords[1] - fromCoords[1])
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(rad(fromCoords[0])) * Math.cos(rad(toCoords[0])) * Math.sin(dLon / 2) * Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  const directKm = R * c
  const drivingEstKm = parseFloat((directKm * 1.35).toFixed(1)) // 1.35 road winding factor
  const estMin = Math.ceil((drivingEstKm / 28) * 60) // avg 28 km/h city driving

  return {
    directionsResult: null,
    distance: `${drivingEstKm} km`,
    distanceKm: drivingEstKm,
    duration: estMin >= 60 ? `${Math.floor(estMin / 60)}h ${estMin % 60}m` : `${estMin} min`,
    durationMinutes: estMin,
    normalDurationMinutes: estMin,
    hasTrafficDelay: false,
    summary: 'Estimated Driving Route',
    isGoogleMaps: false
  }
}

/**
 * Searches places using Google Places AutocompleteService with local biasing (like Uber/Ola) and fallback.
 */
export async function searchGooglePlaces(query, userCoords = null) {
  if (!query || query.trim().length < 2) return []

  const cleanQuery = query.trim()

  // 1. Try Google Places Autocomplete with Local Area Biasing
  try {
    const maps = await loadGoogleMapsScript()
    if (!placesServiceInstance) {
      placesServiceInstance = new maps.places.AutocompleteService()
    }

    const bias = userCoords
      ? new maps.LatLng(userCoords[0], userCoords[1])
      : new maps.LatLng(12.9716, 80.2000) // Chennai / Bangalore metro default

    const requestOptions = {
      input: cleanQuery,
      componentRestrictions: { country: 'in' },
      location: bias,
      radius: 60000 // 60 km radius for localized results
    }

    const predictions = await new Promise((resolve) => {
      const timeout = setTimeout(() => resolve([]), 2600)

      placesServiceInstance.getPlacePredictions(requestOptions, (results, status) => {
        clearTimeout(timeout)
        if (status === maps.places.PlacesServiceStatus.OK && results && results.length > 0) {
          resolve(
            results.map((p) => {
              const mainText = p.structured_formatting?.main_text || p.description.split(',')[0]
              const secondaryText = p.structured_formatting?.secondary_text || p.description.split(',').slice(1).join(', ').trim()
              return {
                display_name: p.description,
                place_id: p.place_id,
                main_text: mainText,
                secondary_text: secondaryText,
                types: p.types || []
              }
            })
          )
        } else {
          resolve([])
        }
      })
    })

    if (predictions && predictions.length > 0) {
      return predictions
    }
  } catch (err) {
    console.warn('Google Places localized search notice:', err)
  }

  // 2. Fallback to Localized ArcGIS Geocoder
  try {
    const locationBiasParam = userCoords ? `&location=${userCoords[1]},${userCoords[0]}&distance=50000` : ''
    const url = `https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates?singleLine=${encodeURIComponent(cleanQuery)}&countryCode=IND&maxLocations=6&forStorage=false&f=json${locationBiasParam}`
    const res = await fetch(url)
    if (res.ok) {
      const data = await res.json()
      if (data.candidates && data.candidates.length > 0) {
        return data.candidates.map((item) => {
          const parts = item.address.split(',')
          const mainText = parts[0]?.trim() || item.address
          const secondaryText = parts.slice(1).join(', ')?.trim() || ''
          return {
            display_name: item.address,
            main_text: mainText,
            secondary_text: secondaryText,
            lat: item.location.y,
            lon: item.location.x
          }
        })
      }
    }
  } catch (e) {
    console.warn('ArcGIS search fallback notice:', e)
  }

  return []
}

/**
 * Geocodes a Google Place ID or address string to [lat, lng] coordinates.
 */
export async function geocodePlaceId(placeId, fallbackAddress) {
  // 1. Try Google Geocoder
  try {
    const maps = await loadGoogleMapsScript()
    if (!geocoderInstance) {
      geocoderInstance = new maps.Geocoder()
    }

    const coords = await new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(null), 2500)

      if (placeId) {
        geocoderInstance.geocode({ placeId }, (results, status) => {
          clearTimeout(timeout)
          if (status === 'OK' && results && results[0]) {
            const loc = results[0].geometry.location
            resolve([loc.lat(), loc.lng()])
          } else {
            resolve(null)
          }
        })
      } else if (fallbackAddress) {
        geocoderInstance.geocode({ address: fallbackAddress }, (results, status) => {
          clearTimeout(timeout)
          if (status === 'OK' && results && results[0]) {
            const loc = results[0].geometry.location
            resolve([loc.lat(), loc.lng()])
          } else {
            resolve(null)
          }
        })
      } else {
        resolve(null)
      }
    })

    if (coords) return coords
  } catch (err) {
    console.warn('Google Geocode fallback:', err)
  }

  // 2. Fallback to ArcGIS geocoding
  if (fallbackAddress) {
    try {
      const url = `https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates?singleLine=${encodeURIComponent(fallbackAddress)}&countryCode=IND&maxLocations=1&forStorage=false&f=json`
      const res = await fetch(url)
      if (res.ok) {
        const data = await res.json()
        if (data.candidates && data.candidates[0]) {
          return [data.candidates[0].location.y, data.candidates[0].location.x]
        }
      }
    } catch {}
  }

  return null
}

/**
 * Reverse geocodes coordinates [lat, lng] to an address string with automatic fallbacks.
 */
export async function reverseGeocodeGoogle(coords) {
  // 1. Try Google Geocoder
  try {
    const maps = await loadGoogleMapsScript()
    if (!geocoderInstance) {
      geocoderInstance = new maps.Geocoder()
    }
    const latlng = new maps.LatLng(coords[0], coords[1])

    const googleAddr = await new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(null), 2500)

      geocoderInstance.geocode({ location: latlng }, (results, status) => {
        clearTimeout(timeout)
        if (status === 'OK' && results && results[0]) {
          resolve(results[0].formatted_address)
        } else {
          resolve(null)
        }
      })
    })

    if (googleAddr) return googleAddr
  } catch (err) {
    console.warn('Google reverse geocode notice:', err)
  }

  // 2. Fallback to ArcGIS Reverse Geocoder (Very accurate in India)
  try {
    const url = `https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/reverseGeocode?location=${coords[1]},${coords[0]}&f=json`
    const res = await fetch(url)
    if (res.ok) {
      const data = await res.json()
      const addr = data?.address?.Match_addr || data?.address?.Address || data?.address?.City
      if (addr) return addr
    }
  } catch (e) {
    console.warn('ArcGIS reverse geocode error:', e)
  }

  // 3. Fallback to OpenStreetMap Nominatim
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${coords[0]}&lon=${coords[1]}&format=json`
    const res = await fetch(url, { headers: { 'User-Agent': 'NammaDriverApp/1.0' } })
    if (res.ok) {
      const data = await res.json()
      if (data?.display_name) return data.display_name
    }
  } catch {}

  return `${coords[0].toFixed(5)}, ${coords[1].toFixed(5)}`
}
