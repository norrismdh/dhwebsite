// =============================================================
// Digital Hive — Site JS
// Mobile nav, scroll-triggered fades, sticky-nav border,
// testimonials carousel. No frameworks. ~80 lines.
// =============================================================

(function () {
  // ---------- Mega menu (injected so every page picks it up) ----------
  function setupMegaMenu() {
    const nav = document.querySelector('.nav');
    if (!nav) return;

    // Current page detection + subdirectory base path
    const path = (location.pathname.split('/').pop() || 'Home.html').toLowerCase();
    const dir  = location.pathname.replace(/\\/g, '/').split('/').slice(0, -1).pop() || '';
    const base = ['use-cases', 'resources', 'vs', 'blog', 'downloads'].includes(dir.toLowerCase()) ? '../' : '';

    // Inject skip-to-main link before the nav (screen readers + keyboard users)
    if (!document.querySelector('.skip-link')) {
      // Ensure <main> has id="top" so the skip link target always resolves
      const mainEl = document.querySelector('main');
      if (mainEl && !mainEl.id) mainEl.id = 'top';
      const skip = document.createElement('a');
      skip.className = 'skip-link';
      skip.href = '#top';
      skip.textContent = 'Skip to main content';
      nav.parentElement.insertBefore(skip, nav);
    }

    // Inject full nav shell so the header is a single source of truth
    nav.innerHTML = `
      <div class="container nav__inner">
        <a class="nav__logo" href="${base}Home.html" aria-label="Digital Hive home">
          <img src="${base}assets/logo-colour.svg" alt="Digital Hive" />
        </a>
        <nav aria-label="Primary">
          <ul class="nav__links"></ul>
        </nav>
        <div class="nav__cta">
          <a class="btn btn--primary" href="${base}Demo.html">Book a demo</a>
          <button type="button" class="nav__toggle" data-mobile-toggle aria-label="Open menu" aria-expanded="false">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/></svg>
          </button>
        </div>
      </div>
      <div class="container mobile-menu" data-mobile-menu></div>`;

    const navLinks = nav.querySelector('.nav__links');
    const inPlatform = ['product.html', 'usecases.html', 'connectors.html', 'security.html'].includes(path);
    const inResources = ['resources.html', 'faq.html', 'customers.html', 'blog.html'].includes(path) || dir === 'blog';
    const inCompany = ['about.html', 'contact.html', 'partners.html'].includes(path);

    // Icon factory — all hex-framed line icons, same visual weight
    const hexIcon = (paths) => `
      <span class="mega__ico" aria-hidden="true">
        <svg class="mega__hex" viewBox="0 0 32 32"><polygon points="16,1.5 28.5,9 28.5,23 16,30.5 3.5,23 3.5,9" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>
        <svg class="mega__glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>
      </span>`;

    const ICO = {
      grid:      `<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>`,
      plug:      `<path d="M9 2v6"/><path d="M15 2v6"/><rect x="7" y="8" width="10" height="6" rx="1"/><path d="M12 14v4a3 3 0 0 0 3 3"/>`,
      layers:    `<polygon points="12 2 22 8 12 14 2 8 12 2"/><polyline points="2 16 12 22 22 16"/>`,
      blueprint: `<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 3v18"/>`,
      question:  `<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12" y2="17.5"/>`,
      book:      `<path d="M4 4h10a4 4 0 0 1 4 4v12H8a4 4 0 0 1-4-4z"/><path d="M4 16a4 4 0 0 1 4-4h10"/>`,
      users:     `<circle cx="9" cy="8" r="3.5"/><circle cx="17" cy="9" r="2.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M15 20a5 5 0 0 1 6.5-4.8"/>`,
      pencil:    `<path d="M4 20h4l11-11-4-4L4 16z"/><path d="M14 6l4 4"/>`,
      shield:    `<path d="M12 3l8 4v5c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V7z"/><polyline points="9 12 11 14 15 10"/>`,
      info:      `<circle cx="12" cy="12" r="10"/><path d="M12 16v-5"/><circle cx="12" cy="8" r=".7" fill="currentColor"/>`,
      handshake: `<path d="M2 12l4-4 4 4 4-4 4 4 4-4"/><path d="M6 12l3 4 3-3 3 3 3-4"/>`,
      mail:      `<rect x="3" y="5" width="18" height="14" rx="2"/><polyline points="3 7 12 13 21 7"/>`,
      calendar:  `<rect x="3" y="5" width="18" height="16" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="3" x2="8" y2="7"/><line x1="16" y1="3" x2="16" y2="7"/>`,
      tag:       `<path d="M3 12V4h8l10 10-8 8z"/><circle cx="8" cy="9" r="1.5"/>`,
    };

    // IA — the three mega panels
    const MEGA = {
      platform: {
        label: 'Platform',
        href: 'Product.html',
        active: inPlatform || path === 'home.html' || path === '',
        eyebrow: 'The Digital Hive Platform',
        title: 'A unified analytics experience above your existing BI stack.',
        items: [
          { ico: ICO.grid,      label: 'Platform overview', sub: 'Catalog, Analytics Hub, governance',      href: 'Product.html' },
          { ico: ICO.plug,      label: 'Connectors',         sub: 'BI, AI, data & document tools',  href: 'Connectors.html' },
          { ico: ICO.layers,    label: 'Use cases',          sub: 'By situation and industry',       href: 'UseCases.html' },
          { ico: ICO.blueprint, label: 'Architecture',       sub: 'Deployment and scale',            href: 'Product.html#security' },
          { ico: ICO.shield,    label: 'Security',           sub: 'Certifications, compliance, trust', href: 'Security.html' },
        ],
        cta: { label: 'See the full platform', href: 'Product.html' },
      },
      resources: {
        label: 'Resources',
        href: 'Resources.html',
        active: inResources,
        eyebrow: 'Learn',
        title: 'Independent research, working definitions, honest comparisons.',
        items: [
          { ico: ICO.question, label: 'FAQ',              sub: 'Common questions answered', href: 'FAQ.html' },
          { ico: ICO.book,     label: 'Resource library', sub: 'Reports, guides, briefs',   href: 'Resources.html' },
          { ico: ICO.users,    label: 'Customer stories', sub: 'Real outcomes, real teams', href: 'Customers.html' },
          { ico: ICO.pencil,   label: 'Blog',             sub: 'Field notes from the team', href: 'Blog.html' },
          { ico: ICO.shield,   label: 'Trust Center',     sub: 'Security & compliance',     href: 'Security.html' },
        ],
        cta: { label: 'Open the library', href: 'Resources.html' },
      },
      company: {
        label: 'Company',
        href: 'About.html',
        active: inCompany,
        eyebrow: 'Company',
        title: 'The category-defining analytics hub for complex enterprises.',
        items: [
          { ico: ICO.info,      label: 'About Digital Hive', sub: 'Why we exist',         href: 'About.html' },
          { ico: ICO.users,     label: 'Leadership',         sub: 'The people behind it', href: 'About.html#team' },
          { ico: ICO.handshake, label: 'Partners',           sub: 'Resellers & ISVs',     href: 'Partners.html' },
          { ico: ICO.mail,      label: 'Contact us',         sub: 'Get in touch',         href: 'Contact.html' },
        ],
        cta: { label: 'Meet the team', href: 'About.html#team' },
      },
    };

    // Build the <li> trigger + panel for each mega entry
    const buildTrigger = (key, def) => {
      const itemsHTML = def.items.map(it => `
        <a class="mega__item" href="${base}${it.href}">
          ${hexIcon(it.ico)}
          <span class="mega__txt">
            <span class="mega__label">${it.label}</span>
            <span class="mega__sub">${it.sub}</span>
          </span>
        </a>`).join('');

      return `
        <li class="nav__item" data-mega="${key}">
          <a class="nav__trigger${def.active ? ' is-current' : ''}" href="${base}${def.href}" aria-haspopup="true" aria-expanded="false"${def.active ? ' aria-current="page"' : ''}>
            <span>${def.label}</span>
            <svg class="nav__chev" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
          </a>
          <div class="mega__panel" role="menu" aria-hidden="true" inert>
            <span class="mega__caret" aria-hidden="true"></span>
            <div class="mega__panel-inner">
              <div class="mega__lede">
                <span class="eyebrow">${def.eyebrow}</span>
                <p>${def.title}</p>
                <a class="mega__cta" href="${base}${def.cta.href}">
                  ${def.cta.label}
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
                </a>
              </div>
              <div class="mega__items">${itemsHTML}</div>
            </div>
          </div>
        </li>`;
    };

    const isPricing = path === 'pricing.html';
    navLinks.innerHTML = [
      buildTrigger('platform', MEGA.platform),
      buildTrigger('resources', MEGA.resources),
      buildTrigger('company', MEGA.company),
      `<li class="nav__item"><a class="nav__plain${isPricing ? ' is-current' : ''}" href="${base}Pricing.html"${isPricing ? ' aria-current="page"' : ''}>Pricing</a></li>`,
    ].join('');

    // ---- Hover / focus open/close with a short close-delay (lets pointer cross gap) ----
    const items = Array.from(navLinks.querySelectorAll('[data-mega]'));
    let closeTimer;
    const closeAll = () => {
      items.forEach(li => {
        li.classList.remove('is-open');
        const t = li.querySelector('.nav__trigger');
        const p = li.querySelector('.mega__panel');
        if (t) t.setAttribute('aria-expanded', 'false');
        if (p) { p.setAttribute('aria-hidden', 'true'); p.setAttribute('inert', ''); }
      });
    };
    const openOne = (li) => {
      items.forEach(other => other.classList.toggle('is-open', other === li));
      const t = li.querySelector('.nav__trigger');
      const p = li.querySelector('.mega__panel');
      if (t) t.setAttribute('aria-expanded', 'true');
      if (p) { p.setAttribute('aria-hidden', 'false'); p.removeAttribute('inert'); }
    };

    items.forEach(li => {
      const trigger = li.querySelector('.nav__trigger');
      li.addEventListener('mouseenter', () => {
        clearTimeout(closeTimer);
        openOne(li);
      });
      li.addEventListener('mouseleave', () => {
        clearTimeout(closeTimer);
        closeTimer = setTimeout(closeAll, 160);
      });
      // Click trigger → two-tap pattern:
      // • Desktop hover already opens the panel, so click goes straight to the page.
      // • Touch / keyboard: first tap opens the panel (preventDefault); second tap navigates.
      trigger.addEventListener('click', (e) => {
        if (!li.classList.contains('is-open')) {
          e.preventDefault();
          openOne(li);
        }
        // Panel already open → let the <a> navigate normally (no preventDefault)
      });
      // Tab focus through links inside panel keeps it open
      li.addEventListener('focusin', () => { clearTimeout(closeTimer); openOne(li); });
      li.addEventListener('focusout', (e) => {
        // Close once focus leaves the whole li
        if (!li.contains(e.relatedTarget)) {
          closeTimer = setTimeout(closeAll, 100);
        }
      });
    });

    // Esc closes
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAll(); });

    // Click outside closes
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.nav__links')) closeAll();
    });

    // ---- Rebuild mobile menu in matching structure ----
    const mobileMenu = document.querySelector('[data-mobile-menu]');
    if (mobileMenu) {
      const mob = (def) => `
        <section class="mobile-menu__group">
          <h5>${def.label}</h5>
          <ul>
            ${def.items.map(it => `<li><a href="${base}${it.href}">${it.label}</a></li>`).join('')}
          </ul>
        </section>`;
      mobileMenu.innerHTML = `
        ${mob(MEGA.platform)}
        ${mob(MEGA.resources)}
        ${mob(MEGA.company)}
        <section class="mobile-menu__group">
          <ul><li><a href="${base}Pricing.html">Pricing</a></li></ul>
        </section>
        <div class="mobile-menu__cta">
          <a class="btn btn--accent" href="${base}Demo.html">Book a demo</a>
        </div>`;
    }
  }
  setupMegaMenu();

  // ---------- Footer (injected so every page stays in sync) ----------
  function setupFooter() {
    const footer = document.querySelector('.footer');
    if (!footer) return;

    const dir = location.pathname.replace(/\\/g, '/').split('/').slice(0, -1).pop() || '';
    const base = ['use-cases', 'resources', 'vs', 'blog', 'downloads'].includes(dir.toLowerCase()) ? '../' : '';

    footer.innerHTML = `
      <div class="container">
        <div class="footer__top">
          <div class="footer__brand">
            <img src="${base}assets/logo-reversed.svg" alt="Digital Hive" />
            <p>Where analytics finally make sense. An analytics hub.</p>
            <div class="footer__social">
              <a href="https://www.linkedin.com/company/digital-hive-bi-portal" aria-label="LinkedIn" target="_blank" rel="noopener"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M4.98 3.5C4.98 4.88 3.87 6 2.5 6S0 4.88 0 3.5 1.12 1 2.5 1s2.48 1.12 2.48 2.5zM0 8h5v16H0V8zm7.5 0H12v2.2h.07c.63-1.2 2.18-2.46 4.49-2.46 4.8 0 5.69 3.16 5.69 7.27V24h-5v-7.2c0-1.72-.03-3.93-2.4-3.93-2.4 0-2.77 1.87-2.77 3.81V24h-5V8z"/></svg></a>
              <a href="https://www.youtube.com/@digitalhive4376" aria-label="YouTube" target="_blank" rel="noopener"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.4.6A3 3 0 0 0 .5 6.2C0 8.1 0 12 0 12s0 3.9.5 5.8a3 3 0 0 0 2.1 2.1c1.9.6 9.4.6 9.4.6s7.5 0 9.4-.6a3 3 0 0 0 2.1-2.1c.5-1.9.5-5.8.5-5.8s0-3.9-.5-5.8zM9.6 15.6V8.4l6.3 3.6-6.3 3.6z"/></svg></a>
            </div>
          </div>
          <div class="footer__col"><h3>Product</h3><ul>
            <li><a href="${base}Product.html#catalog">Catalog</a></li>
            <li><a href="${base}Product.html#hub">Analytics Hub</a></li>
            <li><a href="${base}Product.html#governance">Governance</a></li>
            <li><a href="${base}Connectors.html">Connectors</a></li>
            <li><a href="${base}Pricing.html">Pricing</a></li>
          </ul></div>
          <div class="footer__col"><h3>Use cases</h3><ul>
            <li><a href="${base}UseCases.html">All use cases</a></li>
            <li><a href="${base}use-cases/multi-vendor-bi.html">Multi-vendor BI</a></li>
            <li><a href="${base}use-cases/cloud-migration.html">Cloud migration</a></li>
            <li><a href="${base}use-cases/ma-integration.html">M&amp;A integration</a></li>
            <li><a href="${base}use-cases/data-sovereignty.html">Data sovereignty</a></li>
          </ul></div>
          <div class="footer__col"><h3>Company</h3><ul>
            <li><a href="${base}About.html">About</a></li>
            <li><a href="${base}About.html#team">Leadership</a></li>
            <li><a href="${base}Customers.html">Customers</a></li>
            <li><a href="${base}Contact.html">Contact</a></li>
          </ul></div>
          <div class="footer__col"><h3>Resources</h3><ul>
            <li><a href="${base}Resources.html">Library</a></li>
            <li><a href="${base}FAQ.html">FAQ</a></li>
            <li><a href="${base}Home.html#research">ISG report</a></li>
            <li><a href="${base}Blog.html">Blog</a></li>
            <li><a href="https://support.digitalhive.com">Support</a></li>
          </ul></div>
        </div>
        <div class="footer__bottom">
          <span>&copy; 2026 Digital Hive</span>
          <ul>
            <li><a href="${base}Privacy.html">Privacy</a></li>
            <li><a href="${base}Terms.html">Terms</a></li>
            <li><a href="https://trust.digitalhive.com/" target="_blank" rel="noopener">Trust center</a></li>
          </ul>
        </div>
      </div>`;
  }
  setupFooter();

  // ---------- Client marquee — single source of truth for all logo strips ----------
  const CLIENT_NAMES = [
    'Bank <span class="sub">of</span> America',
    'Citigroup',
    'CIBC',
    'Ford',
    "Lowe's",
    'Takeda',
    'Trinity Health',
    'Westpac',
    'PATTISON',
    'Clarity',
    'DFS',
    'Highmark',
    'Froneri',
    'University <span class="sub">of</span> Denver',
  ];
  function setupClientMarquee() {
    document.querySelectorAll('[data-client-marquee]').forEach(function (row) {
      const items = CLIENT_NAMES.map(function (n) {
        return '<span class="proof__logo">' + n + '</span>';
      }).join('');
      row.innerHTML =
        '<div class="proof__track" aria-hidden="false">' + items + '</div>' +
        '<div class="proof__track" aria-hidden="true">'  + items + '</div>';
    });
  }
  setupClientMarquee();

  // ---------- Reading progress bar (long-form pages: blog articles + customer stories) ----------
  (function () {
    if (!document.querySelector('.art-body, .cs-doc')) return;
    var bar = document.createElement('div');
    bar.id = 'art-progress';
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-label', 'Reading progress');
    document.body.appendChild(bar);
    function updateProgress() {
      var scrolled = window.scrollY;
      var total = document.documentElement.scrollHeight - window.innerHeight;
      bar.style.width = (total > 0 ? Math.min(scrolled / total * 100, 100) : 0) + '%';
    }
    window.addEventListener('scroll', updateProgress, { passive: true });
    updateProgress();
  })();

  // ---------- Sticky nav border on scroll ----------
  const nav = document.querySelector('.nav');
  const onScroll = () => {
    if (!nav) return;
    nav.classList.toggle('is-scrolled', window.scrollY > 4);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // ---------- Mobile menu ----------
  const toggle = document.querySelector('[data-mobile-toggle]');
  const menu = document.querySelector('[data-mobile-menu]');
  if (toggle && menu) {
    toggle.addEventListener('click', () => {
      const open = menu.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', String(open));
    });
    menu.querySelectorAll('a').forEach((a) => {
      a.addEventListener('click', () => menu.classList.remove('is-open'));
    });
  }

  // ---------- Scroll reveal ----------
  const reveals = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    reveals.forEach((el) => io.observe(el));
  } else {
    reveals.forEach((el) => el.classList.add('is-visible'));
  }

  // ---------- Article TOC: mobile collapse + scroll-spy ----------
  const toc = document.querySelector('[data-toc]');
  if (toc) {
    // Mobile collapse — collapsed by default below 1000px
    const tocToggle = toc.querySelector('[data-toc-toggle]');
    if (tocToggle) {
      const mql = window.matchMedia('(min-width: 1000px)');
      const setCollapsed = (val) => toc.setAttribute('data-collapsed', String(val));
      setCollapsed(!mql.matches);
      mql.addEventListener('change', (e) => setCollapsed(!e.matches));
      tocToggle.addEventListener('click', () => {
        setCollapsed(toc.getAttribute('data-collapsed') !== 'true' ? true : false);
      });
    }

    // Scroll-spy
    if ('IntersectionObserver' in window) {
      const tocLinks = Array.from(toc.querySelectorAll('a[href^="#"]'));
      const sections = tocLinks
        .map((a) => document.getElementById(a.getAttribute('href').slice(1)))
        .filter(Boolean);

      const tocIO = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const id = entry.target.id;
            tocLinks.forEach((a) =>
              a.classList.toggle('is-current', a.getAttribute('href') === '#' + id)
            );
          }
        });
      }, { rootMargin: '-30% 0px -55% 0px', threshold: 0 });
      sections.forEach((s) => tocIO.observe(s));
    }
  }

  // ---------- Resource library filter ----------
  const library = document.querySelector('[data-library]');
  if (library) {
    const tabs = Array.from(library.querySelectorAll('[data-filter]'));
    const cards = Array.from(library.querySelectorAll('.res-card'));

    // Initialize tab counts
    const counts = { all: cards.length };
    cards.forEach((c) => {
      const t = c.dataset.type;
      counts[t] = (counts[t] || 0) + 1;
    });
    tabs.forEach((tab) => {
      const c = tab.querySelector('.count');
      if (c) c.textContent = counts[tab.dataset.filter] || 0;
      // Hide tabs with no matching content (except "All")
      if (tab.dataset.filter !== 'all') {
        tab.hidden = !(counts[tab.dataset.filter] > 0);
      }
    });

    const apply = (filter) => {
      let shown = 0;
      cards.forEach((c) => {
        const match = filter === 'all' || c.dataset.type === filter;
        c.style.display = match ? '' : 'none';
        if (match) shown++;
      });
      library.classList.toggle('is-empty', shown === 0);
    };

    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        tabs.forEach((t) => {
          const active = t === tab;
          t.classList.toggle('is-active', active);
          if (t.getAttribute('role') === 'tab') t.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        apply(tab.dataset.filter);
      });
    });
  }

  // ---------- Use case card expand (mobile) ----------
  document.querySelectorAll('[data-uc-expand]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      // Card is wrapped in <a>; prevent navigation when toggling on mobile.
      e.preventDefault();
      e.stopPropagation();
      const card = btn.closest('.uc-card');
      if (!card) return;
      const open = card.classList.toggle('is-expanded');
      btn.setAttribute('aria-expanded', String(open));
      const label = btn.querySelector('span');
      if (label) label.textContent = open ? 'Hide outcomes' : '3 outcomes';
    });
  });

  // ---------- Sticky sub-nav (Product page) ----------
  const subnav = document.querySelector('[data-subnav]');
  const subnavSentinel = document.querySelector('[data-subnav-sentinel]');
  if (subnav && subnavSentinel && 'IntersectionObserver' in window) {
    const sentinelIO = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        // Show sub-nav once the sentinel (bottom of hero) leaves the top of viewport
        subnav.classList.toggle('is-active', !entry.isIntersecting && entry.boundingClientRect.top < 0);
      });
    }, { threshold: 0, rootMargin: '0px 0px 0px 0px' });
    sentinelIO.observe(subnavSentinel);

    // Scroll-spy: highlight the current section link
    const subnavLinks = Array.from(subnav.querySelectorAll('a[href^="#"]'));
    const sections = subnavLinks
      .map((a) => document.querySelector(a.getAttribute('href')))
      .filter(Boolean);

    const spyIO = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const id = entry.target.id;
          subnavLinks.forEach((a) =>
            a.classList.toggle('is-current', a.getAttribute('href') === '#' + id)
          );
        }
      });
    }, { rootMargin: '-40% 0px -55% 0px', threshold: 0 });
    sections.forEach((s) => spyIO.observe(s));
  }

  // ---------- FAQ: categories, accordion, search ----------
  const faqNav = document.querySelector('[data-faq-nav]');
  if (faqNav) {
    const links = Array.from(faqNav.querySelectorAll('.faq-nav__link'));
    const panels = Array.from(document.querySelectorAll('.faq-panel'));
    const items = Array.from(document.querySelectorAll('.faq-item'));
    const search = document.querySelector('[data-faq-search]');
    const emptyState = document.querySelector('[data-faq-empty]');

    const showCategory = (cat) => {
      links.forEach(l => {
        const active = l.dataset.cat === cat;
        l.classList.toggle('is-current', active);
        l.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
      panels.forEach(p => p.classList.toggle('is-current', p.dataset.panel === cat));
      if (emptyState) emptyState.classList.remove('is-on');
      if (search) search.value = '';
      // Collapse all open
      items.forEach(i => i.classList.remove('is-open'));
      // Scroll panel into view on mobile
      if (window.innerWidth < 1000) {
        const visible = document.querySelector('.faq-panel.is-current');
        if (visible) window.scrollTo({ top: visible.offsetTop - 80, behavior: 'smooth' });
      }
    };

    links.forEach(l => l.addEventListener('click', () => showCategory(l.dataset.cat)));

    // Accordion toggle (open one, close siblings within same panel)
    items.forEach(item => {
      const btn = item.querySelector('.faq-item__q');
      if (!btn) return;
      btn.addEventListener('click', () => {
        const willOpen = !item.classList.contains('is-open');
        const panel = item.closest('.faq-panel');
        if (panel) panel.querySelectorAll('.faq-item').forEach(i => i.classList.remove('is-open'));
        item.classList.toggle('is-open', willOpen);
        btn.setAttribute('aria-expanded', String(willOpen));
      });
    });

    // Search across ALL items
    if (search) {
      search.addEventListener('input', () => {
        const q = search.value.trim().toLowerCase();
        if (!q) {
          // Restore category view
          panels.forEach(p => p.classList.toggle('is-current', p.dataset.panel === (links.find(l => l.classList.contains('is-current')) || links[0]).dataset.cat));
          items.forEach(i => { i.style.display = ''; i.classList.remove('is-open'); });
          if (emptyState) emptyState.classList.remove('is-on');
          return;
        }
        // Show all panels, filter items
        panels.forEach(p => p.classList.add('is-current'));
        let shown = 0;
        items.forEach(i => {
          const text = i.textContent.toLowerCase();
          const match = text.includes(q);
          i.style.display = match ? '' : 'none';
          if (match) shown++;
        });
        // Hide panel heads when searching to avoid duplicated headers
        document.querySelectorAll('.faq-panel__head').forEach(h => h.style.display = 'none');
        if (emptyState) emptyState.classList.toggle('is-on', shown === 0);
      });
      search.addEventListener('blur', () => {
        if (!search.value.trim()) {
          document.querySelectorAll('.faq-panel__head').forEach(h => h.style.display = '');
        }
      });
      // ⌘K to focus
      document.addEventListener('keydown', (e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
          e.preventDefault();
          search.focus();
        }
      });
    }

    // Deep-link to category via hash (#pricing, #security, etc.)
    const initialHash = (location.hash || '').replace('#', '');
    if (initialHash && links.find(l => l.dataset.cat === initialHash)) {
      showCategory(initialHash);
    }
  }

  // ---------- Connectors filter ----------
  const cnGrid = document.querySelector('[data-connectors]');
  if (cnGrid) {
    const filters = Array.from(document.querySelectorAll('[data-cn-filter]'));
    const cards = Array.from(cnGrid.querySelectorAll('.cn-card'));
    const counts = { all: cards.length };
    cards.forEach(c => {
      (c.dataset.cat || '').split(/\s+/).filter(Boolean).forEach(cat => {
        counts[cat] = (counts[cat] || 0) + 1;
      });
    });
    filters.forEach(f => {
      const cEl = f.querySelector('.count');
      if (cEl) cEl.textContent = counts[f.dataset.cnFilter] || 0;
    });
    const apply = (filter) => {
      cards.forEach(c => {
        const cats = (c.dataset.cat || '').split(/\s+/);
        c.style.display = (filter === 'all' || cats.includes(filter)) ? '' : 'none';
      });
    };
    filters.forEach(f => f.addEventListener('click', () => {
      filters.forEach(o => {
        const active = o === f;
        o.classList.toggle('is-on', active);
        o.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
      apply(f.dataset.cnFilter);
    }));
  }

  // ---------- Connectors hub: draw lines from center to each spoke ----------
  const hub = document.querySelector('.cn-hub__lines');
  if (hub) {
    const draw = () => {
      const stage = hub.closest('.cn-hub');
      if (!stage) return;
      const rect = stage.getBoundingClientRect();
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      hub.setAttribute('viewBox', `0 0 ${rect.width} ${rect.height}`);
      hub.innerHTML = '';
      stage.querySelectorAll('.cn-spoke').forEach(spoke => {
        const sr = spoke.getBoundingClientRect();
        const sx = sr.left - rect.left + sr.width / 2;
        const sy = sr.top - rect.top + sr.height / 2;
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        // Draw spoke -> center so a positive stroke-dashoffset animation
        // makes the dashes flow inward toward Digital Hive.
        line.setAttribute('x1', sx);
        line.setAttribute('y1', sy);
        line.setAttribute('x2', cx);
        line.setAttribute('y2', cy);
        hub.appendChild(line);
      });
    };
    draw();
    window.addEventListener('resize', draw);
    setTimeout(draw, 100);
  }

  // ---------- Count-up animation ----------
  const countEls = document.querySelectorAll('[data-count-up]');
  if (countEls.length && 'IntersectionObserver' in window) {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const runCount = (el) => {
      const target   = parseFloat(el.dataset.countUp);
      const decimals = parseInt(el.dataset.countDecimals || '0', 10);
      const duration = 1200;
      const startTime = performance.now();
      const easeOut  = (t) => 1 - Math.pow(1 - t, 3);
      const tick = (now) => {
        const progress = Math.min((now - startTime) / duration, 1);
        el.textContent = (easeOut(progress) * target).toFixed(decimals);
        if (progress < 1) requestAnimationFrame(tick);
        else el.textContent = target.toFixed(decimals);
      };
      el.textContent = (0).toFixed(decimals);
      requestAnimationFrame(tick);
    };

    const countIO = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        countIO.unobserve(entry.target);
        if (!reducedMotion) runCount(entry.target);
      });
    }, { threshold: 0.6 });
    countEls.forEach((el) => countIO.observe(el));
  }

  // ---------- Governance bar chart ----------
  const govBars = document.querySelector('.mock-gov__bars');
  if (govBars && 'IntersectionObserver' in window) {
    const barIO = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.querySelectorAll('.bar').forEach((bar, i) => {
            const pct = parseFloat(bar.dataset.barH) || 0;
            setTimeout(() => { bar.style.height = pct + '%'; }, i * 45);
          });
          barIO.unobserve(entry.target);
        }
      });
    }, { threshold: 0.4 });
    barIO.observe(govBars);
  }

  // ---------- Testimonials carousel ----------
  const carousel = document.querySelector('[data-carousel]');
  if (carousel) {
    const slides = Array.from(carousel.querySelectorAll('.carousel__slide'));
    const dots = Array.from(carousel.querySelectorAll('.carousel__dot'));
    const prev = carousel.querySelector('[data-carousel-prev]');
    const next = carousel.querySelector('[data-carousel-next]');
    let idx = 0;
    let timer;

    const go = (n) => {
      idx = (n + slides.length) % slides.length;
      slides.forEach((s, i) => s.classList.toggle('is-active', i === idx));
      dots.forEach((d, i) => {
        d.classList.toggle('is-active', i === idx);
        d.setAttribute('aria-pressed', i === idx ? 'true' : 'false');
      });
    };
    const start = () => {
      stop();
      timer = setInterval(() => go(idx + 1), 7000);
    };
    const stop = () => { if (timer) clearInterval(timer); };

    dots.forEach((d, i) => d.addEventListener('click', () => { go(i); start(); }));
    prev && prev.addEventListener('click', () => { go(idx - 1); start(); });
    next && next.addEventListener('click', () => { go(idx + 1); start(); });

    carousel.addEventListener('mouseenter', stop);
    carousel.addEventListener('mouseleave', start);

    go(0);
    start();
  }
})();
