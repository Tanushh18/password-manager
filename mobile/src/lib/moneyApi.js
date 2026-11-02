import { request, requestBytes } from "./api";

/* The Money calls (server/router/expenses.js). Transactions live only in the owner's Google Sheet; the server reads and writes it. */
const j = (path, method, body, timeout) => request(path, { method, body, timeout });

export const money = {
  settings: () => request("/expenses/settings"),
  saveSheet: (sheetUrl) => j("/expenses/sheet", "PUT", { sheetUrl }, 40000),
  start: (date) => j("/expenses/start", "POST", { date }),
  sms: (messages) => j("/expenses/sms", "POST", { messages }, 60000),
  list: (month) => request(`/expenses${month ? `?month=${encodeURIComponent(month)}` : ""}`, { timeout: 40000 }),
  setCategory: (index, category, remember) => j("/expenses/category", "PUT", { index, category, remember: Boolean(remember) }, 40000),
  review: (index, action) => j("/expenses/review", "PUT", { index, action }, 40000),
  statement: (filename, bytes) => requestBytes(`/expenses/statement?filename=${encodeURIComponent(filename)}`, bytes, { timeout: 120000 }),
};
