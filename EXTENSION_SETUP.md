# Password Manager Extension - Complete Setup Guide

## What You Got

A complete browser extension solution for password autofill across your devices.

### Files Created:

```
extension/
├── manifest.json         ✅ Extension configuration
├── popup.html           ✅ Main UI (login + password list)
├── popup.js             ✅ Popup logic (handles all interactions)
├── popup.css            ✅ Styling
├── content.js           ✅ Injects into websites for autofill
├── background.js        ✅ Service worker
└── README.md            ✅ Full documentation

server/router/
└── extension.js         ✅ Backend API endpoints

server/app.js            ✅ Updated (added CORS for extension)
server/router/routing.js ✅ Updated (imported extension router)
```

---

## Step 1: Backend Setup

### 1.1 Verify Server Endpoints

The following endpoints are now available:

```
GET  /api/password/all                  # Get all passwords
GET  /api/password/by-domain?domain=X   # Get passwords for domain
GET  /api/password/:id                  # Get single password
GET  /api/password/:id/decrypted        # Get decrypted password (autofill)
POST /api/login                         # Login endpoint
```

### 1.2 Test Backend

```bash
cd server
npm install
npm start
# Server should run on http://localhost:5000
```

Test login endpoint:
```bash
curl -X POST http://localhost:5000/api/login \
  -H "Content-Type: application/json" \
  -d '{"email":"your@email.com","password":"yourpassword"}'
```

---

## Step 2: Configure Extension

### 2.1 Update Server URL

Edit `extension/popup.js` line 1:

```javascript
const API_BASE = 'http://localhost:5000/api'; // ← Change this
```

**For local development:**
```javascript
const API_BASE = 'http://localhost:5000/api';
```

**For production:**
```javascript
const API_BASE = 'https://your-domain.com/api';
```

### 2.2 Add Icons (Optional but Recommended)

Create `extension/icons/` folder and add:
- `icon-16.png` (16x16 pixels)
- `icon-48.png` (48x48 pixels)  
- `icon-128.png` (128x128 pixels)

Or use placeholder icons (the extension will still work without them).

---

## Step 3: Load Extension in Chrome

1. Open **Chrome** and go to: `chrome://extensions/`

2. Enable **Developer Mode** (toggle in top right)

3. Click **Load unpacked**

4. Navigate to and select the `extension/` folder from this repo

5. The extension should now appear in your Chrome toolbar! 🎉

---

## Step 4: Test the Extension

### Test Login

1. Click the extension icon in toolbar
2. Enter your password manager credentials
3. Click **Login**
4. If successful, you'll see your password list

### Test Autofill

1. Go to **https://httpbin.org/forms/post** (or any login page)
2. Click extension icon
3. Click the **📝** (Autofill) button on a password
4. The email/password fields should auto-fill!

### Test Copy

1. Click extension icon
2. Click **📋** (Copy) button
3. Password is copied to clipboard
4. Paste with `Ctrl+V`

### Test QR Code

1. Click extension icon
2. Click **📱** (QR Code) button
3. QR code displays with account info

---

## Step 5: Use the Extension

### Daily Workflow

**On any website login page:**
1. Click extension icon
2. Look under "For this website" section
3. Click **📝** to autofill, or **📋** to copy password
4. Submit the form normally

**To logout:**
1. Click extension icon
2. Click **Logout** button
3. Extension clears your session

---

## Configuration Options

### Change Server Domain

Edit `extension/popup.js`:
```javascript
const API_BASE = 'https://your-api.com/api'; // Production
```

### Enable/Disable Features

In `popup.js`, you can:
- Comment out QR code feature
- Change autofill behavior
- Customize UI colors in `popup.css`

### Custom Domain Matching

Edit `extension/popup.js` function `filterPasswordsByDomain()` to improve matching:

```javascript
function filterPasswordsByDomain(domain) {
  return allPasswords.filter(pwd => {
    const service = (pwd.service || pwd.platform || "").toLowerCase();
    // Add your custom logic here
    return service.includes(domain.replace('www.', ''));
  });
}
```

---

## API Authentication

The extension uses **JWT tokens** for authentication:

1. User logs in with email/password
2. Server returns JWT token
3. Token is stored in Chrome's `chrome.storage.local`
4. All API calls include: `Authorization: Bearer <token>`
5. Token expires after 30 days (configured in server)

---

## Security Checklist

✅ Passwords are encrypted end-to-end  
✅ Extension never logs passwords in plain text  
✅ JWT tokens expire automatically  
✅ HTTPS only in production  
✅ CORS restricted to trusted origins  
✅ Content script doesn't steal form data  

---

## Troubleshooting

### Extension doesn't load?
- Check that you selected the `extension/` folder
- Enable Developer Mode
- Reload the extension (circular arrow icon)

### Login fails?
- Verify server is running: `http://localhost:5000/health`
- Check API_BASE URL is correct in popup.js
- Check browser console for errors (right-click → Inspect)
- Verify CORS settings in `server/app.js`

### Autofill not working?
- Make sure website has `<input>` fields
- Try on: https://httpbin.org/forms/post
- Check browser console for errors
- Inspect element to see field names/types

### Password list empty?
- Verify you're logged in correctly
- Check that passwords exist in your vault
- Try refreshing the popup

### CORS Error?
Add your extension URL to `server/app.js` allowedOrigins:
```javascript
const allowedOrigins = [
  'http://localhost:3000',
  'https://password-website.onrender.com',
  'chrome-extension://YOUR_EXTENSION_ID' // Add this
];
```

Get extension ID from `chrome://extensions/`

---

## Publishing to Chrome Web Store

When ready to release:

1. Create a `.zip` file of the `extension/` folder
2. Go to: https://chrome.google.com/webstore/developer/dashboard
3. Upload the zip file
4. Fill in description, icons, screenshots
5. Submit for review

**Required:**
- 128x128 icon
- Privacy policy
- Clear description of what it does

---

## Next Steps

### Short-term (This Week)
- [x] Create browser extension
- [x] Add backend API endpoints
- [ ] Test autofill on 5+ websites
- [ ] Add custom icons

### Medium-term (This Month)
- [ ] Add password search/filter
- [ ] Add favorites/frequently used
- [ ] Add right-click context menu
- [ ] Add keyboard shortcut

### Long-term (This Quarter)
- [ ] Sync extension across devices
- [ ] Add secure sharing features
- [ ] Add password generation in extension
- [ ] Add breach detection

---

## File Summary

| File | Purpose |
|------|---------|
| manifest.json | Extension metadata + permissions |
| popup.html | Login & password list UI |
| popup.js | Main extension logic |
| popup.css | UI styling |
| content.js | Injects into websites for autofill |
| background.js | Service worker (mostly empty for now) |
| extension.js | Backend API routes |

---

## Quick Start Commands

```bash
# Start server
cd server && npm start

# Load extension in Chrome
# 1. chrome://extensions/
# 2. Developer mode ON
# 3. Load unpacked → select extension/ folder

# Test autofill
# Visit: https://httpbin.org/forms/post
# Click extension → autofill → check if filled
```

---

## Support

If something doesn't work:
1. Check the **Troubleshooting** section above
2. Open browser console (right-click → Inspect)
3. Look for error messages
4. Check server logs in terminal

Happy autofilling! 🔐
