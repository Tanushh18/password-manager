import test from "node:test";
import assert from "node:assert/strict";
import { errorMessage } from "../src/lib/errors.js";

const http = (status, data) => ({ response: { status, data } });

test("the server's own message always wins", () => {
  assert.equal(errorMessage(http(400, { error: "Invalid Credentials." }), "fallback"), "Invalid Credentials.");
  assert.equal(errorMessage(http(500, { error: "Please fill the data." })), "Please fill the data.");
});

test("no response: a timeout says the server may be waking up, anything else says it cannot be reached", () => {
  assert.match(errorMessage({ code: "ECONNABORTED", message: "timeout of 20000ms exceeded" }), /took too long.*waking up/);
  assert.match(errorMessage({ message: "Network Error" }), /can't reach the server/);
});

test("status codes without a message are explained, never relabelled as a wrong password", () => {
  assert.match(errorMessage(http(429, "<html>")), /Too many attempts/);
  assert.match(errorMessage(http(502, "<html>"), "That email and password don't match."), /server ran into a problem \(HTTP 502\)/);
  assert.match(errorMessage(http(404, "")), /HTTP 404/);
  assert.equal(errorMessage(http(400, ""), "That email and password don't match."), "That email and password don't match.");
});
