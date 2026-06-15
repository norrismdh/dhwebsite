# Digital Hive Website — Documentation

> This folder is blocked from public access via `vercel.json`. Do not move docs outside of `/docs/`.

## Contents

- [Site Structure](./site-structure.md) — pages, directories, what lives where
- [Adding a Blog Post](./adding-a-blog-post.md) — step-by-step workflow
- [Updating the Team Page](./updating-the-team-page.md) — adding/editing team members
- [Deployment](./deployment.md) — how the site is built and deployed

## Key Rules

- **No trailing periods** on any UI copy (headlines, cards, bullets, CTAs). Blog articles and legal pages (Privacy, Terms, NDA) are exempt. See `CLAUDE.md` at the project root.
- **Shared nav and footer** are injected by `scripts/site.js` — never hardcode them per page.
- Blog pages in subdirectories use `../` relative paths (handled automatically by site.js).
