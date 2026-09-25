// Entry point: loads config, connects to MongoDB and starts listening.
const dotenv = require("dotenv");
dotenv.config({ path: "./config.env", quiet: true });
dotenv.config({ quiet: true });

const app = require("./app");
const { connect } = require("./db/connection");
const { startKeepAlive } = require("./utils/keepAlive");

const PORT = process.env.PORT || 8000;

connect();

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
