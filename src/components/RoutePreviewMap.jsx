import React, { useEffect, useRef, useState } from 'react'
import { loadGoogleMapsScript, calculateEta } from '../utils/googleMaps'

const darkMapStyles = [
  { elementType: "geometry", stylers: [{ color: "#1d2c4d" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#8ec3b9" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#1a3646" }] },
  { featureType: "administrative.country", elementType: "geometry.stroke", stylers: [{ color: "#4b6878" }] },
  { featureType: "administrative.province", elementType: "geometry.stroke", stylers: [{ color: "#4b6878" }] },
  { featureType: "landscape.man_made", elementType: "geometry.stroke", stylers: [{ color: "#334e87" }] },
  { featureType: "landscape.natural", elementType: "geometry", stylers: [{ color: "#021019" }] },
  { featureType: "poi", elementType: "geometry", stylers: [{ color: "#283d6a" }] },
  { featureType: "poi", elementType: "labels.text.fill", stylers: [{ color: "#6f9ba5" }] },
  { featureType: "poi", elementType: "labels.text.stroke", stylers: [{ color: "#1d2c4d" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#304a7d" }] },
  { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#98a5be" }] },
  { featureType: "road", elementType: "labels.text.stroke", stylers: [{ color: "#1d2c4d" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#2c6675" }] },
  { featureType: "road.highway", elementType: "geometry.stroke", stylers: [{ color: "#255463" }] },
  { featureType: "road.highway", elementType: "labels.text.fill", stylers: [{ color: "#b0d5ce" }] },
  { featureType: "transit", elementType: "geometry", stylers: [{ color: "#2f3948" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#0e1626" }] },
  { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#4e6d70" }] }
]

export default function RoutePreviewMap({
  fromCoords,
  toCoords,
  googleDirectionsResult,
  routeCoordinates = [],
  routeInfo = null,
  className = '',
  onLocateMe,
  isDarkMode = false
}) {
  const mapElementRef = useRef(null)
  const googleMapRef = useRef(null)
  const directionsRendererRef = useRef(null)
  const trafficLayerRef = useRef(null)
  const googleDriverMarkersRef = useRef([])
  const googleCustomMarkersRef = useRef([])
  const googleCustomPolylineRef = useRef(null)
  const googleCustomPolylineBgRef = useRef(null)
  const leafletMapRef = useRef(null)
  const leafletLayerRef = useRef(null)
  const [mapEngine, setMapEngine] = useState('google') // Default to Google Maps with Live Traffic

  const hasRoute = Boolean(fromCoords && toCoords && routeInfo && !routeInfo.error)

  // Dynamically update map theme when isDarkMode changes
  useEffect(() => {
    if (googleMapRef.current) {
      googleMapRef.current.setOptions({
        styles: isDarkMode ? darkMapStyles : []
      })
    }
  }, [isDarkMode])

  // 1. Ensure modal popups and grey filters are kept cleared
  useEffect(() => {
    const observer = new MutationObserver(() => {
      const modals = mapElementRef.current?.querySelectorAll(
        '.gm-err-container, .gm-err-content, .gm-err-message, .gm-style-modal, [role="dialog"], [aria-modal="true"], .dismissButton, div[style*="z-index: 1000001"], div[style*="z-index: 1000000"], div[style*="z-index: 1000002"]'
      )
      modals?.forEach(node => {
        node.style.setProperty('display', 'none', 'important')
        node.remove()
      })

      const bottomControls = mapElementRef.current?.querySelectorAll('.gm-style-cc, .gmnoprint')
      bottomControls?.forEach(ctrl => {
        ctrl.style.setProperty('display', 'none', 'important')
        ctrl.remove()
      })

      const gmOverlays = mapElementRef.current?.querySelectorAll('.gm-style-moc, .gm-style-pbc')
      gmOverlays?.forEach(ov => ov.remove())
    })

    if (mapElementRef.current) {
      observer.observe(mapElementRef.current, { childList: true, subtree: true })
    }

    return () => observer.disconnect()
  }, [])

  // Helper to clear custom Google Maps polyline & markers
  const clearGoogleCustomRoute = () => {
    if (googleCustomPolylineRef.current) {
      googleCustomPolylineRef.current.setMap(null)
      googleCustomPolylineRef.current = null
    }
    if (googleCustomPolylineBgRef.current) {
      googleCustomPolylineBgRef.current.setMap(null)
      googleCustomPolylineBgRef.current = null
    }
    googleCustomMarkersRef.current.forEach(m => m.setMap(null))
    googleCustomMarkersRef.current = []
  }

  // 2. Render Google Maps or Leaflet depending on selected mapEngine
  useEffect(() => {
    let isMounted = true

    const renderMap = async () => {
      if (mapEngine === 'google') {
        // 1. Try Google Maps with Live Traffic
        try {
          const maps = await loadGoogleMapsScript()
          if (!isMounted || !mapElementRef.current) return

          if (!googleMapRef.current) {
            mapElementRef.current.innerHTML = ''
            const centerPos = fromCoords ? { lat: fromCoords[0], lng: fromCoords[1] } : { lat: 12.92404, lng: 80.11550 }
            const map = new maps.Map(mapElementRef.current, {
              center: centerPos,
              zoom: 14,
              disableDefaultUI: true,
              keyboardShortcuts: false,
              gestureHandling: 'greedy',
              zoomControl: false,
              mapTypeControl: false,
              streetViewControl: false,
              fullscreenControl: false,
              clickableIcons: false,
              styles: isDarkMode ? darkMapStyles : []
            })

            const trafficLayer = new maps.TrafficLayer()
            trafficLayer.setMap(map)
            trafficLayerRef.current = trafficLayer

            const directionsRenderer = new maps.DirectionsRenderer({
              map,
              suppressMarkers: false,
              polylineOptions: {
                strokeColor: '#0284c7',
                strokeWeight: 6,
                strokeOpacity: 0.95
              }
            })
            directionsRendererRef.current = directionsRenderer
            googleMapRef.current = map

            setTimeout(() => {
              if (googleMapRef.current) {
                maps.event.trigger(googleMapRef.current, 'resize')
              }
            }, 250)
          }

          const map = googleMapRef.current
          const renderer = directionsRendererRef.current

          // Clear custom routes and custom driver markers
          clearGoogleCustomRoute()
          googleDriverMarkersRef.current.forEach(m => m.setMap(null))
          googleDriverMarkersRef.current = []

          if (googleDirectionsResult && renderer) {
            renderer.setMap(map)
            renderer.setDirections(googleDirectionsResult)
          } else if (fromCoords && toCoords && map) {
            // Detach DirectionsRenderer if no native directions result
            if (renderer) {
              renderer.setMap(null)
            }

            // Draw high-precision road polyline from routeCoordinates or points
            const rawCoords = (routeCoordinates && routeCoordinates.length > 1)
              ? routeCoordinates
              : [fromCoords, toCoords]

            const path = rawCoords.map(pt => new maps.LatLng(pt[0], pt[1]))

            // Outer casing polyline for high contrast
            const bgPolyline = new maps.Polyline({
              path,
              geodesic: true,
              strokeColor: isDarkMode ? '#0369a1' : '#1e3a8a',
              strokeOpacity: 0.5,
              strokeWeight: 8,
              map
            })
            googleCustomPolylineBgRef.current = bgPolyline

            // Main road polyline
            const mainPolyline = new maps.Polyline({
              path,
              geodesic: true,
              strokeColor: isDarkMode ? '#38bdf8' : '#0284c7',
              strokeOpacity: 0.95,
              strokeWeight: 5,
              map
            })
            googleCustomPolylineRef.current = mainPolyline

            // Custom Start Pin (Pickup - Green A)
            const pickupMarker = new maps.Marker({
              position: { lat: fromCoords[0], lng: fromCoords[1] },
              map,
              title: 'Pickup Location',
              icon: {
                path: maps.SymbolPath.CIRCLE,
                scale: 9,
                fillColor: '#10b981',
                fillOpacity: 1,
                strokeColor: '#ffffff',
                strokeWeight: 3
              },
              label: {
                text: 'A',
                color: '#ffffff',
                fontSize: '11px',
                fontWeight: 'bold'
              }
            })
            googleCustomMarkersRef.current.push(pickupMarker)

            // Custom End Pin (Destination - Red B)
            const destMarker = new maps.Marker({
              position: { lat: toCoords[0], lng: toCoords[1] },
              map,
              title: 'Destination',
              icon: {
                path: maps.SymbolPath.CIRCLE,
                scale: 9,
                fillColor: '#ef4444',
                fillOpacity: 1,
                strokeColor: '#ffffff',
                strokeWeight: 3
              },
              label: {
                text: 'B',
                color: '#ffffff',
                fontSize: '11px',
                fontWeight: 'bold'
              }
            })
            googleCustomMarkersRef.current.push(destMarker)

            // Fit map bounds to polyline with padding for bottom drawer
            const bounds = new maps.LatLngBounds()
            path.forEach(pt => bounds.extend(pt))
            map.fitBounds(bounds, { top: 90, bottom: 230, left: 50, right: 50 })
          } else if (fromCoords && map) {
            if (renderer) renderer.setMap(null)
            map.setCenter({ lat: fromCoords[0], lng: fromCoords[1] })
            map.setZoom(15)

            // Draw animated nearby driver icons
            const offsets = [
              { lat: 0.0025, lng: 0.0018 },
              { lat: -0.0021, lng: 0.0029 },
              { lat: 0.0014, lng: -0.0026 }
            ]
            offsets.forEach(off => {
              const driverMarker = new maps.Marker({
                position: { lat: fromCoords[0] + off.lat, lng: fromCoords[1] + off.lng },
                map,
                title: 'Available Driver Nearby',
                icon: {
                  path: 'M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z',
                  fillColor: '#0b3977',
                  fillOpacity: 1,
                  strokeWeight: 1,
                  strokeColor: '#ffffff',
                  scale: 1.1,
                  anchor: new maps.Point(12, 12)
                }
              })
              googleDriverMarkersRef.current.push(driverMarker)
            })
          }
          return
        } catch (err) {
          console.warn('Google Maps load failed, falling back to Leaflet:', err)
          if (isMounted) {
            setMapEngine('osm')
          }
        }
      }

      // 2. Leaflet / OpenStreetMap (Clean vector/raster road geometry)
      try {
        if (!isMounted || !mapElementRef.current) return
        const L = window.L || (await import('leaflet')).default || (await import('leaflet'))
        if (!isMounted || !mapElementRef.current) return

        if (!leafletMapRef.current) {
          if (mapElementRef.current._leaflet_id) {
            delete mapElementRef.current._leaflet_id
          }
          mapElementRef.current.innerHTML = ''
          const center = fromCoords || [12.92404, 80.11550]
          try {
            const map = L.map(mapElementRef.current, { zoomControl: false }).setView(center, 14)
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
              attribution: '© OpenStreetMap',
              maxZoom: 19
            }).addTo(map)
            leafletMapRef.current = map
          } catch (initErr) {
            console.warn('Leaflet map init warning:', initErr)
          }
        }

        const map = leafletMapRef.current
        if (!map) return

        if (leafletLayerRef.current) {
          try {
            map.removeLayer(leafletLayerRef.current)
          } catch (e) {}
          leafletLayerRef.current = null
        }

        const layerGroup = L.layerGroup().addTo(map)
        leafletLayerRef.current = layerGroup

        if (fromCoords && toCoords) {
          const rawCoords = (routeCoordinates && routeCoordinates.length > 1)
            ? routeCoordinates
            : [fromCoords, toCoords]

          // Road casing line
          L.polyline(rawCoords, {
            color: isDarkMode ? '#0369a1' : '#1e3a8a',
            weight: 8,
            opacity: 0.45,
            lineCap: 'round',
            lineJoin: 'round'
          }).addTo(layerGroup)

          // Main road polyline
          const mainLine = L.polyline(rawCoords, {
            color: isDarkMode ? '#38bdf8' : '#0284c7',
            weight: 5,
            opacity: 0.95,
            lineCap: 'round',
            lineJoin: 'round'
          }).addTo(layerGroup)

          // Custom Pickup Pin
          const pickupIcon = L.divIcon({
            className: 'leaflet-custom-marker-pickup',
            html: '<div class="map-pin-core pickup"><span>A</span></div>',
            iconSize: [28, 28],
            iconAnchor: [14, 14]
          })
          L.marker(fromCoords, { icon: pickupIcon }).addTo(layerGroup).bindPopup('<b>📍 Pickup Location</b>')

          // Custom Drop Pin
          const destIcon = L.divIcon({
            className: 'leaflet-custom-marker-drop',
            html: '<div class="map-pin-core drop"><span>B</span></div>',
            iconSize: [28, 28],
            iconAnchor: [14, 14]
          })
          L.marker(toCoords, { icon: destIcon }).addTo(layerGroup).bindPopup('<b>🏁 Destination</b>')

          map.fitBounds(mainLine.getBounds(), {
            paddingTopLeft: [40, 80],
            paddingBottomRight: [40, 230]
          })
        } else if (fromCoords) {
          const pickupIcon = L.divIcon({
            className: 'leaflet-custom-marker-pickup',
            html: '<div class="map-pin-core pickup"><span>📍</span></div>',
            iconSize: [28, 28],
            iconAnchor: [14, 14]
          })
          L.marker(fromCoords, { icon: pickupIcon }).addTo(layerGroup).bindPopup('📍 Your Location')

          // Add nearby driver markers on Leaflet
          const offsets = [
            [0.0025, 0.0018],
            [-0.0021, 0.0029],
            [0.0014, -0.0026]
          ]
          offsets.forEach(off => {
            L.circleMarker([fromCoords[0] + off[0], fromCoords[1] + off[1]], {
              radius: 6,
              color: '#ffffff',
              weight: 2,
              fillColor: '#0b3977',
              fillOpacity: 1
            }).addTo(layerGroup).bindPopup('🚗 Available Driver')
          })

          map.setView(fromCoords, 15)
        }

        setTimeout(() => {
          if (leafletMapRef.current) {
            leafletMapRef.current.invalidateSize()
          }
        }, 250)
      } catch (fallbackErr) {
        console.error('All route preview maps failed', fallbackErr)
      }
    }

    const timer = setTimeout(renderMap, 100)

    return () => {
      isMounted = false
      clearTimeout(timer)
    }
  }, [mapEngine, googleDirectionsResult, routeCoordinates, fromCoords, toCoords, isDarkMode])

  useEffect(() => {
    if (!mapElementRef.current) return
    let ro = null
    try {
      ro = new ResizeObserver(() => {
        try {
          if (leafletMapRef.current && leafletMapRef.current._container) {
            leafletMapRef.current.invalidateSize()
          }
          if (googleMapRef.current && window.google?.maps) {
            window.google.maps.event.trigger(googleMapRef.current, 'resize')
          }
        } catch {}
      })
      ro.observe(mapElementRef.current)
    } catch {}
    return () => {
      try {
        if (ro) ro.disconnect()
      } catch {}
    }
  }, [])

  useEffect(() => {
    return () => {
      clearGoogleCustomRoute()
      if (directionsRendererRef.current) {
        directionsRendererRef.current.setMap(null)
      }
      if (trafficLayerRef.current) {
        trafficLayerRef.current.setMap(null)
      }
      googleDriverMarkersRef.current.forEach(m => m.setMap(null))
      if (leafletMapRef.current) {
        leafletMapRef.current.remove()
        leafletMapRef.current = null
      }
      googleMapRef.current = null
    }
  }, [])

  const handleToggleMap = () => {
    setMapEngine(prev => {
      const next = prev === 'google' ? 'osm' : 'google'
      clearGoogleCustomRoute()
      if (next === 'osm' && googleMapRef.current) {
        if (directionsRendererRef.current) directionsRendererRef.current.setMap(null)
        if (trafficLayerRef.current) trafficLayerRef.current.setMap(null)
        googleDriverMarkersRef.current.forEach(m => m.setMap(null))
        googleMapRef.current = null
        if (mapElementRef.current) mapElementRef.current.innerHTML = ''
      } else if (next === 'google' && leafletMapRef.current) {
        leafletMapRef.current.remove()
        leafletMapRef.current = null
        if (mapElementRef.current) mapElementRef.current.innerHTML = ''
      }
      return next
    })
  }

  return (
    <div className={`route-preview-map-container ${className}`}>
      <div ref={mapElementRef} className="route-preview-canvas" />

      {/* Floating Live Traffic / OSM Engine Switcher */}
      <button
        type="button"
        className="map-traffic-live-indicator"
        onClick={handleToggleMap}
        title="Click to switch between Google Maps and OpenStreetMap"
      >
        <span className="live-traffic-dot" />
        <span>{mapEngine === 'google' ? 'Live Traffic (Google)' : 'OpenStreetMap (Clean)'}</span>
        <small style={{ opacity: 0.7, marginLeft: '2px' }}>⇄</small>
      </button>

      {/* Locate Me Button */}
      {onLocateMe && (
        <button
          type="button"
          className="map-locate-me-btn"
          onClick={onLocateMe}
          title="Locate my position"
          aria-label="Locate my position"
        >
          🎯
        </button>
      )}

      {/* Prominent Floating Journey HUD on Top of Map */}
      {hasRoute && routeInfo && (
        <div className="map-floating-route-hud" role="region" aria-label="Route Journey Overview">
          <div className="hud-metric-pill distance">
            <span className="hud-metric-icon">🚗</span>
            <div className="hud-metric-data">
              <span className="hud-metric-val">{routeInfo.distanceKm || routeInfo.distance} <small>km</small></span>
              <span className="hud-metric-lbl">Distance</span>
            </div>
          </div>

          <div className="hud-divider" />

          <div className="hud-metric-pill duration">
            <span className="hud-metric-icon">⏱️</span>
            <div className="hud-metric-data">
              <span className="hud-metric-val">{routeInfo.durationMinutes || routeInfo.duration} <small>min</small></span>
              <span className="hud-metric-lbl">Est. Time</span>
            </div>
          </div>

          <div className="hud-divider" />

          <div className="hud-metric-pill eta">
            <span className="hud-metric-icon">🕒</span>
            <div className="hud-metric-data">
              <span className="hud-metric-val">{calculateEta(routeInfo.durationMinutes)}</span>
              <span className="hud-metric-lbl">Arrival</span>
            </div>
          </div>

          {routeInfo.summary && (
            <>
              <div className="hud-divider hide-mobile" />
              <div className="hud-metric-pill summary hide-mobile">
                <span className="hud-metric-icon">🛣️</span>
                <div className="hud-metric-data">
                  <span className="hud-metric-val summary-text">{routeInfo.summary}</span>
                  <span className="hud-metric-lbl">
                    {routeInfo.hasTrafficDelay ? '⚠️ Congestion Delay' : '🟢 Smooth Traffic'}
                  </span>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
