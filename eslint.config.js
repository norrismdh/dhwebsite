const html = require("@html-eslint/eslint-plugin");

// Spread flat/recommended to get the correct HTML parser, then replace the
// rules with only WCAG 2.1 AA accessibility checks (no formatting noise).
const base = html.configs["flat/recommended"];

module.exports = [
  // ── WCAG 2.1 AA accessibility linting for all HTML files ──────────────────
  {
    ...base,
    files: ["**/*.html"],
    rules: {
      // 1.1.1  Non-text Content — every <img> needs meaningful alt text
      "@html-eslint/require-img-alt": "error",

      // 1.3.1  Info & Relationships — inputs must have an associated label
      "@html-eslint/require-input-label": "error",

      // 1.3.1  Info & Relationships — <li> must be inside <ul>/<ol>/<menu>
      "@html-eslint/require-li-container": "error",

      // 1.4.4  Resize Text — viewport must not block user scaling
      "@html-eslint/no-non-scalable-viewport": "error",

      // 2.1.1  Keyboard — positive tabindex breaks natural focus order
      "@html-eslint/no-positive-tabindex": "error",

      // 2.4.1  Bypass Blocks — <iframe> needs a descriptive title
      "@html-eslint/require-frame-title": "error",

      // 2.4.2  Page Titled — every page must have a <title>
      "@html-eslint/require-title": "error",

      // 2.4.6  Headings — don't skip heading levels (h1 → h3 etc.)
      "@html-eslint/no-skip-heading-levels": "warn",

      // 3.1.1  Language of Page — <html> must carry a lang attribute
      "@html-eslint/require-lang": "error",

      // 4.1.2  Name, Role, Value — abstract ARIA roles are invalid
      "@html-eslint/no-abstract-roles": "error",

      // 4.1.2  Name, Role, Value — aria-hidden on body hides everything from AT
      "@html-eslint/no-aria-hidden-body": "error",

      // 4.1.2  Name, Role, Value — aria-hidden on a focusable element traps keyboard users
      "@html-eslint/no-aria-hidden-on-focusable": "error",

      // 4.1.2  Name, Role, Value — <button> without type defaults to "submit" unexpectedly
      "@html-eslint/require-button-type": "error",

      // Best practice — <meta charset> required for correct text rendering
      "@html-eslint/require-meta-charset": "error",

      // Best practice — <meta viewport> must be present
      "@html-eslint/require-meta-viewport": "error",

      // Best practice — target="_blank" without rel="noreferrer" is a security/usability issue
      "@html-eslint/no-target-blank": "warn",
    },
  },

  // ── Ignore vendored / template files ──────────────────────────────────────
  {
    ignores: ["node_modules/**", "use-cases/Template.html"],
  },
];
