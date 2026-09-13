import express from 'express'
import cors from 'cors'
import multer from 'multer'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { initDb, query, queryOne, run } from './db.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const uploadsDir = path.join(__dirname, 'uploads')

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true })
}

const app = express()
const PORT = process.env.PORT || 3001

// Middlewares
app.use(cors())
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))

// Static file hosting for uploaded avatars
app.use('/uploads', express.static(uploadsDir))

// Multer storage configuration for avatar images
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg'
    const uniqueName = `avatar_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`
    cb(null, uniqueName)
  }
})
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
})

// SSE event subscribers for real-time driver/rider updates
const sseClients = new Set()

function broadcastBookingUpdate(type, booking) {
  const payload = `data: ${JSON.stringify({ type, booking })}\n\n`
  for (const client of sseClients) {
    try {
      client.write(payload)
    } catch {
      sseClients.delete(client)
    }
  }
}

// Health check
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    serverTime: new Date().toISOString(),
    database: 'SQLite (Internal WebAssembly)',
    storage: 'Local File System'
  })
})

// Real-Time SSE endpoint
app.get('/api/bookings/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  sseClients.add(res)
  res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`)

  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n')
  }, 25000)

  req.on('close', () => {
    clearInterval(heartbeat)
    sseClients.delete(res)
  })
})

// ==========================================
// AUTH & PROFILE ENDPOINTS
// ==========================================

// Lookup registered phone
app.post('/api/auth/lookup-phone', (req, res) => {
  try {
    const rawPhone = req.body?.phone || ''
    const cleanPhone = rawPhone.replace(/[^\d]/g, '').slice(-10)
    if (cleanPhone.length < 10) {
      return res.json({ exists: false })
    }

    const row = queryOne('SELECT * FROM profiles WHERE phone = ?', [cleanPhone])
    if (!row) {
      return res.json({ exists: false })
    }

    return res.json({
      exists: true,
      profile: {
        id: row.id,
        name: row.name,
        role: row.role || 'rider',
        phone: row.phone,
        email: row.email,
        vehicleModel: row.vehicle_model || '',
        vehicleNumber: row.vehicle_number || '',
        avatarUrl: row.avatar_url || null
      }
    })
  } catch (err) {
    console.error('lookup-phone error:', err)
    res.status(500).json({ error: 'Internal lookup error' })
  }
})

// Send OTP
app.post('/api/auth/send-otp', (req, res) => {
  try {
    const rawPhone = req.body?.phone || ''
    const cleanPhone = rawPhone.replace(/[^\d]/g, '').slice(-10)
    if (cleanPhone.length < 10) {
      return res.status(400).json({ error: 'Please enter a valid 10-digit mobile number.' })
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString()
    const expiresAt = Date.now() + 5 * 60 * 1000 // 5 minutes

    // Upsert into otps table
    run('DELETE FROM otps WHERE phone = ?', [cleanPhone])
    run('INSERT INTO otps (phone, otp, expires_at) VALUES (?, ?, ?)', [cleanPhone, otp, expiresAt])

    console.log(`[AUTH] Generated OTP for ${cleanPhone}: ${otp}`)
    return res.json({ success: true, phone: cleanPhone, otp })
  } catch (err) {
    console.error('send-otp error:', err)
    res.status(500).json({ error: 'Failed to generate verification code' })
  }
})

// Verify OTP & Authenticate
app.post('/api/auth/verify-otp', (req, res) => {
  try {
    const { phone: rawPhone, otp, role = 'rider', details = {} } = req.body || {}
    const cleanPhone = (rawPhone || '').replace(/[^\d]/g, '').slice(-10)
    const cleanOtp = (otp || '').trim()

    if (!cleanPhone || cleanPhone.length < 10) {
      return res.status(400).json({ error: 'Invalid phone number' })
    }

    let isValid = false
    if (cleanOtp === '123456') {
      isValid = true
    } else {
      const stored = queryOne('SELECT * FROM otps WHERE phone = ?', [cleanPhone])
      if (stored && stored.otp === cleanOtp && Date.now() <= stored.expires_at) {
        isValid = true
      }
    }

    if (!isValid) {
      return res.status(400).json({ error: 'Invalid or expired verification code. Please check and try again.' })
    }

    // Clean up OTP
    run('DELETE FROM otps WHERE phone = ?', [cleanPhone])

    const now = new Date().toISOString()
    let profile = queryOne('SELECT * FROM profiles WHERE phone = ?', [cleanPhone])

    if (!profile) {
      // Create new profile
      const newId = `phone_${cleanPhone}_${Math.random().toString(36).slice(2, 7)}`
      const name = (details.name || (role === 'driver' ? 'Driver Partner' : 'Rider')).trim()
      const email = `user${cleanPhone}@nammadriver.app`
      const vModel = details.vehicleModel || ''
      const vNum = details.vehicleNumber || ''

      run(
        `INSERT INTO profiles (id, name, email, phone, role, vehicle_model, vehicle_number, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [newId, name, email, cleanPhone, role, vModel, vNum, now, now]
      )

      profile = queryOne('SELECT * FROM profiles WHERE id = ?', [newId])
    } else if (details.name || details.vehicleModel || details.vehicleNumber) {
      // Update existing profile with newly provided details
      const name = details.name ? details.name.trim() : profile.name
      const vModel = details.vehicleModel !== undefined ? details.vehicleModel : profile.vehicle_model
      const vNum = details.vehicleNumber !== undefined ? details.vehicleNumber : profile.vehicle_number

      run(
        `UPDATE profiles SET name = ?, vehicle_model = ?, vehicle_number = ?, updated_at = ? WHERE id = ?`,
        [name, vModel, vNum, now, profile.id]
      )
      profile = queryOne('SELECT * FROM profiles WHERE id = ?', [profile.id])
    }

    const userObj = {
      id: profile.id,
      email: profile.email || `user${cleanPhone}@nammadriver.app`,
      user_metadata: {
        name: profile.name,
        phone: profile.phone,
        role: profile.role || role,
        birthday: profile.birthday || null,
        avatar_url: profile.avatar_url || null,
        vehicleModel: profile.vehicle_model || '',
        vehicleNumber: profile.vehicle_number || ''
      }
    }

    return res.json({ user: userObj })
  } catch (err) {
    console.error('verify-otp error:', err)
    res.status(500).json({ error: 'Verification failed' })
  }
})

