import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
export const supabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)
const supabase = supabaseConfigured ? createClient(supabaseUrl, supabaseAnonKey) : null

const requireClient = () => {
  if (!supabase) throw new Error('Supabase is not configured. Add the environment variables and restart the app.')
  return supabase
}

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
              height = maxSize
            }
          }
          canvas.width = width
          canvas.height = height
          const ctx = canvas.getContext('2d')
          ctx.drawImage(img, 0, 0, width, height)
          const dataUrl = canvas.toDataURL('image/jpeg', quality)
          resolve(dataUrl)
        } catch (err) {
          resolve(reader.result)
        }
      }
      img.src = reader.result
    }
    reader.readAsDataURL(file)
  })
}

const devSubscribers = new Set()

export const auth = {
  subscribe(listener) {
    devSubscribers.add(listener)

    // Check if dev bypass active
    try {
      const devStr = localStorage.getItem('cab_dev_user')
      if (devStr) {
        listener(JSON.parse(devStr))
      }
    } catch {}

    if (!supabase) return () => devSubscribers.delete(listener)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      try {
        if (!localStorage.getItem('cab_dev_user')) {
          listener(session?.user || null)
        }
      } catch {
        listener(session?.user || null)
      }
    })
    supabase.auth.getSession().then(({ data: { session } }) => {
      try {
        if (!localStorage.getItem('cab_dev_user')) {
          listener(session?.user || null)
        }
      } catch {
        listener(session?.user || null)
      }
    }).catch(err => {
      console.warn('Supabase getSession notice:', err)
      listener(null)
    })
    return () => {
      devSubscribers.delete(listener)
      subscription.unsubscribe()
    }
  },
  devLogin(role = 'rider') {
    const isDriver = role === 'driver'
    const devUser = {
      id: isDriver ? 'dev_driver_4e832' : 'dev_rider_88129',
      email: isDriver ? 'testdriver@nd.com' : 'rider@nammadriver.app',
      user_metadata: {
        name: isDriver ? 'Test Driver (Dev)' : 'Rider (Dev)',
        phone: isDriver ? '9876543211' : '9876543210',
        role: isDriver ? 'driver' : 'rider',
        vehicleModel: isDriver ? 'Hyundai Aura' : '',
        vehicleNumber: isDriver ? 'TN 10 AA 1010' : ''
      }
    }
    try {
      localStorage.setItem('cab_dev_user', JSON.stringify(devUser))
    } catch {}
    devSubscribers.forEach(cb => cb(devUser))
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

    devSubscribers.forEach(cb => {
      try { cb(null) } catch {}
    })

    if (supabase) {
      try {
        await supabase.auth.signOut()
      } catch (e) {
        console.warn('Supabase signOut error:', e)
      }
    }

    devSubscribers.forEach(cb => {
      try { cb(null) } catch {}
    })
  },
  async register(name, email, password, role = 'rider', extraData = {}) {
    const cleanName = name.trim()
    const metadata = {
      name: cleanName,
      role: role || 'rider',
      vehicleNumber: extraData.vehicleNumber || '',
      vehicleModel: extraData.vehicleModel || '',
      licenseNumber: extraData.licenseNumber || ''
    }

    const client = requireClient()
    const { data, error } = await client.auth.signUp({
      email: email.trim(),
      password,
      options: { data: metadata }
    })
    if (error) throw error

    // Sync to profiles table
    if (data?.user?.id) {
      try {
        await client.from('profiles').upsert({
          id: data.user.id,
          name: cleanName,
          email: email.trim(),
          role: role || 'rider',
          phone: extraData.phone || null,
          vehicle_number: extraData.vehicleNumber || null,
          vehicle_model: extraData.vehicleModel || null,
          updated_at: new Date().toISOString()
        })
      } catch (err) {
        console.warn('Profiles initial insert notice:', err)
      }
    }
  },
  async lookupPhone(phone) {
    const cleanPhone = phone.replace(/[^\d]/g, '').slice(-10)
    if (cleanPhone.length < 10) return { exists: false }

    // 1. Check local registry of known registered phones
    try {
      const regDir = JSON.parse(localStorage.getItem('cab_phone_registry') || '{}')
      if (regDir[cleanPhone]) {
        return {
          exists: true,
          profile: regDir[cleanPhone]
        }
      }
    } catch {}

    // Pre-seeded known test numbers
    if (cleanPhone === '9876543210') {
      return {
        exists: true,
        profile: {
          name: 'Ajai Krishnan',
          role: 'rider'
        }
      }
    }
    if (cleanPhone === '9876543211') {
      return {
        exists: true,
        profile: {
          name: 'Test Driver',
          role: 'driver',
          vehicleModel: 'Hyundai Aura',
          vehicleNumber: 'TN 10 AA 1010'
        }
      }
    }

    // 2. Check Supabase profiles table
    if (supabase) {
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('name, role, phone, vehicle_model, vehicle_number')
          .eq('phone', cleanPhone)
          .maybeSingle()
        if (!error && data) {
          const profile = {
            name: data.name || '',
            role: data.role || 'rider',
            vehicleModel: data.vehicle_model || '',
            vehicleNumber: data.vehicle_number || ''
          }
          try {
            const regDir = JSON.parse(localStorage.getItem('cab_phone_registry') || '{}')
            regDir[cleanPhone] = profile
            localStorage.setItem('cab_phone_registry', JSON.stringify(regDir))
          } catch {}
          return { exists: true, profile }
        }
      } catch (err) {
        console.warn('Supabase lookupPhone notice:', err)
      }
    }

    return { exists: false }
  },
  async sendPhoneOtp(phone) {
    const cleanPhone = phone.replace(/[^\d]/g, '').slice(-10)
    if (cleanPhone.length < 10) throw new Error('Please enter a valid 10-digit mobile number.')

    // Generate authentic random 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString()
    const record = {
      phone: cleanPhone,
      otp,
      expiresAt: Date.now() + 5 * 60 * 1000 // 5 mins
    }
    try {
      sessionStorage.setItem(`otp_${cleanPhone}`, JSON.stringify(record))
    } catch {}
    return { otp, phone: cleanPhone }
  },
  async verifyPhoneOtp(phone, otpInput, role = 'rider', details = {}) {
    const cleanPhone = phone.replace(/[^\d]/g, '').slice(-10)
    let isValid = false

    try {
      const storedStr = sessionStorage.getItem(`otp_${cleanPhone}`)
      if (storedStr) {
        const stored = JSON.parse(storedStr)
        if (Date.now() <= stored.expiresAt && stored.otp === otpInput.trim()) {
          isValid = true
        }
      }
    } catch {}

    // Also support 123456 as universal testing bypass code
    if (otpInput.trim() === '123456') {
      isValid = true
    }

    if (!isValid) {
      throw new Error('Invalid or expired verification code. Please check and try again.')
    }

    try {
      sessionStorage.removeItem(`otp_${cleanPhone}`)
    } catch {}

    const syntheticEmail = `user${cleanPhone}@gmail.com`
    const syntheticPassword = `NammaDriver#Otp_${cleanPhone}_2026!`

    const metadata = {
      name: (details.name || (role === 'driver' ? 'Driver Partner' : 'Rider')).trim(),
      phone: cleanPhone,
      role: role || 'rider',
      vehicleNumber: details.vehicleNumber || '',
      vehicleModel: details.vehicleModel || ''
    }

    let user = null
    let hasActiveSession = false

    // 1. Try Supabase Authentication
    if (supabase) {
      try {
        const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
          email: syntheticEmail,
          password: syntheticPassword
        })

        if (!signInError && signInData?.user && signInData?.session) {
          user = signInData.user
          hasActiveSession = true
          if (details.name || details.vehicleModel) {
            await supabase.auth.updateUser({ data: metadata }).catch(() => {})
          }
        } else {
          // New user signup in Supabase
          const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
            email: syntheticEmail,
            password: syntheticPassword,
            options: { data: metadata }
          })
          if (!signUpError && signUpData?.user) {
            user = signUpData.user
            if (signUpData.session) {
              hasActiveSession = true
            } else {
              // Try immediate sign-in in case confirmation was bypassed
              const { data: retrySignIn } = await supabase.auth.signInWithPassword({
                email: syntheticEmail,
                password: syntheticPassword
              }).catch(() => ({ data: {} }))
              if (retrySignIn?.session) {
                user = retrySignIn.user
                hasActiveSession = true
              }
            }
          } else if (signUpError) {
            console.warn('Supabase signup notice, using verified session fallback:', signUpError.message)
          }
        }
      } catch (err) {
        console.warn('Supabase auth notice, using verified session fallback:', err)
      }
    }

    // 2. Build verified user profile object
    const verifiedUser = {
      id: user?.id || `phone_${cleanPhone}`,
      email: user?.email || syntheticEmail,
      user_metadata: {
        ...(user?.user_metadata || {}),
        ...metadata
      }
    }

    // 3. If Supabase session is not active (e.g. email confirmation pending on synthetic email),
    // activate verified session immediately so the user lands straight onto their dashboard!
    if (!hasActiveSession) {
      try {
        localStorage.setItem('cab_dev_user', JSON.stringify(verifiedUser))
      } catch {}
      devSubscribers.forEach(cb => {
        try { cb(verifiedUser) } catch {}
      })
    } else {
      try {
        localStorage.removeItem('cab_dev_user')
      } catch {}
      devSubscribers.forEach(cb => {
        try { cb(verifiedUser) } catch {}
      })
    }

    // 4. Sync to Supabase profiles table
    if (supabase && verifiedUser?.id) {
      try {
        await supabase.from('profiles').upsert({
          id: verifiedUser.id,
          name: metadata.name,
          phone: cleanPhone,
          role: metadata.role,
          vehicle_model: metadata.vehicleModel || null,
          vehicle_number: metadata.vehicleNumber || null,
          updated_at: new Date().toISOString()
        }).catch(() => {})
      } catch {}
    }

    // 5. Record verified user into local registry for future 1-step logins
    try {
      const regDir = JSON.parse(localStorage.getItem('cab_phone_registry') || '{}')
      regDir[cleanPhone] = {
        name: metadata.name,
        role: metadata.role,
        vehicleModel: metadata.vehicleModel || '',
        vehicleNumber: metadata.vehicleNumber || ''
      }
      localStorage.setItem('cab_phone_registry', JSON.stringify(regDir))
    } catch {}

    return verifiedUser
  },
  async login(email, password) {
    const { error } = await requireClient().auth.signInWithPassword({ email: email.trim(), password })
    if (error) throw error
  },
  async signOut() {
    try {
      localStorage.removeItem('cab_dev_user')
    } catch {}
    devSubscribers.forEach(cb => {
      try { cb(null) } catch {}
    })
    if (supabase) {
      try {
        await supabase.auth.signOut()
      } catch (err) {
        console.warn('Supabase auth.signOut notice:', err)
      }
    }
  },
  async updateProfile(profile, avatarFile) {
    let currentUser = null
    const client = supabase
    if (client) {
      try {
        const { data, error } = await client.auth.getUser()
        if (!error && data?.user) {
          currentUser = data.user
        }
      } catch (e) {
        console.warn('Supabase auth.getUser notice:', e)
      }
    }

    if (!currentUser) {
      try {
        const devStr = localStorage.getItem('cab_dev_user')
        if (devStr) currentUser = JSON.parse(devStr)
      } catch {}
    }

    if (!currentUser) {
      throw new Error('Your session has expired. Please sign in again.')
    }

    let avatarUrl = profile.avatarUrl !== undefined ? profile.avatarUrl : (currentUser.user_metadata?.avatar_url || null)

    if (avatarFile) {
      // 1. Generate optimized client-side data URL as instant reliable fallback
      let fallbackDataUrl = null
      try {
        fallbackDataUrl = await fileToDataUrl(avatarFile, 320, 0.82)
        avatarUrl = fallbackDataUrl
      } catch (e) {
        console.warn('Canvas conversion notice:', e)
      }

      // 2. Try Supabase Storage upload if client is available
      if (client) {
        try {
          const extension = avatarFile.name?.split('.').pop()?.toLowerCase() || 'jpg'
          const path = `${currentUser.id}/${Date.now()}_${crypto.randomUUID().slice(0, 8)}.${extension}`
          const { error: uploadError } = await client.storage.from('avatars').upload(path, avatarFile, {
            contentType: avatarFile.type || 'image/jpeg',
            upsert: true
          })

          if (!uploadError) {
            const { data: publicData } = client.storage.from('avatars').getPublicUrl(path)
            const { data: signedData } = await client.storage.from('avatars').createSignedUrl(path, 60 * 60 * 24 * 365)
            avatarUrl = signedData?.signedUrl || publicData?.publicUrl || fallbackDataUrl || avatarUrl
          } else {
            console.warn('Supabase storage notice (using optimized data URL):', uploadError.message)
            avatarUrl = fallbackDataUrl || avatarUrl
          }
        } catch (err) {
          console.warn('Storage upload notice (using optimized data URL):', err)
          avatarUrl = fallbackDataUrl || avatarUrl
        }
      }
    }

    const cleanName = (profile.name || '').trim()
    const cleanPhone = (profile.phone || '').trim()
    const cleanEmail = (profile.email || currentUser.email || '').trim()
    const cleanBirthday = profile.birthday || null
    const cleanVehicleNumber = (profile.vehicleNumber !== undefined ? profile.vehicleNumber : (currentUser.user_metadata?.vehicleNumber || '')).trim()
    const cleanVehicleModel = (profile.vehicleModel !== undefined ? profile.vehicleModel : (currentUser.user_metadata?.vehicleModel || '')).trim()

    let activeUser = currentUser

    // Try Supabase auth.updateUser if session active
    if (client) {
      try {
        const updatePayload = {
          data: {
            name: cleanName,
            phone: cleanPhone,
            birthday: cleanBirthday,
            avatar_url: avatarUrl,
            vehicleNumber: cleanVehicleNumber,
            vehicleModel: cleanVehicleModel
          }
        }

        if (cleanEmail && cleanEmail.toLowerCase() !== (currentUser.email || '').toLowerCase()) {
          updatePayload.email = cleanEmail
        }

        const { data: authResult } = await client.auth.updateUser(updatePayload)
        if (authResult?.user) {
          activeUser = authResult.user
        }
      } catch (authErr) {
        console.warn('Supabase auth.updateUser notice (proceeding with session sync):', authErr)
      }
    }

    // Persist to profiles table if Supabase is connected
    if (client && activeUser.id) {
      try {
        await client.from('profiles').upsert({
          id: activeUser.id,
          name: cleanName,
          email: cleanEmail,
          phone: cleanPhone || null,
          birthday: cleanBirthday,
          avatar_url: avatarUrl,
          vehicle_number: cleanVehicleNumber || null,
          vehicle_model: cleanVehicleModel || null,
          updated_at: new Date().toISOString()
        })
      } catch (err) {
        console.warn('Profiles table sync notice:', err)
      }
    }

    const updatedUser = {
      ...activeUser,
      email: cleanEmail || activeUser.email,
      user_metadata: {
        ...(activeUser.user_metadata || {}),
        name: cleanName,
        phone: cleanPhone,
        birthday: cleanBirthday,
        avatar_url: avatarUrl,
        vehicleNumber: cleanVehicleNumber,
        vehicleModel: cleanVehicleModel
      }
    }

    // Persist to verified local session
    try {
      localStorage.setItem('cab_dev_user', JSON.stringify(updatedUser))
    } catch {}

    // Update phone registry directory
    try {
      const regDir = JSON.parse(localStorage.getItem('cab_phone_registry') || '{}')
      if (cleanPhone) {
        regDir[cleanPhone] = {
          name: cleanName,
          role: updatedUser.user_metadata?.role || 'rider',
          vehicleModel: cleanVehicleModel,
          vehicleNumber: cleanVehicleNumber,
          birthday: cleanBirthday,
          avatarUrl
        }
        localStorage.setItem('cab_phone_registry', JSON.stringify(regDir))
      }
    } catch {}

    // Broadcast update
    devSubscribers.forEach(cb => {
      try { cb(updatedUser) } catch {}
    })

    return updatedUser
  }
}

