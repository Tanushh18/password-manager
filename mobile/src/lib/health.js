import { estimate } from "./strength";

const OLD_MS = 180 * 24 * 60 * 60 * 1000;

/**
 * Vault health computed on the device from decrypted items.
 * breaches: { [itemId]: count } from the Have I Been Pwned check.
 */
export function computeHealth(items, breaches = {}) {
  const byPassword = new Map();
  const info = {};
  const now = Date.now();

  items.forEach((item) => {
    if (!item.password) return;
    const s = estimate(item.password);
    const changed = item.passwordUpdatedAt || item.updatedAt || item.createdAt;
    info[item.id] = {
      score: s.score,
      label: s.label,
      bits: s.bits,
      reused: false,
      old: changed ? now - new Date(changed).getTime() > OLD_MS : false,
      breached: breaches[item.id] || 0,
    };
    if (!byPassword.has(item.password)) byPassword.set(item.password, []);
    byPassword.get(item.password).push(item.id);
  });

  byPassword.forEach((ids) => {
    if (ids.length > 1) ids.forEach((id) => (info[id].reused = true));
  });

  const list = Object.values(info);
  const total = list.length;
  const score =
    total === 0
      ? 100
      : Math.round(
          list.reduce((sum, i) => {
            let s = (i.score / 4) * 100;
            if (i.reused) s -= 40;
            if (i.old) s -= 10;
            if (i.breached) s -= 60;
            return sum + Math.max(0, s);
          }, 0) / total
        );

  return {
    score,
    total,
    weak: list.filter((i) => i.score <= 1).length,
    reused: list.filter((i) => i.reused).length,
    old: list.filter((i) => i.old).length,
    breached: list.filter((i) => i.breached).length,
    strong: list.filter((i) => i.score >= 3 && !i.reused && !i.breached).length,
    info,
  };
}
