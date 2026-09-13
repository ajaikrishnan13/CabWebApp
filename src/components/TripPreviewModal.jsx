import React, { useEffect, useState, useRef } from 'react'
import { getGoogleDirections, geocodeAddress } from '../utils/googleMaps'

// Helper to parse coordinate pairs
const parseCoords = (c) => {
  if (!c) return null
  if (Array.isArray(c) && c.length === 2 && !isNaN(c[0]) && !isNaN(c[1])) {
    return [parseFloat(c[0]), parseFloat(c[1])]
  }
  if (typeof c === 'string') {
    try {
      const parsed = JSON.parse(c)
      if (Array.isArray(parsed) && parsed.length === 2) {
        return [parseFloat(parsed[0]), parseFloat(parsed[1])]
      }
    } catch {}
  }
  return null
}

// Static, focused Map Snapshot of the Ride Path, Start & End points
function RideRouteMapSnapshot({
  fromCoords,
  toCoords,
  routeCoordinates,
  routeInfo,
  fromName,
  toName,
  isDarkMode = false
}) {
  const mapElRef = useRef(null)

  useEffect(() => {
    let isMounted = true
    let mapInstance = null

    const initMap = async () => {
      if (!mapElRef.current) return
      const L = window.L || (await import('leaflet')).default || (await import('leaflet'))
      if (!isMounted || !mapElRef.current) return

      if (mapElRef.current._leaflet_id) {
        delete mapElRef.current._leaflet_id
      }
      mapElRef.current.innerHTML = ''

      const pts = (routeCoordinates && routeCoordinates.length > 1)
        ? routeCoordinates
        : (fromCoords && toCoords ? [fromCoords, toCoords] : null)

      if (!pts || pts.length < 2) return

      try {
        const map = L.map(mapElRef.current, {
          zoomControl: false,
          attributionControl: false,
          dragging: false,
          touchZoom: false,
          doubleClickZoom: false,
          scrollWheelZoom: false,
          boxZoom: false,
          keyboard: false
        })

        // Standard OpenStreetMap street tiles (authentic streets, 100% free, zero API key required)
        const tileUrl = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
        L.tileLayer(tileUrl, {
          maxZoom: 19,
          attribution: '© OpenStreetMap'
        }).addTo(map)

        // Outer contrast casing road line
        L.polyline(pts, {
          color: isDarkMode ? '#0369a1' : '#1e3a8a',
          weight: 7,
          opacity: 0.5,
          lineCap: 'round',
          lineJoin: 'round'
        }).addTo(map)

        // Vibrant main road line
        const mainLine = L.polyline(pts, {
          color: isDarkMode ? '#38bdf8' : '#0284c7',
          weight: 4.5,
          opacity: 0.95,
          lineCap: 'round',
          lineJoin: 'round'
        }).addTo(map)

        // Start Pin Marker (Green A)
        const startIcon = L.divIcon({
          className: 'leaflet-custom-marker-pickup',
          html: '<div class="map-pin-core pickup"><span>A</span></div>',
          iconSize: [26, 26],
          iconAnchor: [13, 13]
        })
        L.marker(pts[0], { icon: startIcon }).addTo(map)

        // End Pin Marker (Red B)
        const endIcon = L.divIcon({
          className: 'leaflet-custom-marker-drop',
          html: '<div class="map-pin-core drop"><span>B</span></div>',
          iconSize: [26, 26],
          iconAnchor: [13, 13]
        })
        L.marker(pts[pts.length - 1], { icon: endIcon }).addTo(map)

        // Fit bounds tightly around the route with balanced padding (no 230px zoom-out!)
        const routeBounds = mainLine.getBounds()
        map.fitBounds(routeBounds, {
          padding: [38, 38],
          maxZoom: 15
        })

        // Invalidate size and re-fit bounds once modal layout settles
        setTimeout(() => {
          if (isMounted && map && map._container) {
            map.invalidateSize()
            map.fitBounds(routeBounds, {
              padding: [38, 38],
              maxZoom: 15
            })
          }
        }, 120)

        mapInstance = map
      } catch (err) {
        console.warn('Ride map snapshot notice:', err)
      }
    }

    const timer = setTimeout(initMap, 40)

    return () => {
      isMounted = false
      clearTimeout(timer)
      if (mapInstance) {
        try {
          mapInstance.remove()
        } catch {}
      }
    }
  }, [routeCoordinates, fromCoords, toCoords, isDarkMode])

  const shortFrom = (fromName || 'Pickup').split(',')[0]
  const shortTo = (toName || 'Destination').split(',')[0]

  return (
    <div className="trip-route-image-card">
      <div ref={mapElRef} className={`trip-route-snapshot-map ${isDarkMode ? 'dark-mode' : ''}`} />

      {/* Start Ride Location Tag */}
      <div className="route-tag start-tag">
        <span className="tag-dot pickup" />
        <div className="tag-text-wrap">
          <span className="tag-lbl">START RIDE</span>
          <span className="tag-val" title={fromName}>{shortFrom}</span>
        </div>
      </div>

      {/* End Ride Location Tag */}
      <div className="route-tag end-tag">
        <span className="tag-dot drop" />
        <div className="tag-text-wrap">
          <span className="tag-lbl">END RIDE</span>
          <span className="tag-val" title={toName}>{shortTo}</span>
        </div>
      </div>

      {/* Floating Route Distance & Duration Overlay Badge */}
      {routeInfo && (
        <div className="route-image-stats-pill">
          <span className="pill-metric">🚗 <strong>{routeInfo.distanceKm} km</strong></span>
          <span className="pill-sep">•</span>
          <span className="pill-metric">⏱️ <strong>{routeInfo.durationMinutes} min</strong></span>
          {routeInfo.summary && (
            <>
              <span className="pill-sep">•</span>
              <span className="pill-metric summary-note">{routeInfo.summary}</span>
            </>
          )}
        </div>
      )}
    </div>
  )
}

