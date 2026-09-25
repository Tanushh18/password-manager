const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");

// How many devices can be signed in at once; the oldest session is dropped first.
const MAX_SESSIONS = 10;
const TOKEN_TTL = "30d";

const entrySchema = new mongoose.Schema({
    // "e2e"  : `data` is an AES-256-GCM blob encrypted on the device (server can't read it)
    // "gcm"  : legacy server-encrypted entry (password/iv/tag), written by old clients
    // absent : oldest legacy entries, server AES-256-CBC (password/iv)
    enc: { type: String },
    data: { type: String },

    // Legacy fields
    password: { type: String },
    iv: { type: String },
    tag: { type: String },
    platform: { type: String },
    platEmail: { type: String },

    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

const schema = new mongoose.Schema({
    name: { type: String, trim: true },
    email: { type: String, trim: true, index: true },
    password: { type: String },

    // Legacy field: older accounts stored a hash of the confirmation password.
    cpassword: { type: String },

    tokens: [
        {
            token: { type: String },
            createdAt: { type: Date, default: Date.now },
            client: { type: String }
        }
    ],

    // End-to-end vault settings. The server stores only the public KDF salt and
    // an encrypted "key check" blob — never the key itself.
    kdf: {
        salt: { type: String },
        iterations: { type: Number }
    },
    keyCheck: { type: String },

    twoFactor: {
        enabled: { type: Boolean, default: false },
        secret: { type: String },          // sealed with the server key
        pendingSecret: { type: String },   // sealed, during setup
        lastStep: { type: Number, default: -1 },
        recoveryCodes: [{ type: String }]  // sha256 hashes
    },

    passwords: [entrySchema]
}, { timestamps: true });


// HASHING THE PASSWORD
schema.pre("save", async function ()
{
    if (this.isModified("password"))
    {
        this.password = await bcrypt.hash(this.password, 12);
    }
});


// GENERATING AUTH TOKEN
schema.methods.generateAuthToken = async function (client = "web")
{
    const token = jwt.sign({ _id: this._id, jti: crypto.randomBytes(12).toString("hex") }, process.env.SECRET_KEY, { expiresIn: TOKEN_TTL });
    this.tokens = this.tokens.concat({ token, client, createdAt: new Date() }).slice(-MAX_SESSIONS);
    await this.save();
    return token;
};

// Legacy: add a server-encrypted entry (old clients only)
schema.methods.addNewPassword = async function (userPass, iv, platform, platEmail, tag)
{
    const now = new Date();
    this.passwords.push({ enc: tag ? "gcm" : undefined, password: userPass, iv, tag, platform, platEmail, createdAt: now, updatedAt: now });
    await this.save();
    return true;
};

const publicEntry = (entry) =>
{
    if (entry.enc === "e2e")
    {
        return { _id: entry._id, enc: "e2e", data: entry.data, createdAt: entry.createdAt, updatedAt: entry.updatedAt };
    }
    return {
        _id: entry._id,
        enc: entry.enc || "cbc",
        platform: entry.platform,
        platEmail: entry.platEmail,
        // Ciphertext + iv are kept for older web builds that decrypt by value.
        password: entry.password,
        iv: entry.iv,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt
    };
};

// Public view of the account: never send hashes, 2FA secrets or session tokens to a client.
schema.methods.toPublic = function ()
{
    return {
        _id: this._id,
        name: this.name,
        email: this.email,
        vault: {
            kdf: this.kdf && this.kdf.salt ? { salt: this.kdf.salt, iterations: this.kdf.iterations } : null,
            keyCheck: this.keyCheck || null
        },
        twoFactorEnabled: Boolean(this.twoFactor && this.twoFactor.enabled),
        recoveryCodesLeft: this.twoFactor && this.twoFactor.enabled ? (this.twoFactor.recoveryCodes || []).length : 0,
        sessions: (this.tokens || []).length,
        passwords: (this.passwords || []).map(publicEntry)
    };
};

schema.statics.publicEntry = publicEntry;

const User = mongoose.model("user-data", schema);
module.exports = User;
