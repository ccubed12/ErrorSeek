# Pathwise link hub

A small, static website collecting useful links for learning, building skills, and finding inspiration. No accounts, API keys, or other setup are required.

## Run locally

```sh
npm install
npm run dev
```

Open the local URL printed by Vite.

## Change the links

Edit the `groups` list near the top of [`src/link-hub.js`](./src/link-hub.js). Each group has a title, short description, and list of links with a name, URL, and detail. Save the file to see the changes locally.

## Publish

The repository includes a GitHub Pages workflow. In the repository's **Settings → Pages**, choose **GitHub Actions** as the deployment source, then push to `main` (or run **Deploy to GitHub Pages** from **Actions**).
