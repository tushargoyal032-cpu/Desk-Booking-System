# TODO - Desk Booking System

## Completed

- [x] Create a new project directory structure (static front-end).
- [x] Implement seat map UI with zones (500 seats across zones) and interactive seat selection.
- [x] Add booking rules: 5 weekdays advance only, weekends ignored, booking opens at 1:00 PM.
- [x] Implement "one user one booking per day" constraint.
- [x] Implement error handling when a seat is already booked.
- [x] Persist bookings and lifecycle state in localStorage.
- [x] Provide a user selector for up to 1000 users and a clear booking flow.
- [x] Add polished styling, status summaries, and improved responsive behavior.
- [x] Lifecycle actions: Check-in, WFH, Cancel with lifecycle logs.
- [x] Admin panel with login, lifecycle viewer, filters, and export.
- [x] "My Next 5 Days" quick-view cards.
- [x] Cross-tab sync via storage events.
- [x] Confirmation dialogs for destructive actions and richer booking summaries.
- [x] Book button gating for seat selection, window timing, and user quota.
- [x] Admin link button navigates to the dedicated admin view.
- [x] Today is included in the 5-day booking window.

## Future / Nice-to-have

- [ ] Server-side persistence instead of localStorage-only.
- [ ] Real-time seat map updates via WebSocket.
- [ ] User authentication instead of a static user selector.
- [ ] Email or push reminders for upcoming bookings.
- [ ] Automated browser test suite.

