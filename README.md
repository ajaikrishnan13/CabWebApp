# Namma Driver — Private Car Service

A modern web application for cab booking, rental, and driver partner services.

## Features
- **Frontend**: React 18 + Vite (SPA)
- **Database**: Internal SQLite database (`server/data/namma_driver.db`) via `sql.js` (WebAssembly)
- **Backend API**: Express REST API (`server/index.js`) with Server-Sent Events (SSE) for real-time driver coordination
- **Mapping & Routing**: Leaflet (OpenStreetMap) with Google Maps / ArcGIS geocoding support
- **Zero Cloud Subscriptions**: Runs 100% self-hosted on your machine or private server

---

## Getting Started

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment
Set your Google Maps API key in `.env`:
```env
VITE_GOOGLE_MAPS_API_KEY=AIzaSy...
```

### 3. Run Development Server
```bash
npm run dev
```
This automatically starts both the internal API database server on port `3001` and the Vite dev server on port `5174` (reverse-proxied).

---

## Test Accounts
- **Rider**: `9876543210` (OTP: `123456`)
- **Driver**: `9876543211` (OTP: `123456`)

---

## Production Build
```bash
npm run build
```
Generates production-ready static assets in the `dist/` folder.
