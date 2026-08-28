import React, { useState } from 'react'
import { auth } from '../database'
import logo from '../assets/logo.png'

const getAuthError = (error) => {
  if (error.message?.toLowerCase().includes('rate limit')) {
    return 'Supabase has temporarily rate-limited email requests. Wait until the limit resets, then try again. Do not repeatedly submit this form. For development, keep Email provider ON and Confirm email OFF.'
  }
  return error.message || 'Authentication failed. Please try again.'
}

export default function AuthPage() {
  const [isLogin, setIsLogin] = useState(true)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  const toggle = () => {
    setError(null)
    setIsLogin(!isLogin)
  }

  const handleRegister = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      await auth.register(name, email, password)
    } catch (err) {
      setError(getAuthError(err))
    } finally {
      setLoading(false)
    }
  }

  const handleLogin = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      await auth.login(email, password)
    } catch (err) {
      setError(getAuthError(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="auth-screen">
      <div className="auth-hero-brand">
        <img src={logo} alt="Namma Driver logo" className="auth-hero-logo" />
      </div>
      <div className="auth-panel">
        <div className="auth-intro">
          <span className="eyebrow">Exclusively Yours</span>
          <h2>{isLogin ? 'Welcome back' : 'Join the ride'}</h2>
          <p>{isLogin ? 'Sign in to continue with your booking.' : 'Create your account to book a ride.'}</p>
        </div>

        {isLogin ? (
          <form onSubmit={handleLogin} className="form auth-form">
            <label className="auth-field">Email address
              <input required type="email" placeholder="you@example.com" value={email} onChange={e=>setEmail(e.target.value)} />
            </label>
            <label className="auth-field">Password
              <input required type="password" placeholder="Enter your password" value={password} onChange={e=>setPassword(e.target.value)} />
            </label>
            <button type="submit" disabled={loading} className="btn primary-action">{loading? 'Signing in...' : 'Sign in'}</button>
            {error && <div className="err">{error}</div>}
            <p className="auth-switch">New here? <button type="button" className="link" onClick={toggle}>Create an account</button></p>
          </form>
        ) : (
          <form onSubmit={handleRegister} className="form auth-form">
            <label className="auth-field">Full name
              <input required type="text" placeholder="Your name" value={name} onChange={e=>setName(e.target.value)} />
            </label>
            <label className="auth-field">Email address
              <input required type="email" placeholder="you@example.com" value={email} onChange={e=>setEmail(e.target.value)} />
            </label>
            <label className="auth-field">Password
              <input required minLength={6} type="password" placeholder="At least 6 characters" value={password} onChange={e=>setPassword(e.target.value)} />
            </label>
            <button type="submit" disabled={loading} className="btn primary-action">{loading? 'Creating account...' : 'Create account'}</button>
            {error && <div className="err">{error}</div>}
            <p className="auth-switch">Already have an account? <button type="button" className="link" onClick={toggle}>Sign in</button></p>
          </form>
        )}

      </div>
      <p className="auth-footnote">Simple booking. Thoughtful travel.</p>
    </main>
  )
}
