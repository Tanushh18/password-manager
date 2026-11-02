# Money: UPI and bank spending in a Google Sheet

Stashr reads your Federal Bank messages (Android app), sorts every payment into a category (Meta Ads, Food, Groceries…), writes it
**only into your own Google Sheet** and shows it month by month on the website (Money) and in the Android app (Settings → Money).
**No transaction is stored in Stashr's database.** The database keeps only: the sheet link, the start date, your own category rules, your
account's last digits, and when the last message was handled.

## One-time setup (about 10 minutes)
1. **Google Cloud** (console.cloud.google.com): make a project (or use one), *APIs & Services → Library → Google Sheets API → Enable*.
2. *IAM & Admin → Service Accounts → Create*. Name it e.g. `stashr-money`. Open it → *Keys → Add key → JSON* → a file downloads.
3. Put that JSON on **both Render servers** (g305 and xxdr) as the environment variable `GOOGLE_SHEETS_SA_JSON` (paste the JSON, or its
   base64: `base64 -w0 key.json`). Redeploy. Never put this file in git.
4. Make a new Google Sheet. **Share** it with the service account's e-mail (`…@….iam.gserviceaccount.com`) as **Editor**.
5. Stashr website → **Money** (or app → Settings → Money): paste the sheet link, Save. Stashr creates the tabs `Transactions`, `Archive` and
   `Summary` (a ready month × category table built with formulas).
6. Choose **how far back to read your SMS — once**. After that the option disappears; new messages are read from then on.
7. Android app: Money → allow SMS access. On a sideloaded app Android 13+ may first need *Settings → Apps → Stashr → ⋮ → Allow restricted
   settings*, then allow SMS. Tap *Sync now*. From then on the app syncs in the background (about every 15–30 minutes, and whenever you open it).

## What goes in the sheet
Date, Time, Amount, Type (Debit/Credit), Merchant, **Category**, Account (X9229), Method (UPI/ATM/…), **Reference**, Balance, Source (SMS or
Statement), **Status**, Note, Month, SMS received, Flags. The `Summary` tab shows spending per month and category.

## Categories
Built in: Meta Ads, Food, Groceries, Travel, Shopping, Bills & Recharge, Subscriptions, Health, Education, Rent & Home, Investments,
Transfers, Cash, Salary & Income, Other, Uncategorized. "Meta Verifie" (how Federal Bank shortens Meta's name) is Meta Ads. Change a category
once (website or app) with *Remember for this merchant* and every later payment to it is sorted the same way, and the old ones too.

## No fake entries: flagging
Each message is checked. A doubtful one is written as **Flagged**, kept out of the totals, and shown under *Needs checking* with the reasons:
it came from a phone number instead of the bank's sender name; no date or no 12-digit UPI reference; an account that is not yours; a future
date; the arrival time disagrees with the date in the text; an amount over the UPI limit; or the **balance does not follow the previous
transaction** (a message may be missing). You can mark it *genuine* or *delete* it, or let the next statement decide.

## Check with your bank statement (any time, e.g. month end)
Download the statement from Federal net banking as **Excel or CSV** (PDF is not read) and upload it on Money. Every line is matched by
reference (else amount and day): **Verified**, **Mismatch** (amount differs), lines the sheet missed are **added** (Source: Statement), sheet rows inside
the statement's dates that the bank does not show are **Not in statement**, and the statement's own running balance is checked for breaks.
A flagged row that the statement confirms becomes Verified.

## Keeping 4 months
Each entry stays in the active `Transactions` tab for 4 months (120 days). Older rows are **moved, not deleted,** to the `Archive` tab once
a day, so the list stays quick and nothing is lost. Messages older than 4 months read during the first sync go straight to `Archive`.

## Limits
- Only Federal Bank message formats are known (debit and credit via UPI, plus common IMPS/NEFT/ATM wording). A message the parser can't read
  is counted as "not understood" with its first words shown — send an example and the parser gets extended.
- The bank shortens names ("Meta Verifie"); person-to-person payments stay *Uncategorized* until you give them a category.
- SMS reading works only on Android, and only while you allow it. Nothing is read before the start date.
- Reading the sheet takes a moment; the list is cached for under a minute.
