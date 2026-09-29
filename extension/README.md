# Password Manager Browser Extension

A secure Chrome/Firefox extension for autofilling passwords from your password manager vault directly onto login pages.

## Features

✅ **One-Click Autofill** - Auto-detect website and fill credentials  
✅ **QR Code Display** - Show QR codes for phone-based access  
✅ **Clipboard Copy** - Copy passwords securely  
✅ **Fast & Secure** - All passwords are encrypted end-to-end  
✅ **Works Offline** - Once logged in, cached data works without internet  

## Installation

### For Development (Chrome)

1. Open `chrome://extensions/`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the `extension/` folder from this repository
5. The extension should appear in your Chrome toolbar

### For Firefox

1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on**
3. Select any file from the `extension/` folder
4. The extension should appear in Firefox

## Configuration

### Update Server URL

Edit `extension/popup.js` and change:

```javascript
const API_BASE = 'http://localhost:5000/api'; // Change this
```

To your actual server:
- **Development**: `http://localhost:5000/api`
- **Production**: `https://your-domain.com/api`

## How to Use

### Login

1. Click the extension icon in your toolbar
2. Enter your email and password
3. Click **Login**

### Autofill Password

1. Go to any login page (Google, Figma, etc.)
2. Click the extension icon
3. You'll see "For this website" section with matching passwords
4. Click the **📝** (Autofill) button
5. Username and password are automatically filled!

### Copy Password

1. Click the extension icon
2. Find the password entry
3. Click the **📋** (Copy) button
4. Password copied to clipboard - paste where needed

### View QR Code

1. Click the extension icon
2. Click the **📱** (QR Code) button on any password
3. A QR code appears showing account info
4. **On Mobile**: Open your password manager app and scan the QR to copy password

## API Endpoints

The extension uses these endpoints on your server:

### Login
```
POST /login
Body: { email: string, password: string }
Response: { token: string, message: string }
```

### Get All Passwords
```
GET /password/all
Headers: { Authorization: Bearer <token> }
Response: { passwords: [...] }
```

### Get Password By Domain
```
GET /password/by-domain?domain=google.com
Headers: { Authorization: Bearer <token> }
Response: { passwords: [...] }
```

### Get Single Password
```
GET /password/:id
Headers: { Authorization: Bearer <token> }
Response: { password: {...} }
```

### Get Decrypted Password (for autofill)
```
GET /password/:id/decrypted
Headers: { Authorization: Bearer <token> }
Response: { password: string, username: string, service: string }
```

## Security

🔒 **End-to-End Encrypted**
- All passwords are encrypted on your device
- Server cannot read your passwords
- Extension never stores passwords in plain text

🔒 **Secure Communication**
- Uses HTTPS only in production
- JWT token-based authentication
- Session tokens expire after 30 days

🔒 **Auto-Logout**
- Logout button in extension popup
- Clear your session when not in use
- Token stored securely in Chrome storage

## Files Structure

```
extension/
├── manifest.json        # Extension configuration
├── popup.html          # Main UI
├── popup.js            # Popup logic
├── popup.css           # Styles
├── content.js          # Injects into websites
├── background.js       # Service worker
├── README.md           # This file
└── icons/              # Extension icons (add 16x16, 48x48, 128x128 PNG)
```

## Development

### Add Icons

Add PNG icons to `extension/icons/`:
- `icon-16.png` (16x16)
- `icon-48.png` (48x48)
- `icon-128.png` (128x128)

### Testing Autofill

1. Visit a login page with input fields
2. Fill email/username field with ID `"email"`, `"user"`, `"login"` etc.
3. Fill password field with type `password`
4. Click extension → Click autofill button
5. Fields should be automatically populated

### Debug in Chrome

1. Right-click extension icon → Inspect popup
2. Right-click webpage → Inspect → Application tab
3. Go to Chrome Developers Tools for extension scripts

## Troubleshooting

**Autofill not working?**
- Make sure you're on a login page with `<input>` fields
- Check browser console for errors (right-click → Inspect)
- Verify API_BASE URL is correct

**Login fails?**
- Check email/password is correct
- Verify server is running
- Check CORS settings on server

**Passwords not appearing?**
- Refresh the extension popup
- Make sure you're logged in
- Check that server API is responding

## Keyboard Shortcuts

You can set custom shortcuts for the extension in:
- **Chrome**: `chrome://extensions/shortcuts`
- **Firefox**: Extensions settings

Suggested shortcut: `Ctrl+Shift+P` to quickly open autofill

## Privacy & Terms

- Your passwords are never stored in plain text
- Extension data is stored locally in your browser
- No data is sent to third parties
- Clear your login session when done using the extension

## Support

For issues or feature requests, open an issue on GitHub.
