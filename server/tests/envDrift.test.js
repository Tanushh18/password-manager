const { describe, test } = require("node:test");
const expect = require("./expect");
const { findStaleAddresses, hostOfUrl } = require("../utils/envDrift");

const live = [
    { url: "https://wecode-1.onrender.com", suspended: false },
    { url: "https://old-api.onrender.com", suspended: true }
];

describe("findStaleAddresses", () =>
{
    test("an env address that matches a live service is fine", () =>
    {
        expect(findStaleAddresses([{ key: "REACT_APP_LOGIN_URI", value: "https://wecode-1.onrender.com/login" }], live)).toEqual([]);
    });

    test("an address to a deleted Render service is flagged as missing (high)", () =>
    {
        const f = findStaleAddresses([{ key: "REACT_APP_API", value: "https://password-manager-server-8gvj.onrender.com/api" }], live);
        expect(f).toHaveLength(1);
        expect(f[0].status).toBe("missing");
        expect(f[0].severity).toBe("high");
    });

    test("an address to a suspended service is flagged as suspended (medium)", () =>
    {
        const f = findStaleAddresses([{ key: "API_URL", value: "https://old-api.onrender.com" }], live);
        expect(f[0].status).toBe("suspended");
        expect(f[0].severity).toBe("medium");
    });

    test("third-party hosts are never flagged", () =>
    {
        expect(findStaleAddresses([{ key: "JUDGE0_API", value: "https://judge0-ce.p.rapidapi.com" }], live)).toEqual([]);
    });

    test("non-URL values and plain http are ignored", () =>
    {
        expect(findStaleAddresses([{ key: "X", value: "not a url" }, { key: "Y", value: "http://a.onrender.com" }], live)).toEqual([]);
    });

    test("the finding carries the host, never the full value", () =>
    {
        const f = findStaleAddresses([{ key: "A", value: "https://gone.onrender.com/secret-path?token=abc" }], live);
        expect(f[0].host).toBe("gone.onrender.com");
        expect(JSON.stringify(f).includes("token=abc")).toBe(false);
    });

    test("hostOfUrl returns the lowercase host for https only", () =>
    {
        expect(hostOfUrl("https://WeCode-1.onrender.com/x")).toBe("wecode-1.onrender.com");
        expect(hostOfUrl("ftp://a.onrender.com")).toBe("");
    });
});
