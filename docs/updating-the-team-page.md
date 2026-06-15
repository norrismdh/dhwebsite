# Updating the Team Page

Team cards live in `About.html` (the `ab2-team__grid` section). Each card is an `<a>` element linking to LinkedIn.

## Adding or updating a team member

### 1 — Save the headshot

Save the photo to `assets/team/{firstname-lastname}.jpg` (or `.webp`).

Recommended: square crop, minimum 200×200px. The avatar renders at 64×64px but higher resolution is fine.

### 2 — Add or update the card in About.html

```html
<a class="ab2-person reveal" href="https://www.linkedin.com/in/PROFILE/" target="_blank" rel="noopener noreferrer">
  <img class="ab2-person__avatar ab2-person__avatar--photo" src="assets/team/firstname-lastname.jpg" alt="Full Name">
  <div class="ab2-person__name">Full Name</div>
  <div class="ab2-person__role">Job Title</div>
</a>
```

The LinkedIn logo fades in on hover automatically via CSS — no extra markup needed.

### 3 — If no photo yet

Use the initials placeholder instead:

```html
<div class="ab2-person reveal">
  <div class="ab2-person__avatar ab2-person__avatar--a1" aria-hidden="true">AB</div>
  <div class="ab2-person__role">Job Title</div>
</div>
```

Gradient variants: `--a1` through `--a4` (navy shades). Use `<div>` not `<a>` when there's no LinkedIn link.

## Current team (order in HTML)

| Name | Role | LinkedIn |
|------|------|---------|
| Lynn Moore | CEO | linkedin.com/in/moorelynn |
| Michael Norris | COO | linkedin.com/in/norrismikej |
| Scott Masson | CTO | linkedin.com/in/masson-scott |
| Doug Bonanno | Head of Sales & Alliances | linkedin.com/in/douglasbonanno |
| Trevor Kirkland | Head of Customer Success | linkedin.com/in/trevor-kirkland-1460193 |
