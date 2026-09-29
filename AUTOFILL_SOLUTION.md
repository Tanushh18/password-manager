# Password Manager Autofill Solution

## Problem Statement
User wants to enter passwords without manual copy-paste across devices (laptop, TV, phone).

## Solution Architecture (3 Phases)

### **Phase 1: Browser Extension (MVP - Highest Impact)**
- Detects current website automatically
- One-click autofill username + password
- Works on same device (laptop/desktop)

**Implementation:**
1. Create Chrome/Firefox extension
2. Content script detects login fields
3. Matches website to password entries (by favicon/domain)
4. Communicates with web app via message passing
5. Autofills credentials securely

### **Phase 2: QR Code + Clipboard Bridge**
For TV/different device scenarios:
- Generate QR code for each password entry
- Phone app scans QR → identifies account
- Phone copies password to clipboard
- User pastes on TV login screen
- Removes manual typing, reduces friction

**Implementation:**
1. Add `qrIdentifier` field to password schema
2. Generate QR codes in app (already have `qrcode` lib)
3. Mobile app: scan QR → copy password
4. Desktop app: show QR codes for each entry

### **Phase 3: Direct Device-to-Device Sync (Future)**
- Bluetooth/WiFi Direct connection
- One-tap autofill without scanning
- Most seamless but complex

---

## Phase 1: Browser Extension (Recommended Start)

### Architecture

```
Website Login Page
        ↓
    [Content Script]
    (Detects input fields)
        ↓
    [Background Worker]
    (Handles messages)
        ↓
    [Extension Popup]
    (Shows passwords)
        ↓
    [Web App API]
    (Fetches encrypted passwords)
        ↓
    [Password Autofill]
    (Fills username + password)
```

### Files to Create

```
extension/
├── manifest.json           # Extension config
├── content-script.js       # Runs on websites
├── background-worker.js    # Background process
├── popup.html             # Popup UI
├── popup.js               # Popup logic
├── popup.css              # Popup styles
└── icons/                 # Extension icons
```

### Backend API Needed

```
GET /api/password/by-domain?domain=google.com
Response: {
  _id: "...",
  username: "user@gmail.com",
  password: "encrypted_password",
  service: "Google"
}

POST /api/password/autofill
Request: {
  id: "password_id",
  action: "autofill"
}
```

---

## Phase 2: QR Code + Clipboard

### Database Schema Update

Add to password entry:
```javascript
qrIdentifier: { type: String, unique: true }, // UUID
qrData: { type: String }  // Base64 encoded QR image
```

### Mobile App Changes

```
1. Add QR scanner (use react-qr-reader)
2. Scan QR → extract qrIdentifier
3. Lookup password by qrIdentifier
4. Copy password to clipboard
5. Show "Copied to clipboard" toast
```

### Desktop App Changes

```
1. Display QR code in password entry detail view
2. Generate QR on-the-fly or store as image
3. User can screenshot QR for physical scanning
```

---

## Implementation Order

1. **Week 1:** Database schema + API endpoints
2. **Week 2:** Browser extension basics (content script)
3. **Week 3:** Extension popup UI + autofill logic
4. **Week 4:** QR code generation + mobile integration
5. **Week 5:** Testing + deployment

---

## Security Considerations

✅ **What we have:**
- End-to-end encryption (passwords encrypted on device)
- Per-account data keys
- Secure token-based auth

✅ **Extension security:**
- Never store passwords in memory longer than needed
- Autofill only into legitimate login forms
- Request user confirmation before autofilling
- Clear sensitive data after use

⚠️ **QR Code risks:**
- QR contains account identifier only, not password
- Phone→Clipboard is secure (one device)
- Recommend: Temporary QR codes (1-time use)

---

## Which Phase First?

**Recommendation: Start with Phase 1 (Browser Extension)**
- Solves 80% of use cases (laptop/desktop)
- Highest ROI for effort
- Can be done in 2-3 weeks
- Sets foundation for phases 2 & 3

**Phase 2** is easier once extension is done.