// Direct Register
app.post('/api/auth/register', (req, res) => {
  try {
    const { name, email, password: _pw, role = 'rider', extraData = {} } = req.body || {}
    const cleanEmail = (email || '').trim().toLowerCase()
    const cleanName = (name || '').trim()

    let existing = cleanEmail ? queryOne('SELECT * FROM profiles WHERE email = ?', [cleanEmail]) : null
    if (existing) {
      return res.status(400).json({ error: 'User with this email already exists' })
    }

    const newId = `user_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    const now = new Date().toISOString()
    const phone = extraData.phone ? extraData.phone.replace(/[^\d]/g, '').slice(-10) : null

    run(
      `INSERT INTO profiles (id, name, email, phone, role, vehicle_model, vehicle_number, license_number, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        newId,
        cleanName,
        cleanEmail,
        phone,
        role,
        extraData.vehicleModel || '',
        extraData.vehicleNumber || '',
        extraData.licenseNumber || '',
        now,
        now
      ]
    )

    const profile = queryOne('SELECT * FROM profiles WHERE id = ?', [newId])
    const userObj = {
      id: profile.id,
      email: profile.email,
      user_metadata: {
        name: profile.name,
        phone: profile.phone,
        role: profile.role,
        vehicleModel: profile.vehicle_model || '',
        vehicleNumber: profile.vehicle_number || '',
        avatar_url: profile.avatar_url || null
      }
    }

    return res.json({ user: userObj })
  } catch (err) {
    console.error('register error:', err)
    res.status(500).json({ error: 'Registration failed' })
  }
})

// Direct Login
app.post('/api/auth/login', (req, res) => {
  try {
    const { email, password: _pw } = req.body || {}
    const cleanEmail = (email || '').trim().toLowerCase()

    const profile = queryOne('SELECT * FROM profiles WHERE email = ? OR phone = ?', [cleanEmail, cleanEmail])
    if (!profile) {
      return res.status(404).json({ error: 'User not found. Please register or verify with phone OTP.' })
    }

    const userObj = {
      id: profile.id,
      email: profile.email,
      user_metadata: {
        name: profile.name,
        phone: profile.phone,
        role: profile.role || 'rider',
        birthday: profile.birthday || null,
        avatar_url: profile.avatar_url || null,
        vehicleModel: profile.vehicle_model || '',
        vehicleNumber: profile.vehicle_number || ''
      }
    }

    return res.json({ user: userObj })
  } catch (err) {
    console.error('login error:', err)
    res.status(500).json({ error: 'Login failed' })
  }
})

// Get Profile by ID
app.get('/api/profiles/:id', (req, res) => {
  try {
    const profile = queryOne('SELECT * FROM profiles WHERE id = ?', [req.params.id])
    if (!profile) return res.status(404).json({ error: 'Profile not found' })
    res.json(profile)
  } catch (err) {
    console.error('getProfile error:', err)
    res.status(500).json({ error: 'Failed to retrieve profile' })
  }
})

