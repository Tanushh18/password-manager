import test from "node:test";
import assert from "node:assert/strict";
import { pwnedCount } from "../src/lib/breach.js";
import { computeHealth } from "../src/lib/health.js";
import { parseCSV, rowsToItems, toCSV, domainOf } from "../src/lib/items.js";
import { parseEnvBlock, rowsToProjects } from "../src/lib/projectItems.js";

test("pwnedCount sends only a 5-char prefix and parses padded responses", async () => {
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, opts });
    // SHA-1("password123") = CBFDAC6008F9CAB4083784CBD1874F76618D2A97
    return { ok: true, text: async () => "0018A45C4D1DEF81644B54AB7F969B88D65:1\r\nC6008F9CAB4083784CBD1874F76618D2A97:251682\r\nFFFF0000000000000000000000000000000:0\r\n" };
  };
  assert.equal(await pwnedCount("password123"), 251682);
  assert.equal(calls[0].url, "https://api.pwnedpasswords.com/range/CBFDA");
  assert.equal(calls[0].opts.headers["Add-Padding"], "true");
  assert.equal(await pwnedCount("password123"), 251682); // cached
  assert.equal(calls.length, 1);
  assert.equal(await pwnedCount("a-unique-password-not-listed"), 0);
});

test("health flags weak, reused, breached and old", () => {
  const old = new Date(Date.now() - 200 * 864e5).toISOString();
  const h = computeHealth(
    [
      { id: "a", password: "password123" },
      { id: "b", password: "password123" },
      { id: "c", password: "x9$Kq!2mZr#8Lp@4wQ", passwordUpdatedAt: old },
      { id: "d", password: "" },
    ],
    { a: 5 }
  );
  assert.equal(h.total, 3);
  assert.equal(h.reused, 2);
  assert.equal(h.breached, 1);
  assert.equal(h.old, 1);
  assert.equal(h.info.c.score, 4);
  assert.ok(h.score < 60);
});

test("CSV round trip and importer column mapping", () => {
  const items = [{ name: 'Acme "Co"', url: "https://www.acme.com/login", username: "me", password: "p,1\n2", totp: "", notes: "", folder: "Work", favorite: true }];
  const back = rowsToItems(parseCSV(toCSV(items)));
  assert.equal(back[0].name, 'Acme "Co"');
  assert.equal(back[0].password, "p,1\n2");
  assert.equal(back[0].favorite, true);
  // Chrome export
  const chrome = rowsToItems(parseCSV("name,url,username,password\nGitHub,https://github.com/,octo,secret\n"));
  assert.deepEqual([chrome[0].name, chrome[0].username, chrome[0].password], ["GitHub", "octo", "secret"]);
  // Bitwarden export
  const bw = rowsToItems(parseCSV("folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp\nWork,1,login,Jira,,,,https://jira.io,me,pw,JBSWY3DPEHPK3PXP\n"));
  assert.deepEqual([bw[0].folder, bw[0].favorite, bw[0].url, bw[0].totp], ["Work", true, "https://jira.io", "JBSWY3DPEHPK3PXP"]);
  // Old Aurelia sheet
  const legacy = rowsToItems([{ platform: "Bank", email: "a@b.c", password: "x" }]);
  assert.deepEqual([legacy[0].name, legacy[0].username], ["Bank", "a@b.c"]);
  assert.equal(domainOf("https://www.github.com/x"), "github.com");
});

test("parseEnvBlock reads a Render-style paste, including quoted and multi-line values", () => {
  const pasted = [
    "PORT=4000",
    'EMAIL_PASS="app pass with spaces"',
    "MONGO_URI=mongodb+srv://user:pass@cluster.mongodb.net/db",
    "# a comment line should be ignored",
    "",
    "FIREBASE_ADMIN_CREDENTIALS='{",
    '  "type": "service_account",',
    '  "project_id": "demo-project"',
    "}'",
    "NEXT_KEY=still-works-after-a-block",
  ].join("\n");

  const rows = parseEnvBlock(pasted);
  const byName = Object.fromEntries(rows.map((r) => [r.name, r.value]));

  assert.equal(rows.length, 5);
  assert.equal(byName.PORT, "4000");
  assert.equal(byName.EMAIL_PASS, "app pass with spaces");
  assert.equal(byName.MONGO_URI, "mongodb+srv://user:pass@cluster.mongodb.net/db");
  assert.equal(byName.NEXT_KEY, "still-works-after-a-block");
  assert.ok(byName.FIREBASE_ADMIN_CREDENTIALS.includes('"project_id": "demo-project"'));
  assert.equal(byName.FIREBASE_ADMIN_CREDENTIALS.split("\n").length, 4);
});

test("parseEnvBlock ignores blank input and non KEY=VALUE lines", () => {
  assert.deepEqual(parseEnvBlock(""), []);
  assert.deepEqual(parseEnvBlock("   \n # just a comment\n"), []);
  assert.deepEqual(parseEnvBlock("not a valid line"), []);
});

test("rowsToProjects maps the Excel template and attaches matching databases", () => {
  const projectRows = [
    { name: "WeCode", description: "Coding platform", status: "deployed", priority: "high", hosting_provider: "Render", hosting_account_email: "host@example.com" },
    { name: "", description: "example row with no name should be skipped" },
  ];
  const databaseRows = [
    { project_name: "WeCode", label: "main", provider: "MongoDB Atlas", type: "Mongo", account_email: "a@b.com", notes: "cluster0" },
    { project_name: "Someone Else", label: "orphan", provider: "Postgres", type: "sql" },
  ];

  const projects = rowsToProjects(projectRows, databaseRows);
  assert.equal(projects.length, 1);
  assert.equal(projects[0].name, "WeCode");
  assert.equal(projects[0].status, "deployed");
  assert.equal(projects[0].hostingProvider, "Render");
  assert.equal(projects[0].databases.length, 1);
  assert.equal(projects[0].databases[0].provider, "MongoDB Atlas");
  assert.deepEqual(projects[0].envVars, []);
});
