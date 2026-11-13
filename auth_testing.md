# Auth testing
- Sessions live in `user_sessions` {session_token, user_id, expires_at ISO string}. Users in `users` with custom `user_id`.
- To fake a Google/any user: insert a users doc + user_sessions doc, then set cookie `session_token` (httpOnly, secure, SameSite=None) or send `Authorization: Bearer <token>`.
- Email/password: POST /api/auth/register or /api/auth/login sets the same cookie.
- Admin: see /app/memory/test_credentials.md
- Make a user a subscriber for tests: set `subscription_expires_at` to a future ISO datetime (e.g. "2027-12-01T00:00:00+00:00") and `subscription_started_at` to now.
- Clean up: delete users with email starting TEST_ and their sessions/logs/collections/checkins/token_uses/payments.
