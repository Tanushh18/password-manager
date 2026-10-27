const { describe, test } = require("node:test");
const expect = require("./expect");
const { swapServerUrl } = require("../utils/serverUrlsSync");

describe("swapServerUrl", () => {
  test("moves the URL to the new host, keeping its path and on/off switch", () => {
    const rows = [{ url: "https://old.onrender.com/api", enabled: false }, { url: "https://other.onrender.com/api", enabled: true }];
    const { list, changed } = swapServerUrl(rows, "https://old.onrender.com", "https://new.onrender.com");
    expect(changed).toBe(true);
    expect(list).toEqual([{ url: "https://new.onrender.com/api", enabled: false }, { url: "https://other.onrender.com/api", enabled: true }]);
  });

  test("changes nothing when the host is the same or not listed", () => {
    const rows = [{ url: "https://a.onrender.com/api", enabled: true }];
    expect(swapServerUrl(rows, "https://a.onrender.com", "https://a.onrender.com").changed).toBe(false);
    expect(swapServerUrl(rows, "https://zzz.onrender.com", "https://new.onrender.com").changed).toBe(false);
  });

  test("drops a duplicate that the move creates", () => {
    const rows = [{ url: "https://old.onrender.com/api", enabled: true }, { url: "https://new.onrender.com/api", enabled: true }];
    expect(swapServerUrl(rows, "https://old.onrender.com", "https://new.onrender.com").list.length).toBe(1);
  });
});
