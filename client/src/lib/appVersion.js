import pkg from "../../package.json";

/** Stashr release shown in the navbar. Bump package.json (client and server) together. */
export const APP_VERSION = pkg.version;
export const APP_MAJOR_MINOR = APP_VERSION.split(".").slice(0, 2).join(".");

export const WHATS_NEW = [
  ["Stashr departures board", "The Overview opens with a split-flap airport board that flips into your live status: vault, security score, breach check, favourites and projects. Tap a row to go straight there."],
  ["A new home: Overview", "Your vault health, what needs fixing, recent and favourite logins and your projects on one page, under the same jungle-and-runway horizon as the vault."],
  ["Sidebar navigation", "Every part of Stashr is grouped in a sidebar (Vault, Workspace, Infrastructure). Collapse it to icons, or use the bottom bar and the More sheet on your phone."],
  ["Search anything", "Press Ctrl+K (or ⌘K), or the search button, to jump to a login, project, page or action such as adding a password or importing."],
  ["Clearer confirmations", "Deleting, unlinking, deploying or pushing variables now asks in a Stashr dialog that lists exactly what will change, instead of a browser pop-up."],
  ["A richer world", "The vault horizon now has a plane on approach, a control tower and runway lights, waterfall mist and a robot on watch. The jungle has a river with lily pads and jumping fish. Switch scenery and effects in Settings → Appearance."],
  ["Extension refresh", "The Chrome extension matches Stashr, works in dark mode and can search your accounts."],
];
