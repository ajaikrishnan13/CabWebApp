Namma Driver — Starter

This is a minimal starter implementing:
- React + Vite front-end
- Supabase Auth and Postgres for users & bookings
- Leaflet (OpenStreetMap) for map interaction

What to do next:
1. Install dependencies:
   npm install

3. Configure Supabase:
   - Create a free project at https://supabase.com/
   - Copy `.env.example` to `.env` and add the project URL and anon key from Project Settings → API.
   - Run the SQL in `supabase-schema.sql` in the Supabase SQL Editor.
   - This creates the bookings and profiles tables, security policies, and a profile trigger for new users.
   - Enable email authentication under Authentication → Providers.

4. Run the app locally:
   npm run dev

Notes:
- User accounts are managed securely by Supabase Auth.
- Booking requests are stored in Supabase Postgres with Row Level Security, so users can only access their own bookings.
- Users can update their name, email, phone number, and birthday from the profile button in the home header.
- Location search uses ArcGIS World Geocoding with India restricted as the search country.
- Route preview uses Leaflet with the free OSRM driving-route service and shows the route line, distance, and ETA after both stops are selected.
- The app shows a combined Register / Sign In screen and a Home booking screen after auth.
- Replace /public/logo.png with your logo file (or update the image path in src/pages/Auth.jsx).
If you'd like, next steps can include:
- Adding address autocomplete with a geocoding service
- Adding server-side validation / Cloud Functions for pricing and driver assignment
- Improving UI styling (Tailwind or design system)
