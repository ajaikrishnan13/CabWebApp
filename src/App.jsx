import React, { useEffect, useState } from 'react'
import { auth, database, databaseConfigured } from './database'
import AuthPage from './pages/Auth'
import Home from './pages/Home'
import DriverHome from './pages/DriverHome'
import FloatingDevToggle from './components/FloatingDevToggle'

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }
  componentDidCatch(error, errorInfo) {
    console.error('App caught unhandled runtime error:', error, errorInfo)
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '30px', color: '#f8fafc', background: '#0f172a', minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', gap: '16px' }}>
          <h2 style={{ margin: 0, fontSize: '20px' }}>Something went wrong</h2>
          <p style={{ color: '#94a3b8', maxWidth: '380px', margin: 0, fontSize: '13px' }}>{this.state.error?.message || 'An unexpected error occurred while loading this view.'}</p>
          <button style={{ background: '#0284c7', color: '#ffffff', border: 'none', padding: '10px 22px', borderRadius: '10px', cursor: 'pointer', fontWeight: 'bold', fontSize: '14px' }} onClick={() => { try { localStorage.removeItem('cab_dev_user'); } catch {} window.location.reload() }}>
            Reload Application
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

export default function App() {
  // Synchronously initialize user from local session for instant 0ms load
  const [user, setUser] = useState(() => {
    try {
      const devStr = localStorage.getItem('cab_dev_user')
      if (devStr) return JSON.parse(devStr)
    } catch {}
    return null
  })

  const [userRole, setUserRole] = useState(() => {
    try {
      const devStr = localStorage.getItem('cab_dev_user')
      if (devStr) {
        const u = JSON.parse(devStr)
        return u.user_metadata?.role || 'rider'
      }
    } catch {}
    return null
  })

  useEffect(() => {
    const unsub = auth.subscribe(async (u) => {
      setUser(u)
      if (u) {
        let role = u.user_metadata?.role || null
        if (!role) {
          try {
            const prof = await database.getProfile(u.id)
            role = prof?.role || 'rider'
          } catch {
            role = 'rider'
          }
        }
        setUserRole(role)
      } else {
        setUserRole(null)
      }
    })

    return () => unsub()
  }, [])

  const handleSignOut = async () => {
    setUser(null)
    setUserRole(null)
    try {
      localStorage.removeItem('cab_dev_user')
    } catch {}
    await auth.signOut()
  }

  if (!databaseConfigured) {
    return (
      <div className="center" style={{ color: '#f8fafc', background: '#0f172a', minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <p>Internal database is initializing. Please wait...</p>
      </div>
    )
  }

  return (
    <ErrorBoundary>
      {!user ? (
        <AuthPage />
      ) : (
        <>
          {userRole === 'driver' ? (
            <DriverHome user={user} onSignOut={handleSignOut} />
          ) : (
            <Home user={user} onSignOut={handleSignOut} />
          )}
          {user?.id?.startsWith('dev_') && (
            <FloatingDevToggle currentRole={userRole} />
          )}
        </>
      )}
    </ErrorBoundary>
  )
}
