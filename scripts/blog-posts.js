/* ============================================================
   Blog post registry
   To add a new post: prepend an entry to the array below.
   The FIRST entry automatically becomes the "Latest Post" featured section.
   Filter counts on Blog.html are computed from this data -- no manual updating needed.

   cat values must match a key in DH_BLOG_CAT_LABELS below.
   ============================================================ */

/* Category label lookup -- one source of truth for filter tab names and card labels */
window.DH_BLOG_CAT_LABELS = {
  strategy:  'BI Strategy',
  catalogs:  'Analytics Hubs',
  education: 'Education &amp; Guides'
};

window.DH_BLOG_POSTS = [
  {
    slug:     "analytics-portal",
    title:    "Analytics portal: one hub for every BI tool",
    excerpt:  "An analytics portal gives users one trusted place to find dashboards, reports, and business context across every BI tool they already use. What it is, what it should include, and when you need one.",
    cat:      "education",
    date:     "Jun 2026",
    readTime: "8 min"
  },
  {
    slug:     "expensive-reports-nobody-can-find",
    title:    "The most expensive reports in your company are the ones nobody can find",
    excerpt:  "A report nobody can find has almost the same value as one that never existed. Why so much analytics waste comes from a shortage of visibility, not a shortage of content.",
    cat:      "strategy",
    date:     "Jun 2026",
    readTime: "6 min"
  },
  {
    slug:     "data-catalogs-are-dead",
    title:    "Data catalogs are dead, and the industry refusal to admit it is costing you",
    excerpt:  "A decade of vendor promises, and most organizations got expensive shelfware. Here's the honest post-mortem the industry keeps refusing to write.",
    cat:      "strategy",
    date:     "Mar 2026",
    readTime: "7 min"
  },
  {
    slug:     "analytics-catalogs-actually-useful",
    title:    "Analytics hubs: actually useful, or just another checkbox?",
    excerpt:  "Between the vendor noise and the analyst hype, it's hard to separate genuine value from another platform collecting dust. When analytics hubs deliver, and when they don't.",
    cat:      "catalogs",
    date:     "Aug 2025",
    readTime: "5 min"
  },
  {
    slug:     "peaceful-transition-analytics",
    title:    "A peaceful transition of power, for your analytics",
    excerpt:  "Leadership changes, mergers, and reorgs all threaten analytics continuity. How a well-governed analytics environment outlasts the people who built it.",
    cat:      "strategy",
    date:     "Jan 2025",
    readTime: "4 min"
  },
  {
    slug:     "10-statistics-cdao-2024",
    title:    "10 key statistics every Chief Data Analytics Officer should know",
    excerpt:  "The numbers behind analytics fragmentation, BI tool sprawl, and adoption gaps. Reference data for the conversations that matter most at the executive level.",
    cat:      "strategy",
    date:     "Sep 2024",
    readTime: "6 min"
  },
  {
    slug:     "how-many-bi-tools",
    title:    "Navigating the maze: how many BI tools does your organization actually need?",
    excerpt:  "The question most BI leaders are afraid to answer honestly. A framework for auditing your tool landscape without triggering a political firestorm.",
    cat:      "strategy",
    date:     "Jul 2024",
    readTime: "5 min"
  },
  {
    slug:     "how-to-read-gartner-mq-2024",
    title:    "How to read the Gartner Magic Quadrant and Critical Capabilities, 2024 edition",
    excerpt:  "The MQ shapes enterprise buying decisions more than almost any other document. How to use it as a starting point, not an endpoint, when evaluating analytics platforms.",
    cat:      "education",
    date:     "Jul 2024",
    readTime: "6 min"
  },
  {
    slug:     "ultimate-guide-analytics-catalogs",
    title:    "Your complete guide to analytics hubs: solving today's biggest challenges",
    excerpt:  "What an analytics hub is, why it's not a data catalog, and the specific problems it solves for organizations running multiple BI platforms. The definitive reference.",
    cat:      "catalogs",
    date:     "Jun 2024",
    readTime: "5 min"
  },
  {
    slug:     "creativity-analytics-catalog",
    title:    "Better creativity happens when your analytics are organized",
    excerpt:  "Fragmented analytics don't just slow people down, they actively suppress creative thinking. What good analytics organization makes possible for the teams that use it every day.",
    cat:      "catalogs",
    date:     "Apr 2024",
    readTime: "4 min"
  },
  {
    slug:     "power-bi-analytics-catalog",
    title:    "5 great reasons to pair an analytics hub with Microsoft Power BI",
    excerpt:  "Power BI is a strong platform, but it doesn't solve discovery, cross-tool governance, or multi-audience access. Where an analytics hub extends what Power BI already does well.",
    cat:      "education",
    date:     "Jan 2024",
    readTime: "5 min"
  },
  {
    slug:     "dewey-decimal-business-intelligence",
    title:    "People are freaking out about the Dewey Decimal System for business intelligence",
    excerpt:  "The idea of systematic classification for analytics assets shouldn't be novel. And yet most BI environments have no organizing logic at all, and the consequences are real.",
    cat:      "catalogs",
    date:     "Dec 2023",
    readTime: "4 min"
  },
  {
    slug:     "reimagining-analytics-ux",
    title:    "Reimagining user experience in the analytics world",
    excerpt:  "Analytics platforms optimize for power users and ignore everyone else. What it looks like to design BI access around the full range of how people actually use data in their work.",
    cat:      "strategy",
    date:     "Oct 2023",
    readTime: "4 min"
  },
  {
    slug:     "bring-bi-tools-together",
    title:    "Why choose just one tool? How to bring the titans of BI together",
    excerpt:  "The business case for a single BI platform is compelling in theory. In practice, most large organizations run three or more, and treating that as a failure is the wrong frame.",
    cat:      "strategy",
    date:     "Sep 2023",
    readTime: "5 min"
  },
  {
    slug:     "future-analytics-unified-tools",
    title:    "The future of analytics is unified, not standardized",
    excerpt:  "Not consolidated through migration. Not standardized on one platform. Unified, while preserving the investments you've already made. The distinction that changes the strategy entirely.",
    cat:      "strategy",
    date:     "Aug 2023",
    readTime: "4 min"
  },
  {
    slug:     "top-5-analytics-catalog-benefits",
    title:    "The top 5 benefits of analytics hubs you need to know",
    excerpt:  "For leaders building the business case, here are five outcomes analytics hub users consistently report, across financial services, healthcare, and manufacturing deployments.",
    cat:      "catalogs",
    date:     "Aug 2023",
    readTime: "5 min"
  },
  {
    slug:     "analytics-data-metrics-cheatsheet",
    title:    "Analytics hubs, data catalogs, and metrics stores: a plain-language cheat sheet",
    excerpt:  "Three categories, overlapping marketing claims, and genuinely different use cases. The plain-language breakdown that helps teams choose the right tool for the right problem.",
    cat:      "education",
    date:     "Aug 2023",
    readTime: "4 min"
  },
  {
    slug:     "era-of-bi-standardisation-over",
    title:    "The era of BI standardization is over",
    excerpt:  "The idea that enterprises would converge on a single BI platform was always a theory. The evidence it has comprehensively failed, and what organizations should do differently from here.",
    cat:      "strategy",
    date:     "Jul 2023",
    readTime: "5 min"
  },
  {
    slug:     "standardisation-is-wrong",
    title:    "Standardization is the wrong answer for analytics",
    excerpt:  "Consolidating onto one platform sounds efficient. The reality is lost institutional knowledge, disrupted workflows, and adoption that never fully recovers. There's a better path.",
    cat:      "strategy",
    date:     "Jun 2023",
    readTime: "4 min"
  }
];
