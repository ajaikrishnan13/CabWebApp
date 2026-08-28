import React, { useEffect, useState } from 'react'
import { auth, supabaseConfigured } from './database'
import AuthPage from './pages/Auth'
import Home from './pages/Home'

export default function App() {
  const [user, setUser] = useState(null)
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    const unsub = auth.subscribe((u) => {
      setUser(u)
      setChecking(false)
    })
    return () => unsub()
  }, [])

  if (!supabaseConfigured) return <div className="center"><p>Supabase is not configured. Add `.env` from `.env.example` and restart the app.</p></div>
  if (checking) return <div className="center">Loading...</div>

  return user ? <Home user={user} /> : <AuthPage />
}
