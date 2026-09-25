const mongoose = require("mongoose");

// Accept the common variable names so the same code runs locally and on Render
const databaseUrl = () => process.env.MONGO_URL || process.env.DATABASE || process.env.MONGODB_URI;

const connect = async (url = databaseUrl()) =>
{
    if (!url)
    {
        console.error("No database URL found. Set MONGO_URL (or DATABASE) in your environment.");
        return null;
    }

    mongoose.connection.on("disconnected", () => console.warn("Database disconnected."));
    mongoose.connection.on("reconnected", () => console.log("Database reconnected."));
    mongoose.connection.on("error", (error) => console.error("Database error:", error.message));

    try
    {
        await mongoose.connect(url);
        console.log("Connection success.");
    }
    catch (error)
    {
        console.log("Database connection failed:", error.message);
    }
    return mongoose.connection;
};

module.exports = { connect, databaseUrl };
