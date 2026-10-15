import pkg from "../../package.json";

/** Stashr release shown in the navbar. Bump package.json (client and server) together. */
export const APP_VERSION = pkg.version;
export const APP_MAJOR_MINOR = APP_VERSION.split(".").slice(0, 2).join(".");

export const WHATS_NEW = [
  ["Everything stays in sync on its own", "Projects, Render and Services re-read GitHub and every connected Render account in the background. Add or delete something and it shows up here without pressing anything."],
  ["One app, many servers", "Render services built from the same GitHub repo are grouped into a single app with a dropdown for every server, across all your Render accounts."],
  ["Every GitHub repo is a project", "Connect a GitHub token and all the repos it can see appear as projects, new repos included. Projects you add yourself are never touched."],
  ["No stale leftovers", "Links to deleted Render services drop off; projects Stashr created are archived when their repo disappears, and return if it does."],
  ["Env vars to every deployment", "Push a variable once and it goes to every server of that app, then redeploy them all in one step."],
  ["A cleaner, organised layout", "A status bar for sync, summary tiles, status and source filters, and a card layout that shows the servers behind each project."]
];
