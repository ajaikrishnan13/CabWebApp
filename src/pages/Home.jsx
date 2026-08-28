import React, { useEffect, useRef, useState } from 'react'
import { auth, database } from '../database'
import DateTimePicker from '../components/DateTimePicker'
import BirthdayPicker from '../components/BirthdayPicker'
import MapPickerModal from '../components/MapPickerModal'
import TripHistoryView from '../components/TripHistoryView'
import { calculateEstimatedFare, VEHICLE_RATES } from '../utils/fareCalculator'
import { getGoogleDirections, isGoogleMapsConfigured, searchGooglePlaces, geocodePlaceId, reverseGeocodeGoogle } from '../utils/googleMaps'
import logo from '../assets/logo.png'
import sedanImage from '../assets/sedan.png'
import suvImage from '../assets/suv.png'
import luxuryImage from '../assets/luxury.png'
import miniImage from '../assets/mini.png'

const carOptions = [
  {
    name: 'Sedan',
    detail: 'Prime Comfort',
    badge: '⭐ Most Popular',
    badgeCls: 'badge-popular',
    seats: '4 seats',
    luggage: '2 bags',
    eta: '3 min',
    image: sedanImage
  },
  {
    name: 'Mini',
    detail: 'Pocket Friendly',
    badge: '🏷️ Best Value',
    badgeCls: 'badge-value',
    seats: '3 seats',
    luggage: '1 bag',
    eta: '2 min',
    image: miniImage
  },
  {
    name: 'SUV',
    detail: 'Extra Space',
    badge: '👨‍👩‍👧‍👦 6-Seater',
    badgeCls: 'badge-suv',
    seats: '6 seats',
    luggage: '4 bags',
    eta: '5 min',
    image: suvImage
  },
  {
    name: 'Luxury',
    detail: 'Executive Fleet',
    badge: '✨ Executive',
    badgeCls: 'badge-luxury',
    seats: '4 seats',
    luggage: '3 bags',
    eta: '6 min',
    image: luxuryImage
  }
]

