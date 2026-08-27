require("dotenv").config({ path: "./config.env" });
require("dotenv").config();
const mongoose = require("mongoose");

// Accept the common variable names so the same code runs locally and on Render
const DB = process.env.MONGO_URL || process.env.DATABASE || process.env.MONGODB_URI;

if (!DB)
{
    console.error("No database URL found. Set MONGO_URL (or DATABASE) in your environment.");
}
else
{
    mongoose.connect(DB, {
        useNewUrlParser: true,
        useCreateIndex: true,
        useUnifiedTopology: true,
        useFindAndModify: false,
    })
        .then(() =>
        {
            console.log("Connection success.");
        })
        .catch((error) =>
        {
            console.log("Database connection failed:", error.message);
        });

    mongoose.connection.on("disconnected", () => console.warn("Database disconnected."));
    mongoose.connection.on("reconnected", () => console.log("Database reconnected."));
    mongoose.connection.on("error", (error) => console.error("Database error:", error.message));
}

module.exports = mongoose.connection;
