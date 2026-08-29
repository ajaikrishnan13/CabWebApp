import React, { useEffect, useRef, useState } from 'react'
import { loadGoogleMapsScript, reverseGeocodeGoogle, searchGooglePlaces, geocodePlaceId } from '../utils/googleMaps'

// Default center: Local metropolitan area (Chennai, India)
const DEFAULT_CENTER = [12.92404, 80.11550]

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

export default function MapPickerModal({
  isOpen,
  title = 'Select Location on Map',
  type = 'pickup', // 'pickup' | 'destination'
  initialCoords = null,
  initialAddress = '',
  onConfirm,
  onClose,
  isDarkMode = false
}) {
  const mapContainerRef = useRef(null)
  const googleMapRef = useRef(null)
  const googleMarkerRef = useRef(null)
  const leafletMapRef = useRef(null)
  const leafletMarkerRef = useRef(null)

  const [selectedCoords, setSelectedCoords] = useState(initialCoords || DEFAULT_CENTER)
  const [addressText, setAddressText] = useState(initialAddress || '')
  const [geocoding, setGeocoding] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [locating, setLocating] = useState(false)
  const searchDebounceRef = useRef(null)

  // Prevent background scrolling when map picker modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.classList.add('modal-open')
      const originalOverflow = document.body.style.overflow
      document.body.style.overflow = 'hidden'
      return () => {
        document.body.classList.remove('modal-open')
        document.body.style.overflow = originalOverflow
      }
    }
  }, [isOpen])

  const fetchAddress = async (lat, lng) => {
    setGeocoding(true)
    try {
      const addr = await reverseGeocodeGoogle([lat, lng])
      if (addr) {
        setAddressText(addr)
      } else {
        setAddressText(`${lat.toFixed(5)}, ${lng.toFixed(5)}`)
      }
    } catch {
      setAddressText(`${lat.toFixed(5)}, ${lng.toFixed(5)}`)
    } finally {
      setGeocoding(false)
    }
  }

  // Initialize and update Map when modal opens
  useEffect(() => {
    if (!isOpen) return

    setAddressText(initialAddress || '')
    let isMounted = true

    const initMap = async () => {
      let centerCoords = initialCoords

      // If coordinates not provided but address text exists, attempt to geocode
      if (!centerCoords && initialAddress && initialAddress.trim().length > 2) {
        try {
          centerCoords = await geocodePlaceId(null, initialAddress)
        } catch {
          centerCoords = null
        }
      }

      if (!centerCoords) {
        centerCoords = initialCoords || DEFAULT_CENTER
      }

      if (!isMounted) return
      setSelectedCoords(centerCoords)

      // Try Google Maps first
      try {
        const maps = await loadGoogleMapsScript()
        if (!isMounted || !mapContainerRef.current) return

        const centerObj = { lat: centerCoords[0], lng: centerCoords[1] }

        if (!googleMapRef.current) {
          mapContainerRef.current.innerHTML = ''
          const map = new maps.Map(mapContainerRef.current, {
            center: centerObj,
            zoom: 15,
            disableDefaultUI: true,
            zoomControl: true,
            keyboardShortcuts: false,
            gestureHandling: 'greedy',
            mapTypeControl: false,
            streetViewControl: false,
            fullscreenControl: false,
            styles: isDarkMode ? darkMapStyles : []
          })

          const trafficLayer = new maps.TrafficLayer()
          trafficLayer.setMap(map)

          const marker = new maps.Marker({
            position: centerObj,
            map,
            draggable: true,
            title: type === 'pickup' ? 'Pickup Location' : 'Destination',
            animation: maps.Animation.DROP
          })

          marker.addListener('dragend', () => {
            const pos = marker.getPosition()
            const newCoords = [pos.lat(), pos.lng()]
            setSelectedCoords(newCoords)
            fetchAddress(pos.lat(), pos.lng())
          })

          map.addListener('click', (e) => {
            const clicked = e.latLng
            marker.setPosition(clicked)
            const newCoords = [clicked.lat(), clicked.lng()]
            setSelectedCoords(newCoords)
            fetchAddress(clicked.lat(), clicked.lng())
          })

          googleMapRef.current = map
          googleMarkerRef.current = marker

          setTimeout(() => {
            if (googleMapRef.current) {
              maps.event.trigger(googleMapRef.current, 'resize')
              googleMapRef.current.setCenter(centerObj)
            }
          }, 250)
        } else {
          googleMapRef.current.setCenter(centerObj)
          googleMapRef.current.setZoom(15)
          if (googleMarkerRef.current) {
            googleMarkerRef.current.setPosition(centerObj)
          }
        }
        return
      } catch (err) {
        console.warn('Google Maps modal fallback:', err)
      }

      // Leaflet / OpenStreetMap Fallback if Google Maps fails
      try {
        if (!isMounted || !mapContainerRef.current) return
        const L = window.L || (await import('leaflet')).default || (await import('leaflet'))
        if (!isMounted || !mapContainerRef.current) return

        if (!leafletMapRef.current) {
          mapContainerRef.current.innerHTML = ''
          const map = L.map(mapContainerRef.current).setView(centerCoords, 15)
          L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors',
            maxZoom: 19
          }).addTo(map)

          const marker = L.marker(centerCoords, { draggable: true }).addTo(map)

          marker.on('dragend', () => {
            const pos = marker.getLatLng()
            const newCoords = [pos.lat, pos.lng]
            setSelectedCoords(newCoords)
            fetchAddress(pos.lat, pos.lng)
          })

          map.on('click', (e) => {
            marker.setLatLng(e.latlng)
            const newCoords = [e.latlng.lat, e.latlng.lng]
            setSelectedCoords(newCoords)
            fetchAddress(e.latlng.lat, e.latlng.lng)
          })

          leafletMapRef.current = map
          leafletMarkerRef.current = marker

          setTimeout(() => {
            if (leafletMapRef.current) {
              leafletMapRef.current.invalidateSize()
              leafletMapRef.current.setView(centerCoords, 15)
            }
          }, 250)
        } else {
          leafletMapRef.current.setView(centerCoords, 15)
          if (leafletMarkerRef.current) {
            leafletMarkerRef.current.setLatLng(centerCoords)
          }
        }
      } catch (fallbackErr) {
        console.error('All map renderers failed', fallbackErr)
      }
    }

    const timer = setTimeout(initMap, 100)

    return () => {
      isMounted = false
      clearTimeout(timer)
      if (leafletMapRef.current) {
        leafletMapRef.current.remove()
        leafletMapRef.current = null
      }
      googleMapRef.current = null
      googleMarkerRef.current = null
    }
  }, [isOpen])

  // Dynamically update map theme when isDarkMode changes
  useEffect(() => {
    if (googleMapRef.current) {
      googleMapRef.current.setOptions({
        styles: isDarkMode ? darkMapStyles : []
      })
    }
  }, [isDarkMode])

  // Handle Location Search Input
  const handleSearchChange = (val) => {
    setSearchQuery(val)
    if (val.length < 2) {
      setSearchResults([])
      return
    }
    setSearching(true)
    clearTimeout(searchDebounceRef.current)
    searchDebounceRef.current = setTimeout(async () => {
      try {
        let results = await searchGooglePlaces(val)
        if (!results || results.length === 0) {
          const url = `https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates?singleLine=${encodeURIComponent(val)}&countryCode=IND&maxLocations=5&forStorage=false&f=json`
          const res = await fetch(url)
          if (res.ok) {
            const data = await res.json()
            results = (data.candidates || []).map(item => ({
              display_name: item.address,
              lat: item.location.y,
              lon: item.location.x
            }))
          }
        }
        setSearchResults(results || [])
      } catch {
        setSearchResults([])
      } finally {
        setSearching(false)
      }
    }, 280)
  }

  const handleSelectSearchResult = async (item) => {
    let lat = item.lat
    let lon = item.lon

    if (!lat && item.place_id) {
      const coords = await geocodePlaceId(item.place_id, item.display_name)
      if (coords) {
        lat = coords[0]
        lon = coords[1]
      }
    }

    if (!lat) {
      lat = DEFAULT_CENTER[0]
      lon = DEFAULT_CENTER[1]
    }

    const coords = [lat, lon]
    setSelectedCoords(coords)
    setAddressText(item.display_name)
    setSearchQuery('')
    setSearchResults([])

    if (googleMapRef.current && googleMarkerRef.current) {
      const posObj = { lat, lng: lon }
      googleMapRef.current.setCenter(posObj)
      googleMapRef.current.setZoom(16)
      googleMarkerRef.current.setPosition(posObj)
    } else if (leafletMapRef.current && leafletMarkerRef.current) {
      leafletMapRef.current.setView(coords, 16)
      leafletMarkerRef.current.setLatLng(coords)
    }
  }

  // Handle GPS Locate Me
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
        if (googleMapRef.current && googleMarkerRef.current) {
          const posObj = { lat: coords[0], lng: coords[1] }
          googleMapRef.current.setCenter(posObj)
          googleMapRef.current.setZoom(16)
          googleMarkerRef.current.setPosition(posObj)
        } else if (leafletMapRef.current && leafletMarkerRef.current) {
          leafletMapRef.current.setView(coords, 16)
          leafletMarkerRef.current.setLatLng(coords)
        }
        fetchAddress(coords[0], coords[1])
        setLocating(false)
      },
      (err) => {
        console.warn('Geolocation failed', err)
        alert('Could not retrieve your GPS location. Please check browser permissions.')
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
    <div
      className="modal-backdrop map-picker-backdrop"
      role="presentation"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="map-picker-modal" role="dialog" aria-modal="true" aria-labelledby="map-picker-title">
        {/* Header with Title & Close button */}
        <div className="map-picker-header">
          <div className="map-picker-title-wrap">
            <span className={`map-picker-badge ${type === 'pickup' ? 'pickup-badge' : 'dest-badge'}`}>
              {type === 'pickup' ? '📍 Pickup Location' : '🏁 Destination'}
            </span>
            <h3 id="map-picker-title">{title}</h3>
          </div>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            aria-label="Close map picker"
            title="Close"
          >
            ×
          </button>
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
                aria-label="Clear search"
              >
                ✕
              </button>
            )}
            {searchResults.length > 0 && (
              <ul className="map-picker-search-results">
                {searchResults.map((item, idx) => (
                  <li key={idx} onClick={() => handleSelectSearchResult(item)}>
                    <span>📍</span> {item.display_name}
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
            title="Use current location"
          >
            {locating ? '📡 Locating...' : '📍 Current Location'}
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
                <strong>{addressText || `${selectedCoords[0].toFixed(5)}, ${selectedCoords[1].toFixed(5)}`}</strong>
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
