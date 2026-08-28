import React, { useEffect, useRef, useState } from 'react'
import L from 'leaflet'

// Default center (India center if no coords given)
const DEFAULT_CENTER = [12.9716, 77.5946]

async function reverseGeocode(lat, lng) {
  try {
    const url = `https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/reverseGeocode?location=${lng},${lat}&f=json`
    const res = await fetch(url)
    if (!res.ok) throw new Error('Geocoding error')
    const data = await res.json()
    if (data?.address?.Match_addr) {
      return data.address.Match_addr
    }
    if (data?.address?.Address) {
      return `${data.address.Address}, ${data.address.City || ''}`
    }
  } catch (err) {
    console.warn('ArcGIS reverse geocode failed, trying fallback', err)
  }

  try {
    const fallbackUrl = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`
    const res = await fetch(fallbackUrl)
    if (!res.ok) throw new Error('Nominatim error')
    const data = await res.json()
    if (data?.display_name) {
      const parts = data.display_name.split(',').map(s => s.trim())
      return parts.slice(0, 4).join(', ')
    }
  } catch (err) {
    console.warn('Fallback reverse geocode error', err)
  }

  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`
}

async function searchLocation(query) {
  if (!query || query.length < 2) return []
  try {
    const url = `https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates?singleLine=${encodeURIComponent(query)}&countryCode=IND&maxLocations=5&forStorage=false&f=json`
    const res = await fetch(url)
    if (!res.ok) return []
    const data = await res.json()
    return (data.candidates || []).map(c => ({
      name: c.address,
      lat: c.location.y,
      lng: c.location.x
    }))
  } catch {
    return []
  }
}

export default function MapPickerModal({
  isOpen,
  title = 'Select Location on Map',
  type = 'pickup', // 'pickup' | 'destination'
  initialCoords = null,
  onConfirm,
  onClose
}) {
  const mapContainerRef = useRef(null)
  const mapInstanceRef = useRef(null)
  const markerRef = useRef(null)
  const [selectedCoords, setSelectedCoords] = useState(initialCoords || DEFAULT_CENTER)
  const [addressText, setAddressText] = useState('')
  const [geocoding, setGeocoding] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [locating, setLocating] = useState(false)
  const searchDebounceRef = useRef(null)

  // Initialize and update map
  useEffect(() => {
    if (!isOpen) return

    const initialPos = initialCoords || DEFAULT_CENTER
    setSelectedCoords(initialPos)

    // Delay slightly to ensure modal DOM is painted
    const timer = setTimeout(() => {
      if (!mapContainerRef.current) return

      if (!mapInstanceRef.current) {
        const map = L.map(mapContainerRef.current, {
          center: initialPos,
          zoom: initialCoords ? 15 : 12,
          zoomControl: false
        })

        L.control.zoom({ position: 'bottomright' }).addTo(map)

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; OpenStreetMap contributors'
        }).addTo(map)

        // Custom marker icon based on type
        const markerIcon = L.divIcon({
          className: 'custom-map-pin-icon',
          html: `<div class="pin-marker-body ${type === 'pickup' ? 'pickup-pin' : 'dest-pin'}">
                  <span class="pin-dot"></span>
                </div>`,
          iconSize: [32, 42],
          iconAnchor: [16, 40]
        })

        const marker = L.marker(initialPos, {
          draggable: true,
          icon: markerIcon
        }).addTo(map)

        marker.on('dragend', async () => {
          const pos = marker.getLatLng()
          const newCoords = [pos.lat, pos.lng]
          setSelectedCoords(newCoords)
          fetchAddress(pos.lat, pos.lng)
        })

        map.on('click', (e) => {
          const { lat, lng } = e.latlng
          marker.setLatLng([lat, lng])
          setSelectedCoords([lat, lng])
          fetchAddress(lat, lng)
        })

        markerRef.current = marker
        mapInstanceRef.current = map

        fetchAddress(initialPos[0], initialPos[1])
      } else {
        mapInstanceRef.current.invalidateSize()
        mapInstanceRef.current.setView(initialPos, initialCoords ? 15 : 12)
        if (markerRef.current) {
          markerRef.current.setLatLng(initialPos)
        }
        fetchAddress(initialPos[0], initialPos[1])
      }
    }, 120)

    return () => {
      clearTimeout(timer)
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove()
        mapInstanceRef.current = null
        markerRef.current = null
      }
    }
  }, [isOpen])

  const fetchAddress = async (lat, lng) => {
    setGeocoding(true)
    try {
      const name = await reverseGeocode(lat, lng)
      setAddressText(name)
    } catch {
      setAddressText(`${lat.toFixed(5)}, ${lng.toFixed(5)}`)
    } finally {
      setGeocoding(false)
    }
  }

  // Handle Search Input in Modal
  const handleSearchChange = (val) => {
    setSearchQuery(val)
    if (val.length < 2) {
      setSearchResults([])
      return
    }
    setSearching(true)
    clearTimeout(searchDebounceRef.current)
    searchDebounceRef.current = setTimeout(async () => {
      const results = await searchLocation(val)
      setSearchResults(results)
      setSearching(false)
    }, 300)
  }

  const handleSelectSearchResult = (item) => {
    const coords = [item.lat, item.lng]
    setSelectedCoords(coords)
    setAddressText(item.name)
    setSearchQuery('')
    setSearchResults([])

    if (mapInstanceRef.current) {
      mapInstanceRef.current.setView(coords, 16)
      if (markerRef.current) markerRef.current.setLatLng(coords)
    }
  }

  // Handle Locate Me (GPS)
  const handleLocateMe = () => {
    if (!navigator.geolocation) {
      alert('Geolocation is not supported by your browser')
      return
    }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords = [pos.coords.latitude, pos.coords.longitude]
        setSelectedCoords(coords)
        if (mapInstanceRef.current) {
          mapInstanceRef.current.setView(coords, 16)
          if (markerRef.current) markerRef.current.setLatLng(coords)
        }
        fetchAddress(coords[0], coords[1])
        setLocating(false)
      },
      (err) => {
        console.warn('Geolocation failed', err)
        alert('Could not retrieve your location. Please ensure location permissions are enabled.')
        setLocating(false)
      },
      { enableHighAccuracy: true, timeout: 8000 }
    )
  }

  const handleConfirm = () => {
    const finalAddress = addressText || `${selectedCoords[0].toFixed(5)}, ${selectedCoords[1].toFixed(5)}`
    onConfirm(finalAddress, selectedCoords)
    onClose()
  }

  if (!isOpen) return null

  return (
    <div className="modal-backdrop map-picker-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="map-picker-modal" role="dialog" aria-modal="true" aria-labelledby="map-picker-title">
        {/* Header */}
        <div className="map-picker-header">
          <div className="map-picker-title-wrap">
            <span className={`map-picker-badge ${type === 'pickup' ? 'pickup-badge' : 'dest-badge'}`}>
              {type === 'pickup' ? '📍 Pickup Location' : '🏁 Destination'}
            </span>
            <h3 id="map-picker-title">{title}</h3>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close map picker">×</button>
        </div>

        {/* Search & Action Bar */}
        <div className="map-picker-toolbar">
          <div className="map-picker-search-wrap">
            <span className="search-icon" aria-hidden="true">🔍</span>
            <input
              type="text"
              placeholder="Search area, landmark or street..."
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="map-picker-search-input"
            />
            {searchQuery && (
              <button
                type="button"
                className="btn-clear-search"
                onClick={() => { setSearchQuery(''); setSearchResults([]) }}
              >
                ✕
              </button>
            )}
            {searchResults.length > 0 && (
              <ul className="map-picker-search-results">
                {searchResults.map((item, idx) => (
                  <li key={idx} onClick={() => handleSelectSearchResult(item)}>
                    <span>📍</span> {item.name}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <button
            type="button"
            className="map-locate-btn"
            onClick={handleLocateMe}
            disabled={locating}
            title="Use current GPS location"
          >
            {locating ? '📡 Locating...' : '🧭 GPS'}
          </button>
        </div>

        {/* Map View Canvas */}
        <div className="map-picker-canvas-wrap">
          <div ref={mapContainerRef} className="map-picker-canvas" />
          <div className="map-instruction-toast">
            <span>👆 Tap anywhere on the map or drag the pin</span>
          </div>
        </div>

        {/* Footer with Selected Location Details & Confirmation */}
        <div className="map-picker-footer">
          <div className="selected-address-box">
            <span className="address-label">Selected Address:</span>
            <div className="address-display">
              {geocoding ? (
                <span className="geocoding-spinner">Fetching address details...</span>
              ) : (
                <strong>{addressText || 'Pinned on map'}</strong>
              )}
            </div>
            <small className="address-coords">
              {selectedCoords[0].toFixed(5)}, {selectedCoords[1].toFixed(5)}
            </small>
          </div>

          <button
            type="button"
            className={`btn primary-action confirm-location-btn ${type === 'pickup' ? 'confirm-pickup' : 'confirm-dest'}`}
            onClick={handleConfirm}
          >
            Confirm {type === 'pickup' ? 'Pickup' : 'Destination'}
          </button>
        </div>
      </div>
    </div>
  )
}
