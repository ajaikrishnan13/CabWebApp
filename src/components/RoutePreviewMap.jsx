import React, { useEffect, useRef } from 'react'
import L from 'leaflet'

export default function RoutePreviewMap({ fromCoords, toCoords, routeGeoJson }) {
  const mapElementRef = useRef(null)
  const mapInstanceRef = useRef(null)
  const layerGroupRef = useRef(null)

  useEffect(() => {
    if (!mapElementRef.current) return

    if (!mapInstanceRef.current) {
      const map = L.map(mapElementRef.current, {
        center: fromCoords || [12.9716, 77.5946],
        zoom: 12,
        zoomControl: false,
        attributionControl: false
      })

      L.control.zoom({ position: 'bottomright' }).addTo(map)

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19
      }).addTo(map)

      const layerGroup = L.layerGroup().addTo(map)
      layerGroupRef.current = layerGroup
      mapInstanceRef.current = map
    }

    const map = mapInstanceRef.current
    const layerGroup = layerGroupRef.current
    layerGroup.clearLayers()

    // Create custom Start & End markers
    if (fromCoords) {
      const startIcon = L.divIcon({
        className: 'route-map-endpoint-icon',
        html: `<div class="endpoint-marker start-endpoint"><span class="endpoint-inner">A</span></div>`,
        iconSize: [28, 28],
        iconAnchor: [14, 14]
      })
      L.marker(fromCoords, { icon: startIcon }).addTo(layerGroup).bindPopup('Pickup Location')
    }

    if (toCoords) {
      const endIcon = L.divIcon({
        className: 'route-map-endpoint-icon',
        html: `<div class="endpoint-marker end-endpoint"><span class="endpoint-inner">B</span></div>`,
        iconSize: [28, 28],
        iconAnchor: [14, 14]
      })
      L.marker(toCoords, { icon: endIcon }).addTo(layerGroup).bindPopup('Drop-off Destination')
    }

    // Draw route geometry if available
    if (routeGeoJson) {
      const routeLayer = L.geoJSON(routeGeoJson, {
        style: {
          color: '#0b3977',
          weight: 5,
          opacity: 0.9,
          lineCap: 'round',
          lineJoin: 'round'
        }
      }).addTo(layerGroup)

      try {
        const bounds = routeLayer.getBounds()
        if (bounds.isValid()) {
          map.fitBounds(bounds, { padding: [36, 36], maxZoom: 16 })
        }
      } catch (err) {
        console.warn('Bounds fitting notice:', err)
      }
    } else if (fromCoords && toCoords) {
      const bounds = L.latLngBounds([fromCoords, toCoords])
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 })
    } else if (fromCoords) {
      map.setView(fromCoords, 14)
    }

    setTimeout(() => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.invalidateSize()
      }
    }, 150)
  }, [fromCoords, toCoords, routeGeoJson])

  useEffect(() => {
    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove()
        mapInstanceRef.current = null
        layerGroupRef.current = null
      }
    }
  }, [])

  return (
    <div className="route-preview-map-container">
      <div ref={mapElementRef} className="route-preview-leaflet" />
    </div>
  )
}
