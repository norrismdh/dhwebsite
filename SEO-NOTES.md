# SEO Notes

Reference for how the site's crawl/index setup works and what to check after deploys.

## How the setup works

- **Homepage lives at `/`** — `index.html` is served at the root; canonical is `https://www.digitalhive.com/`. `/Home` and `/Home.html` 301 to `/`.
- **Clean URLs** — `cleanUrls: true` in [vercel.json](vercel.json) serves pages without `.html`. All internal links are extensionless and root-absolute (e.g. `/Product`), so crawlers never hop through a redirect.
- **Nav + footer are static, crawlable HTML** — baked into every page by [scripts/build-nav.mjs](scripts/build-nav.mjs) (the single source of truth). Edit the IA there, then run `npm run nav` to regenerate all pages and commit the result. `scripts/site.js` only wires up interactivity; it no longer injects the markup. No Vercel build step.
- **Redirects** ([vercel.json](vercel.json), all 308 permanent):
  - Legacy old-site URLs: `/solutions*` → `/Product`, `/data-literacy*` → `/Resources`
  - Lowercase → canonical mixed-case: `/product` → `/Product`, `/faq` → `/FAQ`, etc. (sources are case-sensitive on Vercel, so no loop on the canonical)
- **robots.txt** — blocks only `/api/` and `/dhadmin/`. Pages meant to stay out of the index (`/thank-you`, `/nda`, `/nda-signed`, `/vs/*`) are left crawlable and rely on `<meta name="robots" content="noindex, nofollow">`. Do NOT `Disallow` a noindexed page — that hides the noindex and risks URL-only listings.
- **Sitemap** ([sitemap.xml](sitemap.xml)) — canonical clean URLs only; excludes noindexed/draft pages. Homepage entry is `https://www.digitalhive.com/`.

## After every deploy — quick checks

```bash
# Redirects should be 308 to the canonical target
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" https://www.digitalhive.com/Home       # -> / 
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" https://www.digitalhive.com/product     # -> /Product
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" https://www.digitalhive.com/solutions   # -> /Product

# robots.txt should list only /api/ and /dhadmin/
curl -s https://www.digitalhive.com/robots.txt

# Noindexed utility pages: reachable (200) AND still carry the noindex meta
curl -s https://www.digitalhive.com/thank-you | grep -i 'name="robots"'
```

## Search Console follow-up (ongoing)

- Resubmit `sitemap.xml` after structural changes.
- Watch **Not found (404)** — this is where *other* old-site URLs surface if they still need a 301.
- Watch **Page with redirect** and **Excluded by noindex** settle as Google recrawls.
- The bare domain / `/Home` transition: expect `/Home` to drop out of the index and `/` to take its place over a few crawls.

## New pages checklist (no build step, so add by hand)

- Canonical + `og:url` = the clean-URL form (`https://www.digitalhive.com/PageName`)
- `og:image` = a raster asset (e.g. `assets/og-default.png`), never SVG
- Add a `<header class="nav">` and `<footer class="footer">` placeholder, then run `npm run nav`
- Add the URL to `sitemap.xml` (unless noindexed)
- No trailing periods on marketing/UI copy (see [CLAUDE.md](CLAUDE.md))
