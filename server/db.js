import initSqlJs from 'sql.js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dataDir = path.join(__dirname, 'data')
const dbPath = path.join(dataDir, 'namma_driver.db')

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true })
}

let db = null

export async function initDb() {
  if (db) return db

  const SQL = await initSqlJs()

  if (fs.existsSync(dbPath)) {
    try {
      const fileBuffer = fs.readFileSync(dbPath)
      db = new SQL.Database(fileBuffer)
      console.log('Loaded existing internal SQLite database from:', dbPath)
    } catch (err) {
      console.warn('Could not read existing database, initializing new database:', err.message)
      db = new SQL.Database()
    }
  } else {
    db = new SQL.Database()
    console.log('Created fresh internal SQLite database at:', dbPath)
  }

  // Run schema setup
  db.run(`
    CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT,
      phone TEXT UNIQUE,
      role TEXT DEFAULT 'rider',
      birthday TEXT,
      avatar_url TEXT,
      vehicle_model TEXT,
      vehicle_number TEXT,
      license_number TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS bookings (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT,
      email TEXT,
      datetime TEXT NOT NULL,
      from_location TEXT NOT NULL,
      to_location TEXT NOT NULL,
      from_coords TEXT,
      to_coords TEXT,
      car_type TEXT NOT NULL,
      service_type TEXT NOT NULL,
      estimated_fare TEXT,
      status TEXT NOT NULL DEFAULT 'requested',
      driver_info TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS otps (
      phone TEXT PRIMARY KEY,
      otp TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
  `)

  // Save after migrations
  saveDb()

  // Seed default test profiles and trips if not present
  seedDefaultData()

  return db
}

export function saveDb() {
  if (!db) return
  try {
    const data = db.export()
    fs.writeFileSync(dbPath, Buffer.from(data))
  } catch (err) {
    console.error('Failed to persist SQLite database to disk:', err)
  }
}

export function query(sql, params = []) {
  if (!db) throw new Error('Database is not initialized')
  const stmt = db.prepare(sql)
  if (params && params.length > 0) {
    stmt.bind(params)
  }
  const rows = []
  while (stmt.step()) {
    rows.push(stmt.getAsObject())
  }
  stmt.free()
  return rows
}

export function queryOne(sql, params = []) {
  const rows = query(sql, params)
  return rows.length > 0 ? rows[0] : null
}

export function run(sql, params = []) {
  if (!db) throw new Error('Database is not initialized')
  db.run(sql, params)
  saveDb()
}

