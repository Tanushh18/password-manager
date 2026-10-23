const { test } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

const originalLoad = Module._load;
const UserStub = {
  publicEntry: (entry) => ({ ...(entry.fields || {}), _id: entry._id }),
  sealEntry: (_key, fields) => fields
};
const linkedServicesStub = (projects) => {
  const out = [];
  const add = (accountId, serviceId, name, extra = {}) => {
    if (!accountId || !serviceId || out.some((item) => item.serviceId === String(serviceId))) return;
    out.push({ accountId: String(accountId), serviceId: String(serviceId), name: String(name || ""), ...extra });
  };
  for (const project of projects || []) {
    for (const service of project.renderServices || []) {
      add(service.accountId, service.serviceId, service.name, service);
    }
    add(project.renderAccountId, project.renderServiceId, project.renderServiceName);
  }
  return out;
};

Module._load = function (request) {
  if (request.endsWith("/models/schema")) return UserStub;
  if (request === "./hosts") return { PROVIDERS: {} };
  if (request === "./renderOps") return { renderRequest: async () => { throw new Error("Render must not be called for a reference-only switch"); } };
  if (request === "./renderPaging") return { fetchAllPages: async () => ({ items: [], truncated: false }) };
  if (request === "./renderGuards") return { mapWithConcurrency: async (items, _limit, fn) => Promise.all(items.map(fn)) };
  if (request === "./projectMerge") return { linkedServices: linkedServicesStub };
  if (request === "./serviceEnvSync") return { planEnvSync: () => ({}), pendingNames: () => [], NAME: /^[A-Za-z_][A-Za-z0-9_]*$/ };
  if (request === "./projectServiceSync") return {
    projectsSharingRepo: () => [],
    moveServiceAccount: async () => { throw new Error("Unsafe legacy service-account reassignment was called"); }
  };
  return originalLoad.apply(this, arguments);
};

const { moveAccount } = require("../utils/deployOps");
Module._load = originalLoad;

const objectId = (n) => String(n).padStart(24, "0");

test("Render account change is rejected unless a real migration wizard is used", async () => {
  const sourceAccountId = objectId(2);
  const destinationAccountId = objectId(3);
  const projectId = objectId(1);
  const user = {
    _id: objectId(9),
    renderAccounts: [
      { _id: sourceAccountId, enc: "udk", fields: { name: "Source Render", apiKey: "source-token" } },
      { _id: destinationAccountId, enc: "udk", fields: { name: "Destination Render", apiKey: "target-token" } }
    ],
    hostAccounts: [],
    projects: [{
      _id: projectId,
      enc: "udk",
      fields: {
        renderAccountId: sourceAccountId,
        renderServiceId: "srv-original",
        renderServiceName: "original-api",
        renderServices: [{ accountId: sourceAccountId, serviceId: "srv-original", name: "original-api" }]
      }
    }],
    getDataKey: async () => "test-data-key"
  };

  await assert.rejects(
    moveAccount(user, projectId, "render:srv-original", destinationAccountId),
    (error) => error.status === 409 && /Move to account migration wizard/.test(error.message)
  );
});
