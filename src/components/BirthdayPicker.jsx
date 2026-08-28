import React, { useState, useEffect, useRef } from 'react'

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
]
const MONTH_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
]
const DAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

function pad(n) {
  return n.toString().padStart(2, '0')
}

export default function BirthdayPicker({ value, onChange }) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef(null)

  const currentYear = new Date().getFullYear()

  // Parse initial value or default to reasonable adult year (~25 years ago)
  const initialDate = value ? new Date(value) : new Date(currentYear - 25, 0, 1)
  const [calYear, setCalYear] = useState(!isNaN(initialDate.getTime()) ? initialDate.getFullYear() : currentYear - 25)
  const [calMonth, setCalMonth] = useState(!isNaN(initialDate.getTime()) ? initialDate.getMonth() : 0)

  // Update internal calendar view if value changes externally
  useEffect(() => {
    if (value) {
      const d = new Date(value)
      if (!isNaN(d.getTime())) {
        setCalYear(d.getFullYear())
        setCalMonth(d.getMonth())
      }
    }
  }, [value])

  // Close popover when clicking outside
  useEffect(() => {
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false)
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

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

  const handleSelectDay = (day) => {
    const iso = `${calYear}-${pad(calMonth + 1)}-${pad(day)}`
    onChange(iso)
    setOpen(false)
  }

  const handleClear = (e) => {
    e.stopPropagation()
    onChange('')
  }

  // Format date display
  const getDisplayValue = () => {
    if (!value) return ''
    try {
      const [y, m, d] = value.split('-').map(Number)
      const dateObj = new Date(y, m - 1, d)
      if (isNaN(dateObj.getTime())) return value
      return dateObj.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      })
    } catch {
      return value
    }
  }

  // Generate Year options from 1930 to currentYear
  const years = []
  for (let y = currentYear; y >= 1930; y--) {
    years.push(y)
  }

  return (
    <div className="birthday-picker-field" ref={containerRef}>
      <span className="field-label-text">Birthday</span>

      <div
        className={`birthday-input-trigger ${open ? 'focused' : ''} ${value ? 'has-value' : ''}`}
        onClick={() => setOpen(!open)}
        role="button"
        tabIndex={0}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <div className="trigger-left">
          <span className="trigger-icon" aria-hidden="true">🎂</span>
          <span className="trigger-text">
            {value ? getDisplayValue() : <span className="placeholder-text">Select your birthday</span>}
          </span>
        </div>

        <div className="trigger-right">
          {value && (
            <button
              type="button"
              className="btn-clear-date"
              onClick={handleClear}
              title="Clear date"
              aria-label="Clear date"
            >
              ✕
            </button>
          )}
          <span className="trigger-arrow">{open ? '▲' : '▼'}</span>
        </div>
      </div>

      {open && (
        <div className="birthday-popover" role="dialog" aria-label="Choose birthday">
          {/* Header with Year and Month Jump Selectors */}
          <div className="bday-nav-bar">
            <button type="button" className="cal-nav-btn" onClick={handlePrevMonth} title="Previous Month">‹</button>

            <div className="bday-selects-group">
              <select
                className="bday-select bday-month-select"
                value={calMonth}
                onChange={(e) => setCalMonth(Number(e.target.value))}
                onClick={(e) => e.stopPropagation()}
              >
                {MONTH_NAMES.map((m, idx) => (
                  <option key={m} value={idx}>{m}</option>
                ))}
              </select>

              <select
                className="bday-select bday-year-select"
                value={calYear}
                onChange={(e) => setCalYear(Number(e.target.value))}
                onClick={(e) => e.stopPropagation()}
              >
                {years.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>

            <button type="button" className="cal-nav-btn" onClick={handleNextMonth} title="Next Month">›</button>
          </div>

          {/* Weekday labels */}
          <div className="bday-grid-header">
            {DAY_LABELS.map((d) => (
              <span key={d}>{d}</span>
            ))}
          </div>

          {/* Days Grid */}
          <div className="bday-days-grid">
            {Array.from({ length: firstDay }).map((_, i) => (
              <span key={`empty-${i}`} className="cal-day-empty" />
            ))}

            {Array.from({ length: daysInMonth }).map((_, i) => {
              const dayNumber = i + 1
              const cellISO = `${calYear}-${pad(calMonth + 1)}-${pad(dayNumber)}`
              const isSelected = value === cellISO
              const todayISO = new Date().toISOString().split('T')[0]
              const isFuture = cellISO > todayISO

              return (
                <button
                  key={dayNumber}
                  type="button"
                  disabled={isFuture}
                  className={`bday-day-btn ${isSelected ? 'selected' : ''} ${isFuture ? 'disabled' : ''}`}
                  onClick={() => handleSelectDay(dayNumber)}
                >
                  {dayNumber}
                </button>
              )
            })}
          </div>

          {/* Quick Year Jump Chips */}
          <div className="bday-quick-decades">
            <span className="quick-label">Decade:</span>
            {[2000, 1990, 1980, 1970].map((dec) => (
              <button
                key={dec}
                type="button"
                className={`decade-chip ${calYear >= dec && calYear < dec + 10 ? 'active' : ''}`}
                onClick={(e) => {
                  e.stopPropagation()
                  setCalYear(dec + 5)
                }}
              >
                {dec}s
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
