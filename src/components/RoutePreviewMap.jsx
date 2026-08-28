import React, { useEffect, useRef, useState } from 'react'
import { loadGoogleMapsScript } from '../utils/googleMaps'

export default function RoutePreviewMap({ fromCoords, toCoords, googleDirectionsResult }) {
  const mapElementRef = useRef(null)
  const googleMapRef = useRef(null)
  const directionsRendererRef = useRef(null)
  const trafficLayerRef = useRef(null)
  const leafletMapRef = useRef(null)
  const leafletLayerRef = useRef(null)
  const [isGoogle, setIsGoogle] = useState(true)

  useEffect(() => {
    let isMounted = true

    const renderMap = async () => {
      // 1. Try Google Maps with Live Traffic
      try {
        const maps = await loadGoogleMapsScript()
        if (!isMounted || !mapElementRef.current) return

        setIsGoogle(true)

        if (!googleMapRef.current) {
          mapElementRef.current.innerHTML = ''
          const map = new maps.Map(mapElementRef.current, {
            center: fromCoords ? { lat: fromCoords[0], lng: fromCoords[1] } : { lat: 12.9716, lng: 77.5946 },
            zoom: 12,
            disableDefaultUI: false,
            zoomControl: true,
            mapTypeControl: false,
            streetViewControl: false,
            fullscreenControl: true
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

        if (googleDirectionsResult && renderer) {
          renderer.setDirections(googleDirectionsResult)
        } else if (fromCoords && toCoords && map) {
          const bounds = new maps.LatLngBounds()
          bounds.extend(new maps.LatLng(fromCoords[0], fromCoords[1]))
          bounds.extend(new maps.LatLng(toCoords[0], toCoords[1]))
          map.fitBounds(bounds, { top: 30, bottom: 30, left: 30, right: 30 })
        } else if (fromCoords && map) {
          map.setCenter({ lat: fromCoords[0], lng: fromCoords[1] })
          map.setZoom(14)
        }
        return
      } catch (err) {
        console.warn('Google Maps preview fallback:', err)
      }

      // 2. Leaflet Fallback if Google Maps fails
      try {
        if (!isMounted || !mapElementRef.current) return
        const L = window.L || (await import('leaflet')).default || (await import('leaflet'))
        if (!isMounted || !mapElementRef.current) return

        setIsGoogle(false)

        if (!leafletMapRef.current) {
          mapElementRef.current.innerHTML = ''
          const center = fromCoords || [12.9716, 77.5946]
          const map = L.map(mapElementRef.current).setView(center, 12)
          L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap',
            maxZoom: 19
          }).addTo(map)
          leafletMapRef.current = map
        }

        const map = leafletMapRef.current
        if (leafletLayerRef.current) {
          map.removeLayer(leafletLayerRef.current)
          leafletLayerRef.current = null
        }

        const layerGroup = L.layerGroup().addTo(map)
        leafletLayerRef.current = layerGroup

        if (fromCoords) {
          L.marker(fromCoords).addTo(layerGroup).bindPopup('📍 Pickup')
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
          map.setView(fromCoords, 14)
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
  }, [googleDirectionsResult, fromCoords, toCoords])

  useEffect(() => {
    return () => {
      if (directionsRendererRef.current) {
        directionsRendererRef.current.setMap(null)
      }
      if (trafficLayerRef.current) {
        trafficLayerRef.current.setMap(null)
      }
      if (leafletMapRef.current) {
        leafletMapRef.current.remove()
        leafletMapRef.current = null
      }
      googleMapRef.current = null
    }
  }, [])

  return (
    <div className="route-preview-map-container">
      <div ref={mapElementRef} className="route-preview-canvas" />
      <div className="map-traffic-live-indicator">
        <span className="live-traffic-dot" />
        <span>{isGoogle ? 'Google Maps Live Traffic' : 'Live Route Preview'}</span>
      </div>
    </div>
  )
}
