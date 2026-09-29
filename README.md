# Stashr — Passwords & Projects, Encrypted

[![CI](https://github.com/Tanushh18/password-manager/actions/workflows/ci.yml/badge.svg)](https://github.com/Tanushh18/password-manager/actions/workflows/ci.yml)

## Description

**Stashr** is a zero-knowledge password vault and project manager with a comprehensive web interface and native Android app that share a unified API and database. All stored data—passwords, project hosting details, databases, environment variables, and custom fields—is **encrypted on your device** with a key derived from your master password.

The server only ever stores encrypted ciphertext, never plaintext. This ensures that even if the server is compromised, your sensitive data remains protected. The encryption uses industry-standard **PBKDF2-SHA256 (600,000 iterations)** for key derivation and **AES-256-GCM** for symmetric encryption.

### Key Highlights

- **End-to-End Encryption**: Your data is encrypted on your device before transmission; the server never has access to plaintext.
- **Zero-Knowledge Architecture**: No master password recovery, by design—only you control your vault.
- **Cross-Platform Sync**: Same account works seamlessly on web and Android with identical data format.
- **Project Tracker**: Store not just passwords, but entire project configurations (hosting, databases, Firebase/GCP, Play Store, environment variables).
- **Bulk Import**: Import projects from Excel templates directly into your encrypted vault.
- **Security Features**: Built-in breach detection, password strength analysis, two-factor authentication (TOTP), recovery codes, and more.

---

## Tech Stack

### Backend (Server)

| Technology | Version | Purpose |
|---|---|---|
| **Node.js** | ≥20 | JavaScript runtime |
| **Express** | ^5.2.1 | Web framework & REST API |
| **Mongoose** | ^9.10.2 | MongoDB ODM & schema management |
| **MongoDB** | – | NoSQL database (local or cloud) |
| **Helmet** | ^8.3.0 | HTTP security headers |
| **bcrypt** | ^6.0.0 | Password hashing (cost 12) |
| **jsonwebtoken** | ^9.0.3 | JWT session management |
| **cookie-parser** | ^1.4.7 | HTTP cookie parsing |
| **CORS** | ^2.8.6 | Cross-origin request handling |
| **dotenv** | ^18.0.3 | Environment variable management |

### Frontend (Web Client)

| Technology | Version | Purpose |
|---|---|---|
| **Node.js** | ≥20.19 | JavaScript runtime |
| **React** | ^19.3.0 | UI library |
| **React DOM** | ^19.3.0 | DOM rendering |
| **Vite** | ^8.3.1 | Build tool & dev server (PWA support) |
| **React Router** | ^7.18.4 | Client-side routing |
| **Axios** | ^1.20.0 | HTTP client |
| **QRCode** | ^1.5.4 | QR code generation (2FA setup) |
| **react-responsive-modal** | ^7.2.0 | Modal dialogs |
| **react-toastify** | ^11.1.0 | Toast notifications |
| **XLSX** | ^0.20.3 | Excel file import/export |

### Mobile (Android App)

| Technology | Version | Purpose |
|---|---|---|
| **Expo SDK** | ~57.0 | React Native framework |
| **Expo Router** | ~57.0.23 | File-based routing (Expo Router v3) |
| **React Native** | 0.86.3 | Native app framework |
| **React** | 19.2.3 | UI library |
| **react-native-quick-crypto** | ^1.1.7 | Native cryptography (OpenSSL) |
| **expo-secure-store** | ~57.0.4 | Secure key storage (Android Keystore) |
| **expo-camera** | ~57.0.5 | Camera access for QR scanning |
| **expo-local-authentication** | ~57.0.3 | Biometric authentication |
| **expo-clipboard** | ~57.0.2 | Clipboard operations |
| **expo-screen-capture** | ~57.0.3 | Screenshot blocking |
| **react-native-svg** | 15.15.4 | SVG rendering |

### Development & Testing

- **Node.js Test Runner** (`--test` flag): Native testing for server and client
- **MongoDB Memory Server**: In-memory MongoDB for API tests
- **supertest**: HTTP request library for API testing
- **Vite**: Bundling and hot module replacement (HMR)
- **EAS CLI**: Expo Application Services for building Android APK/AAB

---

## Features

### Core Vault Features

| Feature | Web | Android |
| --- | :---: | :---: |
| **End-to-end encryption** (PBKDF2-SHA256 600k → AES-256-GCM) | ✓ | ✓ (native) |
| **Logins** (website, username, password, notes, folders, favourites) | ✓ | ✓ |
| **Stored 2FA secrets** with live TOTP codes | ✓ | ✓ + camera QR scan |
| **Vault health** (weak, reused, old, breached passwords) | ✓ | ✓ |
| **Have I Been Pwned** integration (k-anonymity) | ✓ | ✓ |
| **Password & passphrase generator** with strength meter | ✓ | ✓ |
| **Two-factor login** (TOTP) with 10 recovery codes | ✓ | ✓ |
| **Change master password** (full re-key, atomic operation) | ✓ | ✓ |
| **Sign out other devices** | ✓ | ✓ |
| **Delete account** (full data removal) | ✓ | ✓ |
| **Encrypted backup & CSV export** | ✓ (+ Excel) | ✓ |
| **Import from competitors** (Chrome, Bitwarden, 1Password, LastPass) | ✓ | ✓ |
| **Auto-lock after inactivity** | ✓ | ✓ |
| **Biometric unlock** (fingerprint / face) | – | ✓ (Android Keystore) |
| **Offline read-only vault** | PWA shell | ✓ |
| **Screenshot blocking** | – | ✓ |
| **Dark / light theme** | ✓ | ✓ |
| **Website icons** (opt-in, DuckDuckGo) | ✓ | ✓ |

### Project Tracker Features

- Store project-specific configuration per hosting provider & account
- Encrypt databases, Firebase/GCP settings, Play Store credentials
- Store API keys, secrets, environment variables (names & values)
- Custom fields for any project metadata
- Bulk import from Excel template
- All data encrypted exactly like password entries

### Additional Capabilities

- **Session Management**: JWT-based with random `jti`, max 10 concurrent sessions per account
- **Rate Limiting**: Protects login, register, and sensitive account routes per IP
- **Upgrade Path**: Automatic migration for legacy pre-E2E accounts on first sign-in
- **Server Keep-Alive**: Self-pinging via `SELF_URL` or Render's `RENDER_EXTERNAL_URL` (every 14 minutes)

---

## Project Structure

```
password-manager/
├── .github/
│   └── workflows/
│       └── ci.yml              # CI pipeline: tests, builds, audits
├── server/                      # Express API backend
│   ├── app.js                   # Express app configuration
│   ├── server.js                # Entry point
│   ├── package.json             # Dependencies
│   ├── config.env.example       # Environment variable template
│   ├── db/
│   │   └── connection.js        # MongoDB connection
│   ├── models/
│   │   ├── EncDecManager.js     # Encryption/decryption logic
│   │   └── schema.js            # Mongoose schemas (User, Item, etc.)
│   ├── router/
│   │   ├── routing.js           # Route registration
│   │   ├── account.js           # Account routes (/account/*)
│   │   ├── vault.js             # Vault routes (/vault/*)
│   │   ├── projects.js          # Project routes (/projects/*)
│   │   └── helpers.js           # Route helper utilities
│   ├── middlewares/
│   │   ├── authenticate.js      # JWT authentication
│   │   └── rateLimit.js         # Rate limiting
│   ├── utils/
│   │   ├── keepAlive.js         # Self-pinging
│   │   ├── strength.js          # Password strength evaluation
│   │   └── totp.js              # TOTP generation & verification
│   ├── scripts/
│   │   └── import-projects.js   # Bulk import from Excel
│   └── tests/
│       ├── api.test.js          # API endpoint tests
│       └── expect.js            # Test assertions
├── client/                      # Vite + React web app (PWA)
│   ├── index.html               # Entry HTML
│   ├── vite.config.js           # Vite configuration
│   ├── package.json             # Dependencies
│   ├── src/
│   │   ├── main.jsx             # React entry point
│   │   ├── App.jsx              # Root component
│   │   ├── api/
│   │   │   └── client.js        # Axios API client
│   │   ├── lib/
│   │   │   ├── crypto.js        # WebCrypto implementation
│   │   │   ├── strength.js      # Password strength
│   │   │   ├── health.js        # Vault health checks
│   │   │   ├── breach.js        # HIBP integration
│   │   │   └── projectItems.js  # Project data utilities
│   │   ├── hooks/
│   │   │   ├── useTheme.js      # Dark/light theme hook
│   │   │   └── useReveal.js     # Password reveal state
│   │   ├── components/          # React components
│   │   └── pages/               # Page components
│   ├── tests/
│   │   └── crypto.test.mjs      # Crypto interop & import tests
│   └── build/                   # Build output (generated)
├── mobile/                      # Expo + React Native Android app
│   ├── app.json                 # Expo app config
│   ├── package.json             # Dependencies
│   ├── eas.json                 # EAS build config
│   ├── src/
│   │   ├── app/                 # Expo Router routes
│   │   │   ├── _layout.js       # Root layout, auth guards, FLAG_SECURE
│   │   │   ├── auth/            # Sign in/up screens
│   │   │   ├── (tabs)/          # Main tabs (vault, health, generator, settings)
│   │   │   ├── editor.js        # Add/edit item
│   │   │   ├── scan.js          # QR scanner for 2FA
│   │   │   ├── lock.js          # Biometric/password unlock
│   │   │   └── account/         # Account routes
│   │   ├── components/          # React Native UI kit
│   │   ├── lib/
│   │   │   ├── cryptoCore.js    # react-native-quick-crypto wrapper
│   │   │   ├── api.js           # API client for mobile
│   │   │   ├── vault.js         # Vault state management
│   │   │   ├── health.js        # Health check logic
│   │   │   └── breach.js        # Breach checking
│   │   └── utils/               # Utility functions
│   └── android/                 # Generated Android project (Gradle)
├── docs/
│   └── SECURITY.md              # Security design & threat model
├── render.yaml                  # Render Blueprint (deployment)
├── .gitignore                   # Git exclusions
└── README.md                    # This file

**Key directories by concern:**
- **Encryption**: `server/models/EncDecManager.js`, `client/src/lib/crypto.js`, `mobile/src/lib/cryptoCore.js`
- **API**: `server/router/*`, `client/src/api/`, `mobile/src/lib/api.js`
- **UI**: `client/src/components/`, `mobile/src/components/`
- **Tests**: `server/tests/`, `client/tests/`
```

---

## Installation

### Prerequisites

- **Node.js** ≥20 (and ≥20.19 for client)
- **MongoDB** (local or Atlas cloud connection string)
- **Android SDK + JDK 17** (for mobile builds)
- **Git** for version control

### Backend (Server)

1. **Clone and enter the server directory:**
   ```bash
   git clone https://github.com/Tanushh18/password-manager.git
   cd password-manager/server
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Create `config.env` from the template:**
   ```bash
   cp config.env.example config.env
   ```

4. **Edit `config.env` with your settings:**
   ```sh
   MONGO_URL=mongodb://localhost:27017/password-manager
   # Or use MongoDB Atlas:
   # MONGO_URL=mongodb+srv://user:pass@cluster.mongodb.net/password-manager

   SECRET_KEY=<generate-a-long-random-string-for-jwt-signing>
   CRYPTO_SECRET_KEY=<another-long-random-string-for-2fa-sealing>
   
   # Optional:
   # CLIENT_ORIGINS=https://my-frontend.com,https://backup.example.com
   # SELF_URL=https://api.example.com  # Enables keep-alive
   ```

   To generate random strings:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

5. **Start the server:**
   ```bash
   npm run dev:start    # Development with auto-reload
   # or
   npm start            # Production mode
   ```

   Server runs at `http://localhost:8000`

### Frontend (Web Client)

1. **In a separate terminal, clone and enter the client directory:**
   ```bash
   cd password-manager/client
   npm install
   ```

2. **Start the development server:**
   ```bash
   VITE_API_URLS=http://localhost:8000 npm run dev
   ```

   Website runs at `http://localhost:3000`

3. **Build for production:**
   ```bash
   npm run build
   # Output: client/build/
   ```

### Mobile (Android App)

1. **In a separate terminal, clone and enter the mobile directory:**
   ```bash
   cd password-manager/mobile
   npm install
   ```

2. **For development (requires native modules):**
   ```bash
   # Point to your local API server:
   EXPO_PUBLIC_API_URLS=http://<your-computer-ip>:8000 npx expo run:android
   ```

   This builds a development build and installs it on a connected device/emulator.

3. **For production builds:**
   ```bash
   # Installable APK (preview profile):
   npm run build:apk
   
   # Play Store bundle (AAB):
   npm run build:aab
   ```
   Requires EAS CLI and an `EXPO_TOKEN` from https://expo.dev/settings/access-tokens.

---

## Usage

### Web Interface

1. **Sign up** at the vault welcome screen
   - Enter your master password (minimum 12 characters recommended)
   - The app derives a vault key locally and sends only encrypted data to the server

2. **Add passwords/projects**
   - Navigate to `/vault` to add login entries (website, username, password, notes, folders)
   - Navigate to `/projects` to store project-specific configuration
   - All data is encrypted before being sent

3. **View vault health** at `/health`
   - Check for weak passwords (entropy < 50 bits)
   - Detect reused passwords
   - Identify old passwords (>90 days)
   - Check against Have I Been Pwned (first 5 SHA-1 chars sent, k-anonymity enabled)

4. **Generate passwords** with the built-in generator
   - 8–48 character random passwords
   - Passphrases for memorable alternatives
   - Real-time strength meter

5. **Set up two-factor login**
   - Scan TOTP QR code or paste setup key
   - Review 10 recovery codes (store safely)
   - Enable/disable at any time

6. **Import data**
   - Export CSV from Chrome, Bitwarden, 1Password, or LastPass
   - Click "Import" and select the file
   - Existing entries are merged

7. **Change master password**
   - Access `/account` → "Change Master Password"
   - The vault is **atomically re-encrypted** on your device with the new key
   - All other devices are signed out

8. **Backup & export**
   - Encrypted backup (`.enc` format) can be imported back anytime
   - CSV export contains plaintext (store securely)

### Android App

1. **Install** from Play Store or use EAS/local build
2. **Sign in** with your Stashr account
3. **Unlock with biometrics** (fingerprint/face) if set up in Android Keystore
4. **Manage vault** — add, edit, delete entries
5. **Scan QR codes** for 2FA setup
6. **View live TOTP codes** that update every 30 seconds
7. **Auto-lock** when backgrounded (30 seconds by default)
8. **Screenshot blocking** prevents sensitive data from being captured
9. **Clipboard auto-clear** (30 seconds) when copying secrets

### Server API

All API responses are JSON. Authentication uses:
- **Web**: `jwtoken` httpOnly cookie
- **Mobile**: `Authorization: Bearer <token>` header

See the **API Reference** section in the original README for detailed endpoint documentation.

### Excel Import

```bash
cd server
npm install xlsx --no-save
node scripts/import-projects.js /path/to/projects.xlsx
```

The script:
1. Prompts for your master password
2. Derives the vault key locally (never sends plaintext to the server)
3. Encrypts each project row and sends only ciphertext to the API

---

## Security Details

### Encryption & Key Derivation

- **KDF**: PBKDF2-HMAC-SHA256 with **600,000 iterations**
- **Salt**: 16-byte random value, unique per account, stored server-side
- **Vault Key**: 256-bit output (never leaves the device)
- **Encryption**: AES-256-GCM with fresh 12-byte IV per write, 16-byte authentication tag
- **Blob Format**: `v1:<base64 iv>:<base64 ciphertext‖tag>`
- **Key Check**: Encryption of a fixed string, stored server-side to verify the master password locally

### Authentication & Sessions

- **Master Password**: Sent over TLS at sign-in, verified against bcrypt hash (cost 12) server-side
- **Sessions**: JWT tokens (30-day expiry, random `jti` claim), stored server-side for revocation
- **Max Sessions**: 10 concurrent sessions per account
- **Two-Factor**: Optional TOTP (RFC 6238, ±1 step, replay protection) with 10 one-time recovery codes (SHA-256 hashed)
- **Rate Limiting**: Applied to login, register, and sensitive account routes per IP

### Data Privacy

- **Server Visibility**: Only item IDs and created/updated timestamps; all contents are encrypted
- **In Transit**: TLS 1.2+ (enforced by Helmet headers)
- **At Rest**: AES-256-GCM ciphertext only; server never has plaintext

### Client Security (Web)

- **Key Storage**: In-memory only; cleared on reload
- **Auto-lock**: After 15 minutes of inactivity (configurable)
- **Password Reveal**: Hidden after 20 seconds
- **PWA Offline**: Read-only encrypted vault available offline

### Client Security (Android)

- **Key Storage**: Android Keystore via `expo-secure-store` with `requireAuthentication`
- **Biometrics**: Key released only after fingerprint/face check, invalidated if biometrics change
- **Auto-lock**: 30 seconds after app backgrounded (configurable)
- **Clipboard**: Secrets wiped after 30 seconds
- **Screenshots**: Blocked via `FLAG_SECURE`
- **Recents**: App hidden from recent apps list

### Third-Party Data

- **Have I Been Pwned**: First 5 hex characters of SHA-1 sent (k-anonymity), response padded
- **DuckDuckGo Icons**: Optional; domain only sent if enabled

### No Master Password Recovery

By design, there is no recovery mechanism. This is inherent to zero-knowledge encryption. Users are warned at sign-up and encouraged to store encrypted backups.

For full details, see [`docs/SECURITY.md`](docs/SECURITY.md).

---

## Configuration

### Server Environment Variables (`server/config.env`)

| Variable | Required | Description |
|---|---|---|
| `MONGO_URL` | Yes | MongoDB connection string (URI or `mongodb://host/db`) |
| `DATABASE` / `MONGODB_URI` | Alternative | Alternative names for `MONGO_URL` |
| `SECRET_KEY` | Yes | Long random string for JWT signing (min 32 characters) |
| `CRYPTO_SECRET_KEY` | Yes | Long random string for sealing 2FA secrets (min 32 characters) |
| `CLIENT_ORIGINS` | No | Comma-separated CORS origins (e.g., `https://my-app.com,https://backup.com`) |
| `SELF_URL` | No | Public API URL for keep-alive pings (e.g., `https://api.example.com`) |
| `NODE_ENV` | No | `production` or `development` (default: `development`) |
| `KEEP_ALIVE` | No | Enable keep-alive self-pinging (`true` by default if `SELF_URL` or `RENDER_EXTERNAL_URL` is set) |
| `KEEP_ALIVE_MINUTES` | No | Interval for keep-alive pings (default: 14 minutes) |
| `PORT` | No | Server port (default: 8000) |

### Web Client Environment Variables

| Variable | Required | Description |
|---|---|---|
| `VITE_API_URLS` | No | API base URL (default: current domain + `/api`) |
| `REACT_APP_ANDROID_URL` | No | URL to Android app download link |

### Mobile App Configuration

Edit `mobile/app.json` → `expo.extra.apiServers` to add default API servers.

Alternatively, set `EXPO_PUBLIC_API_URLS` at build/run time:
```bash
EXPO_PUBLIC_API_URLS=https://api.example.com npx expo run:android
```

### Render Deployment

The `render.yaml` blueprint automatically prompts for:
- `MONGO_URL`
- `SECRET_KEY`
- `CRYPTO_SECRET_KEY`
- `CLIENT_ORIGINS` (optional)

**Important**: Use the **same** `SECRET_KEY` and `CRYPTO_SECRET_KEY` on every server that shares a database, otherwise logins and decryption will fail.

---

## Dependencies

### Server Dependencies

```json
{
  "bcrypt": "^6.0.0",
  "cookie-parser": "^1.4.7",
  "cors": "^2.8.6",
  "dotenv": "^18.0.3",
  "express": "^5.2.1",
  "helmet": "^8.3.0",
  "jsonwebtoken": "^9.0.3",
  "mongoose": "^9.10.2"
}
```

**Dev Dependencies**:
- `mongodb-memory-server@^11.3.0` — In-memory MongoDB for tests
- `supertest@^7.3.0` — HTTP testing library

### Client Dependencies

```json
{
  "axios": "^1.20.0",
  "qrcode": "^1.5.4",
  "react": "^19.3.0",
  "react-dom": "^19.3.0",
  "react-responsive-modal": "^7.2.0",
  "react-router-dom": "^7.18.4",
  "react-toastify": "^11.1.0",
  "xlsx": "^0.20.3"
}
```

**Dev Dependencies**:
- `vite@^8.3.1` — Build tool
- `@vitejs/plugin-react@^6.1.1` — React plugin for Vite

### Mobile Dependencies

Key packages (see `mobile/package.json` for full list):
- `expo@~57.0.25` — React Native framework
- `expo-router@~57.0.23` — File-based routing
- `react-native@0.86.3` — Native module
- `react-native-quick-crypto@^1.1.7` — Native cryptography
- `expo-secure-store@~57.0.4` — Secure key storage
- `expo-camera@~57.0.5`, `expo-local-authentication@~57.0.3`, etc.

---

## Contribution Guide

Thank you for your interest in contributing! Stashr is completely open-source, and all contributions are welcome.

### Reporting Issues

1. **Search existing issues** at https://github.com/Tanushh18/password-manager/issues to avoid duplicates
2. **Open a new issue** describing:
   - What you were doing (steps to reproduce)
   - What happened (actual behavior)
   - What you expected to happen
   - Environment (OS, browser/app version, Node version)
   - Screenshots or logs if applicable

### Contributing Code

#### 1. Fork the Repository

Click the **Fork** button in the top-right corner of the GitHub page. A copy will appear under your account.

#### 2. Clone Your Fork

```bash
git clone https://github.com/<your-username>/password-manager.git
cd password-manager
```

#### 3. Create a Feature Branch

```bash
git checkout -b feature/my-feature
# or for bug fixes:
git checkout -b fix/my-bugfix
```

#### 4. Set Up the Project Locally

Follow the **Installation** section above for server, client, and/or mobile.

#### 5. Make Your Changes

- Write clean, readable code
- Follow the existing code style (spaces, naming conventions)
- Add tests for new features or bug fixes
- Update documentation if needed (e.g., README, inline comments)

#### 6. Run Tests

```bash
# Server
cd server && npm test

# Client (crypto & importers)
cd client && npm test

# Mobile (config check)
cd mobile && npm run doctor
```

Ensure all tests pass before pushing.

#### 7. Commit Your Changes

```bash
git add .
git commit -m "Fix: describe what was fixed" -m "Additional details if needed"
# or
git commit -m "Feat: add new feature" -m "Explain the feature and why it matters"
```

Follow conventional commit style:
- `fix:` for bug fixes
- `feat:` for new features
- `docs:` for documentation
- `refactor:` for code improvements
- `test:` for test additions
- `chore:` for build, dependencies, etc.

#### 8. Push to Your Fork

```bash
git push origin feature/my-feature
```

#### 9. Open a Pull Request

1. Go to https://github.com/Tanushh18/password-manager
2. Click **Compare and pull request** (GitHub shows this automatically)
3. Fill in the PR title and description:
   - **Title**: Short summary (e.g., "Fix: correct password validation edge case")
   - **Description**: Why this change? What does it do? (link related issues with #123)
4. Click **Create pull request**

#### 10. Code Review & Merge

- Your PR will be reviewed for correctness, security, and style
- Address any feedback by pushing additional commits to your branch
- Once approved, your PR will be merged into `main`

### Development Workflow

- **Server tests** run on every push (CI pipeline via GitHub Actions)
- **Web build** is tested for compilation errors
- **Mobile** is checked for config errors
- **Security**: npm audit is run to check for known vulnerabilities

### Guidelines

- **Security first**: If your change touches encryption, authentication, or secrets handling, include security justification in the PR
- **Tests matter**: Add tests for any new functionality
- **Documentation**: Update inline comments and README if adding features
- **Performance**: Consider the impact on load times and battery usage (especially for mobile)
- **Compatibility**: Test across browsers (Chrome, Firefox, Safari) and devices (Android devices/emulators)

### Getting Help

- Join discussions in GitHub Issues
- Ask questions in PRs; reviewers are happy to help
- Check existing code and tests for patterns and examples

---

## Deployment

### API Server (Render)

1. **Push to your repository**
2. **In Render Dashboard**: New → Blueprint
3. **Select this repository** and `render.yaml`
4. **Fill in secrets**:
   - `MONGO_URL`: MongoDB connection string (Atlas or self-hosted)
   - `SECRET_KEY`: Long random string (use online generator or `node -e "console.log(...)`)
   - `CRYPTO_SECRET_KEY`: Another long random string
   - `CLIENT_ORIGINS` (optional): Comma-separated list of allowed frontend origins

5. **Deploy**: Render builds and runs the server
6. **Keep-alive**: Server pings itself every 14 minutes (free tier stays warm)

See `render.yaml` for full configuration.

### Web Client (Static Hosting)

1. **Build locally**:
   ```bash
   cd client && npm run build
   ```

2. **Deploy `client/build/` to**:
   - **Netlify**: Drag and drop `build/` or connect GitHub
   - **Vercel**: Import repo, set build command `npm install && npm run build`
   - **Render**: Create a Static Site, build command: `npm install && npm run build`, publish dir: `client/build`
   - **GitHub Pages**: Push to `gh-pages` branch (requires configuration)

3. **Set environment**:
   ```bash
   VITE_API_URLS=https://api.example.com npm run build
   ```

4. **Important**: Configure a URL rewrite to serve `index.html` for all routes (SPA routing):
   - **Netlify**: `_redirects` file with `/* /index.html 200`
   - **Vercel**: `vercel.json` with rewrites
   - **Render**: Configure under "Rewrites & Redirects"

### Android App (Play Store)

1. **Set up EAS**:
   ```bash
   cd mobile
   npx eas-cli@latest init
   export EXPO_TOKEN=<token-from-expo.dev>
   ```

2. **Build AAB** (Play Store format):
   ```bash
   npm run build:aab
   ```

3. **Or use GitHub Actions**:
   - Add `EXPO_TOKEN` secret to your repo
   - Push to trigger **"Android build (EAS)"** workflow
   - Download APK/AAB from Artifacts

4. **Submit to Play Store**:
   ```bash
   eas submit -p android --latest
   ```

5. **Checklist**:
   - Privacy policy at `https://your-domain/privacy`
   - Data safety: account email/name, E2E encrypted vault, camera for QR codes
   - No ads, analytics, or tracking

---

## Troubleshooting

### "Cannot find module 'mongodb'" or other missing dependencies

```bash
# Server
cd server && npm install

# Client
cd client && npm install

# Mobile
cd mobile && npm install
```

### Server won't start: "MONGO_URL not set" or "Cannot connect to MongoDB"

- Verify `config.env` exists and has `MONGO_URL`
- Check MongoDB connection string format:
  - Local: `mongodb://localhost:27017/password-manager`
  - Atlas: `mongodb+srv://user:pass@cluster.mongodb.net/password-manager`
- Ensure MongoDB is running: `mongod` (local) or check Atlas connection

### Web client can't reach API

- Verify API is running at the port you set (default: 8000)
- Check `VITE_API_URLS` environment variable:
  ```bash
  VITE_API_URLS=http://localhost:8000 npm run dev
  ```
- Ensure CORS is configured correctly:
  - If API and client are on different hosts, set `CLIENT_ORIGINS` on the server
- Check browser console (F12) for network errors

### Android app crashes on startup

- Ensure `EXPO_PUBLIC_API_URLS` is set to your server's IP/hostname:
  ```bash
  EXPO_PUBLIC_API_URLS=http://192.168.1.20:8000 npx expo run:android
  ```
- Check that your device can reach the API server (same network)
- Review Android logcat: `adb logcat | grep "reactnative"`

### Tests failing

**Server tests**:
```bash
cd server && npm test
```
- Uses in-memory MongoDB; no external database needed
- Check for open ports conflicts

**Client tests**:
```bash
cd client && npm test
```
- Tests crypto interop, importers, health checks
- Requires `crypto.js` and related modules

### "Private IP" or "Localhost" issues on mobile

- Use your computer's **local IP** (e.g., `192.168.1.20`), not `localhost`
  ```bash
  EXPO_PUBLIC_API_URLS=http://192.168.1.20:8000 npx expo run:android
  ```
- Ensure device is on the same network as your computer
- On macOS/Linux: `ifconfig | grep 192.168`

---

## License

ISC License — See the repository for details.

---

## Acknowledgments

- **Original Author**: Rohit Saini
- **Contributors**: All the amazing people helping improve Stashr
- **Security**: Design reviewed against OWASP Top 10 and zero-knowledge architecture principles
- **Open Source**: Built on the shoulders of Express, Mongoose, React, Vite, Expo, and the Node.js ecosystem

---

## Questions or Feedback?

- **Report a bug**: https://github.com/Tanushh18/password-manager/issues/new
- **Start a discussion**: https://github.com/Tanushh18/password-manager/discussions
- **Security issues**: Please email privately instead of opening a public issue

Happy vaulting! 🔐
