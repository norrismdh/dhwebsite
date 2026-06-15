# Site Structure

## Top-Level Pages

| File | URL | Notes |
|------|-----|-------|
| Home.html | /Home | Hero landing page |
| About.html | /About | Team, story, values |
| Product.html | /Product | Platform overview |
| Pricing.html | /Pricing | |
| Demo.html | /Demo | Book a demo form |
| Contact.html | /Contact | |
| Blog.html | /Blog | Blog hub (data-driven, see adding-a-blog-post.md) |
| Resources.html | /Resources | Resources hub |
| Connectors.html | /Connectors | BI tool integrations |
| Customers.html | /Customers | Customer logos/quotes |
| UseCases.html | /UseCases | Use case hub |
| Partners.html | /Partners | |
| Security.html | /Security | |
| Architecture.html | /Architecture | |
| FAQ.html | /FAQ | |
| Clarity.html | /Clarity | Case study |
| Denver.html | /Denver | Case study |
| Pattison.html | /Pattison | Case study |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `blog/` | Individual blog article pages |
| `use-cases/` | Individual use case pages |
| `resources/` | Long-form resource articles |
| `vs/` | Competitor comparison pages (noindex) |
| `assets/` | Logos, PDFs, favicon, team headshots (`assets/team/`) |
| `styles/` | CSS — one file per page/section plus shared tokens |
| `scripts/` | JS — `site.js` (shared nav/footer/animations), `blog-posts.js` (blog registry), `consent.js` |
| `api/` | Vercel serverless functions (download handler, NDA/Zoho Sign) |
| `dhadmin/` | Internal admin UI — not indexed |
| `downloads/` | Gated file downloads |
| `docs/` | This documentation — blocked from public URL access |

## Shared Components

Nav and footer are **not** hardcoded in each page. They are empty `<header class="nav">` and `<footer class="footer">` shells that `scripts/site.js` populates at runtime via `setupMegaMenu()` and `setupFooter()`.

To edit the nav or footer, edit only `scripts/site.js`.

## CSS Architecture

- `styles/tokens.css` — design tokens (colors, spacing, type scale)
- `styles/site.css` — global/shared styles
- `styles/[page].css` — page-specific styles loaded only on that page

## Deployment

Hosted on Vercel. Every push to `main` deploys automatically. See [deployment.md](./deployment.md).
