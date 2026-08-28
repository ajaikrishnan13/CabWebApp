import React, { useEffect, useRef, useState } from 'react'
import { auth, database } from '../database'
import DateTimePicker from '../components/DateTimePicker'
import BirthdayPicker from '../components/BirthdayPicker'
import MapPickerModal from '../components/MapPickerModal'
import RoutePreviewMap from '../components/RoutePreviewMap'
import logo from '../assets/logo.png'
import sedanImage from '../assets/sedan.png'
import suvImage from '../assets/suv.png'
import luxuryImage from '../assets/luxury.png'
import miniImage from '../assets/mini.png'

const carOptions = [
  { name: 'Sedan', detail: 'Comfortable', image: sedanImage },
  { name: 'SUV', detail: 'Extra space', image: suvImage },
  { name: 'Luxury', detail: 'Premium ride', image: luxuryImage },
  { name: 'Mini', detail: 'City friendly', image: miniImage }
]

export default function Home({ user }) {
  const [profile, setProfile] = useState(() => ({
    name: user.user_metadata?.name || '',
    email: user.email || '',
    phone: user.user_metadata?.phone || '',
    birthday: user.user_metadata?.birthday || '',
    avatarUrl: user.user_metadata?.avatar_url || ''
  }))
  const displayName = profile.name || user.user_metadata?.name || user.email || 'User'
  const profileInitials = displayName.split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase()

  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [fromCoords, setFromCoords] = useState(null)
  const [toCoords, setToCoords] = useState(null)
  const [routeInfo, setRouteInfo] = useState(null)
  const [routeGeoJson, setRouteGeoJson] = useState(null)
  const [routeLoading, setRouteLoading] = useState(false)
  const [datetime, setDatetime] = useState('')
  const [dateValue, setDateValue] = useState('')
  const [timeValue, setTimeValue] = useState('')
  const [carType, setCarType] = useState('Sedan')
  const [serviceType, setServiceType] = useState('Rental')
  const [loading, setLoading] = useState(false)
  const [bookingSuccess, setBookingSuccess] = useState(false)
  const [bookingError, setBookingError] = useState(null)
  const [fromSuggestions, setFromSuggestions] = useState([])
  const [toSuggestions, setToSuggestions] = useState([])
  const [bookings, setBookings] = useState([])

  const fromCoordsRef = useRef(null)
  const toCoordsRef = useRef(null)
  const debounceFromRef = useRef(null)
  const debounceToRef = useRef(null)
  const [fromLoading, setFromLoading] = useState(false)
  const [toLoading, setToLoading] = useState(false)
  const [fromError, setFromError] = useState(null)
  const [toError, setToError] = useState(null)

  // Map Picker Modal State
  const [mapPickerOpen, setMapPickerOpen] = useState(false)
  const [mapPickerType, setMapPickerType] = useState('pickup')
  const [gpsLoading, setGpsLoading] = useState(false)

  // Sticky header scroll state
  const [headerScrolled, setHeaderScrolled] = useState(false)
  useEffect(() => {
    const onScroll = () => setHeaderScrolled(window.scrollY > 20)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Profile modal state
  const [profileOpen, setProfileOpen] = useState(false)
  const [avatarFile, setAvatarFile] = useState(null)
  const [avatarPreview, setAvatarPreview] = useState('')
  const [profileLoading, setProfileLoading] = useState(false)
  const [profileMessage, setProfileMessage] = useState(null)
  const [profileSaved, setProfileSaved] = useState(false)

  // Time-of-day greeting
  const getTimeGreeting = () => {
    const h = new Date().getHours()
    if (h < 12) return { emoji: '\uD83C\uDF05', text: 'Good morning' }
    if (h < 17) return { emoji: '\u2600\uFE0F', text: 'Good afternoon' }
    return { emoji: '\uD83C\uDF19', text: 'Good evening' }
  }
  const greeting = getTimeGreeting()

  // Past datetime check
  const isPastDatetime = datetime ? new Date(datetime) < new Date() : false

  // Calculate route and journey details
  useEffect(() => {
    if (!fromCoords || !toCoords) {
      setRouteInfo(null)
      setRouteGeoJson(null)
      return
    }

    const controller = new AbortController()
    const loadRoute = async () => {
      setRouteLoading(true)
      try {
        const coordinates = `${fromCoords[1]},${fromCoords[0]};${toCoords[1]},${toCoords[0]}`
        const response = await fetch(`https://router.project-osrm.org/route/v1/driving/${coordinates}?overview=full&geometries=geojson`, { signal: controller.signal })
        if (!response.ok) throw new Error(`Routing service returned ${response.status}`)
        const data = await response.json()
        if (!data.routes?.[0] || controller.signal.aborted) return

        const route = data.routes[0]
        const distKm = (route.distance / 1000).toFixed(1)
        const durMin = Math.ceil(route.duration / 60)

        setRouteGeoJson(route.geometry)
        setRouteInfo({
          distance: `${distKm} km`,
          duration: durMin >= 60 ? `${Math.floor(durMin / 60)}h ${durMin % 60}m` : `${durMin} min`,
          summary: route.legs?.[0]?.summary ? `via ${route.legs[0].summary}` : 'Direct Route'
        })
      } catch (error) {
        if (error.name !== 'AbortError') {
          console.error('Failed to load route', error)
          setRouteInfo({ error: 'Route estimate unavailable' })
        }
      } finally {
        if (!controller.signal.aborted) {
          setRouteLoading(false)
        }
      }
    }
    loadRoute()
    return () => controller.abort()
  }, [fromCoords, toCoords])

  useEffect(() => {
    database.listBookings(user.id).then(setBookings).catch(err => console.error('Failed to load bookings', err))
  }, [user.id])

  useEffect(() => {
    database.getProfile(user.id).then(saved => {
      setProfile({
        name: saved?.name || user.user_metadata?.name || '',
        email: saved?.email || user.email || '',
        phone: saved?.phone || user.user_metadata?.phone || '',
        birthday: saved?.birthday || user.user_metadata?.birthday || '',
        avatarUrl: saved?.avatar_url || user.user_metadata?.avatar_url || ''
      })
    }).catch(err => console.error('Failed to load profile', err))
  }, [user.id])

  const fetchSuggestions = async (q) => {
    if (!q || q.length < 2) return []
    const url = `https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates?singleLine=${encodeURIComponent(q)}&countryCode=IND&maxLocations=6&forStorage=false&f=json`
    const res = await fetch(url)
    if (!res.ok) throw new Error('Location service returned ' + res.status)
    const data = await res.json()
    return (data.candidates || []).map(item => ({ display_name: item.address, lat: item.location.y, lon: item.location.x }))
  }

  const handleFromInput = (val) => {
    setFrom(val)
    fromCoordsRef.current = null
    setFromCoords(null)
    setFromError(null)
    setFromSuggestions([])
    setFromLoading(true)
    clearTimeout(debounceFromRef.current)
    debounceFromRef.current = setTimeout(async () => {
      try {
        const items = await fetchSuggestions(val)
        setFromSuggestions(items)
      } catch (err) {
        console.error('from suggestion error', err)
        setFromError(err.message || 'Failed to fetch suggestions')
      } finally {
        setFromLoading(false)
      }
    }, 300)
  }

  const handleToInput = (val) => {
    setTo(val)
    toCoordsRef.current = null
    setToCoords(null)
    setToError(null)
    setToSuggestions([])
    setToLoading(true)
    clearTimeout(debounceToRef.current)
    debounceToRef.current = setTimeout(async () => {
      try {
        const items = await fetchSuggestions(val)
        setToSuggestions(items)
      } catch (err) {
        console.error('to suggestion error', err)
        setToError(err.message || 'Failed to fetch suggestions')
      } finally {
        setToLoading(false)
      }
    }, 300)
  }

  const selectFromSuggestion = (s) => {
    setFrom(s.display_name)
    const coordinates = [s.lat, s.lon]
    fromCoordsRef.current = coordinates
    setFromCoords(coordinates)
    setFromSuggestions([])
  }

  const selectToSuggestion = (s) => {
    setTo(s.display_name)
    const coordinates = [s.lat, s.lon]
    toCoordsRef.current = coordinates
    setToCoords(coordinates)
    setToSuggestions([])
  }

  const openMapPicker = (type) => {
    setMapPickerType(type)
    setMapPickerOpen(true)
  }

  const handleMapPickerConfirm = (address, coords) => {
    if (mapPickerType === 'pickup') {
      setFrom(address)
      fromCoordsRef.current = coords
      setFromCoords(coords)
      setFromSuggestions([])
      setFromError(null)
    } else {
      setTo(address)
      toCoordsRef.current = coords
      setToCoords(coords)
      setToSuggestions([])
      setToError(null)
    }
  }

  const handleUseCurrentLocation = () => {
    if (!navigator.geolocation) {
      alert('Geolocation is not supported by your browser.')
      return
    }
    setGpsLoading(true)
    setFromLoading(true)
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const coords = [pos.coords.latitude, pos.coords.longitude]
        fromCoordsRef.current = coords
        setFromCoords(coords)
        setFromSuggestions([])
        try {
          const url = `https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/reverseGeocode?location=${coords[1]},${coords[0]}&f=json`
          const res = await fetch(url)
          const data = await res.json()
          const name = data?.address?.Match_addr || data?.address?.Address || `${coords[0].toFixed(4)}, ${coords[1].toFixed(4)}`
          setFrom(name)
        } catch {
          setFrom(`${coords[0].toFixed(4)}, ${coords[1].toFixed(4)}`)
        } finally {
          setGpsLoading(false)
          setFromLoading(false)
        }
      },
      (err) => {
        console.warn('Geolocation error:', err)
        alert('Could not retrieve current location. Please check browser location permissions.')
        setGpsLoading(false)
        setFromLoading(false)
      },
      { enableHighAccuracy: true, timeout: 8000 }
    )
  }

  const handleSwapLocations = () => {
    const tempFrom = from
    const tempFromCoords = fromCoords
    setFrom(to)
    fromCoordsRef.current = toCoords
    setFromCoords(toCoords)
    setTo(tempFrom)
    toCoordsRef.current = tempFromCoords
    setToCoords(tempFromCoords)
  }

  const handleSignOut = async () => {
    auth.signOut()
  }

  const handleProfileSave = async (e) => {
    e.preventDefault()
    setProfileLoading(true)
    setProfileMessage(null)
    setProfileSaved(false)
    try {
      const updatedUser = await auth.updateProfile(profile, avatarFile)
      const savedAvatarUrl = updatedUser.user_metadata?.avatar_url !== undefined
        ? updatedUser.user_metadata.avatar_url
        : profile.avatarUrl
      setProfile(prev => ({
        ...prev,
        ...profile,
        avatarUrl: savedAvatarUrl || ''
      }))
      setAvatarFile(null)
      if (avatarPreview && avatarPreview.startsWith('blob:')) {
        URL.revokeObjectURL(avatarPreview)
      }
      setAvatarPreview('')
      setProfileSaved(true)
      setTimeout(() => {
        setProfileOpen(false)
        setProfileSaved(false)
      }, 1400)
    } catch (err) {
      const message = err.code === 'PGRST205' || err.message?.includes("public.profiles")
        ? 'Profile storage is not ready. Run the latest supabase-schema.sql in Supabase SQL Editor, then try again.'
        : err.message || 'Could not save profile.'
      setProfileMessage(message)
    } finally {
      setProfileLoading(false)
    }
  }

  const handleAvatarChange = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setProfileMessage('Please choose an image file.')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setProfileMessage('Profile pictures must be smaller than 5 MB.')
      return
    }
    setAvatarFile(file)
    if (avatarPreview && avatarPreview.startsWith('blob:')) {
      URL.revokeObjectURL(avatarPreview)
    }
    setAvatarPreview(URL.createObjectURL(file))
    setProfileMessage(null)
  }

  const handleRequest = async (e) => {
    e.preventDefault()
    setBookingError(null)
    if (!datetime || !from || !to) {
      setBookingError('Please fill in the date/time and both pickup and destination locations.')
      return
    }
    if (isPastDatetime) {
      setBookingError('Please select a future date and time for your booking.')
      return
    }
    setLoading(true)
    try {
      await database.addBooking({
        uid: user.id,
        name: user.user_metadata?.name || null,
        email: user.email,
        datetime,
        from,
        to,
        fromCoords: fromCoords || null,
        toCoords: toCoords || null,
        carType,
        serviceType,
        status: 'requested'
      })
      setBookingSuccess(true)
      // reset form
      setDatetime('')
      setDateValue('')
      setTimeValue('')
      setFrom('')
      setTo('')
      fromCoordsRef.current = null
      toCoordsRef.current = null
      setFromCoords(null)
      setToCoords(null)
      setRouteInfo(null)
      setRouteGeoJson(null)
      // refresh bookings
      setBookings(await database.listBookings(user.id))
      setTimeout(() => setBookingSuccess(false), 5000)
    } catch (err) {
      console.error(err)
      setBookingError('Failed to request booking: ' + err.message)
      setLoading(false)
      return
    } finally {
      setLoading(false)
    }
  }

  const updateDateTime = (date, time) => {
    setDateValue(date)
    setTimeValue(time)
    setDatetime(date && time ? `${date}T${time}` : '')
  }

  return (
    <main className="app-shell">
      {/* Sticky Floating Header */}
      <header className={`site-header${headerScrolled ? ' scrolled' : ''}`} role="banner">
        <div className="site-header-inner">
          {/* Brand */}
          <div className="header-brand">
            <img src={logo} alt="Namma Driver logo" className="header-logo" />
            <div className="header-brand-text">
              <span className="brand-tagline">Private car service</span>
            </div>
          </div>

          {/* Center greeting — time-aware */}
          <div className="header-greeting" aria-hidden="true">
            <span className="greeting-wave">{greeting.emoji}</span>
            <span>{greeting.text}, <strong>{displayName.split(' ')[0]}</strong></span>
          </div>

          {/* Right Actions */}
          <div className="header-actions">
            {/* Profile button */}
            <button
              className="header-profile-btn"
              aria-label="Edit profile"
              title="Edit profile"
              onClick={() => { setProfileMessage(null); setProfileOpen(true) }}
            >
              <span className="header-avatar">
                {profile.avatarUrl
                  ? <img src={profile.avatarUrl} alt="" className="header-avatar-img" />
                  : <span className="header-avatar-initials" aria-hidden="true">{profileInitials}</span>
                }
              </span>
              <span className="header-username">{displayName.split(' ')[0]}</span>
              <svg className="header-chevron" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9" /></svg>
            </button>

            {/* Sign out */}
            <button
              className="header-signout-btn"
              aria-label="Sign out"
              title="Sign out"
              onClick={handleSignOut}
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M10 5H5v14h5M14 8l4 4-4 4M8 12h10" />
              </svg>
              <span className="signout-label">Sign out</span>
            </button>
          </div>
        </div>
      </header>

      <section className="card booking-card">
        <div className="section-heading">
          <div>
            <span className="eyebrow">New journey</span>
            <h2>Where are you going?</h2>
          </div>
          <span className="status-dot">Ready to book</span>
        </div>
        <form className="form" onSubmit={handleRequest}>
          <div className="form-grid">
            <DateTimePicker
              dateValue={dateValue}
              timeValue={timeValue}
              onChange={updateDateTime}
            />

            {/* Redesigned Location Inputs with Map & GPS Quick Actions */}
            <div className="location-inputs-container full-width">
              {/* Pickup Location Field */}
              <div className="location-input-group">
                <label className="field location-field">
                  <div className="location-label-row">
                    <span className="location-label-text">
                      <span className="location-indicator pickup-indicator" /> Pickup Location
                    </span>
                    <div className="location-action-pills">
                      <button
                        type="button"
                        className="loc-action-pill"
                        onClick={handleUseCurrentLocation}
                        disabled={gpsLoading}
                        title="Use current GPS location"
                      >
                        {gpsLoading ? '📡 Locating...' : '🧭 GPS'}
                      </button>
                      <button
                        type="button"
                        className="loc-action-pill highlight"
                        onClick={() => openMapPicker('pickup')}
                        title="Pick location on map"
                      >
                        📍 Select on Map
                      </button>
                    </div>
                  </div>

                  <div className="input-wrap">
                    <span className="location-dot pickup-dot" aria-hidden="true" />
                    <input
                      type="text"
                      placeholder="Search pickup address or landmark"
                      value={from}
                      onChange={e => handleFromInput(e.target.value)}
                    />
                    {from && (
                      <button
                        type="button"
                        className="input-clear-btn"
                        onClick={() => { setFrom(''); setFromCoords(null); fromCoordsRef.current = null }}
                        aria-label="Clear pickup"
                      >
                        ✕
                      </button>
                    )}
                  </div>

                  {(fromSuggestions.length > 0 || fromLoading || fromError) && (
                    <ul className="suggestions">
                      {fromLoading && <li className="muted">Searching locations...</li>}
                      {fromError && <li className="muted">Error: {fromError}</li>}
                      {!fromLoading && !fromError && fromSuggestions.length === 0 && <li className="muted">No places found</li>}
                      {fromSuggestions.map((s, i) => (
                        <li key={i} onClick={() => selectFromSuggestion(s)}>
                          <span className="sug-icon">📍</span> {s.display_name}
                        </li>
                      ))}
                    </ul>
                  )}
                </label>
              </div>

              {/* Swap Button */}
              <div className="location-swap-divider">
                <button
                  type="button"
                  className="btn-swap-locations"
                  onClick={handleSwapLocations}
                  disabled={!from && !to}
                  title="Swap Pickup & Destination"
                  aria-label="Swap Pickup and Destination"
                >
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="17 1 21 5 17 9"></polyline>
                    <path d="M3 5h18"></path>
                    <polyline points="7 23 3 19 7 15"></polyline>
                    <path d="M21 19H3"></path>
                  </svg>
                </button>
              </div>

              {/* Drop-off Location Field */}
              <div className="location-input-group">
                <label className="field location-field">
                  <div className="location-label-row">
                    <span className="location-label-text">
                      <span className="location-indicator dropoff-indicator" /> Drop-off Destination
                    </span>
                    <div className="location-action-pills">
                      <button
                        type="button"
                        className="loc-action-pill highlight"
                        onClick={() => openMapPicker('destination')}
                        title="Pick destination on map"
                      >
                        📍 Select on Map
                      </button>
                    </div>
                  </div>

                  <div className="input-wrap">
                    <span className="location-dot dropoff-dot" aria-hidden="true" />
                    <input
                      type="text"
                      placeholder="Search destination or drop location"
                      value={to}
                      onChange={e => handleToInput(e.target.value)}
                    />
                    {to && (
                      <button
                        type="button"
                        className="input-clear-btn"
                        onClick={() => { setTo(''); setToCoords(null); toCoordsRef.current = null }}
                        aria-label="Clear destination"
                      >
                        ✕
                      </button>
                    )}
                  </div>

                  {(toSuggestions.length > 0 || toLoading || toError) && (
                    <ul className="suggestions">
                      {toLoading && <li className="muted">Searching locations...</li>}
                      {toError && <li className="muted">Error: {toError}</li>}
                      {!toLoading && !toError && toSuggestions.length === 0 && <li className="muted">No places found</li>}
                      {toSuggestions.map((s, i) => (
                        <li key={i} onClick={() => selectToSuggestion(s)}>
                          <span className="sug-icon">🏁</span> {s.display_name}
                        </li>
                      ))}
                    </ul>
                  )}
                </label>
              </div>
            </div>

            {/* Live Journey & Route Estimation Card */}
            {(fromCoords && toCoords) ? (
              <div className="journey-estimation-card full-width">
                <div className="journey-card-header">
                  <div className="journey-badge-wrap">
                    <span className="journey-live-dot" />
                    <span className="journey-header-title">Live Journey & Route Preview</span>
                  </div>
                  {routeLoading && <span className="route-calc-spinner">Calculating optimal route...</span>}
                  {routeInfo?.summary && !routeLoading && (
                    <span className="route-summary-tag">{routeInfo.summary}</span>
                  )}
                </div>

                {/* Primary Route Metrics */}
                <div className="journey-metrics-grid">
                  <div className="journey-metric-card metric-distance">
                    <div className="metric-icon-wrap">🛣️</div>
                    <div className="metric-info">
                      <span className="metric-label">Estimated Distance</span>
                      <strong className="metric-value">
                        {routeLoading ? '...' : (routeInfo?.distance || 'Estimating...')}
                      </strong>
                    </div>
                  </div>

                  <div className="journey-metric-card metric-duration">
                    <div className="metric-icon-wrap">⏱️</div>
                    <div className="metric-info">
                      <span className="metric-label">Estimated Travel Time</span>
                      <strong className="metric-value highlight-gold">
                        {routeLoading ? '...' : (routeInfo?.duration || 'Estimating...')}
                      </strong>
                    </div>
                  </div>
                </div>

                {/* Embedded Interactive Route Map Preview */}
                <div className="journey-map-wrapper">
                  <RoutePreviewMap
                    fromCoords={fromCoords}
                    toCoords={toCoords}
                    routeGeoJson={routeGeoJson}
                  />
                  <div className="journey-map-footer-overlay">
                    <span className="map-stop start-stop">📍 {from ? from.split(',')[0] : 'Pickup'}</span>
                    <span className="map-arrow">➔</span>
                    <span className="map-stop end-stop">🏁 {to ? to.split(',')[0] : 'Destination'}</span>
                  </div>
                </div>
              </div>
            ) : (
              (from || to) && (
                <div className="journey-helper-prompt full-width">
                  <span className="helper-icon">💡</span>
                  <span>
                    {!from ? 'Please select a pickup location.' : 'Select a drop-off destination to view distance, travel time, and route preview.'}
                  </span>
                </div>
              )
            )}

            <fieldset className="car-field full-width">
              <legend>Choose your car</legend>
              <div className="car-options">
                {carOptions.map(car => (
                  <label className={`car-option ${carType === car.name ? 'selected' : ''}`} key={car.name}>
                    <input type="radio" name="carType" value={car.name} checked={carType === car.name} onChange={e=>setCarType(e.target.value)} />
                    <img src={car.image} alt={`${car.name} car`} />
                    <span><strong>{car.name}</strong><small>{car.detail}</small></span>
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset className="service-field full-width">
              <legend>Service type</legend>
              <div className="service-options">
                {[
                  { value: 'Rental', icon: '🚗', label: 'Rental', sub: 'Self-drive rental' },
                  { value: 'Acting Driver', icon: '👨\u200d✈️', label: 'Acting Driver', sub: 'We drive your car' },
                  { value: 'Point-to-Point', icon: '📍', label: 'Point-to-Point', sub: 'One-way transfer' }
                ].map(opt => (
                  <label key={opt.value} className={`service-option${serviceType === opt.value ? ' selected' : ''}`}>
                    <input type="radio" name="service" value={opt.value} checked={serviceType === opt.value} onChange={e => setServiceType(e.target.value)} />
                    <span className="service-icon">{opt.icon}</span>
                    <span className="service-label-wrap">
                      <strong>{opt.label}</strong>
                      <small>{opt.sub}</small>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          </div>

          {/* Past datetime warning */}
          {isPastDatetime && datetime && (
            <div className="booking-warning">
              <span>⚠️</span> Please select a <strong>future</strong> date and time.
            </div>
          )}

          {/* Inline booking error */}
          {bookingError && (
            <div className="booking-inline-err">
              <span>❌</span> {bookingError}
            </div>
          )}

          {/* Booking success banner */}
          {bookingSuccess ? (
            <div className="booking-success-banner">
              <span className="success-check">✓</span>
              <div>
                <strong>Booking requested!</strong>
                <p>We've received your request. Our team will confirm shortly.</p>
              </div>
            </div>
          ) : (
            <button type="submit" className="btn primary-action" disabled={loading || isPastDatetime}>
              {loading ? (
                <><span className="btn-spinner" />Requesting...</>
              ) : 'Request Booking'}
            </button>
          )}
        </form>
      </section>

      <section className="card bookings-card">
        <div className="bookings-card-header">
          <h3>Recent Bookings</h3>
          {bookings.length > 0 && <span className="bookings-count-badge">{bookings.length}</span>}
        </div>
        {bookings.length === 0 ? (
          <div className="empty-bookings">
            <div className="empty-car-illustration" aria-hidden="true">
              <svg viewBox="0 0 120 60" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="10" y="28" width="100" height="22" rx="6" fill="#e4eefa" stroke="#b8cfe8" strokeWidth="1.5"/>
                <rect x="28" y="14" width="56" height="22" rx="6" fill="#c8d8ed" stroke="#98b8d8" strokeWidth="1.5"/>
                <circle cx="32" cy="50" r="8" fill="#0b3977" stroke="#fff" strokeWidth="2"/>
                <circle cx="32" cy="50" r="3.5" fill="#d5e5fa"/>
                <circle cx="88" cy="50" r="8" fill="#0b3977" stroke="#fff" strokeWidth="2"/>
                <circle cx="88" cy="50" r="3.5" fill="#d5e5fa"/>
                <rect x="78" y="20" width="16" height="14" rx="3" fill="#98b8d8"/>
                <rect x="30" y="20" width="40" height="14" rx="3" fill="#98b8d8"/>
                <line x1="0" y1="58" x2="120" y2="58" stroke="#d9e1ed" strokeWidth="1.5" strokeDasharray="4 4"/>
              </svg>
            </div>
            <p className="empty-title">No trips yet</p>
            <p className="empty-sub">Your bookings will appear here once you make your first request above ↑</p>
          </div>
        ) : (
          <ul className="booking-list">
            {bookings.map(b => {
              const statusMap = {
                requested: { label: 'Requested', cls: 'status-requested' },
                confirmed: { label: 'Confirmed', cls: 'status-confirmed' },
                completed: { label: 'Completed', cls: 'status-completed' },
                cancelled: { label: 'Cancelled', cls: 'status-cancelled' }
              }
              const st = statusMap[b.status] || statusMap.requested
              const dt = b.datetime ? new Date(b.datetime) : null
              const dtStr = dt ? dt.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : b.datetime
              return (
                <li key={b.id} className="booking-item">
                  <div className="booking-item-top">
                    <div className="booking-route">
                      <span className="booking-from">📍 {b.from?.split(',')[0] || 'Pickup'}</span>
                      <span className="booking-arrow">→</span>
                      <span className="booking-to">🏁 {b.to?.split(',')[0] || 'Destination'}</span>
                    </div>
                    <span className={`booking-status-badge ${st.cls}`}>{st.label}</span>
                  </div>
                  <div className="booking-item-meta">
                    <span className="booking-meta-pill">🚘 {b.carType}</span>
                    <span className="booking-meta-pill">⚙️ {b.serviceType}</span>
                    <span className="booking-meta-pill">🕐 {dtStr}</span>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {/* Map Location Picker Dialog Modal */}
      <MapPickerModal
        isOpen={mapPickerOpen}
        type={mapPickerType}
        title={mapPickerType === 'pickup' ? 'Choose Pickup on Map' : 'Choose Destination on Map'}
        initialCoords={mapPickerType === 'pickup' ? fromCoords : toCoords}
        onConfirm={handleMapPickerConfirm}
        onClose={() => setMapPickerOpen(false)}
      />

      {profileOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={e => e.target === e.currentTarget && setProfileOpen(false)}>
          <section className="profile-modal" role="dialog" aria-modal="true" aria-labelledby="profile-title">
            <div className="modal-heading">
              <div><span className="eyebrow">Your details</span><h2 id="profile-title">Edit profile</h2></div>
              <button className="modal-close" aria-label="Close profile" onClick={() => setProfileOpen(false)}>×</button>
            </div>
            <form className="form profile-form" onSubmit={handleProfileSave}>
              <div className="avatar-editor">
                <div className="avatar-large">
                  {avatarPreview || profile.avatarUrl ? (
                    <img src={avatarPreview || profile.avatarUrl} alt="Current profile" />
                  ) : (
                    <span>{profileInitials}</span>
                  )}
                </div>
                <div className="avatar-actions-wrap">
                  <label className="avatar-upload">
                    Change photo
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/jpg"
                      onChange={handleAvatarChange}
                    />
                  </label>
                  {(avatarPreview || profile.avatarUrl) && (
                    <button
                      type="button"
                      className="avatar-remove-btn"
                      onClick={() => {
                        setAvatarFile(null)
                        if (avatarPreview && avatarPreview.startsWith('blob:')) {
                          URL.revokeObjectURL(avatarPreview)
                        }
                        setAvatarPreview('')
                        setProfile(prev => ({ ...prev, avatarUrl: '' }))
                      }}
                    >
                      Remove
                    </button>
                  )}
                </div>
                <small>JPG, PNG, or WEBP up to 5 MB</small>
              </div>
              <label className="auth-field">Full name
                <input required type="text" value={profile.name} onChange={e=>setProfile({...profile, name:e.target.value})} />
              </label>
              <label className="auth-field">Email address
                <input required type="email" value={profile.email} onChange={e=>setProfile({...profile, email:e.target.value})} />
              </label>
              <label className="auth-field">Phone number
                <input type="tel" placeholder="+91 98765 43210" value={profile.phone} onChange={e=>setProfile({...profile, phone:e.target.value})} />
              </label>
              <BirthdayPicker
                value={profile.birthday}
                onChange={(birthday) => setProfile({ ...profile, birthday })}
              />
              {profileSaved && (
                <div className="profile-saved-toast">✓ Changes saved successfully!</div>
              )}
              {profileMessage && <div className="err">{profileMessage}</div>}
              <button type="submit" className="btn primary-action" disabled={profileLoading || profileSaved}>
                {profileSaved ? '✓ Saved' : profileLoading ? 'Saving...' : 'Save changes'}
              </button>
            </form>
          </section>
        </div>
      )}

    </main>
  )
}
