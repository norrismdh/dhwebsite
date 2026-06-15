# Deployment

## How it works

The site is a static HTML site hosted on **Vercel**. Every push to the `main` branch on GitHub triggers an automatic deployment. No build step — Vercel serves the files directly from the repository root.

## Configuration

`vercel.json` at the project root controls:

- `cleanUrls: true` — `/About.html` is served as `/About`
- `trailingSlash: false` — `/About/` redirects to `/About`
- `/` redirects to `/Home`
- `/docs/` returns 404 (internal docs blocked from public access)
- `/downloads/:fileId` rewrites to the download API
- Security headers applied to all routes

## Pre-launch

`robots.txt` currently has `Disallow: /` blocking all crawlers. Before launch, swap the comment blocks in `robots.txt` to enable indexing with the planned selective blocks (`/nda`, `/dhadmin/`, `/api/`, `/thank-you`).

## Domains

Managed in the Vercel dashboard. The production domain is `digitalhive.com`.

## Environment variables

Set in the Vercel dashboard (not in the repo). Used by the API routes in `/api/`:

- `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN` — NDA / Zoho Sign integration
- `ZOHO_TEMPLATE_ID`, `ZOHO_ORG_ID` — NDA template reference
- `DOWNLOAD_SECRET` — signed URL key for gated downloads
