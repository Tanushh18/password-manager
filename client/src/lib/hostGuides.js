/** How to get an API token for each hosting provider, shown next to the connect form. */
export const HOSTS = [
  {
    id: "vercel", label: "Vercel", best: "React, Vue, Svelte, Astro, Next.js and other front-end apps.",
    tokenUrl: "https://vercel.com/account/tokens", tokenHint: "Paste the token Vercel shows once.",
    steps: [
      "Open vercel.com/account/tokens and click Create Token.",
      "Name it (e.g. Stashr), choose the scope (your account or team) and an expiry, then Create.",
      "Copy the token right away, Vercel shows it once, and paste it here.",
      "Connect GitHub to Vercel once (Account Settings → Authentication → GitHub) and give it access to the repo you deploy."
    ],
    extra: { teamId: "Team ID (only for a team scope)" }
  },
  {
    id: "netlify", label: "Netlify", best: "Static sites and front-end apps.",
    tokenUrl: "https://app.netlify.com/user/applications#personal-access-tokens", tokenHint: "Personal access token.",
    steps: [
      "Open User settings → Applications → Personal access tokens and click New access token.",
      "Describe it (e.g. Stashr), pick an expiry and click Generate token.",
      "Copy the token and paste it here.",
      "Stashr adds a read-only deploy key to your repo through your GitHub token, so that GitHub token needs the repo scope and admin access to the repo."
    ]
  },
  {
    id: "railway", label: "Railway", best: "Node, Python, Go and other servers, with databases.",
    tokenUrl: "https://railway.com/account/tokens", tokenHint: "Account token (not a project token).",
    steps: [
      "Open railway.com/account/tokens and click Create Token.",
      "Name it (e.g. Stashr). Leave the workspace on “No workspace” for an account token that can create projects.",
      "Copy the token and paste it here.",
      "Install the Railway GitHub app on the repo (Account Settings → Integrations → GitHub)."
    ]
  },
  {
    id: "cloudflare", label: "Cloudflare Pages", best: "Static and front-end sites on Cloudflare's network.",
    tokenUrl: "https://dash.cloudflare.com/profile/api-tokens", tokenHint: "API token with Cloudflare Pages: Edit.",
    steps: [
      "Open dash.cloudflare.com → My Profile → API Tokens and click Create Token → Create Custom Token.",
      "Add the permission Account · Cloudflare Pages · Edit. Under Account Resources choose your account.",
      "Create the token, copy it and paste it here. Stashr finds your account ID by itself.",
      "Authorize the Cloudflare Pages GitHub app for the repo once (Workers & Pages → Create → Connect to Git)."
    ]
  }
];
export const hostById = (id) => HOSTS.find((h) => h.id === id);