function seedDefaultData() {
  const now = new Date().toISOString()

  // 1. Seed Test Rider
  const rider = queryOne('SELECT * FROM profiles WHERE phone = ?', ['9876543210'])
  if (!rider) {
    run(
      `INSERT INTO profiles (id, name, email, phone, role, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        'dev_rider_88129',
        'Ajai Krishnan',
        'rider@nammadriver.app',
        '9876543210',
        'rider',
        now,
        now
      ]
    )
  }

  // 2. Seed Test Driver
  const driver = queryOne('SELECT * FROM profiles WHERE phone = ?', ['9876543211'])
  if (!driver) {
    run(
      `INSERT INTO profiles (id, name, email, phone, role, vehicle_model, vehicle_number, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'dev_driver_4e832',
        'Test Driver (Dev)',
        'testdriver@nd.com',
        '9876543211',
        'driver',
        'Hyundai Aura',
        'TN 10 AA 1010',
        now,
        now
      ]
    )
  }

  // 3. Seed dummy trips ONLY for Quick Test Accounts (9876543210 & 9876543211)
  // New users will NEVER see these because queries strictly filter by user_id
  const existingTestTrips = query("SELECT id FROM bookings WHERE user_id = 'dev_rider_88129' OR id LIKE 'test_%'")
  if (existingTestTrips.length === 0) {
    const todayStr = new Date().toISOString().split('T')[0]
    const currentHour = new Date().getHours()
    const nextHourStr = `${todayStr} ${String((currentHour + 2) % 24).padStart(2, '0')}:00`
    const currentHourStr = `${todayStr} ${String(currentHour).padStart(2, '0')}:15`

    const testDriverInfo = {
      id: 'dev_driver_4e832',
      name: 'Test Driver (Dev)',
      phone: '+91 98765 43211',
      vehicleModel: 'Hyundai Aura',
      vehicleNumber: 'TN 10 AA 1010'
    }

    const testRiderTrips = [
      // A. LIVE REQUESTED: Test Driver can test "Accept Ride" button in live queue
      {
        id: 'test_bk_requested',
        user_id: 'dev_rider_88129',
        name: 'Ajai Krishnan',
        email: 'rider@nammadriver.app',
        datetime: nextHourStr,
        from_location: 'Chennai Central Railway Station, Park Town',
        to_location: 'Phoenix Marketcity, Velachery, Chennai',
        from_coords: JSON.stringify([13.0827, 80.2757]),
        to_coords: JSON.stringify([12.9925, 80.2173]),
        car_type: 'Sedan',
        service_type: 'Point-to-Point',
        estimated_fare: '₹420',
        status: 'requested',
        driver_info: null,
        created_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
        updated_at: new Date(Date.now() - 5 * 60 * 1000).toISOString()
      },
      // B. ACTIVE EN-ROUTE: Driver can test "Start Trip" & "Complete Trip"; Rider can test active driver card
      {
        id: 'test_bk_active',
        user_id: 'dev_rider_88129',
        name: 'Ajai Krishnan',
        email: 'rider@nammadriver.app',
        datetime: currentHourStr,
        from_location: 'OMR IT Corridor, Thoraipakkam, Chennai',
        to_location: 'Marina Beach, Santhome High Road, Chennai',
        from_coords: JSON.stringify([12.9348, 80.2289]),
        to_coords: JSON.stringify([13.0499, 80.2824]),
        car_type: 'Sedan',
        service_type: 'Point-to-Point',
        estimated_fare: '₹510',
        status: 'accepted',
        driver_info: JSON.stringify(testDriverInfo),
        created_at: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
        updated_at: new Date(Date.now() - 10 * 60 * 1000).toISOString()
      },
      // C. COMPLETED (Point-to-Point): Tests receipt modal, payout breakdown, and completed trips filter
      {
        id: 'test_bk_completed_1',
        user_id: 'dev_rider_88129',
        name: 'Ajai Krishnan',
        email: 'rider@nammadriver.app',
        datetime: '2026-09-12 16:30',
        from_location: 'Chennai International Airport (MAA), Meenambakkam',
        to_location: 'T. Nagar Panagal Park, Chennai',
        from_coords: JSON.stringify([12.9856, 80.1636]),
        to_coords: JSON.stringify([13.0405, 80.2337]),
        car_type: 'Sedan',
        service_type: 'Point-to-Point',
        estimated_fare: '₹640',
        status: 'completed',
        driver_info: JSON.stringify(testDriverInfo),
        created_at: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
        updated_at: new Date(Date.now() - 23 * 3600 * 1000).toISOString()
      },
      // D. COMPLETED (Rental / Outstation): Tests Rental car pricing receipt and driver earnings log
      {
        id: 'test_bk_completed_2',
        user_id: 'dev_rider_88129',
        name: 'Ajai Krishnan',
        email: 'rider@nammadriver.app',
        datetime: '2026-09-10 09:15',
        from_location: 'Guindy Industrial Estate, Ekkattuthangal, Chennai',
        to_location: 'Mahabalipuram Heritage Shore Temple, ECR',
        from_coords: JSON.stringify([13.0067, 80.2023]),
        to_coords: JSON.stringify([12.6186, 80.1983]),
        car_type: 'SUV',
        service_type: 'Rental',
        estimated_fare: '₹1,550',
        status: 'completed',
        driver_info: JSON.stringify(testDriverInfo),
        created_at: new Date(Date.now() - 72 * 3600 * 1000).toISOString(),
        updated_at: new Date(Date.now() - 66 * 3600 * 1000).toISOString()
      },
      // E. CANCELLED: Tests the "Cancelled" status tab filter in rider trip history
      {
        id: 'test_bk_cancelled',
        user_id: 'dev_rider_88129',
        name: 'Ajai Krishnan',
        email: 'rider@nammadriver.app',
        datetime: '2026-09-08 20:00',
        from_location: 'Koyambedu CMBT Bus Terminus, Chennai',
        to_location: 'Besant Nagar Elliot Beach, Chennai',
        from_coords: JSON.stringify([13.0694, 80.1948]),
        to_coords: JSON.stringify([12.9994, 80.2709]),
        car_type: 'Mini',
        service_type: 'Point-to-Point',
        estimated_fare: '₹340',
        status: 'cancelled',
        driver_info: null,
        created_at: new Date(Date.now() - 120 * 3600 * 1000).toISOString(),
        updated_at: new Date(Date.now() - 119 * 3600 * 1000).toISOString()
      }
    ]

    for (const trip of testRiderTrips) {
      run(
        `INSERT INTO bookings (
          id, user_id, name, email, datetime, from_location, to_location,
          from_coords, to_coords, car_type, service_type, estimated_fare,
          status, driver_info, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          trip.id,
          trip.user_id,
          trip.name,
          trip.email,
          trip.datetime,
          trip.from_location,
          trip.to_location,
          trip.from_coords,
          trip.to_coords,
          trip.car_type,
          trip.service_type,
          trip.estimated_fare,
          trip.status,
          trip.driver_info,
          trip.created_at,
          trip.updated_at
        ]
      )
    }
  }
}
