import React, { useEffect, useState } from 'react'
import { auth, database } from '../database'
import BirthdayPicker from '../components/BirthdayPicker'
import logo from '../assets/logo.png'

export default function DriverHome({ user, onSignOut }) {
  const [profile, setProfile] = useState(() => ({
    name: user.user_metadata?.name || '',
    email: user.email || '',
    phone: user.user_metadata?.phone || '',
    birthday: user.user_metadata?.birthday || '',
    avatarUrl: user.user_metadata?.avatar_url || '',
    vehicleNumber: user.user_metadata?.vehicleNumber || '',
    vehicleModel: user.user_metadata?.vehicleModel || ''
  }))

  const displayName = profile.name || user.user_metadata?.name || user.email || 'Driver'
  const profileInitials = displayName.split(/\s+/).map(p => p[0]).join('').slice(0, 2).toUpperCase()

  // Sticky header scroll detection
  const [headerScrolled, setHeaderScrolled] = useState(false)
  useEffect(() => {
    const onScroll = () => setHeaderScrolled(window.scrollY > 10)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Time-aware greeting
  const getTimeGreeting = () => {
    const h = new Date().getHours()
    if (h < 12) return { emoji: '🌅', text: 'Good morning' }
    if (h < 17) return { emoji: '☀️', text: 'Good afternoon' }
    return { emoji: '🌙', text: 'Good evening' }
  }
  const greeting = getTimeGreeting()

  // Driver state
  const [isOnline, setIsOnline] = useState(true)
  const [incomingRequests, setIncomingRequests] = useState([])
  const [activeRide, setActiveRide] = useState(null)
  const [completedRides, setCompletedRides] = useState([])
  const [driverTripFilter, setDriverTripFilter] = useState('all') // 'all' | 'today'
  const [selectedDriverTrip, setSelectedDriverTrip] = useState(null)
  const [loading, setLoading] = useState(false)
  const [actionSuccess, setActionSuccess] = useState(null)

  // Profile modal state
  const [profileOpen, setProfileOpen] = useState(false)
  const [avatarFile, setAvatarFile] = useState(null)
  const [avatarPreview, setAvatarPreview] = useState('')
  const [profileLoading, setProfileLoading] = useState(false)
  const [profileMessage, setProfileMessage] = useState(null)
  const [profileSaved, setProfileSaved] = useState(false)

  // Prevent background scrolling when any modal is open
  const isAnyModalOpen = profileOpen || Boolean(selectedDriverTrip)
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

  // Load driver data and live requests
  const refreshRequests = async () => {
    try {
      const requests = await database.listAvailableBookings()
      setIncomingRequests(requests)

      // Also check driver's active and completed bookings
      const driverBookings = await database.listDriverBookings(user.id)
      const currentActive = driverBookings.find(b => b.status === 'accepted' || b.status === 'ongoing')
      const past = driverBookings.filter(b => b.status === 'completed')
      setActiveRide(currentActive || null)
      setCompletedRides(past || [])
    } catch (e) {
      console.warn('Refresh driver requests notice:', e)
    }
  }

  useEffect(() => {
    database.getProfile(user.id).then(saved => {
      if (saved) {
        setProfile({
          name: saved.name || user.user_metadata?.name || '',
          email: saved.email || user.email || '',
          phone: saved.phone || user.user_metadata?.phone || '',
          birthday: saved.birthday || user.user_metadata?.birthday || '',
          avatarUrl: saved.avatar_url || user.user_metadata?.avatar_url || '',
          vehicleNumber: saved.vehicle_number || user.user_metadata?.vehicleNumber || '',
          vehicleModel: saved.vehicle_model || user.user_metadata?.vehicleModel || ''
        })
      }
    }).catch(() => { })

    refreshRequests()
    const timer = setInterval(refreshRequests, 6000) // auto poll for new requests
    return () => clearInterval(timer)
  }, [user.id])

  // Profile modal actions matching Home.jsx
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
      setProfileMessage(err.message || 'Could not save profile.')
    } finally {
      setProfileLoading(false)
    }
  }

  // Driver ride actions
  const handleAcceptRide = async (ride) => {
    setLoading(true)
    try {
      const driverInfo = {
        id: user.id,
        name: displayName,
        phone: profile.phone || '',
        vehicleNumber: profile.vehicleNumber || 'Standard',
        vehicleModel: profile.vehicleModel || 'Taxi'
      }
      await database.updateBookingStatus(ride.id, 'accepted', driverInfo)
      setActionSuccess(`Accepted ride for ${ride.name || 'Passenger'}!`)
      setTimeout(() => setActionSuccess(null), 4000)
      refreshRequests()
    } catch (e) {
      alert('Could not accept ride: ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  const handleStartRide = async () => {
    if (!activeRide) return
    setLoading(true)
    try {
      await database.updateBookingStatus(activeRide.id, 'ongoing', { id: user.id, name: displayName })
      setActionSuccess('Trip started! Drive safely.')
      setTimeout(() => setActionSuccess(null), 4000)
      refreshRequests()
    } catch (e) {
      alert('Error starting trip: ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  const handleCompleteRide = async () => {
    if (!activeRide) return
    setLoading(true)
    try {
      await database.updateBookingStatus(activeRide.id, 'completed', { id: user.id, name: displayName })
      setActionSuccess('Trip completed! Fare added to your earnings.')
      setTimeout(() => setActionSuccess(null), 4000)
      refreshRequests()
    } catch (e) {
      alert('Error completing trip: ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  const handleCancelActiveRide = async () => {
    if (!activeRide) return
    if (!window.confirm('Are you sure you want to cancel this trip?')) return
    setLoading(true)
    try {
      await database.updateBookingStatus(activeRide.id, 'requested', null) // return to pool
      setActiveRide(null)
      setActionSuccess('Ride cancelled and returned to pool.')
      setTimeout(() => setActionSuccess(null), 4000)
      refreshRequests()
    } catch (e) {
      alert('Error cancelling trip: ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  const handleSignOut = async (e) => {
    e?.preventDefault?.()
    if (onSignOut) {
      await onSignOut()
    } else {
      await auth.signOut()
    }
  }

  // Calculate today's earnings
  const todayEarnings = completedRides.reduce((total, ride) => {
    const num = parseInt((ride.estimatedFare || '₹400').replace(/[^\d]/g, ''), 10) || 350
    return total + num
  }, 0)

  return (
    <div className="app-shell driver-theme">
      {/* Sticky Floating Header - Structure Identical to Rider Home */}
      <header className={`site-header${headerScrolled ? ' scrolled' : ''}`} role="banner">
        <div className="site-header-inner">
          {/* Left: Brand */}
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
              aria-label="Edit driver profile"
              title="Edit driver profile"
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

      <main className="content driver-content">
        {/* Driver Shift Control & Summary Banner */}
        <div className="driver-hero-panel">
          <div className="driver-hero-left">
            <h2>Driver Dashboard</h2>
            <p className="driver-subtitle">
              {profile.vehicleModel ? `${profile.vehicleModel} • ` : ''}
              {profile.vehicleNumber || 'Vehicle Active'}
            </p>
          </div>

          {/* Online / Offline Shift Toggle */}
          <div className="driver-shift-toggle-box">
            <button
              type="button"
              className={`shift-toggle-btn ${isOnline ? 'online' : 'offline'}`}
              onClick={() => setIsOnline(!isOnline)}
            >
              <span className="shift-dot-pulse" />
              <strong>{isOnline ? 'Online (Ready)' : 'Off Duty'}</strong>
              <small>{isOnline ? 'Tap to pause' : 'Tap to go active'}</small>
            </button>
          </div>
        </div>

        {actionSuccess && (
          <div className="driver-toast-success">
            <span>✅</span> {actionSuccess}
          </div>
        )}

        {/* Driver Quick Stats Widget */}
        <div className="driver-metrics-bar">
          <div className="driver-metric-tile">
            <span className="tile-icon">💰</span>
            <div className="tile-info">
              <span className="tile-label">Today's Earnings</span>
              <strong className="tile-value">₹{todayEarnings}</strong>
            </div>
          </div>
          <div className="driver-metric-tile">
            <span className="tile-icon">🏁</span>
            <div className="tile-info">
              <span className="tile-label">Completed Trips</span>
              <strong className="tile-value">{completedRides.length}</strong>
            </div>
          </div>
          <div className="driver-metric-tile">
            <span className="tile-icon">🚗</span>
            <div className="tile-info">
              <span className="tile-label">Duty Status</span>
              <strong className={`tile-value ${isOnline ? 'status-online' : 'status-offline'}`}>
                {isOnline ? 'Active' : 'Off-Duty'}
              </strong>
            </div>
          </div>
        </div>

        {/* Active Trip Hero Section */}
        {activeRide && (
          <div className="active-trip-card">
            <div className="active-trip-header">
              <span className="active-radar-dot" />
              <h3>Current Active Trip</h3>
              <span className={`active-status-badge ${activeRide.status}`}>
                {activeRide.status === 'ongoing' ? 'Trip in Progress' : 'Confirmed - En Route'}
              </span>
            </div>

            <div className="active-trip-body">
              <div className="rider-contact-row">
                <div className="rider-avatar-icon">🧑</div>
                <div className="rider-meta">
                  <strong>{activeRide.name || 'Passenger'}</strong>
                  <span>{activeRide.carType} • {activeRide.serviceType}</span>
                </div>
                {activeRide.email && (
                  <a href={`mailto:${activeRide.email}`} className="btn-call-rider">
                    ✉️ Message
                  </a>
                )}
              </div>

              <div className="active-locations-track">
                <div className="active-loc-stop">
                  <span className="stop-marker start">📍</span>
                  <div>
                    <small>PICKUP</small>
                    <p>{activeRide.from}</p>
                  </div>
                </div>
                <div className="active-loc-stop">
                  <span className="stop-marker end">🏁</span>
                  <div>
                    <small>DROP-OFF</small>
                    <p>{activeRide.to}</p>
                  </div>
                </div>
              </div>

              {/* Direct Google Maps Navigation */}
              <div className="active-actions-row">
                <a
                  href={`https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(activeRide.from)}&destination=${encodeURIComponent(activeRide.to)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-open-nav"
                >
                  🗺️ Open in Google Maps
                </a>

                {activeRide.status === 'accepted' ? (
                  <button
                    type="button"
                    className="btn-action-primary"
                    onClick={handleStartRide}
                    disabled={loading}
                  >
                    ▶️ Start Ride
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn-action-complete"
                    onClick={handleCompleteRide}
                    disabled={loading}
                  >
                    ✅ Complete Ride
                  </button>
                )}

                <button
                  type="button"
                  className="btn-action-cancel"
                  onClick={handleCancelActiveRide}
                  disabled={loading}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Incoming Ride Requests Queue */}
        <div className="requests-section">
          <div className="requests-header">
            <h3>Incoming Ride Requests</h3>
            <span className="requests-count-badge">
              {incomingRequests.length} Available
            </span>
          </div>

          {!isOnline ? (
            <div className="offline-placeholder">
              <span className="placeholder-icon">💤</span>
              <h4>You are currently Off Duty</h4>
              <p>Turn on your shift availability toggle above to receive incoming passenger rides.</p>
              <button
                type="button"
                className="btn-go-online"
                onClick={() => setIsOnline(true)}
              >
                Go Online
              </button>
            </div>
          ) : incomingRequests.length === 0 ? (
            <div className="no-requests-placeholder">
              <span className="placeholder-icon">📡</span>
              <h4>Searching for nearby ride requests...</h4>
              <p>New bookings will appear here automatically in real time.</p>
            </div>
          ) : (
            <div className="requests-grid">
              {incomingRequests.map((req) => (
                <div key={req.id} className="request-card">
                  <div className="request-card-top">
                    <div className="req-passenger-wrap">
                      <span className="req-avatar">🧑</span>
                      <div>
                        <strong>{req.name || 'Passenger'}</strong>
                        <small>{req.carType} • {req.serviceType}</small>
                      </div>
                    </div>
                    <div className="req-fare-pill">
                      {req.estimatedFare || 'Est. ₹350+'}
                    </div>
                  </div>

                  <div className="req-route-points">
                    <div className="req-point">
                      <span className="req-dot start" />
                      <span className="req-point-text">{req.from}</span>
                    </div>
                    <div className="req-point">
                      <span className="req-dot end" />
                      <span className="req-point-text">{req.to}</span>
                    </div>
                  </div>

                  <div className="req-datetime-tag">
                    🗓️ Scheduled: {req.datetime}
                  </div>

                  <div className="req-card-actions">
                    <button
                      type="button"
                      className="btn-accept-ride"
                      onClick={() => handleAcceptRide(req)}
                      disabled={loading || Boolean(activeRide)}
                      title={activeRide ? 'Finish active trip first' : 'Accept Ride'}
                    >
                      {activeRide ? 'Busy (Active Ride)' : '✅ Accept Ride'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Past Completed Trips & Earnings Log */}
        <div className="completed-section driver-history-card">
          <div className="driver-history-header">
            <div>
              <span className="eyebrow">Shift Earnings & Log</span>
              <h3>Previous Completed Trips</h3>
            </div>
            <div className="driver-earnings-badge">
              <small>Total Net Payout</small>
              <strong>
                ₹{completedRides.reduce((sum, r) => sum + (parseInt((r.estimatedFare || '350').replace(/[^\d]/g, ''), 10) || 350), 0)}
              </strong>
            </div>
          </div>

          {/* Filter Tabs */}
          {completedRides.length > 0 && (
            <div className="trip-filter-tabs driver-tabs">
              <button
                type="button"
                className={`trip-filter-btn ${driverTripFilter === 'all' ? 'active' : ''}`}
                onClick={() => setDriverTripFilter('all')}
              >
                All Shift Trips ({completedRides.length})
              </button>
              <button
                type="button"
                className={`trip-filter-btn ${driverTripFilter === 'today' ? 'active' : ''}`}
                onClick={() => setDriverTripFilter('today')}
              >
                Today ({completedRides.filter(r => r.datetime?.includes('2026-08-28') || !r.completedAt || (Date.now() - r.completedAt < 24 * 3600 * 1000)).length})
              </button>
            </div>
          )}

          {completedRides.length === 0 ? (
            <div className="no-requests-placeholder">
              <span className="placeholder-icon">📭</span>
              <h4>No completed trips on record yet</h4>
              <p>Trips you complete will appear here with detailed payout breakdowns.</p>
            </div>
          ) : (
            <div className="completed-list">
              {completedRides
                .filter(r => {
                  if (driverTripFilter === 'today') {
                    return r.datetime?.includes('2026-08-28') || !r.completedAt || (Date.now() - r.completedAt < 24 * 3600 * 1000)
                  }
                  return true
                })
                .map((ride) => {
                  const fareVal = ride.estimatedFare || '₹350'
                  return (
                    <div key={ride.id} className="completed-item driver-trip-row">
                      <div className="completed-info">
                        <div className="passenger-lead">
                          <span className="driver-pax-avatar">🧑</span>
                          <strong>{ride.name || 'Passenger'}</strong>
                          <span className="driver-trip-pill">✓ Completed</span>
                        </div>
                        <div className="driver-route-preview">
                          <span>📍 {ride.from.split(',')[0]}</span>
                          <span className="route-arrow">➔</span>
                          <span>🏁 {ride.to.split(',')[0]}</span>
                        </div>
                        <div className="driver-trip-meta">
                          <span>{ride.carType}</span>
                          <span>•</span>
                          <span>{ride.datetime}</span>
                          {ride.distance && <span>• {ride.distance}</span>}
                        </div>
                      </div>

                      <div className="driver-fare-col">
                        <div className="completed-fare driver-payout-amount">
                          +{fareVal}
                        </div>
                        <small className="payout-status-text">✓ Credited</small>
                        <button
                          type="button"
                          className="btn-driver-details"
                          onClick={() => setSelectedDriverTrip(ride)}
                        >
                          📄 Trip Details
                        </button>
                      </div>
                    </div>
                  )
                })}
            </div>
          )}
        </div>
      </main>

      {/* Driver Profile Modal - Matches Rider Profile exactly */}
      {profileOpen && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={e => e.target === e.currentTarget && setProfileOpen(false)}
        >
          <section
            className="profile-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="driver-profile-title"
          >
            <div className="modal-heading">
              <div>
                {/* <span className="eyebrow">Driver Partner</span> */}
                <h2 id="driver-profile-title">Edit profile & vehicle</h2>
              </div>
              <button
                type="button"
                className="modal-close"
                aria-label="Close profile"
                onClick={() => setProfileOpen(false)}
              >
                ×
              </button>
            </div>

            <form className="form profile-form" onSubmit={handleProfileSave}>
              <div className="avatar-editor">
                <div className="avatar-large">
                  {avatarPreview || profile.avatarUrl ? (
                    <img src={avatarPreview || profile.avatarUrl} alt="Driver avatar preview" />
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
                  <input
                    required
                    type="text"
                    value={profile.name}
                    onChange={e => setProfile(prev => ({ ...prev, name: e.target.value }))}
                  />
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
                <input
                  type="email"
                  value={profile.email}
                  onChange={e => setProfile(prev => ({ ...prev, email: e.target.value }))}
                />
              </label>

              <label className="auth-field">
                <span>Phone number</span>
                <div className="field-input-wrap">
                  <input
                    required
                    type="tel"
                    placeholder="+91 98765 43210"
                    value={profile.phone}
                    onChange={e => setProfile(prev => ({ ...prev, phone: e.target.value }))}
                  />
                  <div
                    className={`input-status-capsule ${profile.phone.trim().length >= 10 ? 'valid' : 'required'}`}
                    title={profile.phone.trim().length >= 10 ? 'Completed' : 'Required'}
                  >
                    {profile.phone.trim().length >= 10 ? '✓' : ''}
                  </div>
                </div>
              </label>

              <div className="form-two-col">
                <label className="auth-field">
                  <span>Vehicle model</span>
                  <div className="field-input-wrap">
                    <input
                      required
                      type="text"
                      placeholder="e.g. Swift Dzire"
                      value={profile.vehicleModel}
                      onChange={e => setProfile(prev => ({ ...prev, vehicleModel: e.target.value }))}
                    />
                    <div
                      className={`input-status-capsule ${profile.vehicleModel.trim() ? 'valid' : 'required'}`}
                      title={profile.vehicleModel.trim() ? 'Completed' : 'Required'}
                    >
                      {profile.vehicleModel.trim() ? '✓' : ''}
                    </div>
                  </div>
                </label>
                <label className="auth-field">
                  <span>Plate number</span>
                  <div className="field-input-wrap">
                    <input
                      required
                      type="text"
                      placeholder="TN 01 AB 1234"
                      value={profile.vehicleNumber}
                      onChange={e => setProfile(prev => ({ ...prev, vehicleNumber: e.target.value }))}
                    />
                    <div
                      className={`input-status-capsule ${profile.vehicleNumber.trim() ? 'valid' : 'required'}`}
                      title={profile.vehicleNumber.trim() ? 'Completed' : 'Required'}
                    >
                      {profile.vehicleNumber.trim() ? '✓' : ''}
                    </div>
                  </div>
                </label>
              </div>

              <BirthdayPicker
                value={profile.birthday}
                onChange={birthday => setProfile(prev => ({ ...prev, birthday }))}
              />

              {profileSaved && (
                <div className="profile-saved-toast">✓ Changes saved successfully!</div>
              )}
              {profileMessage && <div className="err">{profileMessage}</div>}

              <button
                type="submit"
                className="btn primary-action"
                disabled={profileLoading || profileSaved}
              >
                {profileSaved ? '✓ Saved' : profileLoading ? 'Saving...' : 'Save changes'}
              </button>
            </form>
          </section>
        </div>
      )}

      {/* Driver Trip Details & Payout Modal */}
      {selectedDriverTrip && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={e => e.target === e.currentTarget && setSelectedDriverTrip(null)}
        >
          <section className="profile-modal receipt-modal" role="dialog" aria-modal="true">
            <div className="modal-heading">
              <div>
                <span className="eyebrow">Trip Details & Payout</span>
                <h2>Trip #{selectedDriverTrip.id.slice(-6).toUpperCase()}</h2>
              </div>
              <button
                type="button"
                className="modal-close"
                onClick={() => setSelectedDriverTrip(null)}
                aria-label="Close trip details"
              >
                ×
              </button>
            </div>

            <div className="receipt-content">
              <div className="receipt-status-banner">
                <span className="booking-status-badge status-completed">
                  ✓ Trip Completed
                </span>
                <span className="receipt-datetime">
                  🗓️ {selectedDriverTrip.datetime}
                </span>
              </div>

              <div className="receipt-driver-card">
                <div className="driver-avatar-mini">🧑</div>
                <div className="driver-receipt-info">
                  <strong>{selectedDriverTrip.name || 'Passenger'}</strong>
                  <span>{selectedDriverTrip.phone || 'Phone verified'}</span>
                </div>
                {selectedDriverTrip.phone && (
                  <a href={`tel:${selectedDriverTrip.phone}`} className="btn-driver-call">
                    📞 Call
                  </a>
                )}
              </div>

              <div className="receipt-route-box">
                <div className="receipt-stop">
                  <span className="receipt-marker start">📍</span>
                  <div>
                    <small>PICKUP LOCATION</small>
                    <p>{selectedDriverTrip.from}</p>
                  </div>
                </div>
                <div className="receipt-stop">
                  <span className="receipt-marker end">🏁</span>
                  <div>
                    <small>DROP-OFF LOCATION</small>
                    <p>{selectedDriverTrip.to}</p>
                  </div>
                </div>
              </div>

              <div className="receipt-fare-breakdown">
                <h4>Earnings Summary</h4>
                <div className="fare-row">
                  <span>Gross Passenger Fare</span>
                  <strong>{selectedDriverTrip.estimatedFare || '₹350'}</strong>
                </div>
                <div className="fare-row">
                  <span>Platform Commission</span>
                  <span style={{ color: '#059669', fontWeight: '700' }}>₹0 (0% Promo)</span>
                </div>
                <div className="fare-row">
                  <span>GST & Service</span>
                  <span>Covered by Platform</span>
                </div>
                <div className="fare-row total">
                  <strong>Net Payout Credited</strong>
                  <strong className="receipt-total-amount" style={{ color: '#047857' }}>
                    {selectedDriverTrip.estimatedFare || '₹350'}
                  </strong>
                </div>
              </div>

              <div className="payout-settlement-notice">
                <span>🏦 Settled to Linked Bank Account • Instant Payout</span>
              </div>

              <button
                type="button"
                className="btn primary-action"
                onClick={() => setSelectedDriverTrip(null)}
              >
                Close Summary
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