export default function Home({ user, onSignOut }) {
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
  const [googleDirectionsResult, setGoogleDirectionsResult] = useState(null)
  const [estimatedFare, setEstimatedFare] = useState(null)
  const [routeLoading, setRouteLoading] = useState(false)
  const [datetime, setDatetime] = useState('')
  const [dateValue, setDateValue] = useState('')
  const [timeValue, setTimeValue] = useState('')
  const [carType, setCarType] = useState('Sedan')
  const [serviceType, setServiceType] = useState('Point-to-Point')
  const [loading, setLoading] = useState(false)
  const [bookingSuccess, setBookingSuccess] = useState(false)
  const [bookingError, setBookingError] = useState(null)
  const [fromSuggestions, setFromSuggestions] = useState([])
  const [toSuggestions, setToSuggestions] = useState([])
  const [bookings, setBookings] = useState([])
  const [tripFilter, setTripFilter] = useState('all') // 'all' | 'completed' | 'active'
  const [selectedReceipt, setSelectedReceipt] = useState(null)
  const [fieldInlineError, setFieldInlineError] = useState(null)
  const [historyCollapsed, setHistoryCollapsed] = useState(false)
  const [activeView, setActiveView] = useState('home') // 'home' | 'history'

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

  // Prevent background scrolling when any modal is open
  const isAnyModalOpen = profileOpen || mapPickerOpen || Boolean(selectedReceipt)
  useEffect(() => {
    if (isAnyModalOpen) {
      document.body.classList.add('modal-open')
      const originalOverflow = document.body.style.overflow
      document.body.style.overflow = 'hidden'
      return () => {
        document.body.classList.remove('modal-open')
        document.body.style.overflow = originalOverflow
      }
    }
  }, [isAnyModalOpen])

  // Time-of-day greeting
  const getTimeGreeting = () => {
    const h = new Date().getHours()
    if (h < 12) return { emoji: '🌅', text: 'Good morning' }
    if (h < 17) return { emoji: '☀️', text: 'Good afternoon' }
    return { emoji: '🌙', text: 'Good evening' }
  }
  const greeting = getTimeGreeting()

  // Past datetime check (allow up to 15 min buffer to prevent locking for present time)
  const isPastDatetime = datetime ? new Date(datetime).getTime() < (Date.now() - 15 * 60 * 1000) : false

  // Calculate route and journey details with Google Maps live traffic
  useEffect(() => {
    if (!fromCoords || !toCoords) {
      setRouteInfo(null)
      setGoogleDirectionsResult(null)
      setEstimatedFare(null)
      return
    }

    let isMounted = true

    const loadRoute = async () => {
      setRouteLoading(true)
      try {
        const googleResult = await getGoogleDirections(fromCoords, toCoords)
        if (!isMounted) return

        setGoogleDirectionsResult(googleResult.directionsResult)
        setRouteInfo({
          distance: googleResult.distance,
          distanceKm: googleResult.distanceKm,
          duration: googleResult.duration,
          durationMinutes: googleResult.durationMinutes,
          hasTrafficDelay: googleResult.hasTrafficDelay,
          trafficText: googleResult.trafficText,
          summary: googleResult.summary,
          isGoogleMaps: true
        })
      } catch (err) {
        if (isMounted) {
          console.error('Google Maps route calculation notice:', err)
          setRouteInfo({ error: 'Route estimate unavailable' })
        }
      } finally {
        if (isMounted) {
          setRouteLoading(false)
        }
      }
    }

    loadRoute()
    return () => {
      isMounted = false
    }
  }, [fromCoords, toCoords])

  // Recalculate estimated fare dynamically whenever distance, duration, car type, or service type updates
  useEffect(() => {
    if (routeInfo && routeInfo.distanceKm) {
      const fare = calculateEstimatedFare({
        distanceKm: routeInfo.distanceKm,
        durationMinutes: routeInfo.durationMinutes || 0,
        carType,
        serviceType
      })
      setEstimatedFare(fare)
    } else {
      setEstimatedFare(null)
    }
  }, [routeInfo, carType, serviceType])

  // Dynamic fare preview for each vehicle card
  const getCarFare = (cType) => {
    if (routeInfo && routeInfo.distanceKm) {
      const f = calculateEstimatedFare({
        distanceKm: routeInfo.distanceKm,
        durationMinutes: routeInfo.durationMinutes || 0,
        carType: cType,
        serviceType
      })
      return f.formatted
    }
    const minRate = VEHICLE_RATES[cType]?.minFare || 180
    return `From ₹${minRate}`
  }

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

  // Search locations using Google Places Autocomplete API with local location biasing
  const fetchSuggestions = async (q, biasCoords = null) => {
    if (!q || q.trim().length < 2) return []

    // 1. Try Google Places with local location bias first
    try {
      const googleResults = await searchGooglePlaces(q, biasCoords || fromCoords || toCoords)
      if (googleResults && googleResults.length > 0) {
        return googleResults
      }
    } catch (err) {
      console.warn('Google Places localized search notice:', err)
    }

    // 2. Fast Fallback to address search so dropdown is never stuck
    try {
      const locationBiasParam = (biasCoords || fromCoords) ? `&location=${(biasCoords || fromCoords)[1]},${(biasCoords || fromCoords)[0]}&distance=50000` : ''
      const url = `https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates?singleLine=${encodeURIComponent(q.trim())}&countryCode=IND&maxLocations=6&forStorage=false&f=json${locationBiasParam}`
      const res = await fetch(url)
      if (res.ok) {
        const data = await res.json()
        if (data.candidates && data.candidates.length > 0) {
          return data.candidates.map((item) => {
            const parts = item.address.split(',')
            return {
              display_name: item.address,
              main_text: parts[0]?.trim() || item.address,
              secondary_text: parts.slice(1).join(', ')?.trim() || '',
              lat: item.location.y,
              lon: item.location.x
            }
          })
        }
      }
    } catch (e) {
      console.warn('Address search fallback notice:', e)
    }

    return []
  }

  const handleFromInput = (val) => {
    setFrom(val)
    if (fieldInlineError?.field === 'from') setFieldInlineError(null)
    fromCoordsRef.current = null
    setFromCoords(null)
    setFromError(null)
    setFromSuggestions([])
    setFromLoading(true)
    clearTimeout(debounceFromRef.current)
    debounceFromRef.current = setTimeout(async () => {
      try {
        const items = await fetchSuggestions(val, null)
        setFromSuggestions(items)
      } catch (err) {
        console.error('from suggestion error', err)
        setFromError(err.message || 'Failed to fetch suggestions')
      } finally {
        setFromLoading(false)
      }
    }, 250)
  }

  const handleToInput = (val) => {
    setTo(val)
    if (fieldInlineError?.field === 'to') setFieldInlineError(null)
    toCoordsRef.current = null
    setToCoords(null)
    setToError(null)
    setToSuggestions([])
    setToLoading(true)
    clearTimeout(debounceToRef.current)
    debounceToRef.current = setTimeout(async () => {
      try {
        const items = await fetchSuggestions(val, fromCoords)
        setToSuggestions(items)
      } catch (err) {
        console.error('to suggestion error', err)
        setToError(err.message || 'Failed to fetch suggestions')
      } finally {
        setToLoading(false)
      }
    }, 250)
  }

  const selectFromSuggestion = async (s) => {
    setFrom(s.display_name)
    setFromSuggestions([])
    if (fieldInlineError?.field === 'from') setFieldInlineError(null)

    if (s.lat && s.lon) {
      const coordinates = [s.lat, s.lon]
      fromCoordsRef.current = coordinates
      setFromCoords(coordinates)
      return
    }

    const coords = await geocodePlaceId(s.place_id, s.display_name)
    if (coords) {
      fromCoordsRef.current = coords
      setFromCoords(coords)
    }
  }

  const selectToSuggestion = async (s) => {
    setTo(s.display_name)
    setToSuggestions([])
    if (fieldInlineError?.field === 'to') setFieldInlineError(null)

    if (s.lat && s.lon) {
      const coordinates = [s.lat, s.lon]
      toCoordsRef.current = coordinates
      setToCoords(coordinates)
      return
    }

    const coords = await geocodePlaceId(s.place_id, s.display_name)
    if (coords) {
      toCoordsRef.current = coords
      setToCoords(coords)
    }
  }

  const openMapPicker = (type) => {
    setMapPickerType(type)
    setMapPickerOpen(true)
  }

  const handleMapPickerConfirm = async (address, coords) => {
    let readableAddress = address
    const isCoordsPattern = /^-?\d+\.\d+,\s*-?\d+\.\d+$/.test(address.trim())
    if (isCoordsPattern && coords) {
      try {
        const resolved = await reverseGeocodeGoogle(coords)
        if (resolved && !/^-?\d+\.\d+,\s*-?\d+\.\d+$/.test(resolved.trim())) {
          readableAddress = resolved
        }
      } catch {}
    }

    if (mapPickerType === 'pickup') {
      setFrom(readableAddress)
      fromCoordsRef.current = coords
      setFromCoords(coords)
      setFromSuggestions([])
      setFromError(null)
    } else {
      setTo(readableAddress)
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
          const addr = await reverseGeocodeGoogle(coords)
          setFrom(addr || `${coords[0].toFixed(4)}, ${coords[1].toFixed(4)}`)
        } catch {
          setFrom(`${coords[0].toFixed(4)}, ${coords[1].toFixed(4)}`)
        } finally {
          setGpsLoading(false)
          setFromLoading(false)
        }
      },
      (err) => {
        console.warn('Geolocation failed', err)
        alert('Could not retrieve your location. Please check browser permissions.')
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

  const handleSignOut = async (e) => {
    e?.preventDefault?.()
    if (onSignOut) {
      await onSignOut()
    } else {
      await auth.signOut()
    }
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

    // 1. Validate Pickup Location
    if (!from || !from.trim()) {
      setFieldInlineError({ field: 'from', message: 'Please enter or pick your pickup location to proceed.' })
      const pickupEl = document.getElementById('pickup-location-input')
      if (pickupEl) {
        pickupEl.focus({ preventScroll: true })
        pickupEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
        pickupEl.classList.add('field-highlight-error')
        setTimeout(() => pickupEl.classList.remove('field-highlight-error'), 2000)
      }
      return
    }

    // 2. Validate Drop-off Destination
    if (!to || !to.trim()) {
      setFieldInlineError({ field: 'to', message: 'Please enter or pick your drop-off destination to proceed.' })
      const toEl = document.getElementById('destination-location-input')
      if (toEl) {
        toEl.focus({ preventScroll: true })
        toEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
        toEl.classList.add('field-highlight-error')
        setTimeout(() => toEl.classList.remove('field-highlight-error'), 2000)
      }
      return
    }

    // 3. Validate Ride Schedule Date & Time
    if (!datetime) {
      setFieldInlineError({ field: 'datetime', message: 'Please choose your pickup date and time schedule.' })
      const schedEl = document.querySelector('.datetime-scheduler')
      if (schedEl) {
        schedEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
        schedEl.classList.add('field-highlight-error')
        setTimeout(() => schedEl.classList.remove('field-highlight-error'), 2000)
      }
      return
    }

    const minLeadMs = 4 * 60 * 60 * 1000 - 60000 // 4 hours with grace buffer
    const bookingTimeMs = new Date(datetime.replace(' ', 'T')).getTime()
    if (bookingTimeMs < Date.now() + minLeadMs) {
      setFieldInlineError({ field: 'datetime', message: 'Scheduled rides must be scheduled at least 4 hours in advance.' })
      const schedEl = document.querySelector('.datetime-scheduler')
      if (schedEl) {
        schedEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
        schedEl.classList.add('field-highlight-error')
        setTimeout(() => schedEl.classList.remove('field-highlight-error'), 2000)
      }
      return
    }
    setLoading(true)
    try {
      const newBooking = await database.addBooking({
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
        estimatedFare: estimatedFare?.formatted || null,
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
      // refresh bookings list
      const updatedList = await database.listBookings(user.id)
      setBookings(updatedList && updatedList.length > 0 ? updatedList : [newBooking])
      setTimeout(() => setBookingSuccess(false), 5000)
    } catch (err) {
      console.error(err)
      setBookingError('Failed to request booking: ' + (err.message || 'Unknown error'))
    } finally {
      setLoading(false)
    }
  }

  const updateDateTime = (date, time) => {
    setDateValue(date)
    setTimeValue(time)
    setDatetime(date && time ? `${date}T${time}` : '')
    if (fieldInlineError?.field === 'datetime') setFieldInlineError(null)
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

            {/* Quick Trips Navigation Pill */}
            <button
              type="button"
              className={`header-nav-btn ${activeView === 'history' ? 'active' : ''}`}
              onClick={() => {
                setActiveView(prev => prev === 'home' ? 'history' : 'home')
                window.scrollTo({ top: 0, behavior: 'smooth' })
              }}
              title={activeView === 'history' ? 'Back to booking' : 'View all trips and receipts'}
            >
              <span className="header-nav-icon">{activeView === 'history' ? '🚗' : '🧾'}</span>
              <span className="header-nav-label">{activeView === 'history' ? 'Book Ride' : 'My Trips'}</span>
              {bookings.length > 0 && activeView === 'home' && (
                <span className="header-nav-badge">{bookings.length}</span>
              )}
            </button>

            {/* Sign out */}
            <button
              type="button"
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

      {activeView === 'history' ? (
        <TripHistoryView
          bookings={bookings}
          onBack={() => {
            setActiveView('home')
            window.scrollTo({ top: 0, behavior: 'smooth' })
          }}
          onSelectReceipt={b => setSelectedReceipt(b)}
          onBookRide={() => {
            setActiveView('home')
            window.scrollTo({ top: 0, behavior: 'smooth' })
          }}
        />
      ) : (
        <>
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
            {fieldInlineError?.field === 'datetime' && (
              <div className="field-inline-alert scheduler-alert full-width" role="alert">
                <span>⚠️</span> {fieldInlineError.message}
              </div>
            )}

            {/* Redesigned Location Inputs with Map & GPS Quick Actions */}
            <div className="location-inputs-container full-width">
              {/* Pickup Location Field */}
              <div className="location-input-group">
                <div className="field location-field">
                  <div className="location-label-row">
                    <span className="location-label-text">
                      <span className="location-indicator pickup-indicator" /> Pickup Location
                    </span>
                    <div className="location-action-pills">
                      <button
                        type="button"
                        className="loc-action-pill"
                        onClick={(e) => {
                          e.stopPropagation()
                          handleUseCurrentLocation()
                        }}
                        disabled={gpsLoading}
                        title="Use current location"
                      >
                        {gpsLoading ? '📡 Locating...' : '📍 Current Location'}
                      </button>
                      <button
                        type="button"
                        className="loc-action-pill highlight"
                        onClick={(e) => {
                          e.stopPropagation()
                          openMapPicker('pickup')
                        }}
                        title="Pick location on map"
                      >
                        📍 Select on Map
                      </button>
                    </div>
                  </div>

                  <div className="input-wrap">
                    <span className="location-dot pickup-dot" aria-hidden="true" />
                    <input
                      id="pickup-location-input"
                      type="text"
                      placeholder="Search pickup address, locality or landmark"
                      value={from}
                      onChange={e => handleFromInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          e.stopPropagation()
                          if (fromSuggestions && fromSuggestions.length > 0) {
                            selectFromSuggestion(fromSuggestions[0])
                          }
                        }
                      }}
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

                  {fieldInlineError?.field === 'from' && (
                    <div className="field-inline-alert" role="alert">
                      <span>⚠️</span> {fieldInlineError.message}
                    </div>
                  )}

                  {(fromSuggestions.length > 0 || fromLoading || fromError) && (
                    <ul className="suggestions location-suggestions-list">
                      {fromLoading && <li className="sug-status-msg">🔍 Searching local places...</li>}
                      {fromError && <li className="sug-status-msg err">⚠️ {fromError}</li>}
                      {!fromLoading && !fromError && fromSuggestions.length === 0 && <li className="sug-status-msg">No local places found</li>}
                      {fromSuggestions.map((s, i) => (
                        <li
                          key={i}
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            selectFromSuggestion(s)
                          }}
                          className="sug-item"
                        >
                          <div className="sug-icon-badge">📍</div>
                          <div className="sug-text-container">
                            <strong className="sug-main-text">{s.main_text || s.display_name.split(',')[0]}</strong>
                            {(s.secondary_text || s.display_name.split(',').length > 1) && (
                              <span className="sug-sub-text">
                                {s.secondary_text || s.display_name.split(',').slice(1).join(', ').trim()}
                              </span>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
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
                <div className="field location-field">
                  <div className="location-label-row">
                    <span className="location-label-text">
                      <span className="location-indicator dropoff-indicator" /> Drop-off Destination
                    </span>
                    <div className="location-action-pills">
                      <button
                        type="button"
                        className="loc-action-pill highlight"
                        onClick={(e) => {
                          e.stopPropagation()
                          openMapPicker('destination')
                        }}
                        title="Pick destination on map"
                      >
                        📍 Select on Map
                      </button>
                    </div>
                  </div>

                  <div className="input-wrap">
                    <span className="location-dot dropoff-dot" aria-hidden="true" />
                    <input
                      id="destination-location-input"
                      type="text"
                      placeholder="Search destination, locality or landmark"
                      value={to}
                      onChange={e => handleToInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          e.stopPropagation()
                          if (toSuggestions && toSuggestions.length > 0) {
                            selectToSuggestion(toSuggestions[0])
                          }
                        }
                      }}
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

                  {fieldInlineError?.field === 'to' && (
                    <div className="field-inline-alert" role="alert">
                      <span>⚠️</span> {fieldInlineError.message}
                    </div>
                  )}

                  {(toSuggestions.length > 0 || toLoading || toError) && (
                    <ul className="suggestions location-suggestions-list">
                      {toLoading && <li className="sug-status-msg">🔍 Searching local places...</li>}
                      {toError && <li className="sug-status-msg err">⚠️ {toError}</li>}
                      {!toLoading && !toError && toSuggestions.length === 0 && <li className="sug-status-msg">No local places found</li>}
                      {toSuggestions.map((s, i) => (
                        <li
                          key={i}
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            selectToSuggestion(s)
                          }}
                          className="sug-item"
                        >
                          <div className="sug-icon-badge">🏁</div>
                          <div className="sug-text-container">
                            <strong className="sug-main-text">{s.main_text || s.display_name.split(',')[0]}</strong>
                            {(s.secondary_text || s.display_name.split(',').length > 1) && (
                              <span className="sug-sub-text">
                                {s.secondary_text || s.display_name.split(',').slice(1).join(', ').trim()}
                              </span>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>

            {/* Trendy Vehicle Category Selector */}
            <div className="trendy-car-section full-width">
              <div className="trendy-car-header">
                <div>
                  <span className="eyebrow">Vehicle Category</span>
                  <h3 className="trendy-car-title">Choose your car</h3>
                </div>
                <span className="car-active-pill">
                  {carType === 'Sedan' && '🚗 Sedan • Prime Comfort'}
                  {carType === 'Mini' && '⚡ Mini • Best Value'}
                  {carType === 'SUV' && '👨‍👩‍👧‍👦 SUV • Spacious 6-Seater'}
                  {carType === 'Luxury' && '✨ Luxury • Executive Fleet'}
                </span>
              </div>

              <div className="trendy-car-grid">
                {carOptions.map(car => {
                  const isSelected = carType === car.name
                  const fareDisplay = getCarFare(car.name)
                  return (
                    <label
                      key={car.name}
                      className={`trendy-car-card ${isSelected ? 'selected' : ''}`}
                    >
                      <input
                        type="radio"
                        name="carType"
                        value={car.name}
                        checked={isSelected}
                        onChange={e => setCarType(e.target.value)}
                      />

                      <div className="car-card-top-row">
                        <span className={`car-tag-badge ${car.badgeCls}`}>
                          {car.badge}
                        </span>
                        <div className="car-radio-check">
                          <span className="car-check-icon">✓</span>
                        </div>
                      </div>

                      <div className="car-image-showcase">
                        <div className="car-image-backdrop" />
                        <img
                          src={car.image}
                          alt={`${car.name} car`}
                          className="car-showcase-img"
                        />
                      </div>

                      <div className="car-card-details">
                        <div className="car-title-row">
                          <strong className="car-name">{car.name}</strong>
                          <span className="car-fare-preview">{fareDisplay}</span>
                        </div>
                        <p className="car-detail-text">{car.detail}</p>

                        <div className="car-spec-chips">
                          <span className="car-spec-chip">👥 {car.seats}</span>
                          <span className="car-spec-chip">🧳 {car.luggage}</span>
                          <span className="car-spec-chip eta-chip">⚡ {car.eta}</span>
                        </div>
                      </div>
                    </label>
                  )
                })}
              </div>
            </div>

            <fieldset className="service-field full-width">
              <div className="service-field-header">
                <legend className="service-legend">Choose Ride Type</legend>
                <span className="service-active-pill">
                  {serviceType === 'Point-to-Point' ? '⚡ Direct Route' : '⏳ Flexible Hours'}
                </span>
              </div>

              <div className="trendy-service-grid">
                {/* 1. Point-to-Point Card */}
                <label className={`trendy-service-card ${serviceType === 'Point-to-Point' ? 'active' : ''}`}>
                  <input
                    type="radio"
                    name="service"
                    value="Point-to-Point"
                    checked={serviceType === 'Point-to-Point'}
                    onChange={() => setServiceType('Point-to-Point')}
                  />
                  <div className="service-card-top">
                    <div className="service-icon-glow point-glow">
                      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10" />
                        <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
                      </svg>
                    </div>
                    <span className="service-badge-pill popular">Popular</span>
                    <div className="service-select-indicator">
                      <span className="indicator-dot" />
                    </div>
                  </div>

                  <div className="service-card-content">
                    <strong className="service-title">Point-to-Point</strong>
                    <span className="service-tagline">Direct A-to-B Transfer</span>
                    <div className="service-perks-row">
                      <span className="service-mini-perk">🛣️ Distance based</span>
                      <span className="service-mini-perk">⚡ Fast pickup</span>
                    </div>
                  </div>
                </label>

                {/* 2. Rental Card */}
                <label className={`trendy-service-card ${serviceType === 'Rental' ? 'active' : ''}`}>
                  <input
                    type="radio"
                    name="service"
                    value="Rental"
                    checked={serviceType === 'Rental'}
                    onChange={() => setServiceType('Rental')}
                  />
                  <div className="service-card-top">
                    <div className="service-icon-glow rental-glow">
                      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
                        <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
                      </svg>
                    </div>
                    <span className="service-badge-pill flexible">Flexible</span>
                    <div className="service-select-indicator">
                      <span className="indicator-dot" />
                    </div>
                  </div>

                  <div className="service-card-content">
                    <strong className="service-title">Rental Package</strong>
                    <span className="service-tagline">Hourly & Multi-stop</span>
                    <div className="service-perks-row">
                      <span className="service-mini-perk">⏱️ Multiple stops</span>
                      <span className="service-mini-perk">🚗 Keep the car</span>
                    </div>
                  </div>
                </label>
              </div>
            </fieldset>

            {/* Preview Journey Card (Placed after Car & Service selection) */}
            {/* Redesigned Compact & Trendy Journey Preview Capsule */}
            {(fromCoords && toCoords) ? (
              <div className="trendy-preview-capsule full-width" role="region" aria-label="Journey Preview">
                {/* Route Header Row */}
                <div className="preview-capsule-route">
                  <div className="preview-stop start">
                    <span className="preview-stop-icon">📍</span>
                    <span className="preview-stop-name" title={from}>{from.split(',')[0]}</span>
                  </div>

                  <div className="preview-track-line">
                    <div className="track-bar" />
                    <span className="track-car-icon" aria-hidden="true">🚗</span>
                  </div>

                  <div className="preview-stop end">
                    <span className="preview-stop-icon">🏁</span>
                    <span className="preview-stop-name" title={to}>{to.split(',')[0]}</span>
                  </div>

                  {routeInfo?.hasTrafficDelay ? (
                    <span className="preview-pill-tag traffic" title={routeInfo.trafficText}>
                      🚦 Slow Traffic
                    </span>
                  ) : (
                    <span className="preview-pill-tag live">
                      ⚡ Live Route
                    </span>
                  )}
                </div>

                {/* Compact Horizontal 3-Column Metrics Bar */}
                <div className="preview-capsule-metrics">
                  <div className="capsule-metric-item">
                    <span className="metric-mini-label">🛣️ Distance</span>
                    <span className="metric-mini-value">
                      {routeLoading ? '...' : (routeInfo?.distance || '—')}
                    </span>
                  </div>

                  <div className="capsule-metric-divider" />

                  <div className="capsule-metric-item">
                    <span className="metric-mini-label">⏱️ Duration</span>
                    <span className={`metric-mini-value ${routeInfo?.hasTrafficDelay ? 'traffic-text' : ''}`}>
                      {routeLoading ? '...' : (routeInfo?.duration || '—')}
                    </span>
                  </div>

                  <div className="capsule-metric-divider" />

                  <div className="capsule-metric-item fare-hero">
                    <div className="fare-badge-label">
                      <span>Best Rate</span>
                    </div>
                    <span className="metric-mini-value fare-value">
                      {routeLoading || !estimatedFare ? '...' : estimatedFare.formatted}
                    </span>
                  </div>
                </div>

                {/* Subtle Micro-Footnote */}
                {estimatedFare?.breakdown && (
                  <div className="preview-capsule-footnote">
                    <span>{carType}</span> • <span>{serviceType}</span> • <span>{estimatedFare.breakdown}</span>
                  </div>
                )}
              </div>
            ) : (
              (from || to) && (
                <div className="journey-helper-prompt full-width">
                  <span className="helper-icon">💡</span>
                  <span>
                    {!from ? 'Please select a pickup location.' : 'Select a drop-off destination to preview your journey details and live fare.'}
                  </span>
                </div>
              )
            )}
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

      {/* Upcoming Scheduled Rides Section */}
      {bookings.filter(b => b.status !== 'completed' && b.status !== 'cancelled').length > 0 && (
        <section className="card bookings-card upcoming-rides-card" aria-label="Upcoming Scheduled Rides">
          <div className="bookings-card-header">
            <div>
              <span className="eyebrow upcoming-eyebrow">Scheduled Journeys</span>
              <h3>Upcoming Rides</h3>
            </div>
            <span className="bookings-count-badge upcoming-badge">
              🗓️ {bookings.filter(b => b.status !== 'completed' && b.status !== 'cancelled').length} Scheduled
            </span>
          </div>

          <ul className="booking-list">
            {bookings.filter(b => b.status !== 'completed' && b.status !== 'cancelled').map(b => {
              const statusMap = {
                requested: { label: 'Requested', cls: 'status-requested' },
                confirmed: { label: 'Confirmed', cls: 'status-confirmed' },
                ongoing: { label: 'Ongoing', cls: 'status-ongoing' }
              }
              const st = statusMap[b.status] || statusMap.requested
              const dt = b.datetime ? new Date(b.datetime) : (b.createdAt ? new Date(b.createdAt) : null)
              const dtStr = dt && !isNaN(dt.getTime())
                ? dt.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
                : (b.datetime || 'Scheduled')
              const fromName = (b.from || b.from_location || 'Pickup location')
              const toName = (b.to || b.to_location || 'Drop location')
              const carName = b.carType || b.car_type || 'Sedan'
              const serviceName = b.serviceType || b.service_type || 'Point-to-Point'

              return (
                <li key={`upcoming-${b.id || Math.random()}`} className="booking-item trip-history-card upcoming-trip-card">
                  <div className="booking-item-top">
                    <div className="booking-route">
                      <span className="booking-from">📍 {fromName.split(',')[0]}</span>
                      <span className="booking-arrow">→</span>
                      <span className="booking-to">🏁 {toName.split(',')[0]}</span>
                    </div>
                    <span className={`booking-status-badge ${st.cls}`}>{st.label}</span>
                  </div>

                  <div className="booking-item-meta">
                    <span className="booking-meta-pill">🚘 {carName}</span>
                    <span className="booking-meta-pill">⚙️ {serviceName}</span>
                    {b.estimatedFare && (
                      <span className="booking-meta-pill booking-fare-pill">💰 {b.estimatedFare}</span>
                    )}
                    <span className="booking-meta-pill highlight-time">🗓️ {dtStr}</span>
                    {b.driver && (
                      <span className="booking-meta-pill driver-assigned-pill">
                        👨‍✈️ Driver: {b.driver.name}
                      </span>
                    )}
                  </div>

                  <div className="trip-card-footer-actions">
                    <button
                      type="button"
                      className="btn-view-receipt"
                      onClick={() => setSelectedReceipt(b)}
                    >
                      🧾 View Details & Invoice
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {/* Rider Recent Activity & History Portal Card */}
      <section className="card bookings-card history-glance-card">
        <div className="history-glance-header">
          <div>
            <span className="eyebrow">Activity & Receipts</span>
            <h3>Trip History & Invoices</h3>
          </div>
          {bookings.length > 0 && (
            <span className="bookings-count-badge">{bookings.length} Total</span>
          )}
        </div>

        {bookings.length > 0 ? (
          <div className="history-glance-body">
            {/* Most Recent Ride Snapshot */}
            <div className="recent-trip-glance">
              <div className="recent-glance-top">
                <span className="recent-glance-tag">Latest Journey</span>
                <span className={`booking-status-badge status-${bookings[0].status || 'requested'}`}>
                  {bookings[0].status === 'completed' ? '✓ Completed' : (bookings[0].status || 'Requested')}
                </span>
              </div>
              <div className="recent-glance-route">
                <span className="glance-from">📍 {(bookings[0].from || bookings[0].from_location || 'Pickup').split(',')[0]}</span>
                <span className="glance-arrow">→</span>
                <span className="glance-to">🏁 {(bookings[0].to || bookings[0].to_location || 'Drop').split(',')[0]}</span>
              </div>
              <div className="recent-glance-meta">
                <span className="meta-pill">🚘 {bookings[0].carType || bookings[0].car_type || 'Sedan'}</span>
                {bookings[0].estimatedFare && (
                  <span className="meta-pill glance-fare-pill">💰 {bookings[0].estimatedFare}</span>
                )}
                {bookings[0].datetime && (
                  <span className="meta-pill">🗓️ {new Date(bookings[0].datetime).toLocaleDateString('en-IN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                )}
              </div>
            </div>

            {/* Open Dedicated History Hub Button */}
            <button
              type="button"
              className="btn-view-all-trips"
              onClick={() => {
                setActiveView('history')
                window.scrollTo({ top: 0, behavior: 'smooth' })
              }}
            >
              <span>Open Full Trip History & Receipts ({bookings.length})</span>
              <span className="glance-btn-arrow">→</span>
            </button>
          </div>
        ) : (
          <div className="empty-glance-state">
            <p>Your completed journeys and invoices will be safely archived here.</p>
          </div>
        )}
      </section>
    </>
  )}

      {/* Map Location Picker Dialog Modal */}
      <MapPickerModal
        isOpen={mapPickerOpen}
        type={mapPickerType}
        title={mapPickerType === 'pickup' ? 'Choose Pickup on Map' : 'Choose Destination on Map'}
        initialCoords={mapPickerType === 'pickup' ? fromCoords : toCoords}
        initialAddress={mapPickerType === 'pickup' ? from : to}
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
              <label className="auth-field">
                <span>Full name</span>
                <div className="field-input-wrap">
                  <input required type="text" value={profile.name} onChange={e=>setProfile({...profile, name:e.target.value})} />
                  <div
                    className={`input-status-capsule ${profile.name.trim() ? 'valid' : 'required'}`}
                    title={profile.name.trim() ? 'Completed' : 'Required'}
                  >
                    {profile.name.trim() ? '✓' : ''}
                  </div>
                </div>
              </label>
              <label className="auth-field">
                <span>Email address</span>
                <input required type="email" value={profile.email} onChange={e=>setProfile({...profile, email:e.target.value})} />
              </label>
              <label className="auth-field">
                <span>Phone number</span>
                <div className="field-input-wrap">
                  <input type="tel" placeholder="+91 98765 43210" value={profile.phone} onChange={e=>setProfile({...profile, phone:e.target.value})} />
                  <div
                    className={`input-status-capsule ${profile.phone.trim().length >= 10 ? 'valid' : 'required'}`}
                    title={profile.phone.trim().length >= 10 ? 'Completed' : 'Required'}
                  >
                    {profile.phone.trim().length >= 10 ? '✓' : ''}
                  </div>
                </div>
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

      {/* Rider Trip Receipt & Invoice Modal */}
      {selectedReceipt && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={e => e.target === e.currentTarget && setSelectedReceipt(null)}
        >
          <section className="profile-modal receipt-modal" role="dialog" aria-modal="true">
            <div className="modal-heading">
              <div>
                <span className="eyebrow">Trip Invoice & Summary</span>
                <h2>Ride #{selectedReceipt.id.slice(-6).toUpperCase()}</h2>
              </div>
              <button
                type="button"
                className="modal-close"
                onClick={() => setSelectedReceipt(null)}
                aria-label="Close invoice"
              >
                ×
              </button>
            </div>

            <div className="receipt-content">
              <div className="receipt-status-banner">
                <span className={`booking-status-badge ${selectedReceipt.status === 'completed' ? 'status-completed' : 'status-confirmed'}`}>
                  {selectedReceipt.status === 'completed' ? '✓ Trip Completed' : selectedReceipt.status}
                </span>
                <span className="receipt-datetime">
                  🗓️ {selectedReceipt.datetime}
                </span>
              </div>

              <div className="receipt-route-box">
                <div className="receipt-stop">
                  <span className="receipt-marker start">📍</span>
                  <div>
                    <small>PICKUP ADDRESS</small>
                    <p>{selectedReceipt.from}</p>
                  </div>
                </div>
                <div className="receipt-stop">
                  <span className="receipt-marker end">🏁</span>
                  <div>
                    <small>DESTINATION</small>
                    <p>{selectedReceipt.to}</p>
                  </div>
                </div>
              </div>

              {selectedReceipt.driver && (
                <div className="receipt-driver-card">
                  <div className="driver-avatar-mini">🚗</div>
                  <div className="driver-receipt-info">
                    <strong>{selectedReceipt.driver.name}</strong>
                    <span>{selectedReceipt.driver.vehicleModel} • {selectedReceipt.driver.vehicleNumber}</span>
                  </div>
                  {selectedReceipt.driver.phone && (
                    <a href={`tel:${selectedReceipt.driver.phone}`} className="btn-driver-call">
                      📞 Call
                    </a>
                  )}
                </div>
              )}

              <div className="receipt-fare-breakdown">
                <h4>Fare Breakdown</h4>
                <div className="fare-row">
                  <span>Vehicle & Service</span>
                  <strong>{selectedReceipt.carType} • {selectedReceipt.serviceType}</strong>
                </div>
                <div className="fare-row">
                  <span>Base Fare</span>
                  <span>₹{Math.max(120, parseInt((selectedReceipt.estimatedFare || '400').replace(/[^\d]/g, ''), 10) - 70)}</span>
                </div>
                <div className="fare-row">
                  <span>Tolls & Fuel Allowance</span>
                  <span>₹70</span>
                </div>
                <div className="fare-row total">
                  <strong>Total Paid</strong>
                  <strong className="receipt-total-amount">{selectedReceipt.estimatedFare || '₹400'}</strong>
                </div>
              </div>

              <button
                type="button"
                className="btn primary-action"
                onClick={() => {
                  alert('Receipt downloaded to your device.')
                  setSelectedReceipt(null)
                }}
              >
                📥 Download Invoice (PDF)
              </button>
            </div>
          </section>
        </div>
      )}

    </main>
  )
}
