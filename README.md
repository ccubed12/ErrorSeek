# Pathwise

Pathwise turns a skill you want to learn into a practical roadmap, finds relevant YouTube lessons, and saves your progress and reward goals in this browser.

## Run locally

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. Each path request searches for YouTube videos across foundations, hands-on practice, and real-world workflows, then uses terms from foundational video titles and snippets to run a focused follow-up search. For physics and mechanics, the foundations search starts with velocity, speed, and frame of reference. Results are labeled S1, S2, S3, and shown as embedded videos and lessons in the path. No account or API key is required; live results depend on the search provider and an internet connection.

Progress is stored in this browser's local storage, so it survives reloads and signing out on this device. It is not account-synced across devices. The membership checkout is a preview; connect Stripe on a backend before accepting payments.
