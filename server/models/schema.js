const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

// How many devices can be signed in at once; the oldest session is dropped first.
const MAX_SESSIONS = 10;
const TOKEN_TTL = "30d";

const schema = new mongoose.Schema({
    name: {
        type: String,
        trim: true
    },

    email: {
        type: String,
        trim: true
    },
    password: {
        type: String,
    },

    // Legacy field: older accounts stored a hash of the confirmation password.
    // New accounts no longer write it.
    cpassword: {
        type: String,
    },
    tokens: [
        {
            token: {
                type: String,
            }
        }
    ],
    passwords: [
        {
            password: {
                type: String,
            },
            platform: {
                type: String,
            },
            platEmail: {
                type: String,
            },
            iv: {
                type: String,
            },
            createdAt: {
                type: Date,
                default: Date.now
            },
            updatedAt: {
                type: Date,
                default: Date.now
            }
        }
    ]
});


// HASHING THE PASSWORD
schema.pre('save', async function (next)
{
    if (this.isModified("password"))
    {
        this.password = await bcrypt.hash(this.password, 12);
    }

    next();
})


// GENERATING AUTH TOKEN
schema.methods.generateAuthToken = async function ()
{
    const token = jwt.sign({ _id: this._id }, process.env.SECRET_KEY, { expiresIn: TOKEN_TTL });
    this.tokens = this.tokens.concat({ token: token }).slice(-MAX_SESSIONS);
    await this.save();
    return token;
}

// SAVING NEW PASSWORD
schema.methods.addNewPassword = async function (userPass, iv, platform, platEmail)
{
    try
    {
        const now = new Date();
        this.passwords = this.passwords.concat({
            password: userPass,
            platform: platform,
            platEmail: platEmail,
            iv: iv,
            createdAt: now,
            updatedAt: now
        });
        await this.save();
        return true;
    }
    catch (err)
    {
        console.log(err);
        return false;
    }
}

// Public view of the account: never send hashes or session tokens to a client.
schema.methods.toPublic = function ()
{
    return {
        _id: this._id,
        name: this.name,
        email: this.email,
        passwords: (this.passwords || []).map((entry) => ({
            _id: entry._id,
            platform: entry.platform,
            platEmail: entry.platEmail,
            // Ciphertext + iv are kept for older web builds that decrypt by value.
            password: entry.password,
            iv: entry.iv,
            createdAt: entry.createdAt,
            updatedAt: entry.updatedAt
        }))
    };
}

const User = mongoose.model("user-data", schema);
module.exports = User;
