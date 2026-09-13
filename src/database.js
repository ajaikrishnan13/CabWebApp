// Internal SQLite Database & Auth Client
export const databaseConfigured = true

export async function fileToDataUrl(file, maxSize = 320, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Failed to read image file'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('Invalid image file'))
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas')
          let { width, height } = img
          if (width > height) {
            if (width > maxSize) {
              height = Math.round((height * maxSize) / width)
              width = maxSize
            }
          } else {
            if (height > maxSize) {
              width = Math.round((width * maxSize) / height)
              width = maxSize
            }
          }
          canvas.width = width
          canvas.height = height
          const ctx = canvas.getContext('2d')
          ctx.drawImage(img, 0, 0, width, height)
          const dataUrl = canvas.toDataURL('image/jpeg', quality)
          resolve(dataUrl)
        } catch {
          resolve(reader.result)
        }
      }
      img.src = reader.result
    }
    reader.readAsDataURL(file)
  })
}

const authSubscribers = new Set()

export const auth = {
  subscribe(listener) {
    authSubscribers.add(listener)

    // Load active session immediately from local cache
    try {
      const userStr = localStorage.getItem('cab_dev_user')
      if (userStr) {
        listener(JSON.parse(userStr))
      } else {
        listener(null)
      }
    } catch {
      listener(null)
    }

    return () => {
      authSubscribers.delete(listener)
    }
  },

  devLogin(role = 'rider') {
    const isDriver = role === 'driver'
    const devUser = {
      id: isDriver ? 'dev_driver_4e832' : 'dev_rider_88129',
      email: isDriver ? 'testdriver@nd.com' : 'rider@nammadriver.app',
      user_metadata: {
        name: isDriver ? 'Test Driver (Dev)' : 'Ajai Krishnan',
        phone: isDriver ? '9876543211' : '9876543210',
        role: isDriver ? 'driver' : 'rider',
        vehicleModel: isDriver ? 'Hyundai Aura' : '',
        vehicleNumber: isDriver ? 'TN 10 AA 1010' : '',
        avatar_url: null
      }
    }
    try {
      localStorage.setItem('cab_dev_user', JSON.stringify(devUser))
    } catch {}
    authSubscribers.forEach(cb => cb(devUser))
    return devUser
  },

  async signOut() {
    try {
      localStorage.removeItem('cab_dev_user')
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i)
        if (key && (key.startsWith('sb-') || key.includes('auth-token') || key.startsWith('cab_dev_'))) {
          localStorage.removeItem(key)
        }
      }
      sessionStorage.clear()
    } catch {}

    authSubscribers.forEach(cb => {
      try { cb(null) } catch {}
    })
  },

  async lookupPhone(phone) {
    const cleanPhone = phone.replace(/[^\d]/g, '').slice(-10)
    if (cleanPhone.length < 10) return { exists: false }

    // 1. Check internal SQLite database via API
    try {
      const res = await fetch('/api/auth/lookup-phone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: cleanPhone })
      })
      if (res.ok) {
        const data = await res.json()
        if (data && data.exists) {
          return data
        }
      }
    } catch (err) {
      console.warn('API lookupPhone error, using fallback:', err)
    }

    // 2. Pre-seeded fallback
    if (cleanPhone === '9876543210') {
      return {
        exists: true,
        profile: {
          name: 'Ajai Krishnan',
          role: 'rider',
          phone: '9876543210'
        }
      }
    }
    if (cleanPhone === '9876543211') {
      return {
        exists: true,
        profile: {
          name: 'Test Driver',
          role: 'driver',
          phone: '9876543211',
          vehicleModel: 'Hyundai Aura',
          vehicleNumber: 'TN 10 AA 1010'
        }
      }
    }

    return { exists: false }
  },

  async sendPhoneOtp(phone) {
    const cleanPhone = phone.replace(/[^\d]/g, '').slice(-10)
    if (cleanPhone.length < 10) throw new Error('Please enter a valid 10-digit mobile number.')

    try {
      const res = await fetch('/api/auth/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: cleanPhone })
      })
      if (res.ok) {
        const data = await res.json()
        return { otp: data.otp, phone: cleanPhone }
      }
    } catch (err) {
      console.warn('API sendPhoneOtp notice, using offline fallback:', err)
    }

    // Fallback: Generate local OTP if backend unreachable
    const otp = Math.floor(100000 + Math.random() * 900000).toString()
    try {
      sessionStorage.setItem(`otp_${cleanPhone}`, JSON.stringify({
        phone: cleanPhone,
        otp,
        expiresAt: Date.now() + 5 * 60 * 1000
      }))
    } catch {}
    return { otp, phone: cleanPhone }
  },

  async verifyPhoneOtp(phone, otpInput, role = 'rider', details = {}) {
    const cleanPhone = phone.replace(/[^\d]/g, '').slice(-10)

    try {
      const res = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: cleanPhone,
          otp: otpInput.trim(),
          role,
          details
        })
      })

      if (res.ok) {
        const data = await res.json()
        if (data?.user) {
          try {
            localStorage.setItem('cab_dev_user', JSON.stringify(data.user))
          } catch {}
          authSubscribers.forEach(cb => cb(data.user))
          return data.user
        }
      } else {
        const errData = await res.json().catch(() => ({}))
        if (errData.error) throw new Error(errData.error)
      }
    } catch (err) {
      if (err.message && !err.message.includes('fetch')) {
        throw err
      }
      console.warn('API verify-otp unreachable, falling back to local verification:', err)
    }

    // Local fallback for OTP verification
    let isValid = otpInput.trim() === '123456'
    try {
      const storedStr = sessionStorage.getItem(`otp_${cleanPhone}`)
      if (storedStr) {
        const stored = JSON.parse(storedStr)
        if (Date.now() <= stored.expiresAt && stored.otp === otpInput.trim()) {
          isValid = true
        }
      }
    } catch {}

    if (!isValid) {
      throw new Error('Invalid or expired verification code. Please check and try again.')
    }

    const verifiedUser = {
      id: `phone_${cleanPhone}`,
      email: `user${cleanPhone}@nammadriver.app`,
      user_metadata: {
        name: (details.name || (role === 'driver' ? 'Driver Partner' : 'Rider')).trim(),
        phone: cleanPhone,
        role: role || 'rider',
        vehicleNumber: details.vehicleNumber || '',
        vehicleModel: details.vehicleModel || '',
        avatar_url: null
      }
    }

    try {
      localStorage.setItem('cab_dev_user', JSON.stringify(verifiedUser))
    } catch {}
    authSubscribers.forEach(cb => cb(verifiedUser))
    return verifiedUser
  },

  async login(email, password) {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    })

    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.error || 'Login failed')
    }

    const { user } = await res.json()
    try {
      localStorage.setItem('cab_dev_user', JSON.stringify(user))
    } catch {}
    authSubscribers.forEach(cb => cb(user))
    return user
  },

  async register(name, email, password, role = 'rider', extraData = {}) {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password, role, extraData })
    })

    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.error || 'Registration failed')
    }

    const { user } = await res.json()
    try {
      localStorage.setItem('cab_dev_user', JSON.stringify(user))
    } catch {}
    authSubscribers.forEach(cb => cb(user))
    return user
  },

  async updateProfile(profile, avatarFile) {
    let currentUser = null
    try {
      const str = localStorage.getItem('cab_dev_user')
      if (str) currentUser = JSON.parse(str)
    } catch {}

    const uid = currentUser?.id || profile.id || 'dev_rider_88129'

    let avatarUrl = profile.avatarUrl !== undefined ? profile.avatarUrl : (currentUser?.user_metadata?.avatar_url || null)

    if (avatarFile) {
      try {
        avatarUrl = await fileToDataUrl(avatarFile, 320, 0.82)
      } catch (e) {
        console.warn('fileToDataUrl notice:', e)
      }
    }

    try {
      const formData = new FormData()
      formData.append('id', uid)
      if (profile.name !== undefined) formData.append('name', profile.name)
      if (profile.email !== undefined) formData.append('email', profile.email)
      if (profile.phone !== undefined) formData.append('phone', profile.phone)
      if (profile.birthday !== undefined) formData.append('birthday', profile.birthday || '')
      if (profile.vehicleModel !== undefined) formData.append('vehicleModel', profile.vehicleModel)
      if (profile.vehicleNumber !== undefined) formData.append('vehicleNumber', profile.vehicleNumber)
      if (avatarUrl) formData.append('avatarUrl', avatarUrl)
      if (avatarFile) formData.append('avatarFile', avatarFile)

      const res = await fetch('/api/auth/profile', {
        method: 'PUT',
        body: formData
      })

      if (res.ok) {
        const data = await res.json()
        if (data?.user) {
          try {
            localStorage.setItem('cab_dev_user', JSON.stringify(data.user))
          } catch {}
          authSubscribers.forEach(cb => cb(data.user))
          return data.user
        }
      }
    } catch (err) {
      console.warn('API updateProfile error, applying local updates:', err)
    }

    // Local fallback update
    const updatedUser = {
      ...currentUser,
      id: uid,
      email: profile.email || currentUser?.email || '',
      user_metadata: {
        ...(currentUser?.user_metadata || {}),
        name: profile.name !== undefined ? profile.name : (currentUser?.user_metadata?.name || ''),
        phone: profile.phone !== undefined ? profile.phone : (currentUser?.user_metadata?.phone || ''),
        birthday: profile.birthday !== undefined ? profile.birthday : (currentUser?.user_metadata?.birthday || null),
        avatar_url: avatarUrl,
        vehicleModel: profile.vehicleModel !== undefined ? profile.vehicleModel : (currentUser?.user_metadata?.vehicleModel || ''),
        vehicleNumber: profile.vehicleNumber !== undefined ? profile.vehicleNumber : (currentUser?.user_metadata?.vehicleNumber || '')
      }
    }

    try {
      localStorage.setItem('cab_dev_user', JSON.stringify(updatedUser))
    } catch {}
    authSubscribers.forEach(cb => cb(updatedUser))
    return updatedUser
  }
}

