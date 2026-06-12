// One-off: insert TL;DR card into each blog article's TOC sidebar.
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const BLOG = join(dirname(fileURLToPath(import.meta.url)), '..', 'blog');

const TLDR = {
  'peaceful-transition-analytics.html':
    'Users don’t follow migrations — they follow familiarity. Put a stable layer in front of your BI tools and swap platforms behind it.',
  'era-of-bi-standardisation-over.html':
    'Standardizing on one BI tool trades visible license savings for invisible costs: lost capability, stalled migrations, vendor lock-in.',
  'analytics-catalogs-actually-useful.html':
    'If your problem is findability — not tooling — a catalog pays off. If users already find and trust their reports, you don’t need one.',
  'reimagining-analytics-ux.html':
    'BI tools no longer compete on capability; they compete on experience. Adoption follows the tool people can actually use.',
  'dewey-decimal-business-intelligence.html':
    'BI needs its Dewey Decimal moment: one classification layer over every library of reports, so anyone can find anything.',
  '10-statistics-cdao-2024.html':
    'CDAO demand is up and impact is real — but tenure is short, data quality is unsolved, and AI governance is arriving faster than budgets.',
  'data-catalogs-are-dead.html':
    'Six-figure data catalogs are used by roughly 5% of intended users. Built for data teams, not business users — that’s why they fail.',
  'creativity-analytics-catalog.html':
    'Creative output stalls when analytics are buried. Make existing work findable and teams build on it instead of rebuilding it.',
  'how-many-bi-tools.html':
    'Most enterprises run four or more BI tools, accumulated rather than chosen. The fix is a layer that makes many tools coherent — not forcing one.',
  'standardisation-is-wrong.html':
    'Consolidating to one BI tool sacrifices fit-for-purpose capability for theoretical savings. Knowledge work isn’t manufacturing.',
  'power-bi-analytics-catalog.html':
    'Power BI adoption stalls on findability, not features. A catalog layer turns published reports into discovered, trusted, used reports.',
  'future-analytics-unified-tools.html':
    'More tools multiplied the coherence problem. Unification is a structural layer above your stack, not another product to buy.',
  'top-5-analytics-catalog-benefits.html':
    'Fragmentation is the real problem. A catalog adds discovery, trust, governance, less duplication, and faster decisions.',
  'analytics-data-metrics-cheatsheet.html':
    'Data catalogs serve data teams. Metrics stores serve semantic consistency. Analytics catalogs serve business users. Three layers, not synonyms.',
  'how-to-read-gartner-mq-2024.html':
    'The MQ tells you who matters in the market. Critical Capabilities tells you who’s good at what you need. Read them together — never as a ranking.',
  'bring-bi-tools-together.html':
    'Multi-tool BI is the norm, not a failure. Don’t standardize — federate: one discovery and governance layer across every tool.',
};

for (const [file, text] of Object.entries(TLDR)) {
  const path = join(BLOG, file);
  let html = readFileSync(path, 'utf8');
  if (html.includes('toc__tldr')) { console.log(`skip (has tldr): ${file}`); continue; }
  const eol = html.includes('\r\n') ? '\r\n' : '\n';
  const tocStart = html.indexOf('toc__list');
  const olEnd = html.indexOf('</ol>', tocStart);
  if (tocStart === -1 || olEnd === -1) { console.log(`TOC NOT FOUND: ${file}`); continue; }
  const insertAt = olEnd + '</ol>'.length;
  const block =
    eol +
    `            <div class="toc__tldr">${eol}` +
    `              <span class="toc__tldr-label">TL;DR</span>${eol}` +
    `              <p>${text}</p>${eol}` +
    '            </div>';
  html = html.slice(0, insertAt) + block + html.slice(insertAt);
  writeFileSync(path, html);
  console.log(`done: ${file}`);
}