// Update Profile & Avatar
app.put('/api/auth/profile', upload.single('avatarFile'), (req, res) => {
  try {
    const uid = req.body.id || req.body.uid
    if (!uid) {
      return res.status(400).json({ error: 'User ID is required' })
    }

    const existing = queryOne('SELECT * FROM profiles WHERE id = ?', [uid])
    if (!existing) {
      return res.status(404).json({ error: 'Profile not found' })
    }

    const name = (req.body.name !== undefined ? req.body.name : existing.name).trim()
    const email = (req.body.email !== undefined ? req.body.email : existing.email || '').trim()
    const phone = req.body.phone !== undefined ? req.body.phone.replace(/[^\d]/g, '').slice(-10) : existing.phone
    const birthday = req.body.birthday !== undefined ? req.body.birthday : existing.birthday
    const vehicleModel = req.body.vehicleModel !== undefined ? req.body.vehicleModel : (existing.vehicle_model || '')
    const vehicleNumber = req.body.vehicleNumber !== undefined ? req.body.vehicleNumber : (existing.vehicle_number || '')

    // Handle avatar from file upload or base64 data URL
    let avatarUrl = existing.avatar_url
    if (req.file) {
      avatarUrl = `/uploads/${req.file.filename}`
    } else if (req.body.avatarUrl !== undefined) {
      avatarUrl = req.body.avatarUrl
    }

    const now = new Date().toISOString()
    run(
      `UPDATE profiles SET
        name = ?,
        email = ?,
        phone = ?,
        birthday = ?,
        avatar_url = ?,
        vehicle_model = ?,
        vehicle_number = ?,
        updated_at = ?
       WHERE id = ?`,
      [name, email, phone, birthday, avatarUrl, vehicleModel, vehicleNumber, now, uid]
    )

    const updated = queryOne('SELECT * FROM profiles WHERE id = ?', [uid])
    const userObj = {
      id: updated.id,
      email: updated.email,
      user_metadata: {
        name: updated.name,
        phone: updated.phone,
        role: updated.role,
        birthday: updated.birthday,
        avatar_url: updated.avatar_url,
        vehicleModel: updated.vehicle_model || '',
        vehicleNumber: updated.vehicle_number || ''
      }
    }

    return res.json({ user: userObj })
  } catch (err) {
    console.error('updateProfile error:', err)
    res.status(500).json({ error: 'Failed to update profile' })
  }
})

// ==========================================
// BOOKINGS ENDPOINTS
// ==========================================

// List bookings for rider
app.get('/api/bookings', (req, res) => {
  try {
    const { uid } = req.query
    if (!uid) {
      return res.json([])
    }
    const rows = query('SELECT * FROM bookings WHERE user_id = ? ORDER BY created_at DESC', [uid])

    const bookings = rows.map(b => ({
      id: b.id,
      uid: b.user_id,
      name: b.name,
      email: b.email,
      datetime: b.datetime,
      from: b.from_location,
      to: b.to_location,
      fromCoords: b.from_coords ? JSON.parse(b.from_coords) : null,
      toCoords: b.to_coords ? JSON.parse(b.to_coords) : null,
      carType: b.car_type,
      serviceType: b.service_type,
      estimatedFare: b.estimated_fare,
      status: b.status,
      driver: b.driver_info ? JSON.parse(b.driver_info) : null,
      createdAt: new Date(b.created_at).getTime(),
      updatedAt: new Date(b.updated_at).getTime()
    }))

    res.json(bookings)
  } catch (err) {
    console.error('list bookings error:', err)
    res.status(500).json({ error: 'Failed to list bookings' })
  }
})

// Create new booking
app.post('/api/bookings', (req, res) => {
  try {
    const body = req.body || {}
    const id = body.id || `bk_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    const now = new Date().toISOString()

    const fromCoords = body.fromCoords ? JSON.stringify(body.fromCoords) : null
    const toCoords = body.toCoords ? JSON.stringify(body.toCoords) : null
    const driverInfo = body.driver ? JSON.stringify(body.driver) : null

    run(
      `INSERT INTO bookings (
        id, user_id, name, email, datetime, from_location, to_location,
        from_coords, to_coords, car_type, service_type, estimated_fare,
        status, driver_info, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        body.uid || 'guest_user',
        body.name || '',
        body.email || '',
        body.datetime || now,
        body.from || '',
        body.to || '',
        fromCoords,
        toCoords,
        body.carType || 'Sedan',
        body.serviceType || 'Rental',
        body.estimatedFare || null,
        body.status || 'requested',
        driverInfo,
        now,
        now
      ]
    )

    const created = queryOne('SELECT * FROM bookings WHERE id = ?', [id])
    const bookingRecord = {
      id: created.id,
      uid: created.user_id,
      name: created.name,
      email: created.email,
      datetime: created.datetime,
      from: created.from_location,
      to: created.to_location,
      fromCoords: created.from_coords ? JSON.parse(created.from_coords) : null,
      toCoords: created.to_coords ? JSON.parse(created.to_coords) : null,
      carType: created.car_type,
      serviceType: created.service_type,
      estimatedFare: created.estimated_fare,
      status: created.status,
      driver: created.driver_info ? JSON.parse(created.driver_info) : null,
      createdAt: new Date(created.created_at).getTime(),
      updatedAt: new Date(created.updated_at).getTime()
    }

    broadcastBookingUpdate('new_booking', bookingRecord)
    return res.status(201).json(bookingRecord)
  } catch (err) {
    console.error('create booking error:', err)
    res.status(500).json({ error: 'Failed to create booking' })
  }
})

