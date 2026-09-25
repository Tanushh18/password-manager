const express = require("express");
const app = express();
const dotenv = require("dotenv");
const cors = require("cors");
const cookieParser = require('cookie-parser');
const mongoose = require("mongoose");
const { startKeepAlive } = require("./utils/keepAlive");

// SETTING UP DOTENV
dotenv.config({ path: "./config.env" });
dotenv.config();

const allowedOrigins = [
  'http://localhost:3000',
  'https://password-website.onrender.com'
];

// Extra origins can be supplied as a comma separated list (CLIENT_ORIGINS)
if (process.env.CLIENT_ORIGINS)
{
  process.env.CLIENT_ORIGINS.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
    .forEach((origin) =>
    {
      if (!allowedOrigins.includes(origin)) allowedOrigins.push(origin);
    });
}

// Render / most PaaS sit behind a proxy: needed for per-IP rate limiting.
app.set("trust proxy", 1);
app.disable("x-powered-by");

// Basic security headers (no extra dependency)
app.use((req, res, next) =>
{
  res.set({
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Strict-Transport-Security": "max-age=15552000; includeSubDomains"
  });
  next();
});

app.use(cors({
  origin: function (origin, callback)
  {
    // No origin => same-origin call, curl, or an uptime/cron pinger
    if (!origin || allowedOrigins.includes(origin))
    {
      callback(null, true);
    }
    else
    {
      // Reject the CORS headers, but never throw: a bad origin must not
      // take the whole request down with a 500.
      callback(null, false);
    }
  },
  credentials: true,
  allowedHeaders: ["Content-Type", "Authorization", "Accept", "X-Client"]
}));
app.use(cookieParser());

const PORT = process.env.PORT || 8000;
const STARTED_AT = new Date();

// CONNECTING WITH DATABASE
require("./db/connection");

app.use(express.json({ limit: "1mb" }));

/* ─────────────────────────────────────────────
   HEALTH CHECKS
   Public, unauthenticated and dependency free so
   an external cron job (cron-job.org, UptimeRobot,
   Render cron, ...) can keep the free-tier instance
   awake and alert when it is down.
───────────────────────────────────────────── */
const DB_STATES = ["disconnected", "connected", "connecting", "disconnecting"];

const buildHealthPayload = () =>
{
  const dbState = mongoose.connection ? mongoose.connection.readyState : 0;
  const memory = process.memoryUsage();

  return {
    status: "ok",
    service: "password-manager-api",
    message: "Server is awake and healthy 💗",
    uptime: Number(process.uptime().toFixed(2)),
    startedAt: STARTED_AT.toISOString(),
    timestamp: new Date().toISOString(),
    database: {
      state: DB_STATES[dbState] || "unknown",
      connected: dbState === 1
    },
    memory: {
      rssMb: Number((memory.rss / 1024 / 1024).toFixed(2)),
      heapUsedMb: Number((memory.heapUsed / 1024 / 1024).toFixed(2))
    },
    env: process.env.NODE_ENV || "development"
  };
};

const healthHandler = (req, res) =>
{
  res.set("Cache-Control", "no-store");
  return res.status(200).json(buildHealthPayload());
};

// Primary health endpoint + the aliases uptime services commonly use
app.get("/health", healthHandler);
app.head("/health", (req, res) => res.status(200).end());
app.get("/healthz", healthHandler);
app.get("/api/health", healthHandler);
app.get("/ping", (req, res) =>
{
  res.set("Cache-Control", "no-store");
  res.status(200).send("pong");
});

// Root route so a cron job hitting "/" also gets a 200 instead of a 404
app.get("/", (req, res) =>
{
  res.set("Cache-Control", "no-store");
  res.status(200).json({
    status: "ok",
    message: "Password Manager API is running.",
    health: "/health"
  });
});

// LINKING THE ROUTER FILES 
app.use(require("./router/routing"));

// 404 for anything unmatched
app.use((req, res) =>
{
  res.status(404).json({ error: "Route not found." });
});

// CENTRAL ERROR HANDLER - keeps the process alive on bad requests
app.use((err, req, res, next) =>
{
  console.error("Unhandled request error:", err.message);
  if (res.headersSent) return next(err);
  if (err.type === "entity.parse.failed" || err.type === "entity.too.large")
  {
    return res.status(err.status || 400).json({ error: "Invalid request body." });
  }
  res.status(500).json({ error: "There was an internal error. Sorry for the inconvenience." });
});

// LISTENING TO PORT 
const server = app.listen(PORT, () =>
{
    console.log(`listening to port : http://localhost:${PORT}/`);
    console.log(`health check      : http://localhost:${PORT}/health`);

    // Self ping so free-tier hosting does not spin the instance down
    startKeepAlive();
});

// KEEPING THE PROCESS ALIVE ON UNEXPECTED FAILURES
process.on("unhandledRejection", (reason) =>
{
    console.error("Unhandled promise rejection:", reason);
});

process.on("uncaughtException", (error) =>
{
    console.error("Uncaught exception:", error);
});

// GRACEFUL SHUTDOWN
["SIGTERM", "SIGINT"].forEach((signal) =>
{
    process.on(signal, () =>
    {
        console.log(`${signal} received, shutting down gracefully.`);
        server.close(() => process.exit(0));
    });
});

module.exports = app;