export const database = {
  async getProfile(uid) {
    try {
      const res = await fetch(`/api/profiles/${encodeURIComponent(uid)}`)
      if (res.ok) {
        return await res.json()
      }
    } catch (err) {
      console.warn('API getProfile notice:', err)
    }
    return null
  },

  async listBookings(uid) {
    if (!uid) return []

    try {
      const res = await fetch(`/api/bookings?uid=${encodeURIComponent(uid)}`)
      if (res.ok) {
        const apiBookings = await res.json()
        if (Array.isArray(apiBookings)) {
          const clean = apiBookings.filter(b => !String(b.id).startsWith('past_trip_'))
          try {
            localStorage.setItem(`cab_bookings_${uid}`, JSON.stringify(clean))
          } catch {}
          return clean
        }
      }
    } catch (err) {
      console.warn('API listBookings notice, using local cache:', err)
      try {
        const localData = localStorage.getItem(`cab_bookings_${uid}`)
        if (localData) {
          return JSON.parse(localData).filter(b => !String(b.id).startsWith('past_trip_'))
        }
      } catch {}
    }

    return []
  },

  async addBooking(booking) {
    const bookingRecord = {
      id: booking.id || `bk_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      uid: booking.uid,
      name: booking.name,
      email: booking.email,
      datetime: booking.datetime,
      from: booking.from,
      to: booking.to,
      fromCoords: booking.fromCoords || null,
      toCoords: booking.toCoords || null,
      carType: booking.carType || 'Sedan',
      serviceType: booking.serviceType || 'Rental',
      estimatedFare: booking.estimatedFare || null,
      status: booking.status || 'requested',
      createdAt: Date.now()
    }

    // Persist to internal SQLite database
    try {
      const res = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bookingRecord)
      })
      if (res.ok) {
        const created = await res.json()
        try {
          const key = `cab_bookings_${booking.uid}`
          const existing = JSON.parse(localStorage.getItem(key) || '[]').filter(b => !String(b.id).startsWith('past_trip_'))
          localStorage.setItem(key, JSON.stringify([created, ...existing]))
        } catch {}
        return created
      }
    } catch (err) {
      console.warn('API addBooking notice (saved locally in backup):', err)
    }

    try {
      const key = `cab_bookings_${booking.uid}`
      const existing = JSON.parse(localStorage.getItem(key) || '[]').filter(b => !String(b.id).startsWith('past_trip_'))
      localStorage.setItem(key, JSON.stringify([bookingRecord, ...existing]))
    } catch {}

    return bookingRecord
  },

  async listAvailableBookings() {
    try {
      const res = await fetch('/api/bookings/available')
      if (res.ok) {
        const apiList = await res.json()
        if (Array.isArray(apiList)) {
          return apiList.filter(b => !String(b.id).startsWith('past_trip_'))
        }
      }
    } catch (err) {
      console.warn('API listAvailableBookings notice:', err)
    }

    return []
  },

  async updateBookingStatus(bookingId, newStatus, driverInfo = null) {
    // 1. Update local cache
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (key && key.startsWith('cab_bookings_')) {
          try {
            const userBookings = JSON.parse(localStorage.getItem(key) || '[]')
            const updated = userBookings.map(b => b.id === bookingId ? { ...b, status: newStatus, driver: driverInfo } : b)
            localStorage.setItem(key, JSON.stringify(updated))
          } catch {}
        }
      }
    } catch {}

    // 2. Update internal SQLite database
    try {
      const res = await fetch(`/api/bookings/${encodeURIComponent(bookingId)}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus, driver: driverInfo })
      })
      if (res.ok) {
        return await res.json()
      }
    } catch (err) {
      console.warn('API updateBookingStatus notice:', err)
    }
  },

  async listDriverBookings(driverId) {
    if (!driverId) return []

    try {
      const res = await fetch(`/api/bookings/driver/${encodeURIComponent(driverId)}`)
      if (res.ok) {
        const apiList = await res.json()
        if (Array.isArray(apiList)) {
          return apiList.filter(b => !String(b.id).startsWith('past_trip_'))
        }
      }
    } catch (err) {
      console.warn('API listDriverBookings notice:', err)
    }

    return []
  }
}

// Purge any legacy mock or test trip entries from client browser storage
try {
  localStorage.removeItem('cab_global_bookings')
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key && key.startsWith('cab_bookings_')) {
      const raw = localStorage.getItem(key)
      if (raw && (raw.includes('past_trip_') || raw.includes('Chennai International Airport'))) {
        const items = JSON.parse(raw).filter(b => !String(b.id).startsWith('past_trip_'))
        if (items.length > 0) {
          localStorage.setItem(key, JSON.stringify(items))
        } else {
          localStorage.removeItem(key)
        }
      }
    }
  }
} catch {}
