// Tiny Jest-style expect() on top of node:assert, so the suite runs on `node --test`.
const assert = require("node:assert/strict");

const matchers = (actual, negate = false) =>
{
    const check = (ok, message) => assert.ok(negate ? !ok : ok, message);
    return {
        toBe: (v) => (negate ? assert.notStrictEqual(actual, v) : assert.strictEqual(actual, v)),
        toEqual: (v) => (negate ? assert.notDeepStrictEqual(actual, v) : assert.deepStrictEqual(actual, v)),
        toBeTruthy: () => check(Boolean(actual), `expected ${actual} to be truthy`),
        toBeUndefined: () => check(actual === undefined, `expected ${JSON.stringify(actual)} to be undefined`),
        toBeNull: () => check(actual === null, `expected ${JSON.stringify(actual)} to be null`),
        toHaveLength: (n) => check(actual && actual.length === n, `expected length ${n}, got ${actual && actual.length}`),
        toMatch: (re) => check(re.test(String(actual)), `expected ${actual} to match ${re}`),
        toContain: (s) => check(String(actual).includes(s), `expected to contain ${s}`),
        // every key of `v` must match (recursively for plain objects); extra keys in `actual` are fine
        toMatchObject: (v) => {
            const subset = (a, b) => b && typeof b === "object" && !Array.isArray(b) ? a && typeof a === "object" && Object.keys(b).every((k) => subset(a[k], b[k])) : JSON.stringify(a) === JSON.stringify(b);
            check(subset(actual, v), `expected ${JSON.stringify(actual)} to match ${JSON.stringify(v)}`);
        },
        toThrow: () => check((() => { try { actual(); return false; } catch (e) { return true; } })(), "expected to throw")
    };
};

module.exports = (actual) => Object.assign(matchers(actual), { not: matchers(actual, true) });
