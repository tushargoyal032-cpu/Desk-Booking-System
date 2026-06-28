(() => {
  const $ = (id) => document.getElementById(id);
  const API_BASE = '';
  const WS_URL = `ws://${window.location.host}/ws`;

  const USERS = 1000;
  const DEFAULT_ZONES = [
    { key: 'zone-a', label: 'Zone A', color: '#4f8cff', seats: Array.from({length: 100}, (_, i) => `A${String(i+1).padStart(3, '0')}`) },
    { key: 'zone-b', label: 'Zone B', color: '#6c5ce7', seats: Array.from({length: 100}, (_, i) => `B${String(i+1).padStart(3, '0')}`) },
    { key: 'zone-c', label: 'Zone C', color: '#00b848', seats: Array.from({length: 100}, (_, i) => `C${String(i+1).padStart(3, '0')}`) },
    { key: 'zone-d', label: 'Zone D', color: '#fdcb70', seats: Array.from({length: 100}, (_, i) => `D${String(i+1).padStart(3, '0')}`) },
    { key: 'zone-e', label: 'Zone E', color: '#ff7675', seats: Array.from({length: 100}, (_, i) => `E${String(i+1).padStart(3, '0')}`) },
  ];

  const ZONES = [];
  try {
    const customZones = JSON.parse(localStorage.getItem('deskbook.zones.v2'));
    if (customZones && Array.isArray(customZones) && customZones.length > 0) {
      ZONES.push(...customZones);
    } else {
      ZONES.push(...DEFAULT_ZONES);
    }
  } catch (e) {
    ZONES.push(...DEFAULT_ZONES);
  }

  const TOTAL_SEATS = ZONES.reduce((acc, z) => acc + z.seats.length, 0);

  function injectZoneStyles() {
    let css = '';
    ZONES.forEach((z) => {
      const color = z.color || '#4f8cff';
      const r = parseInt(color.slice(1, 3), 16) || 79;
      const g = parseInt(color.slice(3, 5), 16) || 140;
      const b = parseInt(color.slice(5, 7), 16) || 255;
      
      css += `
        :root { --${z.key}: ${color}; }
        .${z.key} { color: var(--${z.key}) !important; }
        .pill.${z.key} { border-color: rgba(${r},${g},${b},.35) !important; color: var(--${z.key}) !important; background: rgba(${r},${g},${b},.05) !important; }
        .map-seat.${z.key} { box-shadow: 0 0 10px rgba(${r},${g},${b},.45) !important; background: var(--${z.key}) !important; }
        .map-seat.${z.key}.selected { box-shadow: 0 0 20px var(--${z.key}) !important; }
        .legend-item .swatch.${z.key} { background: var(--${z.key}) !important; }
      `;
    });
    
    let styleTag = document.getElementById('dynamic-zone-styles');
    if (!styleTag) {
      styleTag = document.createElement('style');
      styleTag.id = 'dynamic-zone-styles';
      document.head.appendChild(styleTag);
    }
    styleTag.textContent = css;
  }
  injectZoneStyles();

  const OPEN_HOUR_24 = 13;
  const OPEN_MINUTE = 0;
  const CHECKIN_CUTOFF_HOUR_24 = 15;
  const CHECKIN_CUTOFF_MINUTE = 0;

  const state = {
    selectedSeatId: null,
    selectedZone: null,
    selectedDateISO: null,
    currentUser: null,
    planImageSrc: null,
    seatData: {}, // booked seats from server
    myBookings: {}, // user bookings from server
    waitingList: [],
    wsConnected: false,
  };

  const LIFECYCLE = {
    BOOKED: 'BOOKED',
    CHECKED_IN: 'CHECKED_IN',
    WFH: 'WFH',
    CANCELED: 'CANCELED',
  };

  const ADMIN = { user: 'admin', pass: 'Password-123' };
  const SESSION_TTL_MS = 30 * 60 * 1000;

  const seatMeta = [];

  const ZONE_BOUNDS = {
    'zone-a': { left: 6.67, top: 10, right: 42.22, bottom: 46.67 },
    'zone-b': { left: 57.78, top: 10, right: 93.33, bottom: 46.67 },
    'zone-c': { left: 6.67, top: 56.67, right: 31.11, bottom: 90 },
    'zone-d': { left: 35.56, top: 56.67, right: 63.33, bottom: 90 },
    'zone-e': { left: 67.78, top: 56.67, right: 93.33, bottom: 90 },
  };

  try {
    const customBounds = JSON.parse(localStorage.getItem('deskbook.zoneBounds.v1'));
    if (customBounds) {
      Object.assign(ZONE_BOUNDS, customBounds);
    }
  } catch (e) {}

  const now = () => new Date();
  const toISODate = (d) => {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  };
  const isWeekend = (d) => d.getDay() === 0 || d.getDay() === 6;
  const parseISODate = (iso) => {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d);
  };

  // ── Auth helpers ──
  function getToken() {
    try { return localStorage.getItem('deskbook.token'); } catch { return null; }
  }
  function setToken(t) { localStorage.setItem('deskbook.token', t); }
  function clearToken() { localStorage.removeItem('deskbook.token'); }
  function getPayload() {
    const t = getToken();
    if (!t) return null;
    try {
      const base = t.split('.')[1];
      const json = atob(base.replace(/-/g, '+').replace(/_/g, '/'));
      return JSON.parse(json);
    } catch { return null; }
  }

  // ── API helpers ──
  async function apiCall(path, options = {}) {
    const url = `${API_BASE}${path}`;
    const token = getToken();
    const headers = {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    };
    try {
      const res = await fetch(url, { ...options, headers });
      const body = await res.json().catch(() => ({ ok: false, message: 'Invalid server response.' }));
      if (!res.ok) throw new Error(body.message || `HTTP ${res.status}`);
      return body;
    } catch (err) {
      throw new Error(err.message || 'Network error. Is the server running?');
    }
  }

  // ── WebSocket ──
  let ws = null;
  let wsReconnectTimer = null;

  function connectWebSocket() {
    if (ws) { ws.close(); }
    try {
      ws = new WebSocket(WS_URL);
      ws.onopen = () => {
        state.wsConnected = true;
        updateConnectionStatus();
      };
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          handleWsMessage(msg);
        } catch {}
      };
      ws.onclose = () => {
        state.wsConnected = false;
        updateConnectionStatus();
        wsReconnectTimer = setTimeout(connectWebSocket, 3000);
      };
      ws.onerror = () => {
        state.wsConnected = false;
        updateConnectionStatus();
      };
    } catch {
      state.wsConnected = false;
      updateConnectionStatus();
    }
  }

  function updateConnectionStatus() {
    const el = document.getElementById('wsStatus');
    if (!el) return;
    el.textContent = state.wsConnected ? 'Live' : 'Reconnecting…';
    el.className = state.wsConnected ? 'ws-status connected' : 'ws-status';
  }

  async function handleWsMessage(msg) {
    if (msg.type === 'SEAT_BOOKED' || msg.type === 'SEAT_FREED' || msg.type === 'CHECKED_IN') {
      if (msg.dateISO === state.selectedDateISO) {
        await refreshSeatData();
      }
      // If we were promoted from waiting list
      if (msg.type === 'SEAT_FREED' && msg.promoted && String(msg.promoted.userId) === String(state.currentUser)) {
        setMessage(`🎉 You were assigned seat ${msg.promoted.seatId} from the waiting list!`, 'ok');
        await refreshMyBookings();
        renderMyNext5Days();
      }
    }
    if (msg.type === 'WAITING_LIST_UPDATED') {
      if (msg.dateISO === state.selectedDateISO) {
        await refreshWaitingList();
      }
    }
  }

  // ── Data layer ──
  async function refreshSeatData() {
    if (!state.selectedDateISO) return;
    try {
      const data = await apiCall(`/api/seats?date=${encodeURIComponent(state.selectedDateISO)}`);
      state.seatData = data.booked || {};
      state.waitingList = data.waiting || [];
      updateSeatUIForDate(state.selectedDateISO);
    } catch (err) {
      setMessage(err.message, 'err');
    }
  }

  async function refreshMyBookings() {
    const days = getNext5WeekdaysFromToday();
    try {
      const data = await apiCall(`/api/my-bookings?dates=${days.join(',')}`);
      state.myBookings = data.bookings || {};
    } catch {
      state.myBookings = {};
    }
  }

  async function refreshWaitingList() {
    if (!state.selectedDateISO) return;
    try {
      const data = await apiCall(`/api/waiting-list?date=${encodeURIComponent(state.selectedDateISO)}`);
      state.waitingList = data.waiting || [];
      updateSeatUIForDate(state.selectedDateISO);
    } catch {}
  }

  function seatAlreadyBooked(seatId, dateISO) {
    const entry = state.seatData[seatId];
    return Boolean(entry && entry.status !== 'CANCELED' && entry.status !== 'WFH');
  }

  function userAlreadyBooked(userId, dateISO) {
    const entry = state.myBookings[dateISO];
    return Boolean(entry && entry.status !== 'CANCELED' && entry.status !== 'WFH');
  }

  function getUserWaitPosition(userId, dateISO) {
    const entry = state.waitingList.find((w) => String(w.user_id) === String(userId));
    return entry ? entry.position : null;
  }

  function getWeekdayOffset(dateISO) {
    const target = parseISODate(dateISO);
    if (isWeekend(target)) return -1;
    const today = now();
    const todayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    
    if (target < todayDate) return -1;

    let weekdayCount = 0;
    for (let i = 0; i <= 30; i++) {
      const x = new Date(todayDate);
      x.setDate(todayDate.getDate() + i);
      if (isWeekend(x)) continue;
      weekdayCount += 1;
      if (toISODate(x) === dateISO) {
        return weekdayCount;
      }
    }
    return -1;
  }

  function canSelectDate(dateISO) {
    const d = parseISODate(dateISO);
    if (isWeekend(d)) return { ok: false, reason: 'Weekends are ignored.' };
    const offset = getWeekdayOffset(dateISO);
    if (offset === -1 || offset > 5) {
      return { ok: false, reason: 'Bookings are allowed only within the next 5 weekdays.' };
    }
    return { ok: true, reason: '' };
  }

  function isOpenTimeNow() {
    const t = now();
    const open = new Date(t);
    open.setHours(OPEN_HOUR_24, OPEN_MINUTE, 0, 0);
    return t >= open;
  }

  function canCheckInForDate(dateISO) {
    const selectedDate = parseISODate(dateISO);
    const today = new Date();
    const todayISO = toISODate(today);
    if (dateISO !== todayISO) return false;
    const cutoff = new Date(today);
    cutoff.setHours(CHECKIN_CUTOFF_HOUR_24, CHECKIN_CUTOFF_MINUTE, 0, 0);
    return today < cutoff;
  }

  function canBookNow(dateISO) {
    const offset = getWeekdayOffset(dateISO);
    if (offset === -1 || offset > 5) return false;
    if (offset < 5) return true;
    
    // offset is exactly 5 (the 5th weekday)
    const t = now();
    const open = new Date(t);
    open.setHours(OPEN_HOUR_24, OPEN_MINUTE, 0, 0);
    return t >= open;
  }

  function getEarliestDefaultDateISO() {
    const t = new Date();
    for (let i = 0; i < 14; i += 1) {
      const x = new Date(t);
      x.setDate(t.getDate() + i);
      if (!isWeekend(x)) return toISODate(x);
    }
    return toISODate(t);
  }

  function getNext5WeekdaysFromToday() {
    const res = [];
    const today = new Date();
    for (let i = 0; res.length < 5 && i <= 40; i += 1) {
      const x = new Date(today);
      x.setDate(today.getDate() + i);
      if (!isWeekend(x)) res.push(toISODate(x));
    }
    return res;
  }

  function setMessage(text, kind) {
    const el = $('message');
    if (!el) return;
    el.textContent = text || '';
    el.classList.remove('ok', 'err');
    if (kind) el.classList.add(kind);
  }

  function formatSeatLabel(seat) {
    return `${seat.id} (${seat.zoneLabel})`;
  }

  function getZoneLabel(zoneKey) {
    return ZONES.find((z) => z.key === zoneKey)?.label || 'Unknown zone';
  }

  // ── UI builders (preserved from original) ──
  function initSeatMeta() {
    seatMeta.length = 0;
    for (const z of ZONES) {
      for (const seatId of z.seats) {
        seatMeta.push({ id: seatId, zoneKey: z.key, zoneLabel: z.label });
      }
    }
  }

  function buildInteractiveMap() {
    const map = $('interactiveMap');
    if (!map) return;
    map.innerHTML = '';

    const seatsByZone = {};
    for (const zone of ZONES) {
      seatsByZone[zone.key] = seatMeta.filter((s) => s.zoneKey === zone.key).map((s) => s.id);
    }

    let customCoords = {};
    try {
      const storedCoords = localStorage.getItem('deskbook.seatCoords.v1');
      if (storedCoords) customCoords = JSON.parse(storedCoords);
    } catch (e) {}

    for (const zone of ZONES) {
      const seatIds = seatsByZone[zone.key];
      const bounds = ZONE_BOUNDS[zone.key] || { left: 10, top: 10, right: 90, bottom: 90 };
      const cols = Math.ceil(Math.sqrt(seatIds.length)) || 1;
      const rows = Math.ceil(seatIds.length / cols) || 1;
      const padLeft = 8;
      const padTop = 12;
      const padRight = 8;
      const padBottom = 8;

      const usableWidth = bounds.right - bounds.left - padLeft - padRight;
      const usableHeight = bounds.bottom - bounds.top - padTop - padBottom;
      const cellWidth = usableWidth / cols;
      const cellHeight = usableHeight / rows;

      for (let i = 0; i < seatIds.length; i++) {
        const seatId = seatIds[i];
        let left, top;
        if (customCoords[seatId]) {
          left = customCoords[seatId].left;
          top = customCoords[seatId].top;
        } else {
          const col = i % cols;
          const row = Math.floor(i / cols);
          left = bounds.left + padLeft + col * cellWidth + cellWidth / 2;
          top = bounds.top + padTop + row * cellHeight + cellHeight / 2;
        }

        const el = document.createElement('div');
        el.className = `map-seat ${zone.key}`;
        el.dataset.seatId = seatId;
        el.dataset.zone = zone.key;
        el.style.left = `${left}%`;
        el.style.top = `${top}%`;
        el.title = `Seat ${seatId} (${zone.label})`;
        el.setAttribute('role', 'button');
        el.setAttribute('tabindex', '0');
        el.setAttribute('aria-label', `Seat ${seatId} in ${zone.label}`);
        el.addEventListener('click', () => onSeatClick(seatId));
        el.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSeatClick(seatId);
          }
        });
        map.appendChild(el);
      }
    }
  }

  function updateMapViewVisibility() {
    const map = $('interactiveMap');
    if (map) map.classList.add('active');
  }

  function initZoneSelect() {
    const select = $('zoneSelect');
    if (!select) return;
    select.innerHTML = `<option value="">-- Choose a zone --</option>${ZONES.map((zone) => `<option value="${zone.key}">${zone.label}</option>`).join('')}`;
    select.addEventListener('change', () => {
      const selected = select.value || null;
      state.selectedZone = selected;
      state.selectedSeatId = null;
      if (selected) {
        setMessage(`Zone ${getZoneLabel(selected)} selected. Choose a seat.`, null);
      } else {
        setMessage('Choose a zone to view the interactive map.', null);
      }
      updateSeatUIForDate(state.selectedDateISO || '');
      renderBookingSummary(state.selectedDateISO);
    });
  }

  function getBookingStats() {
    const bookedCount = Object.keys(state.seatData).length;
    return { total: TOTAL_SEATS, booked: bookedCount, available: TOTAL_SEATS - bookedCount };
  }

  function renderBookingSummary(dateISO) {
    const host = $('bookingSummary');
    if (!host) return;

    const summary = getBookingStats();
    const gate = dateISO ? canSelectDate(dateISO) : { ok: false, reason: 'Choose a date.' };
    const seatLabel = state.selectedSeatId ? `Selected seat ${state.selectedSeatId}` : 'No seat selected';
    const zoneLabel = state.selectedZone ? getZoneLabel(state.selectedZone) : 'None';
    const statusText = gate.ok ? 'Open for booking' : gate.reason || 'Unavailable';

    const waitPos = state.currentUser ? getUserWaitPosition(state.currentUser, dateISO) : null;
    const waitText = waitPos ? `<div style="color:var(--danger);margin-top:4px">Waiting list position: #${waitPos}</div>` : '';

    host.innerHTML = `
      <div class="summary-grid">
        <div class="summary-card">
          <div class="summary-label">Availability</div>
          <div class="summary-value">${summary.available}/${summary.total} open</div>
        </div>
        <div class="summary-card">
          <div class="summary-label">Selection</div>
          <div class="summary-value">${seatLabel}</div>
        </div>
        <div class="summary-card">
          <div class="summary-label">Zone</div>
          <div class="summary-value">${zoneLabel}</div>
        </div>
        <div class="summary-card">
          <div class="summary-label">Booking status</div>
          <div class="summary-value">${statusText}</div>
        </div>
      </div>
      ${waitText}
    `;
  }

  function updateSeatUIForDate(dateISO) {
    const day = state.seatData || {};
    const userHasBooking = state.currentUser != null ? userAlreadyBooked(state.currentUser, dateISO) : false;
    const selected = state.selectedSeatId;
    const zoneFilter = state.selectedZone;
    const stats = getBookingStats();
    const canBook = selected && canBookNow(dateISO) && !userHasBooking && stats.available > 0;



    document.querySelectorAll('.map-seat').forEach((el) => {
      const seatId = el.dataset.seatId;
      const zone = el.dataset.zone;
      const isBooked = Boolean(day[seatId] && day[seatId].status !== 'CANCELED' && day[seatId].status !== 'WFH');
      const hidden = zoneFilter && zone !== zoneFilter;
      el.style.display = hidden ? 'none' : '';
      el.classList.toggle('booked', isBooked);
      el.setAttribute('aria-disabled', isBooked ? 'true' : 'false');
      if (!isBooked && selected && seatId === selected) {
        el.classList.add('selected');
      } else {
        el.classList.remove('selected');
      }
    });

    const planPreview = $('planPreview');
    if (planPreview) {
      if (state.planImageSrc) {
        planPreview.classList.add('has-image');
        planPreview.classList.remove('empty');
      } else {
        planPreview.classList.remove('has-image');
        planPreview.classList.add('empty');
      }
    }

    const bookBtn = $('bookBtn');
    const waitBtn = $('waitBtn');
    const waitPos = state.currentUser ? getUserWaitPosition(state.currentUser, dateISO) : null;
    const canJoinWait = canBookNow(dateISO) && !userHasBooking && stats.available === 0 && !waitPos;

    if (bookBtn) bookBtn.disabled = !canBook;
    if (waitBtn) {
      waitBtn.disabled = !canJoinWait;
      waitBtn.style.display = stats.available === 0 ? 'inline-block' : 'none';
    }

    renderBookingSummary(dateISO);
    updateMapZoom();
  }

  function updateMapZoom() {
    const viewport = $('mapViewport');
    if (!viewport) return;

    const zone = state.selectedZone;
    if (!zone || !ZONE_BOUNDS[zone] || !state.planImageSrc) {
      viewport.style.transform = 'translate(0px, 0px) scale(1)';
      return;
    }

    const bounds = ZONE_BOUNDS[zone];
    const zoneWidth = bounds.right - bounds.left;
    const zoneHeight = bounds.bottom - bounds.top;

    const scale = Math.min(4, Math.max(1, (100 / Math.max(zoneWidth, zoneHeight)) * 0.8));

    const centerX = bounds.left + zoneWidth / 2;
    const centerY = bounds.top + zoneHeight / 2;

    const translateX = 50 - centerX * scale;
    const translateY = 50 - centerY * scale;

    viewport.style.transform = `translate(${translateX}%, ${translateY}%) scale(${scale})`;
  }

  function onSeatClick(seatId) {
    if (!state.currentUser) {
      setMessage('Select a user first.', 'err');
      return;
    }
    if (!state.selectedDateISO) {
      setMessage('Select a booking date first.', 'err');
      return;
    }

    if (seatAlreadyBooked(seatId, state.selectedDateISO)) {
      setMessage('Seat is already booked.', 'err');
      state.selectedSeatId = null;
      state.selectedZone = null;
      updateSeatUIForDate(state.selectedDateISO);
      return;
    }

    if (userAlreadyBooked(state.currentUser, state.selectedDateISO)) {
      setMessage('You already have a booking for this day (one user one booking per day).', 'err');
      state.selectedSeatId = null;
      state.selectedZone = null;
      updateSeatUIForDate(state.selectedDateISO);
      return;
    }

    state.selectedSeatId = seatId;
    const meta = seatMeta.find((s) => s.id === seatId);
    state.selectedZone = meta ? meta.zoneKey : null;

    document.querySelectorAll('.seat, .map-seat').forEach((el) => {
      const id = el.dataset.seatId;
      if (id === seatId && !el.classList.contains('booked')) {
        el.classList.add('selected');
      } else {
        el.classList.remove('selected');
      }
    });

    const label = formatSeatLabel(meta || { id: seatId, zoneLabel: '' });
    updateSeatUIForDate(state.selectedDateISO);

    if (canBookNow(state.selectedDateISO)) {
      if (confirm(`Do you want to book seat ${label} for ${state.selectedDateISO}?`)) {
        bookSelected();
      } else {
        setMessage(`Selected ${label}. Click Book to confirm.`, null);
      }
    } else {
      setMessage(`Selected ${label}, but booking is not open for this date yet.`, 'err');
    }
  }

  async function bookSelected() {
    if (!state.currentUser) { setMessage('Select a user first.', 'err'); return; }
    if (!state.selectedDateISO) { setMessage('Select a booking date first.', 'err'); return; }
    if (!state.selectedSeatId) { setMessage('Select a seat from the map first.', 'err'); return; }

    const dateISO = state.selectedDateISO;
    const seatId = state.selectedSeatId;

    const gate = canSelectDate(dateISO);
    if (!gate.ok) { setMessage(gate.reason || 'Invalid booking date.', 'err'); return; }
    if (!canBookNow(dateISO)) { setMessage('Booking is not open yet. Booking opens at 1:00 PM.', 'err'); return; }

    try {
      const result = await apiCall('/api/book', {
        method: 'POST',
        body: JSON.stringify({ seatId, dateISO }),
      });

      setMessage(`Booked! Seat ${result.seatId} for ${dateISO}.`, 'ok');
      state.selectedSeatId = null;
      state.selectedZone = null;
      await refreshSeatData();
      await refreshMyBookings();
      renderMyNext5Days();
      updateLifecycleButtons();
    } catch (err) {
      if (err.message.includes('already booked') || err.message.includes('409')) {
        setMessage('Seat was just taken by another user. Please choose another seat.', 'err');
      } else if (err.message.includes('already have a booking')) {
        setMessage('You already have a booking for this day.', 'err');
      } else {
        setMessage(err.message, 'err');
      }
      state.selectedSeatId = null;
      state.selectedZone = null;
      await refreshSeatData();
    }
  }

  async function joinWaitingList() {
    if (!state.currentUser) { setMessage('Select a user first.', 'err'); return; }
    if (!state.selectedDateISO) { setMessage('Select a booking date first.', 'err'); return; }

    const dateISO = state.selectedDateISO;
    const zone = state.selectedZone;

    if (!canBookNow(dateISO)) { setMessage('Booking is not open yet.', 'err'); return; }

    try {
      const result = await apiCall('/api/waiting-list/join', {
        method: 'POST',
        body: JSON.stringify({ dateISO, zonePreference: zone }),
      });
      setMessage(`Added to waiting list at position #${result.position}.`, 'ok');
      await refreshWaitingList();
      updateSeatUIForDate(dateISO);
      renderMyNext5Days();
    } catch (err) {
      setMessage(err.message, 'err');
    }
  }

  function initUserSelect() {
    const display = $('currentUserValue');
    const hint = $('userHint');
    if (!display) return;

    const payload = getPayload();
    if (payload && payload.userId) {
      state.currentUser = String(payload.userId);
      display.textContent = `${payload.name || 'User'} (#${payload.userId})`;
      if (hint) hint.textContent = 'Signed in via server.';
    } else {
      state.currentUser = null;
      display.textContent = 'Not signed in';
      if (hint) hint.textContent = 'Please sign in from the user login page.';
    }
  }

  function initDatePicker() {
    const input = $('dateInput');
    const hint = $('dateHint');
    if (!input || !hint) return;

    const defaultISO = getEarliestDefaultDateISO();
    state.selectedDateISO = defaultISO;
    input.value = defaultISO;
    hint.textContent = 'Select a weekday within the next 5 weekdays.';

    input.addEventListener('change', async () => {
      const iso = input.value;
      state.selectedDateISO = iso;
      state.selectedSeatId = null;
      const gate = canSelectDate(iso);
      setMessage(gate.ok ? 'Date selected. Choose a zone and seat.' : gate.reason || 'Invalid date.', gate.ok ? null : 'err');
      await refreshSeatData();
      await refreshMyBookings();
      await refreshWaitingList();
      renderMyNext5Days();
      updateLifecycleButtons();
    });
  }

  function seatIdForUserDate(userId, dateISO) {
    const entry = state.myBookings[dateISO];
    return entry && entry.seat_id ? entry.seat_id : null;
  }

  function renderMyNext5Days() {
    const host = $('myNext5Days');
    if (!host) return;
    host.innerHTML = '';
    if (!state.currentUser) return;

    const days = getNext5WeekdaysFromToday();
    for (const iso of days) {
      const entry = state.myBookings[iso];
      const isReleased = entry?.status === 'CANCELED' || entry?.status === 'WFH';
      const seatId = isReleased ? null : (entry?.seat_id || null);
      const status = entry?.status || (seatId ? 'BOOKED' : null);
      const waitPos = getUserWaitPosition(state.currentUser, iso);
      const statusPill = waitPos
        ? `<span class="pill err">Waiting #${waitPos}</span>`
        : status
        ? `<span class="pill ${statusToPillClass(status)}">${status}</span>`
        : '<span class="pill">No booking</span>';

      const card = document.createElement('div');
      card.className = `next-day-card ${iso === state.selectedDateISO ? 'active' : ''}`;
      const d = parseISODate(iso);
      const pretty = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
      card.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px;">
          <div>
            <div style="font-weight: 700; color: var(--text); font-size: 13px;">${pretty}</div>
            <div style="color: var(--muted); font-size: 11px; margin-top: 1px;">Seat: <b>${seatId || '-'}</b></div>
          </div>
          <div style="display: flex; align-items: center; gap: 6px;">
            ${statusPill}
            <button class="btn secondary" type="button" data-select-date="${iso}" style="padding: 4px 8px; font-size: 11px;" ${iso === state.selectedDateISO ? 'disabled' : ''}>Use</button>
          </div>
        </div>
      `;

      card.querySelector('[data-select-date]').addEventListener('click', async () => {
        state.selectedDateISO = iso;
        $('dateInput').value = iso;
        state.selectedSeatId = null;
        state.selectedZone = null;
        await refreshSeatData();
        await refreshMyBookings();
        await refreshWaitingList();
        updateSeatUIForDate(iso);
        updateLifecycleButtons();
        renderMyNext5Days();
        setMessage('Date selected.', null);
      });

      host.appendChild(card);
    }
  }

  function statusToPillClass(status) {
    if (status === 'CHECKED_IN') return 'ok';
    if (status === 'WFH' || status === 'CANCELED') return 'err';
    return '';
  }

  async function cancelLifecycle() {
    const userId = state.currentUser;
    const dateISO = state.selectedDateISO;
    if (!userId || !dateISO) return;

    if (!confirm(`Cancel booking for ${dateISO}? The seat will be released.`)) return;

    try {
      const result = await apiCall('/api/cancel', {
        method: 'POST',
        body: JSON.stringify({ dateISO }),
      });
      setMessage('Booking canceled. Seat is now available again.', 'ok');
      state.selectedSeatId = null;
      state.selectedZone = null;
      await refreshSeatData();
      await refreshMyBookings();
      renderMyNext5Days();
      updateLifecycleButtons();
    } catch (err) {
      setMessage(err.message, 'err');
    }
  }

  async function wfhLifecycle() {
    const userId = state.currentUser;
    const dateISO = state.selectedDateISO;
    if (!userId || !dateISO) return;

    if (!confirm(`Log Work from Home for ${dateISO}?`)) return;

    try {
      await apiCall('/api/wfh', {
        method: 'POST',
        body: JSON.stringify({ dateISO }),
      });
      setMessage(`WFH logged for ${dateISO}.`, 'ok');
      state.selectedSeatId = null;
      state.selectedZone = null;
      await refreshSeatData();
      await refreshMyBookings();
      renderMyNext5Days();
      updateLifecycleButtons();
    } catch (err) {
      setMessage(err.message, 'err');
    }
  }

  async function checkinLifecycle() {
    const userId = state.currentUser;
    const dateISO = state.selectedDateISO;
    if (!userId || !dateISO) return;

    if (!canCheckInForDate(dateISO)) {
      setMessage('Check-in is only available on the booked day before 3:00 PM.', 'err');
      return;
    }

    const seatId = seatIdForUserDate(userId, dateISO);
    if (!seatId) {
      setMessage('No booking found for this date.', 'err');
      return;
    }

    try {
      await apiCall('/api/checkin', {
        method: 'POST',
        body: JSON.stringify({ dateISO }),
      });
      setMessage(`Checked-in logged for seat ${seatId}.`, 'ok');
      await refreshMyBookings();
      renderMyNext5Days();
      updateLifecycleButtons();
    } catch (err) {
      setMessage(err.message, 'err');
    }
  }

  function updateLifecycleButtons() {
    const dateISO = state.selectedDateISO;
    const userId = state.currentUser;
    const wfhBtn = $('wfhBtn');
    const checkinBtn = $('checkinBtn');
    const cancelBtn = $('cancelBtn');

    if (!wfhBtn || !checkinBtn || !cancelBtn) return;

    wfhBtn.disabled = true;
    checkinBtn.disabled = true;
    cancelBtn.disabled = true;

    if (!dateISO || !userId) return;

    const entry = state.myBookings[dateISO];
    const bookingsSeat = seatIdForUserDate(userId, dateISO);
    const selectedDate = parseISODate(dateISO);
    const today = new Date();
    const todayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const canTime = selectedDate >= todayDate;
    if (!canTime) return;

    const checkinAllowed = canCheckInForDate(dateISO);
    const status = entry?.status;

    if (!status || status === 'CANCELED' || status === 'WFH') {
      wfhBtn.disabled = false;
      return;
    }

    if (status === 'BOOKED' && bookingsSeat) {
      wfhBtn.disabled = false;
      checkinBtn.disabled = !checkinAllowed;
      cancelBtn.disabled = false;
    } else if (status === 'CHECKED_IN' && bookingsSeat) {
      cancelBtn.disabled = false;
    }
  }

  function wireActions() {
    const bookBtn = $('bookBtn');
    const clearBtn = $('clearSelectionBtn');
    const wfhBtn = $('wfhBtn');
    const checkinBtn = $('checkinBtn');
    const cancelBtn = $('cancelBtn');
    const waitBtn = $('waitBtn');

    if (bookBtn) bookBtn.addEventListener('click', bookSelected);
    if (waitBtn) waitBtn.addEventListener('click', joinWaitingList);
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        state.selectedSeatId = null;
        state.selectedZone = null;
        if (state.selectedDateISO) updateSeatUIForDate(state.selectedDateISO);
        updateLifecycleButtons();
        setMessage('Selection cleared.', null);
      });
    }
    if (wfhBtn) wfhBtn.addEventListener('click', wfhLifecycle);
    if (checkinBtn) checkinBtn.addEventListener('click', checkinLifecycle);
    if (cancelBtn) cancelBtn.addEventListener('click', cancelLifecycle);

    const logoutBtn = $('logoutBtn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', () => {
        clearToken();
        window.location.href = 'login.html';
      });
    }
  }

  function applyWeekendDisableOnInput() {
    const input = $('dateInput');
    if (!input) return;
    const t = new Date();
    const min = toISODate(t);
    const maxDate = new Date(t);
    maxDate.setDate(maxDate.getDate() + 14);
    input.min = min;
    input.max = toISODate(maxDate);
  }

  function tickOpenClose() {
    setInterval(() => {
      if (!state.selectedDateISO) return;
      const can = canBookNow(state.selectedDateISO);
      const userAlready = state.currentUser ? userAlreadyBooked(state.currentUser, state.selectedDateISO) : false;
      const waitPos = state.currentUser ? getUserWaitPosition(state.currentUser, state.selectedDateISO) : null;
      const stats = getBookingStats();
      const bookBtn = $('bookBtn');
      const waitBtn = $('waitBtn');
      if (bookBtn) bookBtn.disabled = !state.selectedSeatId || !can || userAlready || stats.available === 0;
      if (waitBtn) waitBtn.disabled = !can || userAlready || stats.available > 0 || waitPos;
    }, 1000);
  }

  function loadPlanPreviewFromStorage() {
    const preview = $('planPreview');
    const previewImg = $('floorPlanPreview');
    if (!preview || !previewImg) return;

    const storedPlan = localStorage.getItem('deskbook.floorPlan.v1');
    if (storedPlan && storedPlan !== 'none') {
      state.planImageSrc = storedPlan;
      previewImg.src = storedPlan;
      preview.classList.add('has-image');
      preview.classList.remove('empty');
    } else if (storedPlan === 'none') {
      state.planImageSrc = null;
      previewImg.src = '';
      preview.classList.remove('has-image');
      preview.classList.add('empty');
    } else {
      state.planImageSrc = 'floor-plan-sample-a.svg';
      previewImg.src = 'floor-plan-sample-a.svg';
      preview.classList.add('has-image');
      preview.classList.remove('empty');
    }
    updateMapViewVisibility();
  }

  async function init() {
    const payload = getPayload();
    if (!payload || !payload.userId) {
      setMessage('Please sign in before booking.', 'err');
      window.location.href = 'login.html';
      return;
    }

    connectWebSocket();
    applyWeekendDisableOnInput();

    const legend = $('mapLegend');
    if (legend) {
      legend.innerHTML = ZONES.map((z) => `
        <div class="legend-item"><span class="swatch ${z.key}"></span>${z.label}</div>
      `).join('');
    }

    initSeatMeta();
    buildInteractiveMap();
    initZoneSelect();
    loadPlanPreviewFromStorage();
    initUserSelect();
    initDatePicker();
    wireActions();

    const defaultISO = getEarliestDefaultDateISO();
    state.selectedDateISO = defaultISO;
    await refreshSeatData();
    await refreshMyBookings();
    await refreshWaitingList();
    updateSeatUIForDate(defaultISO);
    setMessage(isOpenTimeNow() ? 'Booking is open. Select a seat.' : 'Booking opens at 1:00 PM. Select date & seat.', null);

    tickOpenClose();
    renderMyNext5Days();
    updateLifecycleButtons();

    // Refresh seat data every 10s as a fallback when WebSocket is down
    setInterval(async () => {
      if (state.selectedDateISO) {
        await refreshSeatData();
      }
    }, 10000);
  }

  window.addEventListener('storage', async (e) => {
    if (e.key === 'deskbook.seatCoords.v1' || e.key === 'deskbook.zones.v2' || e.key === 'deskbook.floorPlan.v1') {
      ZONES = getZonesConfig();
      TOTAL_SEATS = ZONES.reduce((acc, z) => acc + z.seats.length, 0);
      initSeatMeta();
      buildInteractiveMap();
      loadPlanPreviewFromStorage();
      if (state.selectedDateISO) {
        await refreshSeatData();
        updateSeatUIForDate(state.selectedDateISO);
      }
    }
  });

  init();
})();
