import React, { useEffect, useRef, useState } from 'react'
import { loadGoogleMapsScript } from '../utils/googleMaps'

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
  className = '',
  onLocateMe,
  isDarkMode = false
}) {
  const mapElementRef = useRef(null)
  const googleMapRef = useRef(null)
  const directionsRendererRef = useRef(null)
  const trafficLayerRef = useRef(null)
  const googleDriverMarkersRef = useRef([])
  const leafletMapRef = useRef(null)
  const leafletLayerRef = useRef(null)
  const [mapEngine, setMapEngine] = useState('google') // Default to Google Maps with Live Traffic

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
                strokeColor: '#0b3977',
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

          // Clear existing custom driver markers
          googleDriverMarkersRef.current.forEach(m => m.setMap(null))
          googleDriverMarkersRef.current = []

          if (googleDirectionsResult && renderer) {
            renderer.setDirections(googleDirectionsResult)
          } else if (fromCoords && toCoords && map) {
            const bounds = new maps.LatLngBounds()
            bounds.extend(new maps.LatLng(fromCoords[0], fromCoords[1]))
            bounds.extend(new maps.LatLng(toCoords[0], toCoords[1]))
            map.fitBounds(bounds, { top: 40, bottom: 40, left: 40, right: 40 })
          } else if (fromCoords && map) {
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
        }
      }

      // 2. Leaflet / OpenStreetMap (Clean, 100% popup-free vector/raster tiles)
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

        if (fromCoords) {
          L.marker(fromCoords).addTo(layerGroup).bindPopup('📍 Your Pickup Location')

          // Add nearby driver markers on Leaflet
          if (!toCoords) {
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
          }
        }

        if (toCoords) {
          L.marker(toCoords).addTo(layerGroup).bindPopup('🏁 Destination')
        }

        if (fromCoords && toCoords) {
          const polyline = L.polyline([fromCoords, toCoords], {
            color: '#0b3977',
            weight: 5,
            dashArray: '8, 8'
          }).addTo(layerGroup)
          map.fitBounds(polyline.getBounds(), { padding: [30, 30] })
        } else if (fromCoords) {
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
  }, [mapEngine, googleDirectionsResult, fromCoords, toCoords])

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
    </div>
  )
}
