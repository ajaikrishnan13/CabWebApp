import React, { useEffect, useState } from 'react'
import { auth, database, supabaseConfigured } from './database'
import AuthPage from './pages/Auth'
import Home from './pages/Home'
import DriverHome from './pages/DriverHome'
import FloatingDevToggle from './components/FloatingDevToggle'

export default function App() {
  const [user, setUser] = useState(null)
  const [userRole, setUserRole] = useState(null)
  const [checking, setChecking] = useState(true)

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
      setChecking(false)
    })
    return () => unsub()
  }, [])

  const handleSignOut = async () => {
    setUser(null)
    setUserRole(null)
    await auth.signOut()
  }

  if (!supabaseConfigured) return <div className="center"><p>Supabase is not configured. Add `.env` from `.env.example` and restart the app.</p></div>
  if (checking) return <div className="center">Loading...</div>

  if (!user) return <AuthPage />

  return (
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
  )
}

