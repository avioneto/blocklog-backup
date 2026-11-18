# Blocklog weekly backup

Every Sunday (06:00 UTC) GitHub Actions runs `weekly.mjs`, which signs in to your Blocklog account, builds
- the EASA PDF logbook (all flights, no signature),
- the flights CSV,
- the JSON backup (restorable in the app: Data & Settings > Backup > Restore; it does not hold document files or the signature),

and emails the three files to you through Resend. The app code is downloaded from your own site (APP_URL), so the PDF always matches the app.

## Secrets (GitHub repo > Settings > Secrets and variables > Actions > New repository secret)
| Name | Value |
|---|---|
| APP_URL | your Cloudflare Pages address, e.g. https://xxxx.pages.dev (no trailing slash) |
| BLOCKLOG_EMAIL | the email you use to sign in to Blocklog |
| BLOCKLOG_PASSWORD | your Blocklog password |
| RESEND_API_KEY | the API key from resend.com |
| PILOT_NAME | name for the PDF cover (optional) |
| MAIL_TO | where to send the backup (optional; must be the email of your Resend account) |

Keep the repository **private**. Run it by hand from the Actions tab > "Blocklog weekly backup" > Run workflow.

## Anti-pause
Separately, the Supabase database has a scheduled job (every 2 days) that calls its own API, so the free project is not paused for inactivity.
