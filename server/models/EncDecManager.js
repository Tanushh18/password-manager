const crypto = require("crypto");

const encrypt = (userPass) => {
    const iv = crypto.randomBytes(16); // IV should be 16 bytes
    const key = crypto.createHash('sha256').update(process.env.CRYPTO_SECRET_KEY).digest();

    const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
    let encrypted = cipher.update(userPass, 'utf8', 'base64');
    encrypted += cipher.final('base64');

    return {
        iv: iv.toString('hex'), // return hex so we can convert back later
        encryptedPassword: encrypted
    };
};

const decrypt = (encrypted, ivHex) => {
    const iv = Buffer.from(ivHex, 'hex');
    const key = crypto.createHash('sha256').update(process.env.CRYPTO_SECRET_KEY).digest();

    const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
    let decrypted = decipher.update(encrypted, 'base64', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
};

module.exports = { encrypt, decrypt };