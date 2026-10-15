const test = require("node:test");
const expect = require("./expect");
const { replaceHost } = require("../utils/urlRefs");

test("only the old host is rewritten; paths, other hosts and unrelated text are kept", () => {
  const from = "https://dealradar-0oza.onrender.com", to = "https://api.dealradar.com";
  expect(replaceHost("https://dealradar-0oza.onrender.com/api", from, to)).toBe("https://api.dealradar.com/api");
  expect(replaceHost("http://dealradar-0oza.onrender.com:443/x,https://other.onrender.com", from, to)).toBe("https://api.dealradar.com/x,https://other.onrender.com");
  expect(replaceHost("dealradar-0oza.onrender.com", from, to)).toBe("api.dealradar.com");
  expect(replaceHost("https://notdealradar-0oza.onrender.com.evil.com", from, to)).toBe("https://notdealradar-0oza.onrender.com.evil.com");
  expect(replaceHost("https://dealradar-0oza.onrender.com.evil.com/a", from, to)).toBe("https://dealradar-0oza.onrender.com.evil.com/a");
  expect(replaceHost("nothing here", from, to)).toBe("nothing here");
  expect(replaceHost("https://dealradar-0oza.onrender.com", from, "http://insecure.com")).toBe("https://dealradar-0oza.onrender.com");
});
