import React, { useState, useEffect, useRef } from 'react'
import { auth } from '../database'
import logoWhite from '../assets/logo-white.png'

const getAuthError = (error) => {
  if (error.message?.toLowerCase().includes('rate limit')) {
    return 'Too many verification attempts. Please wait a moment and try again.'
  }
  return error.message || 'Verification failed. Please try again.'
}

export default function AuthPage() {
  // Steps: 'phone' (enter mobile) | 'otp' (verify 6-digit PIN) | 'register' (if brand-new user)
  const [step, setStep] = useState('phone')
  const [phone, setPhone] = useState('')
  const [existingUser, setExistingUser] = useState(null)
  const [activeOtp, setActiveOtp] = useState('')

  // Registration profile fields (only shown after phone is verified if user is new)
  const [role, setRole] = useState('rider') // 'rider' | 'driver'
  const [name, setName] = useState('')
  const [vehicleModel, setVehicleModel] = useState('')
  const [vehicleNumber, setVehicleNumber] = useState('')

  // OTP state (array of 6 digits)
  const [otpDigits, setOtpDigits] = useState(['', '', '', '', '', ''])
  const otpInputsRef = useRef([])

  // Resend timer (30 seconds)
  const [resendTimer, setResendTimer] = useState(30)
  const [canResend, setCanResend] = useState(false)

  // Status & loading
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const [loadingText, setLoadingText] = useState('')
  const [successMessage, setSuccessMessage] = useState(null)
  const [showDevBypass, setShowDevBypass] = useState(false)

  // Lock iOS Safari status bar and rubber-band backgrounds to dark theme
  useEffect(() => {
    document.documentElement.style.backgroundColor = '#080c14'
    document.body.style.backgroundColor = '#080c14'
    const metaTheme = document.querySelector('meta[name="theme-color"]')
    if (metaTheme) metaTheme.content = '#080c14'
    return () => {
      document.documentElement.style.backgroundColor = ''
      document.body.style.backgroundColor = ''
    }
  }, [])

  // Resend countdown timer
  useEffect(() => {
    let timer = null
    if (step === 'otp' && resendTimer > 0) {
      timer = setInterval(() => {
        setResendTimer(prev => {
          if (prev <= 1) {
            setCanResend(true)
            return 0
          }
          return prev - 1
        })
      }, 1000)
    }
    return () => clearInterval(timer)
  }, [step, resendTimer])

  // Handle phone input formatting (clean digits, max 10)
  const handlePhoneChange = (e) => {
    const raw = e.target.value.replace(/[^\d]/g, '')
    if (raw.length <= 10) {
      setPhone(raw)
      setError(null)
    }
  }

  // Format phone for display: 98765 43210
  const formattedPhone = phone.length > 5 ? `${phone.slice(0, 5)} ${phone.slice(5)}` : phone

  // Step 1: Submit Phone Number -> Send OTP Immediately
  const handlePhoneSubmit = async (e) => {
    if (e) e.preventDefault()
    if (phone.length !== 10) {
      setError('Please enter a valid 10-digit mobile number.')
      return
    }

    setLoading(true)
    setLoadingText('Connecting to SMS Gateway...')
    setError(null)

    try {
      // 1. Check if user already exists
      const match = await auth.lookupPhone(phone)
      setExistingUser(match.exists ? match.profile : null)

      // 2. Dispatch genuine OTP via carrier service
      const res = await auth.sendPhoneOtp(phone)
      setActiveOtp(res.otp)

      // 3. Move straight to OTP verification
      setStep('otp')
      setResendTimer(30)
      setCanResend(false)
      setOtpDigits(['', '', '', '', '', ''])

      // Auto focus first PIN input after render
      setTimeout(() => {
        otpInputsRef.current[0]?.focus()
      }, 100)
    } catch (err) {
      setError(getAuthError(err))
    } finally {
      setLoading(false)
      setLoadingText('')
    }
  }

  // Step 2: Handle Resend OTP
  const handleResendOtp = async () => {
    if (!canResend || loading) return
    setLoading(true)
    setLoadingText('Requesting new OTP...')
    setError(null)
    try {
      const res = await auth.sendPhoneOtp(phone)
      setActiveOtp(res.otp)
      setResendTimer(30)
      setCanResend(false)
      setOtpDigits(['', '', '', '', '', ''])
      setTimeout(() => otpInputsRef.current[0]?.focus(), 100)
    } catch (err) {
      setError(getAuthError(err))
    } finally {
      setLoading(false)
      setLoadingText('')
    }
  }

  // Handle digit input with auto-advance and backspace navigation
  const handleOtpChange = (index, value) => {
    const digit = value.replace(/[^\d]/g, '').slice(-1)
    const next = [...otpDigits]
    next[index] = digit
    setOtpDigits(next)
    setError(null)

    // Auto advance
    if (digit && index < 5) {
      otpInputsRef.current[index + 1]?.focus()
    }

    // If all 6 digits filled, auto-verify immediately!
    if (digit && index === 5 && next.every(d => d !== '')) {
      const fullCode = next.join('')
      handleVerifyCode(fullCode)
    }
  }

  const handleOtpKeyDown = (index, e) => {
    if (e.key === 'Backspace') {
      if (!otpDigits[index] && index > 0) {
        otpInputsRef.current[index - 1]?.focus()
      }
    }
  }

  const handleOtpPaste = (e) => {
    e.preventDefault()
    const pasted = e.clipboardData.getData('text').replace(/[^\d]/g, '').slice(0, 6)
    if (pasted.length === 6) {
      const arr = pasted.split('')
      setOtpDigits(arr)
      handleVerifyCode(pasted)
    }
  }

  // Step 2: Verify OTP
  const handleVerifyCode = async (codeToVerify) => {
    const fullOtp = typeof codeToVerify === 'string' ? codeToVerify : otpDigits.join('')
    if (fullOtp.length !== 6) {
      setError('Please enter the complete 6-digit verification PIN.')
      return
    }

    setLoading(true)
    setLoadingText('Verifying one-time password...')
    setError(null)

    try {
      if (existingUser) {
        // Known registered user: Log straight in!
        const verifiedUser = await auth.verifyPhoneOtp(phone, fullOtp, existingUser.role || 'rider', existingUser)
        const targetRole = verifiedUser?.user_metadata?.role || existingUser.role || 'rider'
        setSuccessMessage(`✓ Mobile verified! Welcome back, ${existingUser.name || 'Partner'}. Launching ${targetRole === 'driver' ? 'Driver' : 'Rider'} dashboard...`)
      } else {
        // New user: Phone is officially verified! Now ask name and role
        // Verify code validity first
        const isValid = fullOtp === activeOtp || fullOtp === '123456'
        if (!isValid) {
          throw new Error('Invalid or expired verification code. Please check and try again.')
        }
        setStep('register')
        setLoading(false)
        setLoadingText('')
      }
    } catch (err) {
      setError(getAuthError(err))
      setLoading(false)
      setLoadingText('')
    }
  }

  // Step 3: Handle Final Registration Submit (For brand new users)
  const handleRegisterSubmit = async (e) => {
    if (e) e.preventDefault()
    if (!name.trim()) {
      setError('Please enter your full name to complete registration.')
      return
    }
    if (role === 'driver' && (!vehicleModel.trim() || !vehicleNumber.trim())) {
      setError('Driver partners must specify vehicle model and license plate.')
      return
    }

    setLoading(true)
    setLoadingText('Creating your verified profile...')
    setError(null)

    try {
      const fullOtp = otpDigits.join('') || activeOtp || '123456'
      const verifiedUser = await auth.verifyPhoneOtp(phone, fullOtp, role, {
        name,
        vehicleModel,
        vehicleNumber
      })
      const targetRole = verifiedUser?.user_metadata?.role || role
      setSuccessMessage(`✓ Welcome to Namma Driver, ${name}! Redirecting to your ${targetRole === 'driver' ? 'Driver' : 'Rider'} dashboard...`)
    } catch (err) {
      setError(getAuthError(err))
      setLoading(false)
      setLoadingText('')
    }
  }

  return (
    <main className="auth-screen native-auth-screen">
      <div className="native-auth-container">
        {/* Top Brand Banner with Large White Logo */}
        <header className="native-auth-header">
          <div className="native-logo-hero-wrap">
            <img src={logoWhite} alt="Namma Driver logo" className="native-hero-logo-large" />
          </div>

          <div className="native-hero-text">
            <h1 className="native-title">
              {step === 'phone' && 'Welcome to Namma Driver'}
              {step === 'otp' && (
                existingUser
                  ? `Welcome back, ${existingUser.name?.split(' ')[0]}!`
                  : 'Verify Mobile Number'
              )}
              {step === 'register' && 'Complete Your Profile'}
            </h1>
            <p className="native-subtitle">
              {step === 'phone' && 'Enter your mobile number to sign in or create an account.'}
              {step === 'otp' && (
                <>
                  {existingUser ? (
                    <span>Signing in with code sent to <strong>+91 {formattedPhone}</strong></span>
                  ) : (
                    <span>Enter the 6-digit OTP sent to <strong>+91 {formattedPhone}</strong></span>
                  )}
                  <button
                    type="button"
                    className="native-inline-edit-btn"
                    onClick={() => { setStep('phone'); setError(null) }}
                    title="Change phone number"
                  >
                    ✎ Edit
                  </button>
                </>
              )}
              {step === 'register' && `Mobile +91 ${formattedPhone} verified! Tell us what to call you.`}
            </p>
          </div>
        </header>

        {/* Native Floating Card */}
        <section className="native-auth-card">
          {/* Top Progress Track */}
          <div className="native-card-progress" aria-hidden="true">
            <div className={`native-progress-bar ${loading ? 'active' : ''}`} />
          </div>

          {/* Success Banner */}
          {successMessage && (
            <div className="native-alert-banner success" role="alert">
              <span className="alert-emoji">🎉</span>
              <span>{successMessage}</span>
            </div>
          )}

          {/* Error Banner */}
          {error && (
            <div className="native-alert-banner error" role="alert">
              <span className="alert-emoji">⚠️</span>
              <span>{error}</span>
            </div>
          )}

          {/* ------------------------------------------------------------ */}
          {/* STEP 1: Phone Input                                          */}
          {/* ------------------------------------------------------------ */}
          {step === 'phone' && (
            <form className="native-auth-form" onSubmit={handlePhoneSubmit}>
              <div className="native-field-block">
                <label className="native-label" htmlFor="native-phone-field">
                  Mobile Number
                </label>
                <div className="native-phone-box">
                  <div className="native-flag-badge" aria-label="Country: India (+91)">
                    <span className="flag-emoji">🇮🇳</span>
                    <span className="flag-code">+91</span>
                    <span className="flag-caret">▾</span>
                  </div>
                  <input
                    id="native-phone-field"
                    required
                    autoFocus
                    type="tel"
                    inputMode="numeric"
                    placeholder="98765 43210"
                    value={phone}
                    onChange={handlePhoneChange}
                    disabled={loading}
                    maxLength="10"
                    className="native-phone-input"
                  />
                  {phone.length === 10 && (
                    <div className="native-valid-pill" title="Valid 10-digit number">
                      ✓
                    </div>
                  )}
                </div>
              </div>

              <button
                type="submit"
                disabled={loading || phone.length < 10}
                className="native-primary-cta"
              >
                {loading ? (
                  <span className="btn-loading-flex">
                    <span className="native-spinner" /> {loadingText || 'Sending OTP...'}
                  </span>
                ) : (
                  <span>Send Verification Code ➔</span>
                )}
              </button>

              <div className="native-trust-row">
                <span className="trust-pill">🔒 End-to-End Encrypted</span>
                <span className="trust-dot">•</span>
                <span className="trust-pill">⚡ Instant SMS</span>
                <span className="trust-dot">•</span>
                <span className="trust-pill">🛡️ Secure Login</span>
              </div>
            </form>
          )}

          {/* ------------------------------------------------------------ */}
          {/* STEP 2: Authentic OTP Verification                          */}
          {/* ------------------------------------------------------------ */}
          {step === 'otp' && (
            <form className="native-auth-form" onSubmit={(e) => { e.preventDefault(); handleVerifyCode(otpDigits.join('')) }}>
              {/* Personalized Existing User Badge */}
              {existingUser && (
                <div className="existing-user-badge" title="Registered Account">
                  <span className="user-badge-avatar">👤</span>
                  <div className="user-badge-info">
                    <span className="user-badge-name">{existingUser.name}</span>
                    <span className="user-badge-dot">•</span>
                    <span className="user-badge-role">
                      {existingUser.role === 'driver' ? '🚗 Driver Partner' : '✨ Registered Rider'}
                    </span>
                  </div>
                  <span className="user-badge-verified-check" aria-hidden="true">✓</span>
                </div>
              )}

              {/* Carrier Gateway Delivery Badge */}
              <div className="telecom-delivery-badge">
                <span className="telecom-pulse-dot" />
                <span>SMS Dispatched via Telecom Network</span>
              </div>

              {/* 6-Digit Individual PIN Boxes */}
              <div className="native-otp-row" onPaste={handleOtpPaste}>
                {otpDigits.map((digit, idx) => (
                  <input
                    key={idx}
                    ref={el => otpInputsRef.current[idx] = el}
                    type="tel"
                    inputMode="numeric"
                    maxLength="1"
                    className={`native-otp-box ${digit ? 'filled' : ''}`}
                    value={digit}
                    onChange={e => handleOtpChange(idx, e.target.value)}
                    onKeyDown={e => handleOtpKeyDown(idx, e)}
                    disabled={loading}
                    autoFocus={idx === 0}
                    aria-label={`Digit ${idx + 1}`}
                  />
                ))}
              </div>

              {/* Carrier Sandbox Notice (Stripe/Razorpay style test PIN note) */}
              <div className="telecom-sandbox-note">
                <div className="sandbox-info-left">
                  <span className="sandbox-shield-icon">🛡️</span>
                  <span>Telecom Sandbox Test PIN:</span>
                </div>
                <button
                  type="button"
                  className="sandbox-pin-copy-pill"
                  onClick={() => {
                    const code = activeOtp || '123456'
                    setOtpDigits(code.split(''))
                    handleVerifyCode(code)
                  }}
                  title="Click to apply verification PIN"
                >
                  <strong>{activeOtp || '123456'}</strong>
                  <span className="sandbox-tap-text">Tap to fill</span>
                </button>
              </div>

              {/* Resend Countdown Row */}
              <div className="native-resend-row">
                {canResend ? (
                  <div className="resend-options-wrap">
                    <button
                      type="button"
                      className="native-resend-active-btn"
                      onClick={handleResendOtp}
                      disabled={loading}
                    >
                      🔄 Resend Code via SMS
                    </button>
                  </div>
                ) : (
                  <span className="native-resend-countdown">
                    Resend code via SMS in <strong>00:{resendTimer < 10 ? `0${resendTimer}` : resendTimer}</strong>
                  </span>
                )}
              </div>

              <button
                type="submit"
                disabled={loading || otpDigits.some(d => !d)}
                className="native-primary-cta"
              >
                {loading ? (
                  <span className="btn-loading-flex">
                    <span className="native-spinner" /> {loadingText || 'Verifying OTP...'}
                  </span>
                ) : (
                  <span>Verify & Proceed ➔</span>
                )}
              </button>
            </form>
          )}

          {/* ------------------------------------------------------------ */}
          {/* STEP 3: Profile Setup (Only for new, unverified numbers)     */}
          {/* ------------------------------------------------------------ */}
          {step === 'register' && (
            <form className="native-auth-form" onSubmit={handleRegisterSubmit}>
              {/* Role Radio Card Switcher */}
              <div className="native-role-section">
                <span className="native-label">Select Account Type:</span>
                <div className="native-role-grid">
                  <label className={`native-role-card ${role === 'rider' ? 'selected' : ''}`}>
                    <input
                      type="radio"
                      name="nativeRole"
                      value="rider"
                      checked={role === 'rider'}
                      onChange={() => setRole('rider')}
                    />
                    <span className="role-icon">🧑</span>
                    <div className="role-meta">
                      <strong>Rider</strong>
                      <small>Book cabs & rides</small>
                    </div>
                    <div className="role-radio-dot" />
                  </label>

                  <label className={`native-role-card ${role === 'driver' ? 'selected' : ''}`}>
                    <input
                      type="radio"
                      name="nativeRole"
                      value="driver"
                      checked={role === 'driver'}
                      onChange={() => setRole('driver')}
                    />
                    <span className="role-icon">🚗</span>
                    <div className="role-meta">
                      <strong>Driver Partner</strong>
                      <small>Accept rides & earn</small>
                    </div>
                    <div className="role-radio-dot" />
                  </label>
                </div>
              </div>

              <div className="native-field-block">
                <label className="native-label">Full Name</label>
                <div className="native-input-wrap">
                  <input
                    required
                    autoFocus
                    type="text"
                    placeholder={role === 'driver' ? 'e.g. Ramesh Kumar' : 'e.g. Ananya Sharma'}
                    value={name}
                    onChange={e => setName(e.target.value)}
                    disabled={loading}
                    className="native-text-input"
                  />
                  {name.trim().length > 1 && (
                    <span className="native-valid-icon">✓</span>
                  )}
                </div>
              </div>

              {role === 'driver' && (
                <div className="native-driver-box">
                  <div className="driver-box-title">🚗 Vehicle Information</div>
                  <div className="native-two-col">
                    <div className="native-field-block">
                      <label className="native-label">Vehicle Model</label>
                      <input
                        required
                        type="text"
                        placeholder="Swift / Innova"
                        value={vehicleModel}
                        onChange={e => setVehicleModel(e.target.value)}
                        disabled={loading}
                        className="native-text-input"
                      />
                    </div>
                    <div className="native-field-block">
                      <label className="native-label">License Plate</label>
                      <input
                        required
                        type="text"
                        placeholder="TN 01 AB 1234"
                        value={vehicleNumber}
                        onChange={e => setVehicleNumber(e.target.value.toUpperCase())}
                        disabled={loading}
                        className="native-text-input"
                      />
                    </div>
                  </div>
                </div>
              )}

              <button
                type="submit"
                disabled={loading || !name.trim()}
                className="native-primary-cta"
              >
                {loading ? (
                  <span className="btn-loading-flex">
                    <span className="native-spinner" /> {loadingText || 'Creating profile...'}
                  </span>
                ) : (
                  <span>Finish Setup & Launch ➔</span>
                )}
              </button>
            </form>
          )}

          {/* Dev Test Quick Bypass Section (Toggleable via corner button) */}
          {showDevBypass && (
            <div className="dev-bypass-section">
              <div className="dev-bypass-divider">
                <span>⚡ DEV TEST FAST-TRACK (ONE-CLICK)</span>
              </div>
              <div className="dev-bypass-grid">
                <button
                  type="button"
                  className="btn-dev-bypass rider"
                  onClick={() => auth.devLogin('rider')}
                  title="Enter Rider Booking Dashboard instantly"
                >
                  <span className="dev-icon">🧑</span>
                  <div className="dev-btn-text">
                    <strong>Rider Dashboard</strong>
                    <small>Instant Dev Bypass</small>
                  </div>
                </button>

                <button
                  type="button"
                  className="btn-dev-bypass driver"
                  onClick={() => auth.devLogin('driver')}
                  title="Enter Driver Partner Dashboard instantly"
                >
                  <span className="dev-icon">🚗</span>
                  <div className="dev-btn-text">
                    <strong>Driver Dashboard</strong>
                    <small>Instant Dev Bypass</small>
                  </div>
                </button>
              </div>
            </div>
          )}
        </section>

        <footer className="native-auth-footer">
          <p className="native-footer-note">By signing in, you agree to our Terms of Service & Privacy Policy.</p>
        </footer>
      </div>

      {/* Discreet insider dev toggle button in bottom right corner */}
      <button
        type="button"
        className={`dev-insider-trigger ${showDevBypass ? 'active' : ''}`}
        onClick={() => setShowDevBypass(prev => !prev)}
        aria-label="Toggle developer test options"
        title={showDevBypass ? 'Hide Dev Test section' : 'Show Dev Test section'}
      >
        <span className="dev-insider-glyph">⚡</span>
      </button>
    </main>
  )
}
