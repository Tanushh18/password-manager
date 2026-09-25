/**
 * Small, dependency free password strength estimate (0-4), shared by the
 * /insights endpoint. Mirrors the meters shown in the web and Android apps.
 */

const COMMON = new Set([
    "password", "123456", "12345678", "123456789", "qwerty", "abc123", "111111",
    "iloveyou", "admin", "welcome", "letmein", "monkey", "dragon", "football",
    "password1", "1234567", "sunshine", "princess", "000000", "qwerty123"
]);

const estimate = (value) =>
{
    const pwd = String(value || "");
    if (!pwd) return { score: 0, label: "Empty" };
    if (COMMON.has(pwd.toLowerCase())) return { score: 0, label: "Very weak" };

    let pool = 0;
    if (/[a-z]/.test(pwd)) pool += 26;
    if (/[A-Z]/.test(pwd)) pool += 26;
    if (/[0-9]/.test(pwd)) pool += 10;
    if (/[^a-zA-Z0-9]/.test(pwd)) pool += 33;

    let bits = pwd.length * Math.log2(Math.max(pool, 1));
    // Penalise runs like "aaaa" and simple sequences like "abcd" / "1234"
    if (/(.)\1{2,}/.test(pwd)) bits -= 10;
    if (/(0123|1234|2345|3456|4567|5678|6789|abcd|bcde|cdef|qwer|asdf)/i.test(pwd)) bits -= 10;

    const score = bits < 28 ? 0 : bits < 40 ? 1 : bits < 60 ? 2 : bits < 80 ? 3 : 4;
    const label = ["Very weak", "Weak", "Fair", "Strong", "Excellent"][score];
    return { score, label, bits: Math.max(0, Math.round(bits)) };
};

module.exports = { estimate };
