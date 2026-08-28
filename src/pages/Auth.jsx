import React, { useState, useEffect, useRef } from 'react'
import { auth } from '../database'
import logo from '../assets/logo.png'

const getAuthError = (error) => {
  if (error.message?.toLowerCase().includes('rate limit')) {
    return 'Too many verification attempts. Please wait a moment and try again.'
  }
  return error.message || 'Verification failed. Please try again.'
}

export default function AuthPage() {
  // Steps: 'phone' (enter mobile) | 'register' (if new user) | 'otp' (verify 6-digit PIN)
  const [step, setStep] = useState('phone')
  const [phone, setPhone] = useState('')
  const [existingUser, setExistingUser] = useState(null)

  // Registration profile fields (only required when user is new)
  const [role, setRole] = useState('rider') // 'rider' | 'driver'
  const [name, setName] = useState('')
  const [vehicleModel, setVehicleModel] = useState('')
  const [vehicleNumber, setVehicleNumber] = useState('')

  // OTP state (array of 6 digits)
  const [otpDigits, setOtpDigits] = useState(['', '', '', '', '', ''])
  const otpInputsRef = useRef([])

  // Simulated SMS push banner
  const [simulatedSms, setSimulatedSms] = useState(null)
  const [resendTimer, setResendTimer] = useState(45)
  const [canResend, setCanResend] = useState(false)

  // Status & loading
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const [successMessage, setSuccessMessage] = useState(null)
  const [showDevBypass, setShowDevBypass] = useState(false)

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

  // Trigger simulated SMS push banner
  const triggerSmsPush = (code) => {
    setTimeout(() => {
      setSimulatedSms({
        code,
        time: 'Just now'
      })
    }, 450)
  }

  // Step 1: Handle phone submit -> Check existing vs new
  const handlePhoneSubmit = async (e) => {
    if (e) e.preventDefault()
    if (phone.length !== 10) {
      setError('Please enter a valid 10-digit mobile number.')
      return
    }

    setLoading(true)
    setError(null)

    try {
      const match = await auth.lookupPhone(phone)

      if (match.exists && match.profile) {
        // Known user: Directly send OTP and skip registration!
        setExistingUser(match.profile)
        setRole(match.profile.role || 'rider')
        setName(match.profile.name || '')
        setVehicleModel(match.profile.vehicleModel || '')
        setVehicleNumber(match.profile.vehicleNumber || '')

        const res = await auth.sendPhoneOtp(phone)
        setStep('otp')
        setResendTimer(45)
        setCanResend(false)
        setOtpDigits(['', '', '', '', '', ''])
        triggerSmsPush(res.otp)

        setTimeout(() => {
          otpInputsRef.current[0]?.focus()
        }, 100)
      } else {
        // Unknown user: Route to registration step to ask name/role
        setExistingUser(null)
        setStep('register')
      }
    } catch (err) {
      setError(getAuthError(err))
    } finally {
      setLoading(false)
    }
  }

  // Step 2: Handle registration submit -> Send OTP
  const handleRegisterSubmit = async (e) => {
    if (e) e.preventDefault()
    if (!name.trim()) {
      setError('Please enter your full name.')
      return
    }
    if (role === 'driver' && (!vehicleModel.trim() || !vehicleNumber.trim())) {
      setError('Please enter your vehicle model and plate number.')
      return
    }

    setLoading(true)
    setError(null)

    try {
      const res = await auth.sendPhoneOtp(phone)
      setStep('otp')
      setResendTimer(45)
      setCanResend(false)
      setOtpDigits(['', '', '', '', '', ''])
      triggerSmsPush(res.otp)

      setTimeout(() => {
        otpInputsRef.current[0]?.focus()
      }, 100)
    } catch (err) {
      setError(getAuthError(err))
    } finally {
      setLoading(false)
    }
  }

  // Resend OTP
  const handleResendOtp = async () => {
    if (!canResend || loading) return
    setLoading(true)
    setError(null)
    try {
      const res = await auth.sendPhoneOtp(phone)
      setResendTimer(45)
      setCanResend(false)
      setOtpDigits(['', '', '', '', '', ''])
      triggerSmsPush(res.otp)
    } catch (err) {
      setError(getAuthError(err))
    } finally {
      setLoading(false)
    }
  }

  // Handle digit inputs
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

    // If all 6 digits filled, auto-trigger verify
    if (digit && index === 5 && next.every(d => d !== '')) {
      const fullCode = next.join('')
      handleVerifyCode(fullCode)
    }
  }

  const handleOtpKeyDown = (index, e) => {
    if (e.key === 'Backspace' && !otpDigits[index] && index > 0) {
      otpInputsRef.current[index - 1]?.focus()
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

  // Auto fill from simulated SMS notification
  const handleAutoFillFromSms = () => {
    if (simulatedSms?.code) {
      const arr = simulatedSms.code.split('')
      setOtpDigits(arr)
      setSimulatedSms(null)
      handleVerifyCode(simulatedSms.code)
    }
  }

  // Verify OTP
  const handleVerifyCode = async (codeToVerify) => {
    const fullOtp = typeof codeToVerify === 'string' ? codeToVerify : otpDigits.join('')
    if (fullOtp.length !== 6) {
      setError('Please enter the complete 6-digit verification code.')
      return
    }

    setLoading(true)
    setError(null)
    try {
      const verifiedUser = await auth.verifyPhoneOtp(phone, fullOtp, role, {
        name,
        vehicleModel,
        vehicleNumber
      })
      const targetRole = verifiedUser?.user_metadata?.role || role
      setSuccessMessage(`✓ Mobile verified! Welcome aboard. Redirecting to your ${targetRole === 'driver' ? 'Driver' : 'Rider'} dashboard...`)
    } catch (err) {
      setError(getAuthError(err))
      setLoading(false)
    }
  }

  return (
    <main className="auth-screen">
      {/* Floating Simulated SMS Notification Banner */}
      {simulatedSms && (
        <div className="simulated-sms-banner">
          <div className="sms-banner-header">
            <span className="sms-app-badge">💬 MESSAGES • {simulatedSms.time}</span>
            <button
              type="button"
              className="sms-close-btn"
              onClick={() => setSimulatedSms(null)}
              aria-label="Dismiss notification"
            >
              ✕
            </button>
          </div>
          <div className="sms-banner-body">
            <div className="sms-text-wrap">
              <strong>Namma Driver Verification</strong>
              <p>
                Your 6-digit code is <span className="sms-code-highlight">{simulatedSms.code}</span>. Valid for 5 mins.
              </p>
            </div>
            <button
              type="button"
              className="sms-autofill-btn"
              onClick={handleAutoFillFromSms}
            >
              ⚡ Auto-Fill
            </button>
          </div>
        </div>
      )}

      {/* Brand */}
      <div className="auth-hero-brand">
        <img src={logo} alt="Namma Driver logo" className="auth-hero-logo" />
        <span className="auth-hero-label">Private car service</span>
      </div>

      <div className="auth-panel">
        {/* Top Progress Bar */}
        <div className="auth-progress-track">
          <div className={`auth-progress-fill ${loading ? 'active' : ''}`} />
        </div>

        {/* Success Celebration Message */}
        {successMessage && (
          <div className="auth-success-banner">
            <span>🎉</span> {successMessage}
          </div>
        )}

        {/* ------------------------------------------------------------ */}
        {/* STEP 1: Enter Mobile Number (Progressive Initial Screen)       */}
        {/* ------------------------------------------------------------ */}
        {step === 'phone' && (
          <form className="form auth-form" onSubmit={handlePhoneSubmit}>
            <div className="auth-intro">
              <span className="eyebrow">Quick & Secure Access</span>
              <h2>Enter mobile number</h2>
              <p className="auth-phone-subtitle">
                Enter your 10-digit number to sign in or get started.
              </p>
            </div>

            <label className="auth-field">
              <span>Mobile number</span>
              <div className="phone-input-group">
                <div className="phone-prefix-badge">
                  <span className="phone-flag">🇮🇳</span>
                  <span className="phone-code">+91</span>
                </div>
                <input
                  required
                  autoFocus
                  type="tel"
                  placeholder="98765 43210"
                  value={phone}
                  onChange={handlePhoneChange}
                  disabled={loading}
                  maxLength="10"
                  className="phone-number-input"
                />
                <div
                  className={`input-status-capsule ${phone.length === 10 ? 'valid' : 'required'}`}
                  title={phone.length === 10 ? 'Verified 10-digit number' : '10-digit number required'}
                >
                  {phone.length === 10 ? '✓' : ''}
                </div>
              </div>
            </label>

            <button
              type="submit"
              disabled={loading || phone.length < 10}
              className="btn primary-action"
            >
              {loading ? (
                <span className="btn-loading-content">
                  <span className="auth-btn-spinner" /> Checking...
                </span>
              ) : 'Continue ➔'}
            </button>

            {error && <div className="err">{error}</div>}
          </form>
        )}

        {/* ------------------------------------------------------------ */}
        {/* STEP 2: Profile Registration (ONLY for New Unknown Numbers)  */}
        {/* ------------------------------------------------------------ */}
        {step === 'register' && (
          <form className="form auth-form" onSubmit={handleRegisterSubmit}>
            <div className="auth-step-back-row">
              <button
                type="button"
                className="btn-back-step"
                onClick={() => { setStep('phone'); setError(null) }}
              >
                ← Change Number
              </button>
            </div>

            <div className="auth-intro">
              <span className="eyebrow">New Account</span>
              <h2>Complete your profile</h2>
              <p className="auth-phone-subtitle">
                Registering with <strong>+91 {phone}</strong>
              </p>
            </div>

            {/* Role Radio Card Switcher */}
            <div className="role-selector-wrap">
              <span className="role-selector-label">I want to register as:</span>
              <div className="role-selector-grid">
                <label className={`role-card-option ${role === 'rider' ? 'selected' : ''}`}>
                  <input
                    type="radio"
                    name="authRole"
                    value="rider"
                    checked={role === 'rider'}
                    onChange={() => setRole('rider')}
                  />
                  <div className="role-card-indicator" aria-hidden="true" />
                  <span className="role-card-icon">🧑</span>
                  <div className="role-card-text">
                    <strong>Rider</strong>
                    <small>Book rides & cabs</small>
                  </div>
                </label>

                <label className={`role-card-option ${role === 'driver' ? 'selected' : ''}`}>
                  <input
                    type="radio"
                    name="authRole"
                    value="driver"
                    checked={role === 'driver'}
                    onChange={() => setRole('driver')}
                  />
                  <div className="role-card-indicator" aria-hidden="true" />
                  <span className="role-card-icon">🚗</span>
                  <div className="role-card-text">
                    <strong>Driver</strong>
                    <small>Accept rides & earn</small>
                  </div>
                </label>
              </div>
            </div>

            <label className="auth-field">
              <span>Full name</span>
              <div className="field-input-wrap">
                <input
                  required
                  type="text"
                  placeholder={role === 'driver' ? 'e.g. Ramesh Kumar' : 'e.g. Ananya Sharma'}
                  value={name}
                  onChange={e => setName(e.target.value)}
                  disabled={loading}
                />
                <div
                  className={`input-status-capsule ${name.trim().length > 1 ? 'valid' : 'required'}`}
                  title={name.trim().length > 1 ? 'Completed' : 'Required'}
                >
                  {name.trim().length > 1 ? '✓' : ''}
                </div>
              </div>
            </label>

            {/* Additional Driver Partner Vehicle Fields */}
            {role === 'driver' && (
              <div className="driver-fields-panel">
                <div className="driver-panel-heading">
                  <span>🚗 Vehicle Information</span>
                </div>
                <div className="form-two-col">
                  <label className="auth-field">
                    <span>Vehicle model</span>
                    <div className="field-input-wrap">
                      <input
                        required
                        type="text"
                        placeholder="Swift / Innova"
                        value={vehicleModel}
                        onChange={e => setVehicleModel(e.target.value)}
                        disabled={loading}
                      />
                      <div
                        className={`input-status-capsule ${vehicleModel.trim() ? 'valid' : 'required'}`}
                        title={vehicleModel.trim() ? 'Completed' : 'Required'}
                      >
                        {vehicleModel.trim() ? '✓' : ''}
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
                        value={vehicleNumber}
                        onChange={e => setVehicleNumber(e.target.value)}
                        disabled={loading}
                      />
                      <div
                        className={`input-status-capsule ${vehicleNumber.trim() ? 'valid' : 'required'}`}
                        title={vehicleNumber.trim() ? 'Completed' : 'Required'}
                      >
                        {vehicleNumber.trim() ? '✓' : ''}
                      </div>
                    </div>
                  </label>
                </div>
              </div>
            )}

            <button type="submit" disabled={loading} className="btn primary-action">
              {loading ? (
                <span className="btn-loading-content">
                  <span className="auth-btn-spinner" /> Sending OTP...
                </span>
              ) : 'Get Verification Code ➔'}
            </button>

            {error && <div className="err">{error}</div>}
          </form>
        )}

        {/* ------------------------------------------------------------ */}
        {/* STEP 3: 6-Digit OTP Verification Screen                      */}
        {/* ------------------------------------------------------------ */}
        {step === 'otp' && (
          <form className="form auth-form" onSubmit={(e) => { e.preventDefault(); handleVerifyCode() }}>
            <div className="auth-step-back-row">
              <button
                type="button"
                className="btn-back-step"
                onClick={() => { setStep('phone'); setError(null) }}
              >
                ← Change Number
              </button>
            </div>

            <div className="auth-intro">
              <span className="eyebrow">
                {existingUser ? 'Welcome Back' : 'Security Verification'}
              </span>
              <h2>
                {existingUser ? `Hello, ${existingUser.name?.split(' ')[0]}!` : 'Enter OTP code'}
              </h2>
              <div className="otp-target-display">
                <span>Code sent to <strong>+91 {phone}</strong></span>
              </div>
            </div>

            {/* 6-Digit Individual Pin Input Boxes */}
            <div className="otp-boxes-grid" onPaste={handleOtpPaste}>
              {otpDigits.map((digit, idx) => (
                <input
                  key={idx}
                  ref={el => otpInputsRef.current[idx] = el}
                  type="tel"
                  maxLength="1"
                  className={`otp-digit-box ${digit ? 'filled' : ''}`}
                  value={digit}
                  onChange={e => handleOtpChange(idx, e.target.value)}
                  onKeyDown={e => handleOtpKeyDown(idx, e)}
                  disabled={loading}
                  autoFocus={idx === 0}
                />
              ))}
            </div>

            <div className="otp-resend-row">
              {canResend ? (
                <button
                  type="button"
                  className="btn-resend-link"
                  onClick={handleResendOtp}
                  disabled={loading}
                >
                  🔄 Resend Code
                </button>
              ) : (
                <span className="resend-countdown-text">
                  Resend code in <strong>{resendTimer}s</strong>
                </span>
              )}
            </div>

            <button
              type="submit"
              disabled={loading || otpDigits.some(d => !d)}
              className="btn primary-action"
            >
              {loading ? (
                <span className="btn-loading-content">
                  <span className="auth-btn-spinner" /> Verifying...
                </span>
              ) : 'Verify & Sign In'}
            </button>

            {error && <div className="err">{error}</div>}
          </form>
        )}

        {/* DEV Quick Bypass Section (Hidden by default, toggled via insider button) */}
        {showDevBypass && (
          <div className="dev-bypass-section">
            <div className="dev-bypass-divider">
              <span>⚡ DEV QUICK BYPASS (ZERO API CALLS)</span>
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
      </div>

      <p className="auth-footnote">Instant OTP login. Thoughtful travel.</p>

      {/* Barely noticeable insider dev toggle button in bottom right corner */}
      <button
        type="button"
        className={`dev-insider-trigger ${showDevBypass ? 'active' : ''}`}
        onClick={() => setShowDevBypass(prev => !prev)}
        aria-label="Toggle developer tools"
        title={showDevBypass ? 'Hide developer bypass' : 'Developer bypass'}
      >
        <span className="dev-insider-glyph">⚡</span>
      </button>
    </main>
  )
}
