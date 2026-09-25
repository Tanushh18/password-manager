require('dotenv').config();
const jwt = require('jsonwebtoken');
const User = require("../models/schema");

/**
 * Reads the session token from either
 *   - the httpOnly `jwtoken` cookie (web client), or
 *   - an `Authorization: Bearer <token>` header (Android / iOS app).
 */
const readToken = (req) =>
{
    const header = req.headers.authorization || "";
    if (header.toLowerCase().startsWith("bearer "))
    {
        const bearer = header.slice(7).trim();
        if (bearer) return bearer;
    }
    return (req.cookies && req.cookies.jwtoken) || null;
};

const authenticate = async (req, res, next) =>
{
    try
    {
        const token = readToken(req);
        if (!token)
        {
            return res.status(401).json({ error: "Access denied. No token provided." });
        }

        const verify = jwt.verify(token, process.env.SECRET_KEY);
        const rootUser = await User.findOne({ _id: verify._id, "tokens.token": token });

        if (!rootUser)
        {
            return res.status(401).json({ error: "Unauthorised user." });
        }

        req.token = token;
        req.rootUser = rootUser;
        req.userId = rootUser._id;

        next();
    }
    catch (error)
    {
        // Never log the token or the signing secret.
        return res.status(401).json({ error: "Unauthorised user." });
    }
};

authenticate.readToken = readToken;

module.exports = authenticate;
