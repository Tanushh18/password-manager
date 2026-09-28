const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { sealJSON, unsealJSON } = require("./EncDecManager");

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

    twoFactor: {
        enabled: { type: Boolean, default: false },
        secret: { type: String },          // sealed with the server key
        pendingSecret: { type: String },   // sealed, during setup
        lastStep: { type: Number, default: -1 },
        recoveryCodes: [{ type: String }]  // sha256 hashes
    },

    passwords: [entrySchema],

    // Project/infra tracker entries. Same shape and same end-to-end scheme as
    // `passwords` above — each entry is an opaque AES-256-GCM blob the server
    // cannot read.
    projects: [entrySchema]
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
    // "srv": current format — fields are JSON, encrypted with the server key.
    // The server decrypts here so the client just gets plain fields back.
    if (entry.enc === "srv")
    {
        let fields = {};
        try { fields = unsealJSON(entry.data); } catch (e) { fields = { broken: true }; }
        return { ...fields, _id: entry._id, createdAt: entry.createdAt, updatedAt: entry.updatedAt };
    }
    if (entry.enc === "e2e")
    {
        // Old end-to-end blobs from before the switch to server-side encryption.
        // The server never had the key, so these can no longer be read.
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

const sealEntry = (fields) => sealJSON(fields);

// Public view of the account: never send hashes, 2FA secrets or session tokens to a client.
schema.methods.toPublic = function ()
{
    return {
        _id: this._id,
        name: this.name,
        email: this.email,
        twoFactorEnabled: Boolean(this.twoFactor && this.twoFactor.enabled),
        recoveryCodesLeft: this.twoFactor && this.twoFactor.enabled ? (this.twoFactor.recoveryCodes || []).length : 0,
        sessions: (this.tokens || []).length,
        passwords: (this.passwords || []).map(publicEntry),
        projects: (this.projects || []).map(publicEntry)
    };
};

schema.statics.publicEntry = publicEntry;
schema.statics.sealEntry = sealEntry;

const User = mongoose.model("user-data", schema);
module.exports = User;
