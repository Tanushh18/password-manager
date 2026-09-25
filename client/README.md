# Aurelia — website

Vite + React 19 client for the Aurelia vault. All encryption happens in the browser
(`src/lib/crypto.js`); see `../docs/SECURITY.md`.

```sh
npm install
VITE_API_URLS=http://localhost:8000 npm run dev   # dev server on :3000
npm test                                          # crypto interop, importers, health
npm run build                                     # production build → build/
```

| Variable | Purpose |
| --- | --- |
| `VITE_API_URLS` | Comma-separated API servers (fail-over order). `REACT_APP_API_URLS` still works. |
| `VITE_ANDROID_URL` | Download link for the Android app on the home page. |

Structure: `src/state/vault.jsx` (session, key, items), `src/Pages/*` (routes),
`src/Components/*` (UI), `src/lib/*` (crypto, items/import/export, health, breach check).
