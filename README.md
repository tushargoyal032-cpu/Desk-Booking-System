# Desk Booking System — High-Concurrency Edition

## What Changed & Why

The original system was a **pure client-side application** using `localStorage`. This completely fails under 1000 concurrent users because:

1. **No shared state** — `localStorage` is isolated per browser/device. 1000 users see 1000 different truths.
2. **Race conditions** — read → check → write is not atomic. Two users can book the same seat simultaneously.
3. **No real-time sync** — the `storage` event only works across tabs on the **same machine**.
4. **No rate limiting** — a single user can spam bookings.
5. **No queue system** — when seats are full, users have nowhere to go.

This update introduces a **Node.js backend** with:

- **SQLite** with `IMMEDIATE` transactions — only one booking transaction can write at a time, eliminating race conditions.
- **Unique database constraints** on `(date, seat)` and `(user, date)` — the database itself prevents double booking.
- **WebSocket** — real-time seat availability broadcasts to all connected browsers.
- **Rate limiting** — max 10 booking attempts per minute per user/IP.
- **Waiting list queue** — users join a queue when all 500 seats are full; auto-promoted when someone cancels.
- **JWT sessions** — proper signed tokens instead of forgeable localStorage strings.

---

## Project Structure

```
Seat-Booking-System/
├── server/
│   ├── package.json          # Dependencies
│   ├── database.js           # SQLite schema + atomic booking logic
│   ├── server.js             # Express API + WebSocket server
│   └── .env.example          # Copy to .env and configure
│
├── index.html                # Booking UI (updated for API)
├── login.html                # User login (updated for API)
├── admin.html                # Admin panel (updated for API)
├── script.js                 # Main frontend (API + WebSocket)
├── styles.css                # Added waiting-list & connection styles
├── CONCURRENCY_ANALYSIS.md   # Full technical analysis
└── README.md                 # This file
```

---

## Quick Start

### 1. Install Node.js & npm

Download from [https://nodejs.org](https://nodejs.org) (LTS recommended). This installs both `node` and `npm`.

### 2. Install dependencies

Open a terminal in the project root, then:

```bash
cd server
npm install
```

### 3. Configure environment

```bash
cp .env.example .env
```

Edit `.env` if you want to change the admin password or JWT secret.

### 4. Start the server

```bash
npm start
```

The server starts on `http://localhost:3000`.

### 5. Open in browser

Navigate to `http://localhost:3000`.

- **Sample users** (pre-seeded in the database):
  - ID: `101`, Name: `Alice Johnson`
  - ID: `102`, Name: `Bob Smith`
  - ID: `103`, Name: `Clara Davis`

- **Admin login:**
  - Username: `admin`
  - Password: `Password-123` (or whatever you set in `.env`)

---

## How the 1000-User Scenario Is Handled

### At 1:00 PM — Booking Opens

1. 1000 users open the page simultaneously.
2. Each browser establishes a **WebSocket** connection to the server.
3. The server serves the current seat map from SQLite.

### User 1 and User 2 Click the Same Seat at the Same Millisecond

1. Both browsers send `POST /api/book`.
2. The server starts **SQLite `IMMEDIATE` transaction** for User 1. This acquires the write lock.
3. User 2's request queues behind the lock.
4. User 1's transaction:
   - Checks seat availability → **free**
   - Checks user quota → **ok**
   - Inserts booking → **success**
   - Commits and releases lock
5. Server broadcasts `{type: 'SEAT_BOOKED', seatId: '042', ...}` to all 1000 WebSocket clients.
6. User 2's transaction now acquires the lock:
   - Checks seat availability → **already taken by User 1**
   - Returns `409 Conflict` with message: "Seat is already booked."
7. User 2's UI immediately refreshes and shows the seat as taken.

**Result: Zero double bookings.**

### All 500 Seats Are Booked

1. The 501st user sees the **"Join Waiting List"** button instead of "Book".
2. They click it → `POST /api/waiting-list/join` → position #1 recorded in SQLite.
3. If any user cancels or marks WFH, the backend:
   - Frees the seat
   - Finds the first waiting user
   - Atomically assigns the freed seat
   - Broadcasts the promotion via WebSocket
4. The promoted user's UI auto-updates to show their new booking.

---

## API Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/login` | — | User login (returns JWT) |
| GET | `/api/users` | — | List all users |
| GET | `/api/seats?date=YYYY-MM-DD` | — | Seat availability for a date |
| POST | `/api/book` | User | Book a seat (rate limited) |
| POST | `/api/cancel` | User | Cancel booking |
| POST | `/api/wfh` | User | Mark WFH |
| POST | `/api/checkin` | User | Check in |
| GET | `/api/my-bookings?dates=...` | User | Get user's bookings |
| POST | `/api/waiting-list/join` | User | Join waiting list |
| GET | `/api/waiting-list?date=...` | — | View waiting list |
| POST | `/api/admin/login` | — | Admin login (returns session token) |
| GET | `/api/admin/logs` | Admin | All lifecycle logs |
| POST | `/api/admin/reset` | Admin | Reset all data |
| POST | `/api/admin/import-users` | Admin | Import users from CSV/Excel |
| POST | `/api/admin/clear-users` | Admin | Clear user list |
| GET | `/api/health` | — | Server health check |
| WS | `/ws` | — | WebSocket for real-time updates |

---

## Testing Concurrency

You can simulate the 1:00 PM rush with `autocannon` or `k6`:

```bash
# Install autocannon
npm install -g autocannon

# Run a 1000-user concurrent booking test
autocannon -c 1000 -d 10 -m POST \
  -H "Authorization: Bearer <USER_JWT>" \
  -b '{"seatId":"001","dateISO":"2025-06-30"}' \
  -H "Content-Type: application/json" \
  http://localhost:3000/api/book
```

With the SQLite `IMMEDIATE` transaction, you will see:
- Exactly 1 successful booking per seat
- 409 responses for all attempts after the first per seat
- Zero database constraint violations

---

## Security Notes

- Change `JWT_SECRET` and `ADMIN_PASS` in `.env` before production use.
- The server runs on HTTP. For production, place it behind an HTTPS reverse proxy (Nginx, Caddy, etc.).
- The `.env` file is blocked from being read by the agent — copy it manually from `.env.example`.

---

## License

Tushar Goyal