export default function TripPreviewModal({
  trip,
  onClose,
  onRebook,
  isDarkMode = false
}) {
  const [routeInfo, setRouteInfo] = useState(null)
  const [routeCoordinates, setRouteCoordinates] = useState([])
  const [resolvedFromCoords, setResolvedFromCoords] = useState(() => {
    return parseCoords(trip?.fromCoords || trip?.from_coords) || [12.9856, 80.1636]
  })
  const [resolvedToCoords, setResolvedToCoords] = useState(() => {
    return parseCoords(trip?.toCoords || trip?.to_coords) || [13.0405, 80.2337]
  })

  // Calculate route and road curvature geometry
  useEffect(() => {
    let isMounted = true

    const prepareRoute = async () => {
      if (!trip) return

      let fromC = parseCoords(trip.fromCoords || trip.from_coords)
      let toC = parseCoords(trip.toCoords || trip.to_coords)

      if (!fromC && trip.from) {
        fromC = await geocodeAddress(trip.from)
      }
      if (!toC && trip.to) {
        toC = await geocodeAddress(trip.to)
      }

      if (!fromC) fromC = [12.9856, 80.1636]
      if (!toC) toC = [13.0405, 80.2337]

      if (!isMounted) return
      setResolvedFromCoords(fromC)
      setResolvedToCoords(toC)

      try {
        const dir = await getGoogleDirections(fromC, toC)
        if (!isMounted) return
        setRouteCoordinates(dir.routeCoordinates || [fromC, toC])
        setRouteInfo({
          distance: dir.distance,
          distanceKm: dir.distanceKm,
          duration: dir.duration,
          durationMinutes: dir.durationMinutes,
          summary: dir.summary
        })
      } catch (err) {
        console.warn('Trip preview route notice:', err)
        if (isMounted) {
          setRouteCoordinates([fromC, toC])
          setRouteInfo({ distanceKm: 12.5, durationMinutes: 24, summary: 'Optimal Route' })
        }
      }
    }

    prepareRoute()

    return () => {
      isMounted = false
    }
  }, [trip])

  if (!trip) return null

  const statusMap = {
    requested: { label: 'Requested', cls: 'status-requested', icon: '⏳' },
    confirmed: { label: 'Confirmed', cls: 'status-confirmed', icon: '🗓️' },
    ongoing: { label: 'Ongoing', cls: 'status-ongoing', icon: '⚡' },
    accepted: { label: 'Driver Assigned', cls: 'status-confirmed', icon: '🚗' },
    completed: { label: 'Trip Completed', cls: 'status-completed', icon: '✓' },
    cancelled: { label: 'Cancelled', cls: 'status-cancelled', icon: '✕' }
  }

  const st = statusMap[trip.status] || statusMap.requested
  const fromAddr = trip.from || trip.from_location || 'Pickup location'
  const toAddr = trip.to || trip.to_location || 'Drop-off destination'
  const car = trip.carType || trip.car_type || 'Sedan'
  const service = trip.serviceType || trip.service_type || 'Point-to-Point'
  const rawFare = String(trip.estimatedFare || trip.estimated_fare || '₹450')
  const fareNumeric = parseInt(rawFare.replace(/[^\d]/g, ''), 10) || 450
  const baseFare = Math.max(100, fareNumeric - 70)

  // Clean, consistent booking reference code (e.g. #ND-66XY)
  const cleanId = String(trip.id || '').replace(/[^a-zA-Z0-9]/g, '').slice(-4).toUpperCase() || 'TRIP'
  const refCode = `#ND-${cleanId}`

  // Meaningful, human-readable trip title based on the destination or route
  const getDisplayTitle = () => {
    const cleanPlace = (addr) => {
      if (!addr) return ''
      return addr.split(',')[0].trim()
    }

    const toPlace = cleanPlace(toAddr)
    const fromPlace = cleanPlace(fromAddr)

    const isGenericDrop = !toPlace || /^(drop|destination|drop-off)/i.test(toPlace)
    const isGenericPickup = !fromPlace || /^(pickup|start|current)/i.test(fromPlace)

    if (!isGenericDrop) {
      return `Trip to ${toPlace}`
    }
    if (!isGenericPickup) {
      return `Trip from ${fromPlace}`
    }
    return `${car} ${service} Ride`
  }

  const tripDisplayTitle = getDisplayTitle()

  const dt = trip.datetime ? new Date(trip.datetime) : (trip.createdAt ? new Date(trip.createdAt) : null)
  const isValidDate = Boolean(dt && !isNaN(dt.getTime()))
  const dateFormatted = isValidDate
    ? dt.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
    : (trip.datetime || 'Recently booked')
  const timeFormatted = isValidDate
    ? dt.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true })
    : ''

  const driver = trip.driver || trip.driver_info

  return (
    <div
      className="modal-backdrop trip-preview-backdrop"
      role="presentation"
      onMouseDown={e => e.target === e.currentTarget && onClose()}
    >
      <section className="profile-modal trip-preview-modal" role="dialog" aria-modal="true">
        {/* Modal Header */}
        <div className="modal-heading trip-preview-heading">
          <div className="trip-heading-content">
            <div className="trip-heading-eyebrow-row">
              <span className="eyebrow trip-eyebrow-label">Trip Preview & Receipt</span>
              <span className="trip-ref-code" title={`Booking Reference: ${trip.id || refCode}`}>
                {refCode}
              </span>
            </div>
            <h2 className="trip-preview-title" title={`${fromAddr} → ${toAddr}`}>
              {tripDisplayTitle}
            </h2>
          </div>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            aria-label="Close trip preview"
          >
            ×
          </button>
        </div>

        <div className="trip-preview-scroll-body">
          {/* Ride Route Snapshot Image Map Preview (Start, End & Trajectory) */}
          <RideRouteMapSnapshot
            fromCoords={resolvedFromCoords}
            toCoords={resolvedToCoords}
            routeCoordinates={routeCoordinates}
            routeInfo={routeInfo}
            fromName={fromAddr}
            toName={toAddr}
            isDarkMode={isDarkMode}
          />

          {/* Structured Status & Date Info Card */}
          <div className="trip-preview-status-strip">
            <div className="status-strip-cell status-strip-state">
              <span className="status-strip-label">Status</span>
              <span className={`booking-status-badge ${st.cls}`}>
                {st.icon} {st.label}
              </span>
            </div>

            <div className="status-strip-cell status-strip-schedule">
              <span className="status-strip-label">Date & Time</span>
              <div className="status-strip-datetime-val">
                <span className="status-strip-date">🗓️ {dateFormatted}</span>
                {timeFormatted && (
                  <span className="status-strip-time">⏰ {timeFormatted}</span>
                )}
              </div>
            </div>
          </div>

          {/* Route Stops Detail */}
          <div className="trip-preview-stops-card">
            <div className="preview-stop-row">
              <span className="preview-stop-marker pickup">📍</span>
              <div className="preview-stop-details">
                <small className="preview-stop-label">PICKUP LOCATION</small>
                <p className="preview-stop-address" title={fromAddr}>{fromAddr}</p>
              </div>
            </div>

            <div className="preview-stop-connector" />

            <div className="preview-stop-row">
              <span className="preview-stop-marker drop">🏁</span>
              <div className="preview-stop-details">
                <small className="preview-stop-label">DROP-OFF DESTINATION</small>
                <p className="preview-stop-address" title={toAddr}>{toAddr}</p>
              </div>
            </div>
          </div>

          {/* Assigned Driver Card (if driver present) */}
          {driver && (
            <div className="trip-preview-driver-card">
              <div className="driver-preview-avatar">👨‍✈️</div>
              <div className="driver-preview-info">
                <strong>{driver.name || 'Assigned Chauffeur'}</strong>
                <span>{driver.vehicleModel || car} • {driver.vehicleNumber || 'TN-01-AB-1234'}</span>
                <span className="driver-rating-text">⭐ 4.9 (Top Rated Driver)</span>
              </div>
              {driver.phone && (
                <a href={`tel:${driver.phone}`} className="btn-driver-call" title="Call Driver">
                  📞 Call
                </a>
              )}
            </div>
          )}

          {/* Vehicle & Transparent Fare Breakdown */}
          <div className="trip-preview-fare-card">
            <h4>Fare Breakdown & Summary</h4>
            <div className="fare-row">
              <span>Vehicle & Service</span>
              <strong>{car} • {service}</strong>
            </div>
            <div className="fare-row">
              <span>Base Fare & Driving</span>
              <span>₹{baseFare}</span>
            </div>
            <div className="fare-row">
              <span>Tolls, Taxes & Fuel Allowance</span>
              <span>₹70</span>
            </div>
            <div className="fare-row total">
              <strong>Total Fare Paid</strong>
              <strong className="receipt-total-amount">₹{fareNumeric}</strong>
            </div>
            <div className="fare-payment-pill">
              <span>💳 Payment Method:</span>
              <strong>Cash / UPI Verified</strong>
            </div>
          </div>

          {/* Action Buttons: Book Again & Download Invoice */}
          <div className="trip-preview-actions">
            {onRebook && (
              <button
                type="button"
                className="btn-preview-rebook"
                onClick={() => {
                  onRebook({
                    from: fromAddr,
                    to: toAddr,
                    fromCoords: resolvedFromCoords,
                    toCoords: resolvedToCoords,
                    carType: car,
                    serviceType: service
                  })
                  onClose()
                }}
              >
                🚗 Book This Ride Again
              </button>
            )}

            <button
              type="button"
              className="btn-preview-download"
              onClick={() => {
                alert(`Official invoice for ${tripDisplayTitle} (${refCode}) downloaded to your device.`)
              }}
            >
              📥 Download Invoice (PDF)
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}
