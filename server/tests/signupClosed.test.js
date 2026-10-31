const { describe, test } = require("node:test");
const expect = require("./expect");

describe("sign-ups are closed by default", () =>
{
    test("signupOpen only when ALLOW_SIGNUP=true", () =>
    {
        const src = require("node:fs").readFileSync(require("node:path").join(__dirname, "../router/routing.js"), "utf8");
        expect(src).toContain('process.env.ALLOW_SIGNUP === "true"');
        expect(src).toContain("if (!signupOpen()) return res.status(403)");
    });
});
