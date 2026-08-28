import React, { useState, useMemo } from 'react'

export default function TripHistoryView({
  bookings = [],
  onBack,
  onSelectReceipt,
  onBookRide
}) {
  const [searchQuery, setSearchQuery] = useState('')
  const [filterTab, setFilterTab] = useState('all') // 'all' | 'upcoming' | 'completed' | 'active'
  const [currentPage, setCurrentPage] = useState(1)
  const pageSize = 6

  // Counts
  const upcomingCount = useMemo(() => {
    return bookings.filter(b => b.status !== 'completed' && b.status !== 'cancelled').length
  }, [bookings])

  const completedCount = useMemo(() => {
    return bookings.filter(b => b.status === 'completed').length
  }, [bookings])

  const activeCount = useMemo(() => {
    return bookings.filter(b => b.status === 'confirmed' || b.status === 'ongoing').length
  }, [bookings])

  // Filtered & Searched trips
  const filteredTrips = useMemo(() => {
    return bookings.filter(b => {
      // 1. Tab filter
      if (filterTab === 'upcoming' && (b.status === 'completed' || b.status === 'cancelled')) return false
      if (filterTab === 'completed' && b.status !== 'completed') return false
      if (filterTab === 'active' && b.status !== 'confirmed' && b.status !== 'ongoing') return false

      // 2. Search query filter (matches pickup, dropoff, car, service, or date)
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase()
        const fromStr = (b.from || '').toLowerCase()
        const toStr = (b.to || '').toLowerCase()
        const carStr = (b.carType || '').toLowerCase()
        const dtStr = (b.datetime || '').toLowerCase()
        const idStr = (b.id || '').toLowerCase()
        return fromStr.includes(q) || toStr.includes(q) || carStr.includes(q) || dtStr.includes(q) || idStr.includes(q)
      }

      return true
    })
  }, [bookings, filterTab, searchQuery])

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filteredTrips.length / pageSize))
  const paginatedTrips = useMemo(() => {
    const start = (currentPage - 1) * pageSize
    return filteredTrips.slice(start, start + pageSize)
  }, [filteredTrips, currentPage, pageSize])

  const handleTabChange = (tab) => {
    setFilterTab(tab)
    setCurrentPage(1)
  }

  return (
    <div className="trip-history-hub full-width" role="main">
      {/* Top Header Navigation Bar */}
      <div className="history-hub-nav">
        <button
          type="button"
          className="btn-back-home"
          onClick={onBack}
          aria-label="Back to Home booking screen"
        >
          <span className="back-arrow">←</span>
          <span className="back-text">Back to Home</span>
        </button>

        <div className="history-hub-summary-badge">
          <span className="badge-count-num">{bookings.length}</span>
          <span className="badge-count-lbl">Total Trips</span>
        </div>
      </div>

      {/* Full-width Title Banner (Zero Squishing) */}
      <div className="history-hub-title-banner">
        <span className="eyebrow hub-eyebrow">Your Activity & Archives</span>
        <h1 className="history-hub-title">My Trips & Receipts</h1>
      </div>

      {/* Search & Filter Toolbar */}
      <div className="history-hub-toolbar card">
        <div className="history-search-wrap">
          <span className="search-icon" aria-hidden="true">🔍</span>
          <input
            type="search"
            className="history-search-input"
            placeholder="Search by address, landmark, date or trip ID..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value)
              setCurrentPage(1)
            }}
          />
          {searchQuery && (
            <button
              type="button"
              className="search-clear-btn"
              onClick={() => setSearchQuery('')}
              aria-label="Clear search"
            >
              ✕
            </button>
          )}
        </div>

        {/* Segmented Status Tabs */}
        <div className="trip-filter-tabs hub-tabs" role="tablist" aria-label="Filter trips by status">
          <button
            type="button"
            role="tab"
            aria-selected={filterTab === 'all'}
            className={`trip-filter-btn ${filterTab === 'all' ? 'active' : ''}`}
            onClick={() => handleTabChange('all')}
          >
            <span className="trip-filter-name">All Trips</span>
            <span className="trip-filter-count">{bookings.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={filterTab === 'upcoming'}
            className={`trip-filter-btn ${filterTab === 'upcoming' ? 'active' : ''}`}
            onClick={() => handleTabChange('upcoming')}
          >
            <span className="trip-filter-name">🗓️ Upcoming</span>
            <span className="trip-filter-count">{upcomingCount}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={filterTab === 'completed'}
            className={`trip-filter-btn ${filterTab === 'completed' ? 'active' : ''}`}
            onClick={() => handleTabChange('completed')}
          >
            <span className="trip-filter-name">✓ Completed</span>
            <span className="trip-filter-count">{completedCount}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={filterTab === 'active'}
            className={`trip-filter-btn ${filterTab === 'active' ? 'active' : ''}`}
            onClick={() => handleTabChange('active')}
          >
            <span className="trip-filter-name">⚡ Active</span>
            <span className="trip-filter-count">{activeCount}</span>
          </button>
        </div>
      </div>

      {/* Trips Content Area */}
      {paginatedTrips.length === 0 ? (
        <div className="card empty-hub-card">
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
          <h3>No matching journeys found</h3>
          <p className="empty-sub">
            {searchQuery
              ? `No bookings match your search for "${searchQuery}". Try a different keyword.`
              : filterTab === 'upcoming'
              ? 'You have no scheduled or upcoming rides scheduled.'
              : filterTab === 'completed'
              ? 'You have not completed any rides yet.'
              : 'Your booking records will appear here as soon as you book a ride.'}
          </p>
          <div className="empty-actions">
            {searchQuery && (
              <button
                type="button"
                className="btn secondary-action"
                onClick={() => setSearchQuery('')}
              >
                Clear Search Filter
              </button>
            )}
            <button
              type="button"
              className="btn primary-action"
              onClick={onBookRide || onBack}
            >
              🚗 Book a New Journey
            </button>
          </div>
        </div>
      ) : (
        <div className="history-hub-list-wrap">
          <ul className="booking-list history-hub-list">
            {paginatedTrips.map(b => {
              const statusMap = {
                requested: { label: 'Requested', cls: 'status-requested' },
                confirmed: { label: 'Confirmed', cls: 'status-confirmed' },
                ongoing: { label: 'Ongoing', cls: 'status-ongoing' },
                completed: { label: '✓ Completed', cls: 'status-completed' },
                cancelled: { label: 'Cancelled', cls: 'status-cancelled' }
              }
              const st = statusMap[b.status] || statusMap.requested
              const dt = b.datetime ? new Date(b.datetime) : (b.createdAt ? new Date(b.createdAt) : null)
              const dtStr = dt && !isNaN(dt.getTime())
                ? dt.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
                : (b.datetime || 'Recently booked')
              const fromName = (b.from || b.from_location || 'Pickup location')
              const toName = (b.to || b.to_location || 'Drop location')
              const carName = b.carType || b.car_type || 'Sedan'
              const serviceName = b.serviceType || b.service_type || 'Point-to-Point'

              return (
                <li key={b.id || Math.random()} className="booking-item trip-history-card hub-trip-card">
                  <div className="booking-item-top">
                    <div className="booking-route">
                      <span className="booking-from" title={fromName}>📍 {fromName.split(',')[0]}</span>
                      <span className="booking-arrow">→</span>
                      <span className="booking-to" title={toName}>🏁 {toName.split(',')[0]}</span>
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

                  <div className="trip-card-footer-actions hub-footer-actions">
                    <span className="trip-id-crumb">Trip ID: #{b.id?.slice(-6).toUpperCase()}</span>
                    <button
                      type="button"
                      className="btn-view-receipt"
                      onClick={() => onSelectReceipt(b)}
                    >
                      🧾 View Invoice & Details
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className="hub-pagination-bar card">
              <button
                type="button"
                className="btn-page-arrow"
                disabled={currentPage === 1}
                onClick={() => {
                  setCurrentPage(prev => Math.max(1, prev - 1))
                  window.scrollTo({ top: 0, behavior: 'smooth' })
                }}
                aria-label="Previous page"
              >
                ← Previous
              </button>
              <span className="page-indicator-text">
                Page <strong>{currentPage}</strong> of <strong>{totalPages}</strong> ({filteredTrips.length} trips)
              </span>
              <button
                type="button"
                className="btn-page-arrow"
                disabled={currentPage === totalPages}
                onClick={() => {
                  setCurrentPage(prev => Math.min(totalPages, prev + 1))
                  window.scrollTo({ top: 0, behavior: 'smooth' })
                }}
                aria-label="Next page"
              >
                Next →
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
