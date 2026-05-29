// Product page Tweaks
// Surfaces font family, accent color, and headline weight as live tweaks.
// Defaults to Segoe UI per user request; brand Montserrat is still available.

const FONT_MAP = {
  segoeui: '"Segoe UI", system-ui, -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif',
  montserrat: '"Montserrat", system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  system: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
};

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "fontFamily": "segoeui",
  "accent": "#F39235",
  "headingWeight": 700
}/*EDITMODE-END*/;

function applyTweaks(t) {
  const root = document.documentElement;
  root.style.setProperty('--font-sans', FONT_MAP[t.fontFamily] || FONT_MAP.segoeui);
  root.style.setProperty('--dh-orange', t.accent);
  // Accent rolls through several derived tokens:
  root.style.setProperty('--fg-accent', t.accent);
  root.style.setProperty('--link', t.accent);
  // Heading weight applies to all h1-h6 via a single var consumed in inline rule
  root.style.setProperty('--tweak-heading-weight', String(t.headingWeight));
}

// Heading weight override — added once
(function injectHeadingRule() {
  if (document.getElementById('tweak-heading-rule')) return;
  const style = document.createElement('style');
  style.id = 'tweak-heading-rule';
  style.textContent = `
    h1, h2, h3, .promise__line, .hero h1, .page-hero h1,
    .feature-row__copy h2, .connectors__head h2, .security__head h2,
    .notwhat__head h2, .bottom-cta h2 {
      font-weight: var(--tweak-heading-weight, 700);
    }
  `;
  document.head.appendChild(style);
})();

function ProductTweaksApp() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);

  React.useEffect(() => { applyTweaks(t); }, [t]);

  return (
    <TweaksPanel title="Tweaks">
      <TweakSection label="Typography" />
      <TweakRadio
        label="Font family"
        value={t.fontFamily}
        options={['segoeui', 'montserrat', 'system']}
        onChange={(v) => setTweak('fontFamily', v)}
      />
      <TweakRadio
        label="Heading weight"
        value={t.headingWeight}
        options={[
          { value: 500, label: 'Medium' },
          { value: 700, label: 'Bold' },
        ]}
        onChange={(v) => setTweak('headingWeight', v)}
      />

      <TweakSection label="Color" />
      <TweakColor
        label="Accent"
        value={t.accent}
        options={['#F39235', '#FAB400', '#193359', '#D87A1F']}
        onChange={(v) => setTweak('accent', v)}
      />
    </TweaksPanel>
  );
}

// Mount the tweaks app (runs even before edit mode is activated;
// TweaksPanel handles its own visibility via the host protocol).
(function mountTweaks() {
  // Apply defaults immediately so page renders in Segoe UI before React mounts.
  applyTweaks(TWEAK_DEFAULTS);

  const mountNode = document.createElement('div');
  mountNode.id = 'tweaks-root';
  document.body.appendChild(mountNode);
  ReactDOM.createRoot(mountNode).render(<ProductTweaksApp />);
})();
