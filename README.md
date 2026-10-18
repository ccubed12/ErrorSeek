# Pathwise

Pathwise turns a skill you want to learn into a practical roadmap, finds relevant YouTube lessons, and saves your paths and progress. Without an account, progress is kept in the current browser. Connect Supabase to let people create accounts and sync their learning across devices.

## Run locally

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. Each path request searches for YouTube videos across foundations, hands-on practice, and real-world workflows, then uses terms from foundational video titles and snippets to run a focused follow-up search. For physics and mechanics, the foundations search starts with velocity, speed, and frame of reference. Results are shown as embedded videos and lessons in the selected path. No YouTube API key is required; live results depend on the search provider and an internet connection. If the published host does not provide the development search endpoint, people can still create starter paths and open lesson searches on YouTube.

## Enable accounts and cross-device sync

1. Create a project at [Supabase](https://supabase.com/) and open its SQL Editor.
2. Run [`supabase/schema.sql`](./supabase/schema.sql). The table uses row-level security so each signed-in user can access only their own learning state.
3. Copy `.env.example` to `.env`. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` to the project URL and publishable/anon key from Supabase's project API settings. These are public client settings; never put a Supabase service-role key in the website.
4. Enable email/password sign-in in the Supabase Authentication settings. Set the site's allowed URL to your local or published site URL so confirmation emails return to the right place.
5. Restart Vite after changing environment values. Existing browser progress is copied to the account when a new account is created; signing into an existing account loads that account's saved progress.

## Publish

The website is free to publish on GitHub Pages, and does not require Cloudflare to work. It creates and saves learning paths in the browser, and lesson circles link to YouTube searches when automatic search is not configured. The repository owner must first open **Settings → Pages** and choose **GitHub Actions** under **Build and deployment → Source**. The workflow cannot enable Pages itself. Once Pages is enabled, push to `main` (or run **Deploy to GitHub Pages** from **Actions**) to publish at <https://ccubed12.github.io/ErrorSeek/>.

Automatic video discovery is an optional, separately hosted free-tier service. To enable it:

1. Create a free [Cloudflare](https://dash.cloudflare.com/sign-up) account and create an API token with **Workers Scripts: Edit** permissions for the account.
2. In this GitHub repository, add the Actions secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` under **Settings → Secrets and variables → Actions → Secrets**. The account ID is shown on the Cloudflare dashboard.
3. Run **Deploy video search API** from the repository's **Actions** tab. The deployment log shows the `errorseek-api` URL, in the form `https://errorseek-api.<your-account-subdomain>.workers.dev`.
4. Add an Actions **variable** named `VITE_API_BASE_URL` with that complete Worker URL (no trailing slash) and run **Deploy to GitHub Pages** again.

The API searches YouTube directly and does not need a YouTube API key. Its allowed website origin is set in [`wrangler.toml`](./wrangler.toml).

To enable account sync, install [`supabase/schema.sql`](./supabase/schema.sql) in a Supabase project and add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as Actions variables. Without those settings, progress is saved in the current browser. Subscription checkout still needs separately deployed secure Stripe endpoints; it is not required for free video discovery, learning paths, or local progress.

For a local production-style build, run `npm run build` and publish `dist/` on a static host. The free plan supports one learning path and resource summaries. Pathwise Plus supports multiple paths and exercises for videos and articles. To enable real subscription checkout locally, set `STRIPE_SECRET_KEY` and the monthly and annual recurring Price IDs from your Stripe account. Never expose or commit the Stripe secret key. Checkout and payment verification currently run in Vite's development/preview server middleware; production checkout requires secure server endpoints and durable entitlement verification.
