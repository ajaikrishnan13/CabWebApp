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

export const auth = {
  subscribe(listener) {
    if (!supabase) return () => {}
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => listener(session?.user || null))
    supabase.auth.getSession().then(({ data: { session } }) => listener(session?.user || null))
    return () => subscription.unsubscribe()
  },
  async register(name, email, password) {
    const { error } = await requireClient().auth.signUp({ email: email.trim(), password, options: { data: { name: name.trim() } } })
    if (error) throw error
  },
  async login(email, password) {
    const { error } = await requireClient().auth.signInWithPassword({ email: email.trim(), password })
    if (error) throw error
  },
  async signOut() {
    const { error } = await requireClient().auth.signOut()
    if (error) throw error
  },
  async updateProfile(profile, avatarFile) {
    const client = requireClient()
    const { data: { user: currentUser }, error: sessionError } = await client.auth.getUser()
    if (sessionError || !currentUser) throw sessionError || new Error('Your session has expired. Please sign in again.')

    let avatarUrl = profile.avatarUrl !== undefined ? profile.avatarUrl : null

    if (avatarFile) {
      // 1. Generate optimized client-side data URL as instant reliable fallback
      let fallbackDataUrl = null
      try {
        fallbackDataUrl = await fileToDataUrl(avatarFile, 320, 0.82)
        avatarUrl = fallbackDataUrl
      } catch (e) {
        console.warn('Canvas conversion notice:', e)
      }

      // 2. Try Supabase Storage upload
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
          console.warn('Supabase storage upload notice (using optimized image data URL instead):', uploadError.message)
          avatarUrl = fallbackDataUrl || avatarUrl
        }
      } catch (err) {
        console.warn('Storage upload error (using optimized image data URL instead):', err)
        avatarUrl = fallbackDataUrl || avatarUrl
      }
    }

    const cleanName = (profile.name || '').trim()
    const cleanPhone = (profile.phone || '').trim()
    const cleanEmail = (profile.email || currentUser.email || '').trim()
    const cleanBirthday = profile.birthday || null

    const updatePayload = {
      data: {
        name: cleanName,
        phone: cleanPhone,
        birthday: cleanBirthday,
        avatar_url: avatarUrl
      }
    }

    // Only update auth email if explicitly changed
    if (cleanEmail && cleanEmail.toLowerCase() !== (currentUser.email || '').toLowerCase()) {
      updatePayload.email = cleanEmail
    }

    const { data: authResult, error: authError } = await client.auth.updateUser(updatePayload)
    if (authError) throw authError

    const activeUser = authResult?.user || currentUser

    // Persist to profiles table
    try {
      const { error: profileError } = await client.from('profiles').upsert({
        id: activeUser.id,
        name: cleanName,
        email: cleanEmail,
        phone: cleanPhone || null,
        birthday: cleanBirthday,
        avatar_url: avatarUrl,
        updated_at: new Date().toISOString()
      })
      if (profileError) console.warn('Profiles table sync notice:', profileError.message)
    } catch (err) {
      console.warn('Profiles sync error:', err)
    }

    return {
      ...activeUser,
      user_metadata: {
        ...activeUser.user_metadata,
        name: cleanName,
        phone: cleanPhone,
        birthday: cleanBirthday,
        avatar_url: avatarUrl
      }
    }
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
    const { data, error } = await requireClient().from('bookings').select('*').eq('user_id', uid).order('created_at', { ascending: false })
    if (error) throw error
    return data.map(booking => ({ ...booking, id: booking.id, uid: booking.user_id, createdAt: new Date(booking.created_at).getTime(), from: booking.from_location, to: booking.to_location, fromCoords: booking.from_coords, toCoords: booking.to_coords, carType: booking.car_type, serviceType: booking.service_type }))
  },
  async addBooking(booking) {
    const { error } = await requireClient().from('bookings').insert({ user_id: booking.uid, name: booking.name, email: booking.email, datetime: booking.datetime, from_location: booking.from, to_location: booking.to, from_coords: booking.fromCoords, to_coords: booking.toCoords, car_type: booking.carType, service_type: booking.serviceType, status: booking.status })
    if (error) throw error
  }
}
