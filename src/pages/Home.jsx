import React, { useEffect, useMemo, useRef, useState } from 'react'
import { auth, database } from '../database'
import DateTimePicker from '../components/DateTimePicker'
import BirthdayPicker from '../components/BirthdayPicker'
import MapPickerModal from '../components/MapPickerModal'
import TripHistoryView from '../components/TripHistoryView'
import RoutePreviewMap from '../components/RoutePreviewMap'
import { calculateEstimatedFare, VEHICLE_RATES } from '../utils/fareCalculator'
import { getGoogleDirections, isGoogleMapsConfigured, searchGooglePlaces, geocodePlaceId, reverseGeocodeGoogle } from '../utils/googleMaps'
import logo from '../assets/logo.png'
import logoWhite from '../assets/logo-white.png'
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
  const [serviceType, setServiceType] = useState('Scheduled')
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
  const [stepMode, setStepMode] = useState('search') // 'search' | 'ride_options'
  const [showScheduler, setShowScheduler] = useState(false)

  const hasRoute = Boolean(fromCoords && toCoords && routeInfo && !routeInfo.error)
  const upcomingBookings = bookings.filter(b => {
    if (!b.datetime) return false
    const tripDate = new Date(b.datetime.replace(' ', 'T'))
    return tripDate > new Date() && b.status !== 'cancelled' && b.status !== 'completed'
  })

  const fromCoordsRef = useRef(null)
  const toCoordsRef = useRef(null)

  // Intelligent Pickup Location Detection (Saved preference -> Live GPS auto-detect)
  useEffect(() => {
    let isMounted = true

    // 1. Check if user has a previously chosen pickup saved in localStorage
    try {
      const savedPickup = localStorage.getItem('nd_last_pickup_addr')
      const savedCoordsStr = localStorage.getItem('nd_last_pickup_coords')
      if (savedPickup && savedCoordsStr) {
        const parsedCoords = JSON.parse(savedCoordsStr)
        if (Array.isArray(parsedCoords) && parsedCoords.length === 2) {
          setFrom(savedPickup)
          setFromCoords(parsedCoords)
          fromCoordsRef.current = parsedCoords
        }
      }
    } catch {}

    // 2. Automatically request live device GPS to locate user accurately
    if (navigator.geolocation) {
      setFromLoading(true)
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          if (!isMounted) return
          const coords = [pos.coords.latitude, pos.coords.longitude]
          fromCoordsRef.current = coords
          setFromCoords(coords)
          try {
            const addr = await reverseGeocodeGoogle(coords)
            if (addr && isMounted) {
              setFrom(addr)
              try {
                localStorage.setItem('nd_last_pickup_addr', addr)
                localStorage.setItem('nd_last_pickup_coords', JSON.stringify(coords))
              } catch {}
            }
          } catch {
            if (isMounted) setFrom('Current Location')
          } finally {
            if (isMounted) setFromLoading(false)
          }
        },
        (err) => {
          console.log('Auto-GPS check notice:', err.message)
          if (isMounted) setFromLoading(false)
        },
        { enableHighAccuracy: true, timeout: 7000, maximumAge: 60000 }
      )
    }

    return () => {
      isMounted = false
    }
  }, [])
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

  // App Settings & Dark Mode State
  const [darkMode, setDarkMode] = useState(() => {
    try {
      const saved = localStorage.getItem('nd_theme')
      return saved ? saved === 'dark' : false
    } catch {
      return false
    }
  })
  const [settingsOpen, setSettingsOpen] = useState(false)

  useEffect(() => {
    try {
      if (darkMode) {
        document.documentElement.setAttribute('data-theme', 'dark')
        localStorage.setItem('nd_theme', 'dark')
        document.documentElement.style.backgroundColor = '#0b1120'
        document.body.style.backgroundColor = '#0b1120'
        const meta = document.querySelector('meta[name="theme-color"]')
        if (meta) meta.content = '#0b1120'
      } else {
        document.documentElement.setAttribute('data-theme', 'light')
        localStorage.setItem('nd_theme', 'light')
        document.documentElement.style.backgroundColor = '#f7f9fc'
        document.body.style.backgroundColor = '#f7f9fc'
        const meta = document.querySelector('meta[name="theme-color"]')
        if (meta) meta.content = '#0b3977'
      }
    } catch {
      // ignore
    }
  }, [darkMode])

  const handleToggleDarkMode = () => {
    setDarkMode(prev => !prev)
  }

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

  // Prevent background scrolling when any modal is open, and guarantee clean release
  const isAnyModalOpen = profileOpen || mapPickerOpen || Boolean(selectedReceipt) || settingsOpen
  useEffect(() => {
    if (isAnyModalOpen) {
      document.body.classList.add('modal-open')
      document.body.style.overflow = 'hidden'
    } else {
      document.body.classList.remove('modal-open')
      document.body.style.overflow = ''
    }
    return () => {
      document.body.classList.remove('modal-open')
      document.body.style.overflow = ''
    }
  }, [isAnyModalOpen])

  // Always reset scroll state when Home unmounts
  useEffect(() => {
    return () => {
      document.body.classList.remove('modal-open')
      document.body.style.overflow = ''
    }
  }, [])

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
    const mainAddr = s.main_text ? `${s.main_text}, ${s.secondary_text}` : s.display_name
    setTo(mainAddr)
    setToSuggestions([])
    if (fieldInlineError?.field === 'to') setFieldInlineError(null)

    if (s.lat && s.lon) {
      const coordinates = [parseFloat(s.lat), parseFloat(s.lon)]
      toCoordsRef.current = coordinates
      setToCoords(coordinates)
      setStepMode('ride_options')
      return
    }

    const coords = await geocodePlaceId(s.place_id, s.display_name)
    if (coords) {
      toCoordsRef.current = coords
      setToCoords(coords)
      setStepMode('ride_options')
    }
  }

  const handleQuickSelect = (name, coords) => {
    setTo(name)
    toCoordsRef.current = coords
    setToCoords(coords)
    setToSuggestions([])
    if (fieldInlineError?.field === 'to') setFieldInlineError(null)
    setStepMode('ride_options')
  }

  const handleProceedToRide = async () => {
    if (!to || !to.trim()) {
      setFieldInlineError({ field: 'to', message: 'Please enter a destination to request a ride.' })
      document.getElementById('rapido-destination-input')?.focus()
      return
    }

    if (!fromCoords) {
      setFieldInlineError({ field: 'from', message: 'Detecting your pickup location... please wait or tap GPS.' })
      return
    }

    // If destination coordinates are already resolved, proceed straight to ride options
    if (toCoords) {
      setStepMode('ride_options')
      return
    }

    // Otherwise geocode the destination address entered
    setToLoading(true)
    try {
      if (toSuggestions.length > 0) {
        await selectToSuggestion(toSuggestions[0])
        return
      }
      const suggestions = await fetchSuggestions(to, fromCoords)
      if (suggestions && suggestions.length > 0) {
        await selectToSuggestion(suggestions[0])
      } else {
        const coords = await geocodeAddress(to)
        if (coords) {
          toCoordsRef.current = coords
          setToCoords(coords)
          setStepMode('ride_options')
        } else {
          setFieldInlineError({ field: 'to', message: 'Could not find that location. Please pick on map.' })
        }
      }
    } catch (err) {
      console.warn('Geocoding error', err)
      setFieldInlineError({ field: 'to', message: 'Could not find that location. Please pick on map.' })
    } finally {
      setToLoading(false)
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
      try {
        localStorage.setItem('nd_last_pickup_addr', readableAddress)
        localStorage.setItem('nd_last_pickup_coords', JSON.stringify(coords))
      } catch {}
    } else {
      setTo(readableAddress)
      toCoordsRef.current = coords
      setToCoords(coords)
      setToSuggestions([])
      setToError(null)
      setStepMode('ride_options')
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
          const finalAddr = addr || `${coords[0].toFixed(4)}, ${coords[1].toFixed(4)}`
          setFrom(finalAddr)
          try {
            localStorage.setItem('nd_last_pickup_addr', finalAddr)
            localStorage.setItem('nd_last_pickup_coords', JSON.stringify(coords))
          } catch {}
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
    if (e) e.preventDefault()
    setBookingError(null)

    // 1. Validate Pickup Location
    if (!from || !from.trim()) {
      setFieldInlineError({ field: 'from', message: 'Please enter or pick your pickup location.' })
      setStepMode('search')
      return
    }

    // 2. Validate Drop-off Destination
    if (!to || !to.trim()) {
      setFieldInlineError({ field: 'to', message: 'Please enter your destination.' })
      setStepMode('search')
      return
    }

    // 3. Date & time: If user explicitly entered datetime (e.g. Scheduled), check lead time
    let rideDatetime = datetime
    if (rideDatetime) {
      const minLeadMs = 4 * 60 * 60 * 1000 - 60000 // 4 hours buffer
      const bookingTimeMs = new Date(rideDatetime.replace(' ', 'T')).getTime()
      if (bookingTimeMs < Date.now() + minLeadMs && serviceType === 'Scheduled') {
        setFieldInlineError({ field: 'datetime', message: 'Scheduled rides must be booked at least 4 hours in advance.' })
        setShowScheduler(true)
        return
      }
    } else {
      // Instant ride defaults to current time
      const now = new Date()
      const pad = n => String(n).padStart(2, '0')
      rideDatetime = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`
    }

    setLoading(true)
    try {
      const newBooking = await database.addBooking({
        uid: user.id,
        name: user.user_metadata?.name || null,
        email: user.email,
        datetime: rideDatetime,
        from,
        to,
        fromCoords: fromCoords || null,
        toCoords: toCoords || null,
        carType,
        serviceType,
        estimatedFare: estimatedFare?.formatted || getCarFare(carType),
        status: 'requested'
      })
      setBookingSuccess(true)
      setBookings(prev => [newBooking, ...prev])
      // Reset destination for next ride
      setTo('')
      setToCoords(null)
      toCoordsRef.current = null
      setRouteInfo(null)
      setGoogleDirectionsResult(null)
      setStepMode('search')
      setShowScheduler(false)
      setDatetime('')
      setDateValue('')
      setTimeValue('')
    } catch (err) {
      console.error('Booking creation failed', err)
      setBookingError(err.message || 'Failed to submit ride request. Please try again.')
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
    <main className={`app-shell ${activeView === 'home' ? 'native-map-mode' : ''}`}>
      {/* Sticky Floating Header */}
      <header className={`site-header${headerScrolled ? ' scrolled' : ''}`} role="banner">
        <div className="site-header-inner">
          {/* Brand */}
          <div className="header-brand">
            <img src={darkMode ? logoWhite : logo} alt="Namma Driver logo" className="header-logo" />
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

            {/* App Settings Overlay Trigger */}
            <button
              type="button"
              className={`header-settings-btn ${settingsOpen ? 'active' : ''}`}
              onClick={() => setSettingsOpen(prev => !prev)}
              aria-label="Settings"
              title="Settings & Dark Mode"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="3"></circle>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
              </svg>
              <span className="settings-label">Settings</span>
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

      {/* Settings Overlay Dropdown Modal */}
      {settingsOpen && (
        <div className="settings-overlay-backdrop" onClick={() => setSettingsOpen(false)}>
          <div className="settings-overlay-card" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="settings-overlay-header">
              <div className="settings-header-title">
                <span className="settings-header-icon">⚙️</span>
                <h3>Settings & Preferences</h3>
              </div>
              <button
                type="button"
                className="settings-close-btn"
                onClick={() => setSettingsOpen(false)}
                aria-label="Close settings"
              >
                ✕
              </button>
            </div>

            <div className="settings-overlay-content">
              {/* Dark Mode Provision Toggle */}
              <div className="settings-option-item">
                <div className="settings-option-info">
                  <div className="settings-option-label">
                    <span className="option-emoji">{darkMode ? '🌙' : '☀️'}</span>
                    <strong>Dark Mode</strong>
                    <span className={`theme-badge ${darkMode ? 'dark' : 'light'}`}>
                      {darkMode ? 'ON' : 'OFF'}
                    </span>
                  </div>
                  <p className="settings-option-desc">
                    {darkMode ? 'Night theme enabled for low-light travel' : 'Crisp day theme for daytime booking'}
                  </p>
                </div>
                <label className="toggle-switch" aria-label="Toggle dark mode">
                  <input
                    type="checkbox"
                    checked={darkMode}
                    onChange={handleToggleDarkMode}
                  />
                  <span className="toggle-slider" />
                </label>
              </div>

              {/* Live Traffic Flow Layer Status */}
              <div className="settings-option-item">
                <div className="settings-option-info">
                  <div className="settings-option-label">
                    <span className="option-emoji">🚦</span>
                    <strong>Live Traffic Flow</strong>
                    <span className="theme-badge live">Live</span>
                  </div>
                  <p className="settings-option-desc">Color-coded real-time Google congestion lines</p>
                </div>
                <span className="settings-status-pill green">ACTIVE</span>
              </div>

              {/* Advance Booking Policy */}
              <div className="settings-option-item">
                <div className="settings-option-info">
                  <div className="settings-option-label">
                    <span className="option-emoji">⏱️</span>
                    <strong>Advance Booking Window</strong>
                  </div>
                  <p className="settings-option-desc">Min. 4 hours required for chauffeur scheduling</p>
                </div>
                <span className="settings-status-pill blue">4 Hours</span>
              </div>
            </div>

            <div className="settings-overlay-footer">
              <span className="app-version-text">Namma Driver • Native Map Edition</span>
            </div>
          </div>
        </div>
      )}

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
        <div className="rapido-layout">
          {/* 1. Full Interactive Map Canvas with Live Location & Drivers */}
          <div className="rapido-map-stage">
            <RoutePreviewMap
              fromCoords={fromCoords}
              toCoords={toCoords}
              googleDirectionsResult={googleDirectionsResult}
              className="rapido-map-canvas"
              onLocateMe={handleUseCurrentLocation}
              isDarkMode={darkMode}
            />
          </div>

          {/* 2. Floating Progressive Bottom Sheet Drawer */}
          <div className={`rapido-drawer ${hasRoute && stepMode === 'ride_options' ? 'mode-options' : 'mode-search'}`}>
            <div className="rapido-drawer-handle" aria-hidden="true" />

            {/* Error alerts */}
            {bookingError && (
              <div className="rapido-alert-banner error" role="alert">
                <span>⚠️</span> {bookingError}
              </div>
            )}
            {fieldInlineError && (
              <div className="rapido-alert-banner warning" role="alert">
                <span>⚠️</span> {fieldInlineError.message}
              </div>
            )}

            {/* STEP 1: Zero-Clutter "Where to?" Search Drawer */}
            {(!hasRoute || stepMode === 'search') && (
              <div className="rapido-search-content">
                {/* Service Categories Bar */}
                <div className="rapido-service-bar">
                  {[
                    { id: 'Point-to-Point', name: 'Ride Now', icon: '⚡', comingSoon: true, disabled: true },
                    { id: 'Scheduled', name: 'Schedule', icon: '🗓️' },
                    { id: 'Rental', name: 'Rental', icon: '⚙️' },
                    { id: 'Airport Transfer', name: 'Airport', icon: '✈️' }
                  ].map(s => (
                    <button
                      key={s.id}
                      type="button"
                      disabled={s.disabled}
                      className={`rapido-service-tab ${serviceType === s.id ? 'active' : ''} ${s.disabled ? 'disabled' : ''}`}
                      onClick={() => {
                        if (s.disabled) return
                        setServiceType(s.id)
                        if (s.id === 'Scheduled') setShowScheduler(true)
                      }}
                      title={s.comingSoon ? 'Ride Now is coming soon' : s.name}
                    >
                      {s.comingSoon && <span className="rapido-tab-badge-soon">Soon</span>}
                      <span className="tab-icon">{s.icon}</span>
                      <span className="tab-text">{s.name}</span>
                    </button>
                  ))}
                </div>

                {/* Pickup Location Pill */}
                <div className="rapido-pickup-capsule">
                  <span className="pickup-pulse-dot" />
                  <div className="pickup-capsule-body" onClick={() => openMapPicker('pickup')} role="button" tabIndex={0}>
                    <span className="pickup-capsule-lbl">Pickup Location</span>
                    <span className="pickup-capsule-val" title={from || 'Current Location'}>
                      {fromLoading || gpsLoading ? (
                        <span className="pickup-locating-pulse">📍 Locating your position...</span>
                      ) : from ? (
                        from.length > 36 ? from.slice(0, 36) + '…' : from
                      ) : (
                        '📍 Tap to set pickup location'
                      )}
                    </span>
                  </div>
                  <div className="pickup-capsule-actions">
                    <button
                      type="button"
                      className="pickup-gps-quick-btn"
                      onClick={handleUseCurrentLocation}
                      disabled={gpsLoading || fromLoading}
                      title="Use my live GPS location"
                    >
                      {gpsLoading ? '⏳ GPS' : '🎯 GPS'}
                    </button>
                    <button
                      type="button"
                      className="pickup-capsule-btn"
                      onClick={() => openMapPicker('pickup')}
                      title="Change pickup on map"
                    >
                      🗺️ Change
                    </button>
                  </div>
                </div>

                {/* 2. Destination Search Box (AFTER pickup) */}
                <div className="rapido-search-box-wrap">
                  <div className="rapido-search-input-inner">
                    <span className="rapido-search-icon" aria-hidden="true">🔍</span>
                    <input
                      id="rapido-destination-input"
                      type="text"
                      className="rapido-destination-input"
                      placeholder="Where are you going?"
                      value={to}
                      onChange={e => handleToInput(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          handleProceedToRide()
                        }
                      }}
                      onFocus={() => {
                        if (to && toSuggestions.length === 0) {
                          fetchSuggestions(to).then(setToSuggestions)
                        }
                      }}
                      autoComplete="off"
                    />
                    {to && (
                      <button
                        type="button"
                        className="rapido-search-clear"
                        onClick={() => {
                          setTo('')
                          setToCoords(null)
                          toCoordsRef.current = null
                          setRouteInfo(null)
                          setGoogleDirectionsResult(null)
                          setToSuggestions([])
                        }}
                        aria-label="Clear input"
                      >
                        ✕
                      </button>
                    )}
                  </div>

                  {/* Autocomplete Dropdown List */}
                  {toSuggestions.length > 0 && (
                    <ul className="rapido-suggestions-menu" role="listbox">
                      {toSuggestions.map((item, idx) => (
                        <li
                          key={idx}
                          role="option"
                          className="rapido-suggestion-row"
                          onClick={() => selectToSuggestion(item)}
                        >
                          <span className="row-icon">📍</span>
                          <div className="row-details">
                            <strong className="row-primary">{item.main_text || item.display_name.split(',')[0]}</strong>
                            <small className="row-secondary">{item.secondary_text || item.display_name.split(',').slice(1).join(',')}</small>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* Quick Shortcut Chips */}
                <div className="rapido-chips-row">
                  <button
                    type="button"
                    className="rapido-chip"
                    onClick={() => handleQuickSelect('Chennai International Airport', [12.9941, 80.1709])}
                  >
                    <span>✈️</span> Airport
                  </button>
                  <button
                    type="button"
                    className="rapido-chip"
                    onClick={() => handleQuickSelect('Chennai Central Railway Station', [13.0827, 80.2707])}
                  >
                    <span>🚆</span> Central
                  </button>
                  <button
                    type="button"
                    className="rapido-chip"
                    onClick={() => handleQuickSelect('Phoenix Marketcity, Velachery', [12.9918, 80.2166])}
                  >
                    <span>🛍️</span> Phoenix Mall
                  </button>
                  <button
                    type="button"
                    className="rapido-chip highlight"
                    onClick={() => openMapPicker('destination')}
                  >
                    <span>🗺️</span> Pick on Map
                  </button>
                </div>

                {/* 3. Schedule Ride Time Strip (AFTER destination input) */}
                <div className="rapido-schedule-home-strip">
                  <button
                    type="button"
                    className={`btn-toggle-schedule-home ${showScheduler ? 'active' : ''}`}
                    onClick={() => setShowScheduler(prev => !prev)}
                    title="Set scheduled ride date & time"
                  >
                    <div className="schedule-home-left">
                      <span className="schedule-home-icon">🗓️</span>
                      <span>{datetime ? `Scheduled for: ${datetime.replace('T', ' ')}` : (serviceType === 'Scheduled' ? 'Set Scheduled Date & Time' : 'Schedule for later (Optional)')}</span>
                    </div>
                    <span className="schedule-home-arrow">{showScheduler ? '▲ Close' : (datetime ? '✎ Edit' : '+ Set Time')}</span>
                  </button>
                  {showScheduler && (
                    <div className="rapido-scheduler-box" style={{ marginTop: '8px' }}>
                      <DateTimePicker
                        dateValue={dateValue}
                        timeValue={timeValue}
                        onChange={updateDateTime}
                      />
                    </div>
                  )}
                </div>

                {/* 4. Prominent Request Ride Submit Button */}
                <button
                  type="button"
                  className="btn-rapido-search-submit"
                  onClick={handleProceedToRide}
                  disabled={toLoading || fromLoading}
                >
                  {toLoading ? (
                    <span className="confirm-btn-loading">
                      <span className="btn-spinner" /> Finding Route & Fares...
                    </span>
                  ) : datetime ? (
                    <>
                      <span className="search-submit-text">🗓️ Request Scheduled Ride</span>
                      <span className="search-submit-arrow">➔</span>
                    </>
                  ) : (
                    <>
                      <span className="search-submit-text">🚗 Request Ride / View Fares</span>
                      <span className="search-submit-arrow">➔</span>
                    </>
                  )}
                </button>

                {/* Upcoming Scheduled Rides Pill Banner (if any) */}
                {upcomingBookings.length > 0 && (
                  <div
                    className="rapido-upcoming-pill"
                    onClick={() => setActiveView('history')}
                    role="button"
                    tabIndex={0}
                  >
                    <span className="pill-badge">🗓️ UPCOMING</span>
                    <span className="pill-msg">
                      <strong>{upcomingBookings.length} Scheduled Ride{upcomingBookings.length > 1 ? 's' : ''}</strong>
                    </span>
                    <span className="pill-arrow">➔</span>
                  </div>
                )}
              </div>
            )}

            {/* STEP 2: Progressive Ride Selection Tray (When destination is set) */}
            {hasRoute && stepMode === 'ride_options' && (
              <div className="rapido-options-content">
                {/* Route Header Strip with Distance, Time & Edit button */}
                <div className="rapido-route-header-strip">
                  <div className="route-header-stops">
                    <div className="stop-item">
                      <span className="stop-dot pickup" />
                      <span className="stop-name" title={from}>{from.split(',')[0]}</span>
                    </div>
                    <div className="stop-connector" />
                    <div className="stop-item">
                      <span className="stop-dot drop" />
                      <span className="stop-name destination" title={to}><strong>{to.split(',')[0]}</strong></span>
                    </div>
                  </div>

                  <div className="route-header-right">
                    <div className="route-stat-tag">
                      <strong>{routeInfo.distanceKm} km</strong>
                      <small>• {routeInfo.durationMinutes} min</small>
                    </div>
                    <button
                      type="button"
                      className="btn-route-edit"
                      onClick={() => setStepMode('search')}
                      title="Change destination"
                    >
                      ✎ Change
                    </button>
                  </div>
                </div>

                {/* Horizontal / Compact Vehicle Selection Cards */}
                <div className="rapido-vehicles-carousel">
                  {carOptions.map(car => {
                    const isSelected = carType === car.name
                    const fare = getCarFare(car.name)
                    return (
                      <div
                        key={car.name}
                        className={`rapido-car-card ${isSelected ? 'active' : ''}`}
                        onClick={() => setCarType(car.name)}
                        role="button"
                        tabIndex={0}
                      >
                        <div className="car-card-visual">
                          <img src={car.image} alt={car.name} className="car-card-img" />
                          <span className="car-card-eta">{car.eta}</span>
                        </div>
                        <div className="car-card-body">
                          <div className="car-card-title-row">
                            <strong>{car.name}</strong>
                            <span className="car-card-seats">{car.seats}</span>
                          </div>
                          <span className="car-card-sub">{car.detail}</span>
                          <span className="car-card-price">{fare}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>

                {/* Optional Schedule for Later Drawer Toggle */}
                <div className="rapido-schedule-drawer-toggle">
                  <button
                    type="button"
                    className={`btn-toggle-schedule ${showScheduler ? 'active' : ''}`}
                    onClick={() => setShowScheduler(prev => !prev)}
                  >
                    <span>🗓️</span> {showScheduler ? 'Close Schedule' : (datetime ? `Scheduled: ${datetime}` : 'Schedule for later')}
                  </button>
                </div>

                {showScheduler && (
                  <div className="rapido-scheduler-box">
                    <DateTimePicker
                      dateValue={dateValue}
                      timeValue={timeValue}
                      onChange={updateDateTime}
                    />
                  </div>
                )}

                {/* Primary Booking Action Button */}
                <button
                  type="button"
                  className="btn-rapido-confirm"
                  onClick={handleRequest}
                  disabled={loading}
                >
                  {loading ? (
                    <span className="confirm-btn-loading">
                      <span className="btn-spinner" /> Reserving...
                    </span>
                  ) : (
                    <>
                      <span className="confirm-btn-action">
                        {datetime ? `Schedule ${carType}` : `Book ${carType}`}
                      </span>
                      <span className="confirm-btn-price">
                        {estimatedFare?.formatted || getCarFare(carType)}
                      </span>
                      <span className="confirm-btn-arrow">➔</span>
                    </>
                  )}
                </button>
              </div>
            )}





          </div>
        </div>
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
        isDarkMode={darkMode}
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