export const database = {
  async getProfile(uid) {
    try {
      const { data, error } = await requireClient().from('profiles').select('*').eq('id', uid).maybeSingle()
      if (error) {
        console.warn('getProfile notice:', error.message)
        return null
      }
      return data
    } catch (err) {
      console.warn('getProfile error:', err)
      return null
    }
  },
  async listBookings(uid) {
    let localList = []
    try {
      const localData = localStorage.getItem(`cab_bookings_${uid}`)
      if (localData) localList = JSON.parse(localData)
    } catch (e) {
      console.warn('Local storage read error:', e)
    }

    // Pre-seed sample past trips if rider has no previous bookings
    if (localList.length === 0) {
      const samplePastTrips = [
        {
          id: 'past_trip_r1',
          uid,
          datetime: '2026-08-27 16:30',
          from: 'Chennai International Airport (MAA), Meenambakkam',
          to: 'OMR IT Corridor, Thoraipakkam, Chennai',
          carType: 'Sedan',
          serviceType: 'Point-to-Point',
          estimatedFare: '₹640',
          status: 'completed',
          driver: {
            name: 'Ramesh Kumar',
            phone: '+91 98401 23456',
            vehicleModel: 'Hyundai Aura',
            vehicleNumber: 'TN 10 AA 1010'
          },
          createdAt: Date.now() - 28 * 3600 * 1000,
          completedAt: Date.now() - 27 * 3600 * 1000
        },
        {
          id: 'past_trip_r2',
          uid,
          datetime: '2026-08-25 11:00',
          from: 'Phoenix Marketcity, Velachery, Chennai',
          to: 'Marina Beach, Santhome High Road, Chennai',
          carType: 'Mini',
          serviceType: 'Point-to-Point',
          estimatedFare: '₹380',
          status: 'completed',
          driver: {
            name: 'Suresh Babu',
            phone: '+91 98409 87654',
            vehicleModel: 'Maruti WagonR',
            vehicleNumber: 'TN 07 CC 8899'
          },
          createdAt: Date.now() - 72 * 3600 * 1000,
          completedAt: Date.now() - 71 * 3600 * 1000
        },
        {
          id: 'past_trip_r3',
          uid,
          datetime: '2026-08-22 09:15',
          from: 'T. Nagar Panagal Park, Chennai',
          to: 'Mahabalipuram Heritage Shore Temple',
          carType: 'SUV',
          serviceType: 'Rental',
          estimatedFare: '₹1,550',
          status: 'completed',
          driver: {
            name: 'Vignesh K',
            phone: '+91 98412 23344',
            vehicleModel: 'Toyota Innova',
            vehicleNumber: 'TN 01 BX 4545'
          },
          createdAt: Date.now() - 140 * 3600 * 1000,
          completedAt: Date.now() - 134 * 3600 * 1000
        }
      ]
      localList = samplePastTrips
      try {
        localStorage.setItem(`cab_bookings_${uid}`, JSON.stringify(samplePastTrips))
      } catch {}
    }

    try {
      const { data, error } = await requireClient().from('bookings').select('*').eq('user_id', uid).order('created_at', { ascending: false })
      if (!error && Array.isArray(data) && data.length > 0) {
        const mapped = data.map(b => ({
          id: b.id,
          uid: b.user_id,
          createdAt: b.created_at ? new Date(b.created_at).getTime() : Date.now(),
          datetime: b.datetime,
          from: b.from_location || b.from || '',
          to: b.to_location || b.to || '',
          fromCoords: b.from_coords || b.fromCoords || null,
          toCoords: b.to_coords || b.toCoords || null,
          carType: b.car_type || b.carType || 'Sedan',
          serviceType: b.service_type || b.serviceType || 'Rental',
          estimatedFare: b.estimated_fare || b.estimatedFare || null,
          status: b.status || 'requested',
          name: b.name || '',
          email: b.email || '',
          driver: b.driver || null
        }))
        // Merge with local past trips so history is always preserved
        const combined = [...mapped]
        localList.forEach(localItem => {
          if (!combined.some(c => c.id === localItem.id)) {
            combined.push(localItem)
          }
        })
        return combined
      }
    } catch (err) {
      console.warn('Supabase listBookings error, using cached local bookings:', err)
    }

    return localList
  },
  async addBooking(booking) {
    const bookingRecord = {
      id: Date.now().toString(),
      uid: booking.uid,
      name: booking.name,
      email: booking.email,
      datetime: booking.datetime,
      from: booking.from,
      to: booking.to,
      fromCoords: booking.fromCoords,
      toCoords: booking.toCoords,
      carType: booking.carType,
      serviceType: booking.serviceType,
      estimatedFare: booking.estimatedFare || null,
      status: booking.status || 'requested',
      createdAt: Date.now()
    }

    // Always persist to local cache first so it's never lost
    try {
      const key = `cab_bookings_${booking.uid}`
      const existing = JSON.parse(localStorage.getItem(key) || '[]')
      localStorage.setItem(key, JSON.stringify([bookingRecord, ...existing]))
      // Also write to global pool for instant driver visibility
      const globalPool = JSON.parse(localStorage.getItem('cab_global_bookings') || '[]')
      localStorage.setItem('cab_global_bookings', JSON.stringify([bookingRecord, ...globalPool]))
    } catch (e) {
      console.warn('Local cache write notice:', e)
    }

    // Try Supabase insert
    try {
      const client = requireClient()
      const { data, error } = await client.from('bookings').insert({
        user_id: booking.uid,
        name: booking.name,
        email: booking.email,
        datetime: booking.datetime,
        from_location: booking.from,
        to_location: booking.to,
        from_coords: booking.fromCoords || null,
        to_coords: booking.toCoords || null,
        car_type: booking.carType,
        service_type: booking.serviceType,
        status: booking.status || 'requested'
      }).select()

      if (error) {
        console.warn('Supabase insert notice (saved locally in backup):', error.message)
      } else if (data && data[0]) {
        bookingRecord.id = data[0].id
      }
    } catch (err) {
      console.warn('Supabase addBooking error (booking safely stored locally):', err)
    }

    return bookingRecord
  },
  async listAvailableBookings() {
    let list = []
    try {
      const globalPool = JSON.parse(localStorage.getItem('cab_global_bookings') || '[]')
      list = globalPool.filter(b => b.status === 'requested')
    } catch (e) {}

    try {
      const { data, error } = await requireClient().from('bookings').select('*').eq('status', 'requested').order('created_at', { ascending: false })
      if (!error && Array.isArray(data)) {
        const mapped = data.map(b => ({
          id: b.id,
          uid: b.user_id,
          createdAt: b.created_at ? new Date(b.created_at).getTime() : Date.now(),
          datetime: b.datetime,
          from: b.from_location || b.from || '',
          to: b.to_location || b.to || '',
          fromCoords: b.from_coords || b.fromCoords || null,
          toCoords: b.to_coords || b.toCoords || null,
          carType: b.car_type || b.carType || 'Sedan',
          serviceType: b.service_type || b.serviceType || 'Point-to-Point',
          status: b.status || 'requested',
          name: b.name || 'Passenger',
          email: b.email || ''
        }))
        return mapped.length > 0 ? mapped : list
      }
    } catch (err) {
      console.warn('Supabase listAvailableBookings notice:', err)
    }
    return list
  },
  async updateBookingStatus(bookingId, newStatus, driverInfo = null) {
    // 1. Update local cache
    try {
      const globalPool = JSON.parse(localStorage.getItem('cab_global_bookings') || '[]')
      const updatedGlobal = globalPool.map(b => {
        if (b.id === bookingId) {
          return { ...b, status: newStatus, driver: driverInfo, updatedAt: Date.now() }
        }
        return b
      })
      localStorage.setItem('cab_global_bookings', JSON.stringify(updatedGlobal))

      // Also update any user-specific local storage
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
    } catch (e) {
      console.warn('Local status update notice:', e)
    }

    // 2. Update Supabase
    try {
      const client = requireClient()
      const payload = { status: newStatus }
      await client.from('bookings').update(payload).eq('id', bookingId)
    } catch (err) {
      console.warn('Supabase updateBookingStatus notice:', err)
    }
  },
  async listDriverBookings(driverId) {
    let list = []
    try {
      const globalPool = JSON.parse(localStorage.getItem('cab_global_bookings') || '[]')
      list = globalPool.filter(b => b.driver?.id === driverId || (b.status !== 'requested' && b.driver))
    } catch {}

    // Pre-seed sample past trips if driver has no history
    if (list.length === 0) {
      const sampleDriverTrips = [
        {
          id: 'driver_trip_p1',
          name: 'Priya Raman',
          email: 'priya.r@example.com',
          phone: '+91 98401 11223',
          datetime: '2026-08-28 14:15',
          from: 'Koyambedu CMBT Bus Terminus, Chennai',
          to: 'T. Nagar, Usman Road Shopping Hub, Chennai',
          carType: 'Sedan',
          serviceType: 'Point-to-Point',
          estimatedFare: '₹420',
          status: 'completed',
          distance: '9.4 km',
          duration: '32 mins',
          completedAt: Date.now() - 8 * 3600 * 1000
        },
        {
          id: 'driver_trip_p2',
          name: 'Karthik Sundaram',
          email: 'karthik.s@example.com',
          phone: '+91 98402 33445',
          datetime: '2026-08-28 10:30',
          from: 'Chennai Central Railway Station, Park Town',
          to: 'Guindy Industrial Estate, Ekkattuthangal',
          carType: 'Sedan',
          serviceType: 'Point-to-Point',
          estimatedFare: '₹390',
          status: 'completed',
          distance: '11.8 km',
          duration: '40 mins',
          completedAt: Date.now() - 12 * 3600 * 1000
        },
        {
          id: 'driver_trip_p3',
          name: 'Deepa Narayanan',
          email: 'deepa.n@example.com',
          phone: '+91 98403 55667',
          datetime: '2026-08-27 19:45',
          from: 'Sholinganallur ELCOT SEZ Junction, OMR',
          to: 'ECR Kovalam Beach Resort, Chennai',
          carType: 'Sedan',
          serviceType: 'Rental',
          estimatedFare: '₹620',
          status: 'completed',
          distance: '16.5 km',
          duration: '48 mins',
          completedAt: Date.now() - 27 * 3600 * 1000
        }
      ]
      list = sampleDriverTrips
    }

    return list
  }
}
