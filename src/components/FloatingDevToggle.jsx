import React, { useState, useEffect, useRef } from 'react'
import { auth } from '../database'

export default function FloatingDevToggle({ currentRole }) {
  const isDriver = currentRole === 'driver'
  const nextRole = isDriver ? 'rider' : 'driver'

  // Position state (defaults to bottom right corner)
  const [position, setPosition] = useState(() => ({
    x: window.innerWidth ? Math.max(16, window.innerWidth - 180) : 220,
    y: window.innerHeight ? Math.max(80, window.innerHeight - 90) : 600
  }))

  // Dimming opacity state after idle
  const [isDimmed, setIsDimmed] = useState(false)
  const idleTimerRef = useRef(null)

  // Dragging state
  const isDraggingRef = useRef(false)
  const dragStartPos = useRef({ x: 0, y: 0 })
  const elementStartPos = useRef({ x: 0, y: 0 })
  const hasMovedRef = useRef(false)
  const buttonRef = useRef(null)

  // Auto-dimming timer (fades out after 3.2s of inactivity)
  const wakeUp = () => {
    setIsDimmed(false)
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
    idleTimerRef.current = setTimeout(() => {
      setIsDimmed(true)
    }, 3200)
  }

  useEffect(() => {
    wakeUp()
    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
    }
  }, [])

  // Drag handlers using Pointer Events
  const handlePointerDown = (e) => {
    isDraggingRef.current = true
    hasMovedRef.current = false
    dragStartPos.current = { x: e.clientX, y: e.clientY }
    elementStartPos.current = { ...position }
    buttonRef.current?.setPointerCapture(e.pointerId)
    wakeUp()
  }

  const handlePointerMove = (e) => {
    if (!isDraggingRef.current) return
    const dx = e.clientX - dragStartPos.current.x
    const dy = e.clientY - dragStartPos.current.y

    if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
      hasMovedRef.current = true
    }

    const btnWidth = buttonRef.current?.offsetWidth || 150
    const btnHeight = buttonRef.current?.offsetHeight || 44

    const maxX = window.innerWidth - btnWidth - 10
    const maxY = window.innerHeight - btnHeight - 10

    const nextX = Math.min(Math.max(10, elementStartPos.current.x + dx), maxX)
    const nextY = Math.min(Math.max(10, elementStartPos.current.y + dy), maxY)

    setPosition({ x: nextX, y: nextY })
    wakeUp()
  }

  const handlePointerUp = (e) => {
    if (!isDraggingRef.current) return
    isDraggingRef.current = false
    try {
      buttonRef.current?.releasePointerCapture(e.pointerId)
    } catch {}

    // If it was a tap (not dragged), execute toggle
    if (!hasMovedRef.current) {
      auth.devLogin(nextRole)
    }
    wakeUp()
  }

  return (
    <div
      ref={buttonRef}
      className={`floating-dev-toggle ${isDimmed ? 'dimmed' : 'active'} ${isDriver ? 'to-rider' : 'to-driver'}`}
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onMouseEnter={wakeUp}
      onTouchStart={wakeUp}
      role="button"
      tabIndex={0}
      title={`DEV Toggle: Click to switch to ${isDriver ? 'Rider' : 'Driver'} (Drag to move)`}
    >
      <span className="dev-drag-handle" aria-hidden="true">⠿</span>
      <span className="dev-badge-icon">{isDriver ? '🧑' : '🚗'}</span>
      <span className="dev-toggle-text">
        {isDriver ? 'Switch to Rider' : 'Switch to Driver'}
      </span>
    </div>
  )
}
