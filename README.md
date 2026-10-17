# Pathwise

Pathwise turns a skill you want to learn into a practical roadmap, finds relevant YouTube lessons, and saves your paths and progress in this browser.

## Run locally

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. Each path request searches for YouTube videos across foundations, hands-on practice, and real-world workflows, then uses terms from foundational video titles and snippets to run a focused follow-up search. For physics and mechanics, the foundations search starts with velocity, speed, and frame of reference. Results are shown as embedded videos and lessons in the selected path. No YouTube API key is required; live results depend on the search provider and an internet connection.

The free plan supports one learning path and resource summaries. Pathwise Plus supports multiple paths and exercises for videos and articles. To enable real subscription checkout, copy `.env.example` to `.env`, then set `STRIPE_SECRET_KEY` and the monthly and annual recurring Price IDs from your Stripe account. Restart Vite after changing environment values. Never expose or commit the Stripe secret key.

Checkout and payment verification are implemented in the Vite server middleware for local development and preview. A production deployment needs equivalent authenticated server endpoints and durable entitlement storage. Learning data and the current Plus flag are stored in this browser's local storage; they are not synced across devices.
