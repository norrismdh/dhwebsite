# Adding a Blog Post

## Overview

Adding a blog post touches **3 files**. The blog hub page (`Blog.html`) does **not** need to be edited — it renders entirely from data.

---

## Step 1 — Create the article file

Copy an existing post as a template:

```
blog/bring-bi-tools-together.html  →  blog/your-new-slug.html
```

Edit:
- `<title>` and `<meta name="description">`
- `<h1>`, subtitle, date, read time in the art-header section
- Breadcrumb "current" text
- Table of contents `<nav>` (h2 headings and anchor links)
- Article prose inside `<article class="prose">`
- "Keep reading" related posts links at the bottom

Nav and footer inject automatically — do not add them manually.

**No trailing periods** on headlines, subheadings, or short copy. Prose sentences in the article body keep normal punctuation.

---

## Step 2 — Register the post in blog-posts.js

Open `scripts/blog-posts.js` and **prepend** a new entry at the top of the `DH_BLOG_POSTS` array. The first entry is always the "Latest Post" featured on the blog hub.

```js
window.DH_BLOG_POSTS = [
  {
    slug:     "your-new-slug",
    title:    "Your post title",
    excerpt:  "One or two sentence description shown on the card.",
    cat:      "strategy",   // strategy | catalogs | education
    date:     "Jun 2026",
    readTime: "5 min"
  },
  // ... existing posts below
];
```

**`cat` values:**

| Value | Displayed as |
|-------|-------------|
| `strategy` | BI Strategy |
| `catalogs` | Analytics Hubs |
| `education` | Education & Guides |

Labels are defined in `DH_BLOG_CAT_LABELS` at the top of `blog-posts.js`. To add a new category, add an entry there and a new filter tab in `Blog.html`.

This single change automatically:
- Adds the card to the "All posts" grid
- Updates the filter tab counts
- Promotes the post to the "Latest Post" featured section

---

## Step 3 — Update sitemap.xml

Add a new `<url>` block. No `.html` extension — Vercel's `cleanUrls: true` strips it.

```xml
<url>
  <loc>https://www.digitalhive.com/blog/your-new-slug</loc>
  <lastmod>2026-06-15</lastmod>
  <priority>0.6</priority>
</url>
```

---

## That's it

| File | What changes |
|------|-------------|
| `blog/your-new-slug.html` | New article (created from template) |
| `scripts/blog-posts.js` | One object prepended to array |
| `sitemap.xml` | One `<url>` block added |
