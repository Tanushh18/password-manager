const { describe, test, beforeEach, afterEach } = require("node:test");
const jwt = require("jsonwebtoken");
const expect = require("./expect");
const User = require("../models/schema");
const authenticate = require("../middlewares/authenticate");

process.env.SECRET_KEY = process.env.SECRET_KEY || "test-secret";
const call = async (req) => {
    const out = { headers: {} };
    const res = { set: (k, v) => { out.headers[k] = v; }, status: (code) => { out.status = code; return { json: (body) => { out.body = body; } }; } };
    let nextCalled = false;
    await authenticate(req, res, () => { nextCalled = true; });
    return { ...out, nextCalled };
};
let realFind;
beforeEach(() => { realFind = User.findOne; });
afterEach(() => { User.findOne = realFind; });

describe("authenticate: only a bad token is 'signed out'", () => {
    test("no token, a malformed token and an expired token are 401", async () => {
        expect((await call({ headers: {}, cookies: {} })).status).toBe(401);
        expect((await call({ headers: { authorization: "Bearer not.a.jwt" }, cookies: {} })).status).toBe(401);
        const expired = jwt.sign({ _id: "u1" }, process.env.SECRET_KEY, { expiresIn: -10 });
        expect((await call({ headers: {}, cookies: { jwtoken: expired } })).status).toBe(401);
    });

    test("a valid token whose session was revoked is 401", async () => {
        User.findOne = async () => null;
        const token = jwt.sign({ _id: "u1" }, process.env.SECRET_KEY);
        const r = await call({ headers: {}, cookies: { jwtoken: token } });
        expect(r.status).toBe(401);
        expect(r.nextCalled).toBe(false);
    });

    test("a database failure is a retryable 503, never a sign-out", async () => {
        User.findOne = async () => { throw new Error("MongoNetworkError: connection timed out"); };
        const token = jwt.sign({ _id: "u1" }, process.env.SECRET_KEY);
        const r = await call({ headers: {}, cookies: { jwtoken: token } });
        expect(r.status).toBe(503);
        expect(r.headers["Retry-After"]).toBe("5");
        expect(r.body.error).toMatch(/session is fine/);
        expect(r.nextCalled).toBe(false);
    });

    test("a valid, live session passes through", async () => {
        const user = { _id: "u1" };
        User.findOne = async () => user;
        const token = jwt.sign({ _id: "u1" }, process.env.SECRET_KEY);
        const req = { headers: {}, cookies: { jwtoken: token } };
        const r = await call(req);
        expect(r.nextCalled).toBe(true);
        expect(req.rootUser).toBe(user);
    });
});
