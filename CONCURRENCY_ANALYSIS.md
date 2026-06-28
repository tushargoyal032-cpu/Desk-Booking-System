# Seat Booking System — Concurrency Analysis

## Current Architecture (BEFORE)
- **Pure client-side HTML/CSS/JS**
- **Persistence:** `localStorage` only (per-browser, isolated)
- **Sync:** `window.addEventListener('storage', …)` — only works across tabs **in the same browser profile on the same machine**
- **No backend server**

## Why It CANNOT Handle 1000 Concurrent Users

### 1. No Shared State Between Users
`localStorage` is **browser-isolated**. If User A is on Chrome and User B is on Chrome on a different laptop, they have **completely independent data stores**. Each user sees all 500 seats as "available" until they themselves book. There is no central truth.

### 2. Guaranteed Race Conditions (Double Booking)
At 1:00 PM, 1000 users open the site. The booking flow is:
```javascript
if (!seatAlreadyBooked(seatId, dateISO)) {   // ← reads localStorage
    bookings[dateISO][seatId] = userId;       // ← writes localStorage
    setBookingsStore(bookings);                // ← async, not atomic
}
```
- **Read** and **write** are two separate, non-atomic operations.
- Two users can read "available" at the same millisecond, then both write.
- Result: **the same seat is booked by multiple users**, and total bookings can exceed 500.

### 3. `localStorage` Size Limits
Browsers cap `localStorage` at ~5–10 MB. With 1000 users, lifecycle logs, and booking history, the store will overflow and start throwing `QuotaExceededError`.

### 4. No Rate Limiting or Abuse Protection
A malicious user can spam the Book button with a script, creating hundreds of bookings per second.

### 5. No Queue / Waitlist
When all 500 seats are taken, the 501st user gets an error. There is no way to capture demand and auto-assign seats when cancellations occur.

### 6. Trivially Forgeable Sessions
The admin password is hardcoded in JavaScript (`Password-123`). User sessions are just `localStorage` strings with no cryptographic signature.

---

## New Architecture (AFTER)

### Backend: Node.js + Express + SQLite + WebSocket
1. **SQLite** with `IMMEDIATE` transactions for ACID guarantees.
2. **Unique constraints** on `(date_iso, seat_id)` and `(user_id, date_iso)` — the database enforces "one seat, one user" at the hardware level.
3. **WebSocket** broadcasts real-time seat availability to all connected clients.
4. **Rate limiting** — max 10 booking attempts per minute per IP/user.
5. **Waiting list queue** — users join a queue when seats are full; auto-promoted on cancellation.
6. **JWT sessions** for admin and user auth.
7. **Express static file serving** — frontend files served from the same origin.

### Frontend Changes
- All `localStorage` reads/writes for bookings replaced with `fetch()` calls to `/api/*`.
- WebSocket connection for real-time seat updates.
- Visual queue position indicator.
- Graceful handling of "seat taken while you were selecting" conflicts.

---

## How Atomic Booking Works (The Key Fix)

```javascript
// BEGIN IMMEDIATE TRANSACTION  ← acquires SQLite write lock
//    SELECT * FROM bookings WHERE date_iso = ? AND seat_id = ?
//    IF found → ROLLBACK, return "already booked"
//    SELECT * FROM bookings WHERE date_iso = ? AND user_id = ?
//    IF found → ROLLBACK, return "user already booked"
//    INSERT INTO bookings (user_id, seat_id, date_iso, status)
//    INSERT INTO lifecycle_logs (user_id, date_iso, seat_id, status)
// COMMIT  ← lock released, all other clients see the new state
```

SQLite in `IMMEDIATE` mode guarantees that **only one transaction can write at a time**. The 1000th user will wait in line, see the seat is taken, and get a clear error — never a double booking.

---

## How the Queue Works

1. User tries to book → all 500 seats taken.
2. User clicks "Join Waiting List" → inserted into `waiting_list` table with `position`.
3. If another user cancels, the backend:
   - Finds the first waiting user for that date.
   - Atomically assigns the freed seat.
   - Broadcasts via WebSocket: `{"type":"SEAT_FREED","seatId":"042","newUserId":"507"}`.
4. The promoted user's UI auto-updates to show their new booking.

---

## File Changes Summary

| File | Action | Purpose |
|------|--------|---------|
| `server/package.json` | **New** | Dependencies (express, better-sqlite3, ws, jsonwebtoken, express-rate-limit) |
| `server/database.js` | **New** | SQLite schema, connection, atomic booking function, queue logic |
| `server/server.js` | **New** | Express API + WebSocket server + rate limiting |
| `index.html` | **Minor** | No material changes (same structure) |
| `script.js` | **Major rewrite** | API calls, WebSocket, real-time UI, conflict handling |
| `login.html` | **Minor** | API login instead of localStorage match |
| `admin.html` | **Moderate** | API calls for admin ops, user import, lifecycle logs |
| `styles.css` | **Minor** | Added waiting-list and queue styles |

---

## Running the New System

```bash
# 1. Install Node.js (https://nodejs.org) — comes with npm
# 2. In the project root:
cd server
npm install
npm start

# 3. Open http://localhost:3000 in browsers
```

The server listens on port 3000 and serves the static frontend files automatically.
