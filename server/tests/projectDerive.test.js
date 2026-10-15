const test = require("node:test");
const expect = require("./expect");
const { deriveDetails, dnsProviderFromNs } = require("../utils/projectDerive");

test("databases, services used, custom domain and DNS provider come from what the project already has; secrets never copied", () => {
  const p = {
    liveUrl: "https://dealradar.ggnhome.com", envVars: [
      { name: "MONGO_URI", value: "mongodb+srv://user:SuperSecret@cluster0.ab12c.mongodb.net/app" },
      { name: "REDIS_URL", value: "rediss://default:tok@eu1-wise-fox.upstash.io:6379" },
      { name: "CLOUDINARY_URL", value: "cloudinary://1:2@x" }, { name: "GROQ_API_KEY", value: "g" }, { name: "PORT", value: "10000" }
    ]
  };
  const patch = deriveDetails(p, { nameservers: ["lara.ns.cloudflare.com", "rob.ns.cloudflare.com"] });
  expect(patch.databases.map((d) => [d.label, d.provider, d.notes])).toEqual([["MongoDB", "MongoDB Atlas", "host cluster0.ab12c.mongodb.net"], ["Redis", "Upstash", "host eu1-wise-fox.upstash.io"]]);
  expect(patch.customDomain).toBe("dealradar.ggnhome.com");
  expect(patch.dnsProvider).toBe("Cloudflare");
  expect(patch.extraFields[0].label).toBe("Services used (auto)");
  expect(/Groq/.test(patch.extraFields[0].value) && /Cloudinary/.test(patch.extraFields[0].value)).toBe(true);
  expect(JSON.stringify(patch).includes("SuperSecret")).toBe(false);
  expect(JSON.stringify(patch).includes("tok@")).toBe(false);
});

test("nothing you typed is overwritten, and an up-to-date project gives no patch", () => {
  const p = { liveUrl: "https://x.onrender.com", customDomain: "mine.com", dnsProvider: "Manual DNS",
    envVars: [{ name: "MONGO_URI", value: "mongodb+srv://u:p@c.mongodb.net/a" }], databases: [{ label: "Main DB", notes: "on c.mongodb.net" }],
    extraFields: [{ label: "Services used (auto)", value: "MongoDB" }] };
  expect(deriveDetails(p, { nameservers: ["a.ns.cloudflare.com"] })).toBe(null);
  expect(dnsProviderFromNs(["ns-1.awsdns-01.org"])).toBe("AWS Route 53");
});
