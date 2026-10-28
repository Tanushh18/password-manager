const { describe, test } = require("node:test");
const expect = require("./expect");
const { findExposedSecrets, mask } = require("../utils/secretExposure");

// Fake values only: nothing here is a real credential.
const FAKE_KEY = "fakefake1234567890abcdefghijklmnopqrstuv";

describe("findExposedSecrets", () =>
{
    test("a secret-named variable with a browser prefix is flagged high", () =>
    {
        const f = findExposedSecrets([{ key: "REACT_APP_RAPID_API_KEY", value: FAKE_KEY }]);
        expect(f).toHaveLength(1);
        expect(f[0].severity).toBe("high");
        expect(f[0].preview.startsWith("fake")).toBe(true);
        expect(f[0].preview.includes(FAKE_KEY)).toBe(false);
    });

    test("a plain config value with a browser prefix is not flagged", () =>
    {
        expect(findExposedSecrets([{ key: "REACT_APP_LOGIN_URI", value: "https://example.onrender.com/login" }])).toEqual([]);
    });

    test("Firebase web config is public by design and not flagged", () =>
    {
        expect(findExposedSecrets([{ key: "REACT_APP_FIREBASE_API_KEY", value: "AIzaFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE" }])).toEqual([]);
    });

    test("a live-looking key is flagged even on a server-only name", () =>
    {
        const f = findExposedSecrets([{ key: "SOME_SETTING", value: "sk_live_fake1234567890abcdef" }]);
        expect(f).toHaveLength(1);
        expect(f[0].severity).toBe("high");
    });

    test("a server-only secret with a normal value is not flagged", () =>
    {
        expect(findExposedSecrets([{ key: "JWT_SECRET", value: "abc" }])).toEqual([]);
    });

    test("empty values are ignored", () =>
    {
        expect(findExposedSecrets([{ key: "REACT_APP_API_KEY", value: "" }])).toEqual([]);
    });

    test("a masked preview never shows the whole value", () =>
    {
        expect(mask("abcdefghijkl")).toBe("abcd••••kl");
        expect(mask("short")).toBe("••••");
    });
});
