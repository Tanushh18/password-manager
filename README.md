# Aurelia — Aurora Password Vault

A password manager on the MERN stack with a website **and a native Android app** that share one API
and one database. Every secret is encrypted with AES-256 before it reaches the database.

## What is inside

* **Aurora interface** — midnight glass, animated northern-light gradients, a twinkling star field,
  a light that follows your pointer, gradient text, and a dark / light theme toggle.
* **Live vault health** — a real-time score (0–100) with weak, reused and stale password counts,
  strength badges on every entry, and filters to fix them fast. Scored server side, so plaintext
  never leaves the API.
* **Built-in generator** — adjustable length, live strength meter (bits of entropy).
* **Android app** (`mobile/`) — Expo app with biometric unlock, one-tap copy with clipboard
  auto-clear, generator, passphrases and the same health score. See [`mobile/README.md`](mobile/README.md).
* **Installable PWA** — add the website to your home screen; it has its own icon and an offline page.
* **Live service status** — every page shows the real state of the API, read from `/health`.
* **A health endpoint for cron jobs** — so free-tier hosting never goes to sleep.

### Design system

| Role | Dark | Light |
| --- | --- | --- |
| Background | `#07061A` | `#F6F4FF` |
| Primary violet | `#8B5CF6` | `#7C3AED` |
| Magenta | `#EC4899` | `#DB2777` |
| Cyan | `#22D3EE` | `#0891B2` |
| Success mint | `#34D399` | `#10B981` |
| Warning amber | `#FBBF24` | `#D97706` |
| Danger rose | `#F43F5E` | `#E11D48` |

Web tokens live in `client/src/styles/theme.css`, app tokens in `mobile/src/lib/theme.js`.
Typography is Sora (display), Inter (body) and JetBrains Mono (secrets).

## Keeping the server awake

The API exposes a public, unauthenticated health check that an external cron job
(cron-job.org, UptimeRobot, a Render cron, ...) can ping on a schedule:

```
GET https://<your-api>/health
```

```json
{
  "status": "ok",
  "service": "password-manager-api",
  "uptime": 128.42,
  "database": { "state": "connected", "connected": true },
  "memory": { "rssMb": 61.6, "heapUsedMb": 14.9 }
}
```

`/healthz`, `/api/health`, `HEAD /health`, `/ping` and `/` all answer 200 as well, so any pinger works.

The server can also keep itself awake. Set `SELF_URL` (Render sets `RENDER_EXTERNAL_URL` for you) and
it pings its own `/health` every 14 minutes:

| Variable | Meaning |
| --- | --- |
| `SELF_URL` | Public URL of the API, e.g. `https://your-api.onrender.com` |
| `KEEP_ALIVE` | `false` disables the self ping |
| `KEEP_ALIVE_MINUTES` | Interval in minutes (default `14`) |
| `CLIENT_ORIGINS` | Extra allowed CORS origins, comma separated |

## Installing Aurelia on a phone

1. Open the site in Chrome (Android) or Safari (iOS).
2. **Android / desktop Chrome:** accept the "Keep Aurelia on your phone" invitation, or use
   *Menu → Install app*.
3. **iOS Safari:** tap *Share → Add to Home Screen*.

The service worker (`client/public/service-worker.js`) caches only the app shell and static assets.
API traffic is never cached — passwords always come fresh from the server.

<a id="setting">
<h2>Setting up the project</h2>
</a>
Go to the folder in which you want to clone the project and run the following command

```bash
git clone https://github.com/rockingrohit9639/password-manager-mern.git
```

### Setting up the server
To setup the server in your system run the following commands

```sh
cd server
npm install
```

After installing all the server dependencies run the server using the following command 

```sh
npm run dev:start
```
Now, the server will be up and running

**Note :- You have to configure all the environment variables by creating a config.env file in root server folder.

Structure of the config.env file

```js
MONGO_URL=<your MongoDB URI>
SECRET_KEY=<your secret key for hashing passwords>
CRYPTO_SECRET_KEY=<your secret key for encrypting passwords while saving in db>
SELF_URL=<optional: public URL of this API, enables the keep-alive self ping>
CLIENT_ORIGINS=<optional: extra allowed origins, comma separated>
```

`DATABASE` and `MONGODB_URI` are accepted as aliases for `MONGO_URL`.

### Setting up the client
Go to the client folder and run 

```sh
npm install
```
All the dependencies should be installed. Now, you just have to start the React server by following command

```sh
npm start
```

Point the client at a different API by setting `REACT_APP_API_URL` before building:

```sh
REACT_APP_API_URL=http://localhost:8000 npm start
```

### You also have to keep the mongodb cluster open in order to run the app properly.

## API routes

| Method | Route | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/health` | – | Health check for uptime cron jobs |
| `POST` | `/register` | – | Create an account |
| `POST` | `/login` | – | Sign in, sets the `jwtoken` cookie |
| `GET` | `/logout` | – | Clear the session cookie |
| `GET` | `/authenticate` | session | Current user and their stored passwords (no hashes or tokens) |
| `POST` | `/addnewpassword` | session | Store a new encrypted password |
| `POST` | `/updatepassword` | session | Change the password, platform or email on an entry |
| `POST` | `/deletepassword` | session | Remove an entry |
| `POST` | `/decrypt` | session | Decrypt one of **your own** entries (`{ id }`) |
| `GET` | `/insights` | session | Vault health: score, strength, reuse and age per entry |

"session" means either the `jwtoken` cookie (website) or an `Authorization: Bearer <token>`
header (Android app, which gets its token by sending `"client": "mobile"` to `/login`).

## Security notes

* Login and register are rate limited (20 attempts / 15 min per IP).
* Session JWTs expire after 30 days; each account keeps at most 10 active sessions and
  `/logout` revokes the current one on the server.
* The web client auto-hides revealed passwords after 20s; the app also clears copied
  passwords from the clipboard after 30s.

# How to contribute?
This project is completely open source. Everyone's contribution is welcome here.
The following are guidelines for contributing to this project.

### 🚩 New Issue : 
For any bug or a new feature please open an issue [here](https://github.com/rockingrohit9639/password-manager-mern/issues/new)

### 🚩 Forking repository :
Firstly you have to make your own copy of the project. For that, you have to fork the repository. You can find the fork button on the top-right side of the browser window. (Refer to the image below )
Kindly wait till it gets forked.
After that copy will look like <your-user-name>/password-manager-mern forked from rockingrohit/password-manager-mern.

### 🚩 Clone repository :
Now you have your own copy of the project. Here you have to start your work.
Go to the desired location on your computer where you want to set up the project.
Right-click there and click on git bash. A terminal window will pop up
Type the command git clone <your-fork-url>.git and hit enter.
Wait for few seconds till the project gets copied
  
### Setup the project given at the top of this readme file. [here](#setting)

### 🚩 Pushing your changes :
After doing the changes, and when tests are successfully passing you can push your changes to remote.
Go to your terminal and type git status and hit enter, this will show your changes from the files.
Then type in git add . and hit enter, this will add all the files to the staging area.
Commit the changes by git commit -m "<message-describing-your-change>" and hit enter.
Now push your branch to your fork by git push origin <your-branch-name> or git push and hit enter.

### 📌 Creating a pull request : 
By this time you can see a message on your GitHub fork as your fork is ahead of rockingrohit9639: master by <number> of commits and you can also see a button Compare and pull request.
Click on Compare and pull request button
Fill the form completely by describing your change, cause of change, issue getting fixed etc.
After filling the form completely click on Create Pull request
  
Then your work is done. Thank you for your submissions. I will review your code and merge it.