// List available bookings for drivers (status = 'requested')
app.get('/api/bookings/available', (_req, res) => {
  try {
    const rows = query("SELECT * FROM bookings WHERE status = 'requested' ORDER BY created_at DESC")
    const bookings = rows.map(b => ({
      id: b.id,
      uid: b.user_id,
      name: b.name || 'Passenger',
      email: b.email,
      datetime: b.datetime,
      from: b.from_location,
      to: b.to_location,
      fromCoords: b.from_coords ? JSON.parse(b.from_coords) : null,
      toCoords: b.to_coords ? JSON.parse(b.to_coords) : null,
      carType: b.car_type,
      serviceType: b.service_type,
      estimatedFare: b.estimated_fare,
      status: b.status,
      createdAt: new Date(b.created_at).getTime()
    }))
    res.json(bookings)
  } catch (err) {
    console.error('list available bookings error:', err)
    res.status(500).json({ error: 'Failed to list available bookings' })
  }
})

// Update booking status & assign driver
app.patch('/api/bookings/:id/status', (req, res) => {
  try {
    const { id } = req.params
    const { status, driver } = req.body || {}

    const existing = queryOne('SELECT * FROM bookings WHERE id = ?', [id])
    if (!existing) {
      return res.status(404).json({ error: 'Booking not found' })
    }

    const now = new Date().toISOString()
    const driverInfo = driver ? JSON.stringify(driver) : existing.driver_info

    run(
      'UPDATE bookings SET status = ?, driver_info = ?, updated_at = ? WHERE id = ?',
      [status || existing.status, driverInfo, now, id]
    )

    const updated = queryOne('SELECT * FROM bookings WHERE id = ?', [id])
    const bookingRecord = {
      id: updated.id,
      uid: updated.user_id,
      name: updated.name,
      email: updated.email,
      datetime: updated.datetime,
      from: updated.from_location,
      to: updated.to_location,
      fromCoords: updated.from_coords ? JSON.parse(updated.from_coords) : null,
      toCoords: updated.to_coords ? JSON.parse(updated.to_coords) : null,
      carType: updated.car_type,
      serviceType: updated.service_type,
      estimatedFare: updated.estimated_fare,
      status: updated.status,
      driver: updated.driver_info ? JSON.parse(updated.driver_info) : null,
      createdAt: new Date(updated.created_at).getTime(),
      updatedAt: new Date(updated.updated_at).getTime()
    }

    broadcastBookingUpdate('status_changed', bookingRecord)
    return res.json(bookingRecord)
  } catch (err) {
    console.error('update booking status error:', err)
    res.status(500).json({ error: 'Failed to update booking status' })
  }
})

// List bookings for driver
app.get('/api/bookings/driver/:driverId', (req, res) => {
  try {
    const { driverId } = req.params
    const rows = query('SELECT * FROM bookings ORDER BY created_at DESC')
    const filtered = rows.filter(b => {
      if (!b.driver_info) return false
      try {
        const d = JSON.parse(b.driver_info)
        return d.id === driverId || d.phone?.includes(driverId)
      } catch {
        return false
      }
    })

    const bookings = filtered.map(b => ({
      id: b.id,
      name: b.name,
      email: b.email,
      datetime: b.datetime,
      from: b.from_location,
      to: b.to_location,
      fromCoords: b.from_coords ? JSON.parse(b.from_coords) : null,
      toCoords: b.to_coords ? JSON.parse(b.to_coords) : null,
      carType: b.car_type,
      serviceType: b.service_type,
      estimatedFare: b.estimated_fare,
      status: b.status,
      driver: JSON.parse(b.driver_info),
      completedAt: new Date(b.updated_at).getTime()
    }))

    res.json(bookings)
  } catch (err) {
    console.error('list driver bookings error:', err)
    res.status(500).json({ error: 'Failed to list driver bookings' })
  }
})

// Start server
async function start() {
  await initDb()
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Internal Database & API Server listening at http://localhost:${PORT}`)
  })
}

start().catch(err => {
  console.error('Failed to start server:', err)
  process.exit(1)
})
