import React, { useState, useEffect, useRef } from 'react'

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
]
const DAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

const MIN_LEAD_HOURS = 4 // Minimum 4 hours advance notice required

function pad(n) {
  return n.toString().padStart(2, '0')
}

function formatDateISO(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function formatTimeISO(hours, minutes) {
  return `${pad(hours)}:${pad(minutes)}`
}

function parseTimeTo12h(timeStr) {
  if (!timeStr) return { hour12: 9, minutes: 0, period: 'AM' }
  const [hStr, mStr] = timeStr.split(':')
  let h = parseInt(hStr, 10) || 0
  const m = parseInt(mStr, 10) || 0
  const period = h >= 12 ? 'PM' : 'AM'
  h = h % 12
  if (h === 0) h = 12
  return { hour12: h, minutes: m, period }
}

function to24h(hour12, minutes, period) {
  let h = parseInt(hour12, 10)
  if (period === 'AM') {
    if (h === 12) h = 0
  } else {
    if (h !== 12) h += 12
  }
  return `${pad(h)}:${pad(minutes)}`
}

/**
 * Returns the earliest valid date/time object (Current time + 4 hours, rounded up to next 5-min slot)
 */
function getEarliestAllowedDateTime() {
  const earliest = new Date(Date.now() + MIN_LEAD_HOURS * 60 * 60 * 1000)
  const rem = earliest.getMinutes() % 5
  if (rem !== 0) {
    earliest.setMinutes(earliest.getMinutes() + (5 - rem))
  }
  earliest.setSeconds(0)
  earliest.setMilliseconds(0)
  return earliest
}

export default function DateTimePicker({ dateValue, timeValue, onChange }) {
  const [mode, setMode] = useState('schedule') // 'now' | 'schedule'
  const [showCalendar, setShowCalendar] = useState(false)
  const calendarRef = useRef(null)

  // Real-time references & Earliest valid boundary
  const now = new Date()
  const earliestAllowed = getEarliestAllowedDateTime()
  const earliestISO = formatDateISO(earliestAllowed)
  const earliestTimeStr = formatTimeISO(earliestAllowed.getHours(), earliestAllowed.getMinutes())

  // View state for custom calendar popover
  const initialDate = dateValue ? new Date(dateValue) : earliestAllowed
  const [calYear, setCalYear] = useState(initialDate.getFullYear())
  const [calMonth, setCalMonth] = useState(initialDate.getMonth())

  // Parse current 12-hour values for custom time controller
  const { hour12, minutes, period } = parseTimeTo12h(timeValue || earliestTimeStr)

  // Close calendar popover on outside click
  useEffect(() => {
    function handleClickOutside(e) {
      if (calendarRef.current && !calendarRef.current.contains(e.target)) {
        setShowCalendar(false)
      }
    }
    if (showCalendar) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showCalendar])

  // Initialize or correct date/time to ensure minimum 4 hours advance notice
  useEffect(() => {
    const currentEarliest = getEarliestAllowedDateTime()
    const currentEarliestDateStr = formatDateISO(currentEarliest)
    const currentEarliestTimeStr = formatTimeISO(currentEarliest.getHours(), currentEarliest.getMinutes())

    if (!dateValue || !timeValue) {
      onChange(currentEarliestDateStr, currentEarliestTimeStr)
      return
    }

    // If existing selection is less than 4 hours ahead, automatically bump to earliest allowed
    try {
      const [year, month, day] = dateValue.split('-').map(Number)
      const [h, m] = timeValue.split(':').map(Number)
      const selectedDateTime = new Date(year, month - 1, day, h, m)
      if (selectedDateTime.getTime() < currentEarliest.getTime()) {
        onChange(currentEarliestDateStr, currentEarliestTimeStr)
      }
    } catch {
      onChange(currentEarliestDateStr, currentEarliestTimeStr)
    }
  }, [dateValue, timeValue])

  // Safe changer that enforces >= 4 hours ahead
  const setSafeDateTime = (newDateStr, newTimeStr) => {
    const minTime = getEarliestAllowedDateTime()
    try {
      const [year, month, day] = newDateStr.split('-').map(Number)
      const [h, m] = newTimeStr.split(':').map(Number)
      const target = new Date(year, month - 1, day, h, m)

      if (target.getTime() < minTime.getTime()) {
        // Bump to minimum allowed
        onChange(formatDateISO(minTime), formatTimeISO(minTime.getHours(), minTime.getMinutes()))
      } else {
        onChange(newDateStr, newTimeStr)
      }
    } catch {
      onChange(newDateStr, newTimeStr)
    }
  }

  // Quick Date presets generation (Starts from earliest allowed date)
  const quickDays = Array.from({ length: 4 }).map((_, idx) => {
    const d = new Date(earliestAllowed)
    d.setDate(d.getDate() + idx)
    const iso = formatDateISO(d)
    const todayISO = formatDateISO(now)
    const tomorrowISO = formatDateISO(new Date(now.getTime() + 86400000))

    let label = ''
    if (iso === todayISO) label = 'Today'
    else if (iso === tomorrowISO) label = 'Tomorrow'
    else label = d.toLocaleDateString('en-US', { weekday: 'short' })

    return {
      iso,
      label,
      dayNum: d.getDate(),
      monthShort: d.toLocaleDateString('en-US', { month: 'short' }),
      weekday: d.toLocaleDateString('en-US', { weekday: 'short' })
    }
  })

  // Quick Time presets (Filtered to only show slots >= 4 hours ahead)
  const getQuickTimePresets = () => {
    const selectedDate = dateValue || earliestISO
    const isEarliestDay = selectedDate === earliestISO
    const presets = []

    if (isEarliestDay) {
      // +4 hours (Earliest allowed)
      presets.push({
        label: `+4h (${earliestAllowed.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })})`,
        time: formatTimeISO(earliestAllowed.getHours(), earliestAllowed.getMinutes())
      })

      // +5 hours
      const t5 = new Date(earliestAllowed.getTime() + 60 * 60000)
      presets.push({
        label: `+5h (${t5.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })})`,
        time: formatTimeISO(t5.getHours(), t5.getMinutes())
      })

      // +6 hours
      const t6 = new Date(earliestAllowed.getTime() + 120 * 60000)
      presets.push({
        label: `+6h (${t6.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })})`,
        time: formatTimeISO(t6.getHours(), t6.getMinutes())
      })

      // Popular fixed slots that fall after the 4-hour threshold today
      const slots = [
        { label: 'Morning (08:30 AM)', time: '08:30' },
        { label: 'Mid-day (11:30 AM)', time: '11:30' },
        { label: 'Afternoon (02:30 PM)', time: '14:30' },
        { label: 'Evening (06:00 PM)', time: '18:00' },
        { label: 'Night (09:30 PM)', time: '21:30' }
      ]

      slots.forEach(slot => {
        const [sh, sm] = slot.time.split(':').map(Number)
        const slotDate = new Date(earliestAllowed)
        slotDate.setHours(sh, sm, 0, 0)
        if (slotDate.getTime() >= earliestAllowed.getTime()) {
          presets.push(slot)
        }
      })

      return presets
    } else {
      return [
        { label: 'Morning (08:30 AM)', time: '08:30' },
        { label: 'Mid-day (11:30 AM)', time: '11:30' },
        { label: 'Afternoon (02:30 PM)', time: '14:30' },
        { label: 'Evening (06:00 PM)', time: '18:00' },
        { label: 'Night (09:30 PM)', time: '21:30' }
      ]
    }
  }

  // Time Changer Helpers with 4-hour protection
  const handleHourChange = (newHour) => {
    const t = to24h(newHour, minutes, period)
    setSafeDateTime(dateValue || earliestISO, t)
  }

  const handleMinuteChange = (newMin) => {
    const t = to24h(hour12, newMin, period)
    setSafeDateTime(dateValue || earliestISO, t)
  }

  const handlePeriodChange = (newPeriod) => {
    const t = to24h(hour12, minutes, newPeriod)
    setSafeDateTime(dateValue || earliestISO, t)
  }

  // Calendar matrix generator
  const getDaysInMonth = (year, month) => new Date(year, month + 1, 0).getDate()
  const getFirstDayOfMonth = (year, month) => new Date(year, month, 1).getDay()

  const daysInMonth = getDaysInMonth(calYear, calMonth)
  const firstDay = getFirstDayOfMonth(calYear, calMonth)

  const handlePrevMonth = (e) => {
    e.stopPropagation()
    if (calMonth === 0) {
      setCalMonth(11)
      setCalYear(calYear - 1)
    } else {
      setCalMonth(calMonth - 1)
    }
  }

  const handleNextMonth = (e) => {
    e.stopPropagation()
    if (calMonth === 11) {
      setCalMonth(0)
      setCalYear(calYear + 1)
    } else {
      setCalMonth(calMonth + 1)
    }
  }

  const selectCustomDate = (day) => {
    const selected = new Date(calYear, calMonth, day)
    const iso = formatDateISO(selected)
    setSafeDateTime(iso, timeValue || earliestTimeStr)
    setShowCalendar(false)
  }

  // Humanized summary formatting
  const getFormattedSummary = () => {
    if (!dateValue || !timeValue) return { dateDisplay: 'Pick Date', timeDisplay: 'Pick Time', relativeText: '' }
    try {
      const [year, month, day] = dateValue.split('-').map(Number)
      const [h, m] = timeValue.split(':').map(Number)
      const target = new Date(year, month - 1, day, h, m)

      const diffMs = target.getTime() - Date.now()
      const diffMins = Math.round(diffMs / 60000)

      let relativeText = ''
      if (diffMins >= 60 && diffMins < 1440) {
        const hrs = Math.floor(diffMins / 60)
        const remMins = diffMins % 60
        relativeText = `⏱️ In ${hrs} hr${hrs > 1 ? 's' : ''} ${remMins > 0 ? `${remMins}m` : ''}`
      } else if (diffMins >= 1440) {
        const days = Math.floor(diffMins / 1440)
        relativeText = `📅 In ${days} day${days > 1 ? 's' : ''}`
      } else if (diffMins > 0) {
        relativeText = `⏱️ In ${diffMins} min${diffMins > 1 ? 's' : ''}`
      }

      const dateDisplay = target.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric'
      })

      const timeDisplay = target.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      })

      return { dateDisplay, timeDisplay, relativeText }
    } catch {
      return { dateDisplay: dateValue, timeDisplay: timeValue, relativeText: '' }
    }
  }

  const summary = getFormattedSummary()
  const isCustomDateSelected = dateValue && !quickDays.some(d => d.iso === dateValue)

  return (
    <fieldset className="datetime-scheduler full-width">
      <legend className="scheduler-legend">
        <span>Ride Schedule</span>
        <span className="scheduler-badge">Advance Booking (Min. 4 hrs)</span>
      </legend>

      {/* Mode Switcher */}
      <div className="scheduler-mode-tabs">
        <button
          type="button"
          className="scheduler-tab disabled"
          disabled
          title="Instant Ride Now is coming soon"
          aria-disabled="true"
        >
          <span className="tab-icon">⚡</span>
          <span className="tab-text">
            <span className="tab-title-row">
              <strong>Ride Now</strong>
              <span className="tab-coming-soon-badge">Coming Soon</span>
            </span>
          </span>
        </button>
        <button
          type="button"
          className="scheduler-tab active"
          onClick={() => setMode('schedule')}
        >
          <span className="tab-icon">📅</span>
          <span className="tab-text">
            <strong>Schedule Ahead</strong>
            <small>Min. 4 hours in advance</small>
          </span>
        </button>
      </div>

      {/* 4-Hour Notice Guideline Banner */}
      <div className="lead-time-notice">
        <span className="lead-notice-icon">⏱️</span>
        <div className="lead-notice-text">
          <strong>4-Hour Advance Scheduling:</strong> Earliest available pickup is <b>{earliestAllowed.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}</b> ({earliestAllowed.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}).
        </div>
      </div>

      {/* Schedule For Later Controls */}
      <div className="schedule-controls-wrapper">
        {/* 1. Date Selection Section */}
        <div className="scheduler-subpanel">
          <div className="subpanel-header">
            <label className="subpanel-title">
              <span className="subpanel-icon">🗓️</span> Pickup Date
            </label>
            {isCustomDateSelected && (
              <span className="custom-date-tag">Custom: {dateValue}</span>
            )}
          </div>

          <div className="date-chips-grid">
            {quickDays.map((d) => {
              const isSelected = dateValue === d.iso
              return (
                <button
                  key={d.iso}
                  type="button"
                  className={`date-chip ${isSelected ? 'selected' : ''}`}
                  onClick={() => setSafeDateTime(d.iso, timeValue || earliestTimeStr)}
                >
                  <span className="chip-weekday">{d.label}</span>
                  <strong className="chip-daynum">{d.dayNum}</strong>
                  <span className="chip-month">{d.monthShort}</span>
                </button>
              )
            })}

            {/* Custom Date Popover Trigger */}
            <div className="custom-calendar-container" ref={calendarRef}>
              <button
                type="button"
                className={`date-chip custom-chip ${isCustomDateSelected || showCalendar ? 'selected' : ''}`}
                onClick={() => setShowCalendar(!showCalendar)}
                aria-label="Pick custom date"
              >
                <span className="chip-weekday">More</span>
                <span className="custom-cal-icon">📅</span>
                <span className="chip-month">Calendar</span>
              </button>

              {/* Interactive Custom Calendar Popup */}
              {showCalendar && (
                <div className="calendar-popover">
                  <div className="cal-nav">
                    <button type="button" className="cal-nav-btn" onClick={handlePrevMonth}>‹</button>
                    <span className="cal-month-title">
                      {MONTH_NAMES[calMonth]} {calYear}
                    </span>
                    <button type="button" className="cal-nav-btn" onClick={handleNextMonth}>›</button>
                  </div>

                  <div className="cal-grid-header">
                    {DAY_LABELS.map(dl => <span key={dl}>{dl}</span>)}
                  </div>

                  <div className="cal-days-grid">
                    {Array.from({ length: firstDay }).map((_, i) => (
                      <span key={`empty-${i}`} className="cal-day-empty" />
                    ))}

                    {Array.from({ length: daysInMonth }).map((_, i) => {
                      const dayNumber = i + 1
                      const cellDate = new Date(calYear, calMonth, dayNumber)
                      const cellISO = formatDateISO(cellDate)
                      const isPast = cellISO < earliestISO
                      const isSelected = dateValue === cellISO
                      const isToday = cellISO === formatDateISO(now)

                      return (
                        <button
                          key={dayNumber}
                          type="button"
                          disabled={isPast}
                          className={`cal-day-btn ${isSelected ? 'selected' : ''} ${isToday ? 'today' : ''} ${isPast ? 'disabled' : ''}`}
                          onClick={() => selectCustomDate(dayNumber)}
                        >
                          {dayNumber}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 2. Time Selection Section */}
        <div className="scheduler-subpanel">
          <div className="subpanel-header">
            <label className="subpanel-title">
              <span className="subpanel-icon">⏰</span> Pickup Time
            </label>
            <span className="current-time-badge">{summary.timeDisplay}</span>
          </div>

          {/* Quick Time Preset Pills */}
          <div className="time-presets-scroller">
            {getQuickTimePresets().map((preset, idx) => (
              <button
                key={idx}
                type="button"
                className={`time-preset-pill ${timeValue === preset.time ? 'active' : ''}`}
                onClick={() => setSafeDateTime(dateValue || earliestISO, preset.time)}
              >
                {preset.label}
              </button>
            ))}
          </div>

          {/* Tactile Precise Time Controller */}
          <div className="tactile-time-box">
            <div className="time-dial-col">
              <span className="dial-label">Hour</span>
              <select
                className="time-select"
                value={hour12}
                onChange={(e) => handleHourChange(Number(e.target.value))}
              >
                {Array.from({ length: 12 }, (_, i) => i + 1).map(h => (
                  <option key={h} value={h}>{pad(h)}</option>
                ))}
              </select>
            </div>

            <div className="time-dial-col time-separator-col">
              <span className="dial-label">&nbsp;</span>
              <span className="time-colon">:</span>
            </div>

            <div className="time-dial-col">
              <span className="dial-label">Minute</span>
              <select
                className="time-select"
                value={Math.floor(minutes / 5) * 5}
                onChange={(e) => handleMinuteChange(Number(e.target.value))}
              >
                {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map(m => (
                  <option key={m} value={m}>{pad(m)}</option>
                ))}
              </select>
            </div>

            <div className="time-dial-col time-period-col">
              <span className="dial-label">Period</span>
              <div className="period-toggle-group">
                <button
                  type="button"
                  className={`period-btn ${period === 'AM' ? 'active' : ''}`}
                  onClick={() => handlePeriodChange('AM')}
                >
                  AM
                </button>
                <button
                  type="button"
                  className={`period-btn ${period === 'PM' ? 'active' : ''}`}
                  onClick={() => handlePeriodChange('PM')}
                >
                  PM
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 3. Luxury Live Summary Preview Card */}
      <div className="scheduler-summary-card">
        <div className="summary-left">
          <div className="summary-check-icon">✓</div>
          <div className="summary-details">
            <div className="summary-label">Selected Timing</div>
            <div className="summary-datetime-line">
              <span className="highlight-date">{summary.dateDisplay}</span>
              <span className="summary-dot">•</span>
              <span className="highlight-time">{summary.timeDisplay}</span>
            </div>
          </div>
        </div>
        {summary.relativeText && (
          <span className="summary-countdown-pill">{summary.relativeText}</span>
        )}
      </div>
    </fieldset>
  )
}
