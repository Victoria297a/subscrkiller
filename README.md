# Subscription Killer

A subscription control app with a bright frontend plus a secure Node.js backend for users, profile pictures, subscriptions, and encrypted bank snapshots.

## Features

- Manual subscription tracking
- CSV or pasted transaction import
- Recurring-payment detection
- Unused-subscription alerts
- Monthly waste and annual waste calculations
- Spending visualization by category
- One-click cancel guidance for common providers
- Rewards engine: every configured `€X` saved grants voucher progress
- Savings projection nudges, for example: cancel one payment and reach a big goal faster
- User accounts (register/login)
- Profile picture uploads
- Secure backend storage for subscriptions and bank records
- Encrypted-at-rest sensitive fields (`IBAN`, `balance`) in MongoDB
- Local fallback mode when backend is not running

## Security Notes

- Passwords are hashed with `bcrypt`.
- Auth uses signed JWT tokens.
- Sensitive bank data is encrypted with `AES-256-GCM` before database storage.
- Set strong `JWT_SECRET` and `DATA_ENCRYPTION_KEY` values in production.
- Configure `MONGODB_URI` and `MONGODB_DB` for your MongoDB instance.

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create environment file from the example:

```bash
Copy-Item .env.example .env
```

3. Start the server:

```bash
npm start
```

4. Ensure MongoDB is running and reachable by your configured URI.

5. Open `http://localhost:3000`.

## Run

- With backend: run `npm start`, then open `http://localhost:3000`.
- Frontend-only fallback: open `index.html` directly.

## Notes

- Imported transactions should include at least date, merchant, and amount columns.
- Files in `uploads/` are ignored by git.