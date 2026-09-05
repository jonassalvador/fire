// iOS Safari only evaluates :active styles on elements while a touch
// listener exists somewhere in the document — without one, tapping a tab or
// switch never shows the press-scale feedback at all (the CSS is correct,
// the pseudo-class just never activates). The listener itself does nothing;
// its mere presence is what turns :active on.
document.addEventListener('touchstart', () => {}, { passive: true });

// Pinch- and double-tap-zoom are both already blocked by the viewport meta
// tag's own maximum-scale=1/user-scalable=no (see index.html) — a JS-based
// gesturestart/multi-touch-touchmove alternative was tried here for a
// while, on the theory that the meta tag's own zoom lock was what killed
// the page's native scroll bounce. It wasn't: bounce turned out to be
// missing only in this tool's own preview (confirmed by testing the live
// site directly in real Safari and Chrome, where the meta-tag version
// bounces fine) — so the simpler meta-tag-only approach is back, with
// nothing extra needed here.

// ---------- DOM refs ----------

const els = {};
document.querySelectorAll('input, select').forEach(el => els[el.id] = el);
document.querySelectorAll('output').forEach(el => els[el.id] = el);

// Collapsible field-groups (Tillväxt & inflation, Skatter) — closed by
// default (per the HTML's lack of an initial .is-open class); the chevron's
// rotation is driven purely by aria-expanded in CSS, so this just needs to
// flip that and the content's .is-open class together. .is-open (not the
// `hidden` attribute) is what actually animates the section open/closed —
// see .field-group__content's grid-template-rows transition in style.css.
document.querySelectorAll('.field-group__header').forEach(header => {
  header.addEventListener('click', () => {
    // The section's height keeps changing for the whole 0.3s
    // grid-template-rows transition (see .field-group__content in
    // style.css) — confirmed directly that this can drag the page's
    // scroll position along with it (measured window.scrollY moving by
    // over 100px on its own while scrolled down, even with scroll
    // anchoring disabled below). A single correction right after the
    // click isn't enough, since the drift can appear partway through the
    // animation, not just at the moment it starts — so this re-pins the
    // scroll position every frame for the whole transition instead of
    // just once, and stops once it's done so it never fights a real,
    // deliberate scroll afterward.
    const scrollX = window.scrollX, scrollY = window.scrollY;
    const expanded = header.getAttribute('aria-expanded') === 'true';
    header.setAttribute('aria-expanded', String(!expanded));
    document.getElementById(header.getAttribute('aria-controls')).classList.toggle('is-open', !expanded);
    // this specific toggle has no other recalculate() call following it
    // (unlike every switch-driven reveal elsewhere) to otherwise trigger
    // this on its own.
    updateSliderThumbVisuals();

    const start = performance.now();
    function pinScroll(now) {
      if (window.scrollX !== scrollX || window.scrollY !== scrollY) window.scrollTo(scrollX, scrollY);
      if (now - start < 350) requestAnimationFrame(pinScroll);
    }
    requestAnimationFrame(pinScroll);
  });
});

let currentMode = 'need';
const modesNav = document.querySelector('.modes');
const modesIndicator = document.querySelector('.modes__indicator');
const modeTabs = document.querySelectorAll('.modes__tab');
const modeFields = document.querySelectorAll('[data-modes]');

// Sized/positioned from the currently active tab's own layout box —
// offsetLeft/offsetWidth are relative to .modes (the nearest positioned
// ancestor), and stay correct regardless of .modes' own horizontal scroll
// position on mobile, so no scroll-offset math is needed here.
function updateTabIndicator() {
  const activeTab = document.querySelector('.modes__tab.is-active');
  if (!activeTab || !modesIndicator) return;
  modesIndicator.style.width = `${activeTab.offsetWidth}px`;
  modesIndicator.style.transform = `translateX(${activeTab.offsetLeft}px)`;
}

// Each tab centers its label when it's one line, but top-aligns it the
// moment that specific tab's own label wraps to two+ lines — counting
// actual rendered line boxes (via a Range over the text) rather than
// comparing scrollHeight to line-height, since line-height often computes
// to the unresolved keyword "normal" rather than a pixel value. This is
// per tab, not a single shared flag, since tabs no longer stretch to a
// shared width (see .modes__tab in style.css) and so can wrap
// independently of one another.
function updateTabWrapping() {
  modeTabs.forEach(tab => {
    const label = tab.querySelector('.modes__label');
    if (!label) return;
    const range = document.createRange();
    range.selectNodeContents(label);
    tab.classList.toggle('is-wrapped', range.getClientRects().length > 1);
  });
}

// .modes sits at position:sticky/top:0, so it reports the same
// getBoundingClientRect() at top:0 whether it's genuinely pinned with
// content scrolling in behind it or just passing through that same spot in
// its normal, non-stuck document position — there's no property on .modes
// itself to tell the two apart. The sentinel above it (a zero-height div in
// normal flow, right where .modes would sit if it weren't sticky) gives an
// unambiguous signal instead: once the sentinel scrolls above the viewport,
// .modes can only still be visible at top:0 because it's now actually
// pinned there.
const modesSentinel = document.querySelector('.modes__sentinel');
if (modesSentinel && 'IntersectionObserver' in window) {
  new IntersectionObserver(
    ([entry]) => modesNav.classList.toggle('is-stuck', !entry.isIntersecting && entry.boundingClientRect.top < 0),
    { threshold: 0 }
  ).observe(modesSentinel);
}

// tab widths (and so wrapping and indicator position alike) can change on
// viewport resize or once the label font swaps in.
function updateTabLayout() {
  updateTabWrapping();
  updateTabIndicator();
}
window.addEventListener('resize', updateTabLayout);
if (document.fonts && document.fonts.ready) {
  document.fonts.ready.then(updateTabLayout);
}

// track width/position (and so every slider thumb visual's x/y) can change
// on resize, or once the label font swaps in and reflows a wrapped label
// above it — confirmed directly as a real, not just theoretical, gap: a
// field whose label happens to wrap to 3 lines shifted its slider down
// once the real font loaded, and with nothing re-running this after that
// point, the visual thumb stayed stuck at its pre-swap position (visibly
// well above the actual, now-lower track) for the rest of the page's
// life.
window.addEventListener('resize', () => updateSliderThumbVisuals());
if (document.fonts && document.fonts.ready) {
  document.fonts.ready.then(updateSliderThumbVisuals);
}

modeTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    currentMode = tab.dataset.mode;
    modeTabs.forEach(t => t.classList.toggle('is-active', t === tab));
    modeTabs.forEach(t => t.setAttribute('aria-selected', t === tab ? 'true' : 'false'));
    updateTabIndicator();
    updateVisibility();
    recalculate();
  });
});

function updateVisibility() {
  modeFields.forEach(el => {
    const modes = el.dataset.modes.split(' ');
    el.classList.toggle('mode-hidden', !modes.includes(currentMode));
  });
  updateReturnVisibility();
}


const capitalSplitFields = document.getElementById('capital-split-fields');

function updateReturnVisibility() {
  // Blandportfölj shows nothing extra here at all — it just reuses the plain
  // "Förväntad nominell avkastning: Blandportfölj" slider down in Avkastning,
  // same rate tab 1 uses. Egen fördelning always shows the same three
  // %-sliders, rebalanced back to that split every year.
  const isSplit = document.querySelector('input[name="capitalMode"]:checked').value === 'split';
  capitalSplitFields.classList.toggle('is-open', isSplit);

  // lengths matched (verified same line count on mobile and desktop) so
  // toggling the radio doesn't change this hint's height.
  const capitalModeHint = document.getElementById('capital-mode-hint');
  capitalModeHint.textContent = isSplit
    ? 'Du delar upp kapitalet i Aktier/fonder, Räntor och Sparkonto, med egen avkastning och skatt.'
    : `Generell blandportfölj: 60–70 % aktier, 30–40 % räntor, ${els.return.value} % förväntad avkastning nominellt.`;
}

document.querySelectorAll('input[name="capitalMode"]').forEach(radio => {
  radio.addEventListener('change', recalculate);
});

// "Vid vilken ålder vill du gå FIRE" and "Räkna till ålder" only matter for
// Die With Zero — a sustained-forever "Bevara kapitalet" target needs neither
// a start nor an end age, just the spend and the growth rate — so they're
// hidden whenever "Bevara kapitalet" is selected.
const dieWithZeroFields = document.getElementById('die-with-zero-fields');
const strategyHint = document.getElementById('strategy-hint');
document.querySelectorAll('input[name="strategy"]').forEach(radio => {
  radio.addEventListener('change', () => {
    const preserve = radio.value === 'preserve';
    dieWithZeroFields.classList.toggle('is-open', !preserve);
    strategyHint.textContent = preserve
      ? 'Kapitalet ska aldrig minska i värde — du lever bara på avkastningen, inte av grundplåten.'
      : 'Kapitalet får ta slut exakt vid din valda slutålder — du spenderar medvetet ner det till noll.';
    recalculate();
  });
});

const pensionFields = document.getElementById('pension-fields');
const pensionHint = document.getElementById('pension-hint');
document.querySelectorAll('input[name="pensionMode"]').forEach(radio => {
  radio.addEventListener('change', () => {
    const ignore = radio.value === 'ignore';
    pensionFields.classList.toggle('is-open', !ignore);
    pensionHint.textContent = ignore
      ? 'Beräkningen bygger enbart på ditt eget sparande — ingen pension räknas in, även om du faktiskt har rätt till det.'
      : 'Din allmänna pension och tjänstepension räknas in och minskar hur mycket du själv behöver ta ur ditt kapital.';
    recalculate();
  });
});

// "Hur mycket kan jag ta ut?" — waiting a few more years before actually
// withdrawing lets the capital (and, if you keep saving, new contributions)
// keep compounding first, so the sustainable withdrawal it supports later is
// higher than what the same capital supports today.
const withdrawWaitFields = document.getElementById('withdraw-wait-fields');
const withdrawTimingHint = document.getElementById('withdraw-timing-hint');
document.querySelectorAll('input[name="withdrawTiming"]').forEach(radio => {
  radio.addEventListener('change', () => {
    const wait = radio.value === 'wait';
    withdrawWaitFields.classList.toggle('is-open', wait);
    withdrawTimingHint.textContent = wait
      ? 'Kapitalet får växa och du fortsätter spara i ytterligare några år innan uttaget beräknas.'
      : 'Uttaget beräknas utifrån ditt kapital redan idag, utan att vänta eller spara mer.';
    recalculate();
  });
});

// ---------- Formatting ----------

function currencyMeta() {
  return { symbol: 'kr', locale: 'sv-SE' };
}

function fmtNumber(n) {
  const { locale } = currencyMeta();
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(Math.round(n));
}

function fmtMoney(n) {
  return `${fmtNumber(n)} ${currencyMeta().symbol}`;
}

// ---------- Capital allocation ----------
//
// Blandportfölj: a single bucket using the plain "Blandportfölj" rate/tax
// (same as tab 1) — no split to configure at all here.
//
// Egen fördelning: Aktier/fonder, Räntor and Sparkonto each have their own
// %-slider, always summing to 100 — rebalanced back to that %-split every
// year (see makeRebalancer()/getParams()).

let currentAllocation = { stocks: 1, bonds: 0, savings: 0 };

// Aktier/fonder (top) is the primary slider: dragging it rebalances Räntor
// and Sparkonto proportionally, in whatever ratio they already have to each
// other, to make room. Räntor and Sparkonto then trade directly with each
// other when either is dragged on its own, leaving Aktier/fonder untouched
// — what's above stays put; what's below absorbs the change.
function rebalanceAllocPct(changedKey) {
  const sliders = { stocks: els['alloc-stocks-pct'], bonds: els['alloc-bonds-pct'], savings: els['alloc-savings-pct'] };

  if (changedKey === 'stocks') {
    const stocks = Math.max(0, Math.min(+sliders.stocks.value, 100));
    sliders.stocks.value = stocks;
    const remainder = 100 - stocks;
    const otherSum = +sliders.bonds.value + +sliders.savings.value;

    ['bonds', 'savings'].forEach(k => {
      const share = otherSum > 0 ? (+sliders[k].value / otherSum) : 0.5;
      sliders[k].value = Math.max(0, Math.round(remainder * share));
    });

    // rounding can leave the total slightly off — absorb it into savings.
    const leftover = remainder - (+sliders.bonds.value + +sliders.savings.value);
    sliders.savings.value = Math.max(0, +sliders.savings.value + leftover);
  } else {
    const partnerKey = changedKey === 'bonds' ? 'savings' : 'bonds';
    const stocks = +sliders.stocks.value;
    const room = 100 - stocks;
    const changedValue = Math.max(0, Math.min(+sliders[changedKey].value, room));
    sliders[changedKey].value = changedValue;
    sliders[partnerKey].value = Math.max(0, room - changedValue);
  }
}

els['alloc-stocks-pct'].addEventListener('input', () => rebalanceAllocPct('stocks'));
els['alloc-bonds-pct'].addEventListener('input', () => rebalanceAllocPct('bonds'));
els['alloc-savings-pct'].addEventListener('input', () => rebalanceAllocPct('savings'));

function updateAllocationDisplay() {
  const isSplit = document.querySelector('input[name="capitalMode"]:checked').value === 'split';
  const totalCapital = +els['total-capital'].value;
  let stocks, bonds, savings; // kr, always — used for currentAllocation and the blended rate below

  if (!isSplit) {
    // Blandportfölj — treated as one bucket using the Blandportfölj rate,
    // same as tab 1's model (see getParams()).
    stocks = totalCapital;
    bonds = 0;
    savings = 0;
  } else {
    const stocksPct = +els['alloc-stocks-pct'].value;
    const bondsPct = +els['alloc-bonds-pct'].value;
    const savingsPct = +els['alloc-savings-pct'].value;
    stocks = totalCapital * stocksPct / 100;
    bonds = totalCapital * bondsPct / 100;
    savings = totalCapital * savingsPct / 100;

    els['out-alloc-stocks-pct'].textContent = stocksPct;
    els['out-alloc-bonds-pct'].textContent = bondsPct;
    els['out-alloc-savings-pct'].textContent = savingsPct;
    document.getElementById('alloc-stocks-pct-hint').textContent = `Motsvarar ${fmtNumber(stocks)} kr.`;
    document.getElementById('alloc-bonds-pct-hint').textContent = `Motsvarar ${fmtNumber(bonds)} kr.`;
    document.getElementById('alloc-savings-pct-hint').textContent = `Motsvarar ${fmtNumber(savings)} kr.`;
  }

  const total = stocks + bonds + savings;

  els['out-return-stocks'].textContent = els['return-stocks'].value;
  els['out-return-bonds'].textContent = els['return-bonds'].value;
  els['out-return-savings'].textContent = els['return-savings'].value;

  // A 0 kr "Totalt investerat kapital" collapses stocks/bonds/savings (all
  // literal kr amounts) to 0/0/0 too, which would otherwise wipe out the
  // split you actually chose — the %-sliders still define a real ratio even
  // at 0 kr, so read the ratio straight from them instead of from the (now
  // zeroed) kr amounts.
  if (total > 0) {
    currentAllocation = { stocks: stocks / total, bonds: bonds / total, savings: savings / total };
  } else if (!isSplit) {
    currentAllocation = { stocks: 1, bonds: 0, savings: 0 };
  } else {
    currentAllocation = {
      stocks: +els['alloc-stocks-pct'].value / 100,
      bonds: +els['alloc-bonds-pct'].value / 100,
      savings: +els['alloc-savings-pct'].value / 100,
    };
  }

  // "Blandad avkastning" — only shown inside Egen fördelning (Blandportfölj
  // already shows its own rate via capital-mode-hint above) — the single
  // nominal rate your chosen split works out to overall, weighted by each
  // bucket's own share, computed from currentAllocation itself (not the raw
  // kr amounts) so it stays correct even at 0 kr.
  if (isSplit) {
    const blendedReturn = currentAllocation.stocks * (+els['return-stocks'].value)
      + currentAllocation.bonds * (+els['return-bonds'].value)
      + currentAllocation.savings * (+els['return-savings'].value);
    document.getElementById('blended-return-hint').textContent =
      `Blandad avkastning: ${blendedReturn.toFixed(1).replace('.', ',')} % nominellt, givet din fördelning ovan.`;
  }
}

// The one "Totalt kapital" slider, split across the three buckets by their
// current allocation share (100/0/0 for "samlat kapital").
function computeStartBuckets() {
  const total = +els['total-capital'].value;
  return {
    stocks: total * currentAllocation.stocks,
    bonds: total * currentAllocation.bonds,
    savings: total * currentAllocation.savings,
  };
}

// Playful FIRE-nivå labels for "Önskad månadskonsumtion efter skatt" — purely descriptive,
// doesn't feed into any calculation. Ranges are inclusive of their lower bound;
// the top bucket also covers anything above 150 000 kr should the slider's
// max ever change.
// Description lengths are deliberately matched to each other (verified to
// render as the same number of lines on both mobile and desktop widths) —
// otherwise dragging "Önskad månadskonsumtion" across a level boundary
// changes this hint's height and pushes the rest of the form up or down.
const FIRE_LEVELS = [
  { min: 5000, name: 'Barista FIRE', desc: 'Portföljen täcker en liten bas — du jobbar fortfarande deltid för att klara dig.' },
  { min: 10000, name: 'Lean FIRE', desc: 'Helt fri, men minimalistiskt: bara mat, boende, absoluta måsten.' },
  { min: 15000, name: 'Slender FIRE', desc: 'Mellan fattigt och lagom — visst utrymme, men budgetera strikt.' },
  { min: 20000, name: 'Regular FIRE', desc: 'Motsvarar en genomsnittlig svensk nettoinkomst, utan ekonomisk stress.' },
  { min: 30000, name: 'Chubby FIRE', desc: 'Guldkant på tillvaron, med utrymme för resor och restauranger.' },
  { min: 40000, name: 'Fat FIRE', desc: 'Ren lyxnivå i Sverige, res i business class utan att titta på prislappen.' },
  { min: 60000, name: 'Obese FIRE', desc: 'Extremt hög levnadsstandard — ekonomin begränsar dig inte nämnvärt.' },
  { min: 100000, name: 'Whale FIRE', desc: 'Ekonomiskt oberoende på generationsnivå — klass med mångmiljonärer.' },
];

function fireLevelFor(spend) {
  let level = FIRE_LEVELS[0];
  for (const l of FIRE_LEVELS) {
    if (spend >= l.min) level = l;
  }
  return level;
}

// ---------- Slider thumb visual overlay ----------
// Real Mobile Safari has a well-documented, long-standing bug where a
// custom ::-webkit-slider-thumb clips its OWN box-shadow/filter to its own
// plain layout box — and unlike the usual ancestor-overflow clipping this
// project has fixed elsewhere with bleed margins, nothing done TO the
// thumb itself ever stopped it: neither switching box-shadow for filter,
// nor growing the room available well past it, nor removing a transform
// suspected of promoting it onto its own layer (all tried, all reported
// back as still clipped). That points at something more basic than a CSS
// property on the native thumb can fix — iOS appears to always composite
// a native form control's pseudo-element through its own fixed-size
// internal buffer, clipping anything painted past its own bounds no
// matter what. The only reliable way around a native-control rendering
// limit like that is to stop drawing on the native control at all: the
// real thumb (below) becomes fully invisible but keeps its real size, so
// the actual drag hit-area is unchanged, and this plain sibling <span> is
// drawn on top instead, positioned here in JS to track it exactly. A
// plain span isn't a native control, so its box-shadow can't hit this bug
// — and it's still subject to ordinary, well-behaved ancestor
// overflow:hidden clipping, so the bleed margins already in place for
// that (see .field-group__content-inner/.expand-collapse-inner) can
// finally do their job for the shadow too.
document.querySelectorAll('.field input[type="range"]').forEach(input => {
  const visual = document.createElement('span');
  visual.className = 'slider-thumb-visual';
  visual.setAttribute('aria-hidden', 'true');
  visual.innerHTML = '<span class="slider-thumb-visual__dot"></span>';
  input.insertAdjacentElement('afterend', visual);
});

// A native thumb's CENTER travels the track's full width — at min, the
// center sits at the track's own left edge, so the thumb's left HALF
// overflows past it (and the mirror image at max) — which is exactly what
// the real, invisible thumb this visual sits on top of still does. Drawn
// as-is, the visible dot would bleed into the card's side padding at
// either end the same way (reported back as looking wrong: "the handle
// sticks outside of the slider area"). Since this dot is a plain span,
// not bound to that native behavior at all, it's free to use an INSET
// model instead — its own center travels only the track width minus one
// full thumb diameter, so its edges land exactly on the track's own ends
// at min/max instead of past them. updateSliderFills() below insets its
// fill percentage to match, so the color boundary still meets the dot
// exactly rather than running past it.
function getThumbRadius(input) {
  const field = input.closest('.field');
  return parseFloat(getComputedStyle(field).getPropertyValue('--thumb-size')) / 2;
}

// Positioned in the same coordinate space .field itself establishes (see
// its position:relative in style.css). No transition on left/top: a
// dragged thumb has to track the finger 1:1, not ease toward it.
function updateSliderThumbVisuals() {
  document.querySelectorAll('.field input[type="range"]').forEach(input => {
    const visual = input.nextElementSibling;
    if (!visual || !visual.classList.contains('slider-thumb-visual')) return;
    // hidden (a closed section, or a mode-hidden field on another tab) —
    // getBoundingClientRect() would read all zeros; skip rather than
    // snapping the visual to a wrong position it'd otherwise show
    // instantly once revealed.
    if (input.offsetParent === null) return;
    const field = input.closest('.field');
    const fieldRect = field.getBoundingClientRect();
    const inputRect = input.getBoundingClientRect();
    const min = +input.min || 0, max = +input.max || 100, val = +input.value;
    const pct = max > min ? (val - min) / (max - min) : 0;
    const radius = getThumbRadius(input);
    const x = inputRect.left - fieldRect.left + radius + pct * (inputRect.width - 2 * radius);
    visual.style.left = `${x}px`;
    visual.style.top = `${inputRect.top - fieldRect.top + inputRect.height / 2}px`;
  });
}

// A native range input jumps straight to wherever you press, then drags
// from there — precise with a mouse, but a finger is wide enough that a
// touch meant to grab-and-adjust from the current value often lands a
// little off and yanks the value with it. Worse, that jump turned out to
// still be reachable on touch even with a full relative-drag replacement
// in place and reattached to window for reliability (reported back as
// still happening occasionally) — some path back to the native
// jump-then-drag was evidently still open on a real device this tool
// can't fully reproduce or rule out. Rather than keep chasing that,
// touches (event.pointerType — a mouse or pen press is untouched, since a
// jump-to-click is exactly the precise, expected behavior there) now
// split into two kinds that are each individually incapable of ever
// producing a jump, instead of one kind that's supposed to avoid it:
// starting the touch ON the handle itself drags it, by feel, exactly as
// before; starting anywhere else on the track nudges the value by exactly
// one step toward that side and does nothing else — never an absolute
// position, so there's no jump left to happen either way.
function snapToStep(value, min, max, step) {
  const stepped = min + Math.round((value - min) / step) * step;
  // step is sometimes fractional (0.1, 0.25) — round off the float noise
  // that dividing/multiplying by those introduces (e.g. 0.30000000000000004)
  // to whatever precision the step itself is expressed in.
  const decimals = (String(step).split('.')[1] || '').length;
  return Math.min(max, Math.max(min, +stepped.toFixed(decimals)));
}

document.querySelectorAll('.field input[type="range"]').forEach(input => {
  // Two extra, purely defensive layers against the same jump reappearing
  // yet again after tapping fast or dragging into a scroll — both a sign
  // that some native default action is still reaching the input, later
  // and through a different path than the pointerdown this all runs from.
  // preventDefault() on a touch-sourced pointerdown is supposed to also
  // suppress the compatibility mouse events (mousedown/click) a browser
  // fires afterward for the same touch, and Safari specifically still
  // dispatches the older, separate Touch Events (touchstart etc.)
  // alongside Pointer Events for the same physical touch, each with its
  // own independent default action — either one not actually being
  // suppressed here would look exactly like this: fine most of the time,
  // then an occasional native jump slips through anyway. Not verifiable
  // on a real device from here, so this errs toward blocking defaults
  // more aggressively than assuming pointerdown's own preventDefault was
  // enough on every engine.
  input.addEventListener('touchstart', e => e.preventDefault(), { passive: false });
  let touchGuardActive = false;
  function guardAgainstCompatibilityEvent(e) {
    if (!touchGuardActive) return;
    e.preventDefault();
    e.stopPropagation();
  }
  input.addEventListener('mousedown', guardAgainstCompatibilityEvent);
  input.addEventListener('click', guardAgainstCompatibilityEvent);

  // tracks the in-progress drag's own window listeners, if any, so a new
  // touch can forcibly tear down a previous one that never cleaned up
  // after itself — see the pointerdown handler below for why that can
  // happen and what it looks like when it does.
  let endActiveDrag = null;

  input.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'touch') return;
    // if a previous drag's own pointerup/pointercancel never fired —
    // plausible under fast repeated taps, or a drag that gets interrupted
    // mid-gesture by the page attempting to scroll instead — its onMove/
    // onUp closures stay attached to window forever, each still watching
    // for its own original pointerId. Touch pointerIds can get reused for
    // a later, entirely new touch, and if that happens, the stale
    // listener fires anyway, moving the value by a delta measured against
    // its own long-stale start position instead of this new touch's real
    // one — which looks exactly like an unexplained jump, and was
    // reported back as still happening after this same bug's more likely
    // causes (native compatibility events) were already guarded against.
    // Tearing down whatever the previous gesture left behind before this
    // one starts anything of its own closes that off regardless of
    // whether that theory is actually what's happening on a real device.
    if (endActiveDrag) {
      endActiveDrag();
      endActiveDrag = null;
    }
    e.preventDefault(); // stop the native jump-to-touch-point
    // armed for a short window after every touch pointerdown (see the two
    // listeners and their own comment above) — self-clears either the
    // moment a compatibility event actually shows up, or on this timeout
    // if none ever does, so it can never get stuck blocking some later,
    // genuinely unrelated interaction.
    touchGuardActive = true;
    setTimeout(() => { touchGuardActive = false; }, 500);
    // deliberately not calling input.focus() here (preventDefault also
    // suppresses the native focus a touch would otherwise cause) — tried
    // that, and a light blue focus ring started showing on every
    // touch-drag as a result. It's not just a matter of hiding that ring
    // conditionally either: it comes from :focus-visible matching a
    // script-called .focus() here just as much as it matches real
    // keyboard focus (checked directly), so there's no reliable way to
    // target "the ring from this specific call" and leave real keyboard
    // focus styling intact. Simplest fix is to just not focus the control
    // from a touch at all — genuine Tab-key focus (unrelated to this
    // handler) still works normally, and still gets a real indicator, on
    // the visible dot itself (see :focus-visible + .slider-thumb-visual in
    // style.css).

    const min = +input.min || 0, max = +input.max || 100, step = +input.step || 1;
    const inputRect = input.getBoundingClientRect();
    const val = +input.value;
    const pct = max > min ? (val - min) / (max - min) : 0;
    // the handle's own current center, recomputed fresh (not read from the
    // visual overlay's last-drawn position) using the exact same inset
    // formula updateSliderThumbVisuals() draws it with, so this always
    // agrees with wherever the handle is actually shown.
    const radius = getThumbRadius(input);
    const handleCenterX = inputRect.left + radius + pct * (inputRect.width - 2 * radius);
    // a bit more generous than the handle's own visible radius — a
    // fingertip is wider than it looks, and touch targets should be too.
    const grabRadius = radius + 10;

    if (Math.abs(e.clientX - handleCenterX) > grabRadius) {
      // tapped elsewhere on the track — one step toward that side, full
      // stop. No drag tracking starts from a tap like this at all.
      const next = snapToStep(val + (e.clientX > handleCenterX ? step : -step), min, max, step);
      if (next !== val) {
        input.value = next;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      return;
    }

    // best-effort — wrapped defensively since a pointerId the browser
    // doesn't recognize as an active pointer throws here (confirmed
    // directly: an uncaught NotFoundError from this exact call silently
    // skipped the rest of the handler below at the time, before move/up
    // were moved to window as they are now). Not load-bearing any more
    // either way (see below), so a failure here has nothing to cascade
    // into.
    try { input.setPointerCapture(e.pointerId); } catch {}

    const trackWidth = inputRect.width;
    const startValue = val;
    const startX = e.clientX;
    const pointerId = e.pointerId;

    // move/up listen on window, not input — confirmed directly this
    // matters: dragging off the input's own (6px-tall) box occasionally
    // left it not receiving pointermove/pointerup at all (pointer capture
    // not reliably keeping events routed there once the finger drifts far
    // enough vertically), so this handler's own move/up cleanup never ran
    // — leaving the touch's eventual release to fall through to the
    // browser's native default after all, jumping the value to wherever
    // the finger ended up. Listening on window instead means the drag
    // keeps working (and still ends cleanly) no matter where on screen the
    // finger actually is for the rest of the gesture; the pointerId check
    // keeps this from reacting to an unrelated second touch elsewhere on
    // the page in the meantime.
    function onMove(moveEvent) {
      if (moveEvent.pointerId !== pointerId) return;
      const deltaValue = ((moveEvent.clientX - startX) / trackWidth) * (max - min);
      const next = snapToStep(startValue + deltaValue, min, max, step);
      if (next !== +input.value) {
        input.value = next;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
    function cleanup() {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      endActiveDrag = null;
    }
    function onUp(upEvent) {
      if (upEvent.pointerId !== pointerId) return;
      cleanup();
    }
    endActiveDrag = cleanup;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  });
});

// Lysa-trial: paints each range input's own filled progress portion (in the
// accent gradient) up to its current value, with a hard cutoff to the plain
// track color right after — the reference artboard's `.track-fill`, done
// via a two-stop-at-the-same-position gradient trick since a native range
// input has no separate fill element to style. Re-run on every
// recalculate() (via syncDisplays() below) so it stays in sync with every
// slider, not just the one just dragged.
function updateSliderFills() {
  document.querySelectorAll('.field input[type="range"]').forEach(el => {
    const min = +el.min || 0, max = +el.max || 100, val = +el.value;
    const pct = max > min ? (val - min) / (max - min) : 0;
    // matches the visual thumb's own inset position (see
    // updateSliderThumbVisuals()) rather than the raw value percentage, so
    // the fill's color boundary meets the dot exactly instead of running
    // past it toward the track's true (un-inset) end.
    const radius = getThumbRadius(el);
    const trackWidth = el.getBoundingClientRect().width;
    const fillPct = trackWidth > 0 ? ((radius + pct * (trackWidth - 2 * radius)) / trackWidth) * 100 : 0;
    el.style.background = `linear-gradient(to right, var(--accent), var(--accent-end) ${fillPct}%, var(--rule) ${fillPct}%)`;
  });
}

// Same sliding-indicator pattern as updateTabIndicator() above, generalized
// to every .strategy-toggle on the page (there are several — capital mode,
// strategy, pension, withdraw-timing) — sized/positioned from whichever
// option is currently checked, so the fill visibly slides between options
// instead of each one fading its own background in/out independently.
function updateToggleIndicators() {
  document.querySelectorAll('.strategy-toggle').forEach(toggle => {
    // a toggle on a currently-hidden tab (e.g. "Gå i FIRE nu" on tabs 1-2)
    // has offsetParent === null, and offsetWidth/offsetLeft on anything
    // inside it read 0 — writing that through would corrupt the indicator
    // to width:0/translateX(0) while unseen, and since the transition is
    // always active, switching to that tab would then visibly animate it
    // from that stale 0 to its real position, even though nothing was
    // actually toggled. Skipping the write entirely while hidden leaves
    // whatever was last correctly measured in place, ready to reappear
    // instantly and already correct the moment the tab becomes visible.
    if (toggle.offsetParent === null) return;
    const indicator = toggle.querySelector('.strategy-toggle__indicator');
    const checkedOption = toggle.querySelector('.strategy-toggle__option:has(input:checked)');
    if (!indicator || !checkedOption) return;

    // the very first time this specific indicator is positioned — whether
    // it was visible from page load or this is its first reveal after
    // being hidden — it has no inline width/transform yet, so animating
    // from that blank state to the real one is the same kind of unwanted
    // "slides in on its own" motion the offsetParent check above prevents
    // for re-reveals, just showing up on the very first one instead.
    // Positioning it once with transitions off, then restoring them,
    // keeps every later real toggle animating normally.
    const firstTime = !indicator.dataset.positioned;
    if (firstTime) indicator.style.transition = 'none';
    indicator.style.width = `${checkedOption.offsetWidth}px`;
    indicator.style.transform = `translateX(${checkedOption.offsetLeft}px)`;
    if (firstTime) {
      indicator.offsetHeight; // force layout so the transition:none above is committed before it's removed
      indicator.style.transition = '';
      indicator.dataset.positioned = 'true';
    }
  });
}

// keep all range outputs and unit labels in sync
function syncDisplays() {
  const money = currencyMeta().symbol;
  els['out-age'].textContent = els.age.value;
  els['out-targetAge'].textContent = els.targetAge.value;
  els['out-spend'].textContent = fmtNumber(+els.spend.value);
  const fireLevel = fireLevelFor(+els.spend.value);
  document.getElementById('spend-hint').textContent = `${fireLevel.name} — ${fireLevel.desc}`;
  els['out-savings'].textContent = fmtNumber(+els.savings.value);
  els['out-waitYears'].textContent = els.waitYears.value;
  els['out-waitSavings'].textContent = fmtNumber(+els.waitSavings.value);
  els['out-total-capital'].textContent = fmtNumber(+els['total-capital'].value);
  els['out-return'].textContent = els.return.value;
  els['out-comparerate'].textContent = els.comparerate.value.replace('.', ',');
  els['out-lifespan'].textContent = els.lifespan.value;
  els['out-inflation'].textContent = els.inflation.value;
  els['out-pension1amount'].textContent = fmtNumber(+els.pension1amount.value);
  els['out-pension2amount'].textContent = fmtNumber(+els.pension2amount.value);
  els['out-pensionage'].textContent = els.pensionage.value;
  els['out-tax-isk-blend'].textContent = els['tax-isk-blend'].value.replace('.', ',');
  els['out-tax-isk-stocks'].textContent = els['tax-isk-stocks'].value.replace('.', ',');
  els['out-tax-bonds'].textContent = els['tax-bonds'].value.replace('.', ',');
  els['out-tax-savings'].textContent = els['tax-savings'].value;
  els['out-tax-pension1'].textContent = els['tax-pension1'].value;
  els['out-tax-pension2'].textContent = els['tax-pension2'].value;
  document.querySelectorAll('.field .unit').forEach(u => u.textContent = money);
  updateAllocationDisplay();
  updateSliderFills();
  updateToggleIndicators();
  updateSliderThumbVisuals();
}

// ---------- Simulation engine ----------

function getParams() {
  const useBuckets = currentMode !== 'need';

  const inflation = +els.inflation.value / 100;

  // discount a nominal rate by inflation to get a real one. A 0% inflation
  // slider is a no-op here, so there's no need for a separate on/off toggle.
  const toReal = nominal => (1 + nominal) / (1 + inflation) - 1;

  // Blandportfölj (tab 1's own simplified rate, below), Aktier/fonder and
  // Räntor are all assumed to sit in an ISK — schablonskatt, applied
  // annually on the account's full value, withdrawals then tax-free —
  // independently adjustable, they just happen to share the same 1% default.
  const BLEND_TAX = +els['tax-isk-blend'].value / 100;
  const STOCKS_TAX = +els['tax-isk-stocks'].value / 100;
  const BONDS_TAX = +els['tax-bonds'].value / 100;
  const SAVINGS_TAX = +els['tax-savings'].value / 100;

  // The simplified 100%-aktier model (tab 1, no buckets, no Kapital section
  // at all) always uses its own Blandportfölj rate — separate from the
  // Aktier/fonder-bucket rate used everywhere else.
  const simpleReal = (1 + toReal(+els.return.value / 100)) * (1 - BLEND_TAX) - 1;

  let growthRate = simpleReal;
  let stocksRate = simpleReal, bondsRate = simpleReal, savingsRate = simpleReal;
  const taxRate = 0; // every bucket here is ISK, so nothing is ever taxed at withdrawal

  if (useBuckets) {
    // ISK: schablonskatt on the account value every year, withdrawals then free.
    const iskGrowth = (nominal, tax) => (1 + toReal(nominal)) * (1 - tax) - 1;

    // "samlat kapital" (Blandportfölj) reuses the same rate and ISK tax as
    // tab 1; it's literally the same model, just also usable in tabs 2-4.
    // Only once you actually split into Egen fördelning does Aktier/fonder's
    // own rate and tax come into play.
    const isSplit = document.querySelector('input[name="capitalMode"]:checked').value === 'split';
    const stocksNominal = isSplit ? +els['return-stocks'].value : +els.return.value;
    const stocksTax = isSplit ? STOCKS_TAX : BLEND_TAX;
    stocksRate = iskGrowth(stocksNominal / 100, stocksTax);
    bondsRate = iskGrowth(+els['return-bonds'].value / 100, BONDS_TAX);

    // sparkonto: ränta beskattas löpande varje år som inkomst av kapital, so
    // unlike a schablonskatt-taxed bucket, the withdrawal itself is then
    // tax-free. The tax hits the nominal interest earned that year, so it's
    // applied before converting to a real rate — not after, unlike the ISK
    // buckets above, whose small ~1% rate doesn't meaningfully distort
    // things either way.
    const netNominalSavings = (+els['return-savings'].value / 100) * (1 - SAVINGS_TAX);
    savingsRate = toReal(netNominalSavings);

    growthRate = currentAllocation.stocks * stocksRate
      + currentAllocation.bonds * bondsRate
      + currentAllocation.savings * savingsRate;
  }

  // "Ignorera pension" zeroes the amounts here rather than reading the sliders
  // directly, so your configured pension stays put on the sliders (just not
  // applied) if you flip the switch back on later.
  const countPension = document.querySelector('input[name="pensionMode"]:checked').value === 'count';
  const pensionStartAge = +els.pensionage.value;
  // each pension has its own user-adjustable rate now (Skatter) — allmän and
  // tjänstepension are taxed as ordinary income, but not necessarily at the
  // same marginal rate as each other.
  const pensions = [
    { amount: countPension ? +els.pension1amount.value : 0, startAge: pensionStartAge, taxRate: +els['tax-pension1'].value / 100 },
    { amount: countPension ? +els.pension2amount.value : 0, startAge: pensionStartAge, taxRate: +els['tax-pension2'].value / 100 },
  ];

  // 'preserve' (Bevara kapitalet): must end with at least the starting balance.
  // 'die' (Die With Zero): no floor at all beyond simply not running out early.
  const strategy = document.querySelector('input[name="strategy"]:checked').value;

  return {
    growthRate,
    // per-bucket real rates, used by accumulate() so monthly savings can be
    // routed into the aktier/fonder bucket specifically while each bucket
    // still compounds at its own rate.
    stocksRate, bondsRate, savingsRate,
    taxRate, // always 0 — every bucket is ISK, taxed annually above, never at withdrawal
    pensions,
    lifespan: +els.lifespan.value,
    strategy,
  };
}

// The end-of-horizon bar a simulation has to clear, given the chosen strategy.
// `startBalance` is whatever balance is actually being tested (it varies
// during a binary search) — "preserve" needs it as the floor,
// "die" doesn't need a floor at all.
function meetsEndGoal(finalBalance, startBalance, params) {
  if (params.strategy === 'preserve') return finalBalance >= startBalance;
  return true; // 'die' — no floor beyond not running out early
}

// each pension is taxed as ordinary income at its own rate — separate from,
// and usually different than, the tax on withdrawals from the portfolio.
// Whether pension is being paid at this exact instant in time — a plain
// step at the birthday, no averaging. simulateBuckets() below is the one
// place a "year" can straddle a birthday (its starting age can be a
// fractional "blir redo" crossing), and it handles that by splitting the
// year into sub-periods at the birthday itself and evaluating this at each
// sub-period's own start — so the instant check here is all that's needed;
// there's never a fraction of a single pension left over to average.
function pensionNetIncomeAt(age, pensions) {
  return pensions.reduce((sum, p) => sum + (age >= p.startAge ? p.amount * (1 - p.taxRate) : 0), 0);
}

// Simulates yearly balance from startAge to lifespan given a monthly net spend target.
// Returns { path: [{age, balance}], failedAtAge: number|null }
function simulate(startBalance, startAge, monthlySpend, params) {
  const { growthRate, taxRate, pensions, lifespan } = params;
  let balance = startBalance;
  const path = [{ age: startAge, balance }];
  let failedAtAge = null;

  for (let age = startAge; age < lifespan; age++) {
    const pensionNet = pensionNetIncomeAt(age, pensions);
    const netGap = Math.max(0, monthlySpend - pensionNet);
    const grossMonthly = taxRate > 0 ? netGap / (1 - taxRate) : netGap;
    const annualWithdrawal = grossMonthly * 12;

    balance -= annualWithdrawal;
    if (balance < 0 && failedAtAge === null) {
      failedAtAge = age;
      balance = 0;
    }
    balance *= (1 + growthRate);
    path.push({ age: age + 1, balance: Math.max(0, balance) });
  }

  return { path, failedAtAge };
}

function succeeds(startBalance, startAge, monthlySpend, params) {
  const result = simulate(startBalance, startAge, monthlySpend, params);
  if (result.failedAtAge !== null) return false;
  const finalBalance = result.path[result.path.length - 1].balance;
  return meetsEndGoal(finalBalance, startBalance, params);
}

// Binary search for the minimum starting balance that survives to lifespan.
function solveRequiredBalance(monthlySpend, startAge, params) {
  let lo = 0, hi = monthlySpend * 12 * 100;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (succeeds(mid, startAge, monthlySpend, params)) hi = mid; else lo = mid;
  }
  return hi;
}

function bucketsTotal(b) { return b.stocks + b.bonds + b.savings; }

// The target split to rebalance back to every year, derived from whatever
// shape `buckets` itself started at — so "your chosen split" stays exactly
// that for the entire horizon, instead of silently drifting toward whichever
// bucket happens to compound fastest. Falls back to 100% aktier/fonder if
// there's no capital yet to derive a shape from (e.g. building up purely
// from monthly savings starting at zero) — same as the rest of the tool
// treats an empty portfolio elsewhere.
function bucketShape(buckets) {
  const total = bucketsTotal(buckets);
  return total > 0
    ? { stocks: buckets.stocks / total, bonds: buckets.bonds / total, savings: buckets.savings / total }
    : { stocks: 1, bonds: 0, savings: 0 };
}

// Returns a `total => {stocks, bonds, savings}` rebalancer that keeps the
// given starting `buckets`' own %-split — used by both Blandportfölj
// (a no-op single bucket) and Egen fördelning, so "your chosen split" stays
// exactly that for the entire horizon instead of drifting toward whichever
// bucket happens to compound fastest.
function makeRebalancer(buckets) {
  const shape = bucketShape(buckets);
  return total => ({ stocks: total * shape.stocks, bonds: total * shape.bonds, savings: total * shape.savings });
}

// Bucket-aware decumulation: tracks stocks/bonds/savings separately through
// every year of withdrawal, each compounding (and being drawn down) at its
// own rate, then rebalanced back to the original split at the end of the
// year — the same discipline an investor doing an annual rebalance would
// follow, so a bucket that outran the others doesn't quietly take over the
// whole portfolio over a multi-decade horizon. There's no withdrawal-time
// tax to account for here — every bucket is ISK or sparkonto, both already
// taxed annually above — so it's just proportional drawdown-by-allocation,
// same philosophy the rest of the tool uses elsewhere.
function simulateBuckets(startBuckets, startAge, monthlySpend, params) {
  const { stocksRate, bondsRate, savingsRate, pensions, lifespan } = params;
  let stocks = startBuckets.stocks, bonds = startBuckets.bonds, savings = startBuckets.savings;
  const rebalance = makeRebalancer(startBuckets);
  const path = [{ age: startAge, balance: stocks + bonds + savings }];
  let failedAtAge = null;

  for (let age = startAge; age < lifespan; age++) {
    // when startAge is fractional (a "blir redo" crossing rather than a
    // whole slider year), stepping by whole years from it can overshoot
    // lifespan by up to just under a year — clip the final iteration's own
    // "year" to end exactly at lifespan instead, so its balance is computed
    // over the true (shorter) remaining duration rather than a full year
    // that then gets its age label chopped back without reworking the
    // number itself, which used to read as a small kink right at the end.
    const yearEnd = Math.min(age + 1, lifespan);
    // split this year at any pension birthday strictly inside it — the
    // simulation's own starting age can be a fractional "blir redo"
    // crossing, so a birthday can land mid-step instead of exactly on a
    // step boundary. No pension for the sub-period before it, full pension
    // for the sub-period after, each compounding only over its own
    // (fractional) share of the year — averaging the whole year at one
    // blended rate instead reads as a small kink right at the birthday.
    // a birthday falls inside any *given* year at most once across the whole
    // horizon per pension, so most years have no split at all — building a
    // Set and sorting on every single year regardless was pure overhead in
    // the (overwhelmingly common) unsplit case, in what's the hottest inner
    // loop in the app (called by solveRequiredBalanceBuckets()'s own binary
    // search, itself called dozens of times per recalculate() in "ready"
    // mode). `pensions` only ever has a couple of entries, so a plain
    // include-check dedupes just as correctly without that overhead.
    let splitAges = [];
    for (const p of pensions) {
      if (p.startAge > age && p.startAge < yearEnd && !splitAges.includes(p.startAge)) splitAges.push(p.startAge);
    }
    const bounds = splitAges.length ? [age, ...splitAges.sort((a, b) => a - b), yearEnd] : [age, yearEnd];

    for (let s = 0; s < bounds.length - 1; s++) {
      const subStart = bounds[s], subYears = bounds[s + 1] - bounds[s];
      const pensionNet = pensionNetIncomeAt(subStart, pensions);
      const netGap = Math.max(0, monthlySpend - pensionNet);
      const total = stocks + bonds + savings;
      const subWithdrawal = netGap * 12 * subYears;

      if (subWithdrawal > total) {
        if (failedAtAge === null) failedAtAge = age;
        stocks = 0; bonds = 0; savings = 0;
      } else if (total > 0) {
        // withdraw proportionally across all three, same blended-by-allocation
        // philosophy the rest of the tool uses elsewhere.
        stocks = Math.max(0, stocks - subWithdrawal * (stocks / total));
        bonds = Math.max(0, bonds - subWithdrawal * (bonds / total));
        savings = Math.max(0, savings - subWithdrawal * (savings / total));
      }

      stocks *= Math.pow(1 + stocksRate, subYears);
      bonds *= Math.pow(1 + bondsRate, subYears);
      savings *= Math.pow(1 + savingsRate, subYears);

      // a birthday landing mid-step means the true turn from declining to
      // rising (or vice versa) happens at that exact age, not at either
      // whole-year mark either side of it — without a real plotted point
      // there, the chart just draws one straight line across the turn,
      // which reads as a small kink instead of a clean vertex.
      const subEnd = bounds[s + 1];
      if (subEnd !== yearEnd) path.push({ age: subEnd, balance: stocks + bonds + savings });
    }

    // annual rebalance back to the target %-split — once per full year (or
    // once at the very end of a final, clipped partial year), same as
    // always (not per sub-period).
    const rebalanced = stocks + bonds + savings;
    ({ stocks, bonds, savings } = rebalance(rebalanced));

    path.push({ age: yearEnd, balance: Math.max(0, stocks + bonds + savings) });
  }

  return { path, failedAtAge };
}

function succeedsBuckets(startBuckets, startAge, monthlySpend, params) {
  const result = simulateBuckets(startBuckets, startAge, monthlySpend, params);
  if (result.failedAtAge !== null) return false;
  const startBalance = bucketsTotal(startBuckets);
  const finalBalance = result.path[result.path.length - 1].balance;
  return meetsEndGoal(finalBalance, startBalance, params);
}

// Binary search for the max sustainable spend, scaling the given bucket mix
// proportionally up/down while searching, so every candidate keeps the same
// allocation shape as the real thing.
function solveMaxSpendBuckets(startBuckets, startAge, params) {
  const total = bucketsTotal(startBuckets);
  let lo = 0, hi = total;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (succeedsBuckets(startBuckets, startAge, mid, params)) lo = mid; else hi = mid;
  }
  return lo;
}

// Binary search for the minimum total capital — kept in the same bucket shape
// as `buckets` — that survives to lifespan. `iterations` defaults to full
// (kr-exact) precision; findFireAge() passes a lower one for the many
// intermediate sign-checks along its own outer bisection, where only the
// direction of the gap matters, not its exact value — that outer bisection
// re-halves the age range 30 times regardless, so it self-corrects for the
// inner solve's coarser precision on every one of those intermediate calls,
// converging to the same fractional age either way.
function solveRequiredBalanceBuckets(monthlySpend, startAge, buckets, params, iterations = 60) {
  // bucketShape() already handles an empty (all-zero) `buckets` the same way
  // accumulate()/simulateBuckets() do (100% Aktier/fonder) — using that same
  // fallback here, instead of a separate flat-rate one, keeps "what you'd
  // need today" consistent with what your future savings would actually be
  // invested as, rather than silently assuming a different mix.
  const shape = bucketShape(buckets);

  let lo = 0, hi = monthlySpend * 12 * 100;
  for (let i = 0; i < iterations; i++) {
    const mid = (lo + hi) / 2;
    const scaledBuckets = { stocks: shape.stocks * mid, bonds: shape.bonds * mid, savings: shape.savings * mid };
    if (succeedsBuckets(scaledBuckets, startAge, monthlySpend, params)) hi = mid; else lo = mid;
  }
  return hi;
}

// Looks up the balance at a given age along a path, clamped to the path's own
// range. Matches the nearest point rather than requiring an exact age match
// — every point used to sit at a whole-number age, but findFireAge()'s
// "blir redo" crossing point can now sit at a fractional one.
function capitalAtAge(path, age) {
  const minAge = path[0].age, maxAge = path[path.length - 1].age;
  const clamped = Math.min(maxAge, Math.max(minAge, age));
  let closest = path[0], closestDiff = Math.abs(closest.age - clamped);
  for (const p of path) {
    const diff = Math.abs(p.age - clamped);
    if (diff < closestDiff) { closest = p; closestDiff = diff; }
  }
  return closest.balance;
}

// Simulates the accumulation phase with the three buckets tracked separately —
// each compounds at its own rate, the monthly savings contribution is added
// to the aktier/fonder bucket, and then the whole thing is rebalanced back to
// the original split at the end of the year (same as simulateBuckets() does
// during decumulation) — so new savings landing in one bucket, and buckets
// compounding at different rates, don't quietly shift your actual allocation
// away from the split you chose. Returns a path of { age, balance, stocks,
// bonds, savings } — every consumer that only looks at .balance (= sum of the
// three) is unaffected; simulateBuckets() below uses the per-bucket
// breakdown to know each bucket's actual value once decumulation starts.
function accumulate(startBuckets, startAge, monthlySavings, params, maxAge) {
  let { stocks, bonds, savings } = startBuckets;
  const rebalance = makeRebalancer(startBuckets);
  const path = [{ age: startAge, balance: stocks + bonds + savings, stocks, bonds, savings }];
  for (let age = startAge; age < maxAge; age++) {
    stocks += monthlySavings * 12;
    stocks *= (1 + params.stocksRate);
    bonds *= (1 + params.bondsRate);
    savings *= (1 + params.savingsRate);

    // annual rebalance back to the target %-split.
    const total = stocks + bonds + savings;
    ({ stocks, bonds, savings } = rebalance(total));

    path.push({ age: age + 1, balance: stocks + bonds + savings, stocks, bonds, savings });
  }
  return path;
}

// Finds the first age at which accumulated savings meet the required FIRE number
// for retiring at that same age (reusing solveRequiredBalanceBuckets — the
// same bucket- and rebalance-mode-aware solver the rest of "ready" already
// uses for its caption — for each candidate age, scaled to that point's own
// actual stocks/bonds/savings shape rather than a single flat blended rate).
//
// accumulate() only checks once a year, so the year readiness is actually
// crossed can leave the balance sitting anywhere up to a full year's growth
// above the requirement — purely an artifact of which month within that
// year the crossing happened to fall, not a real difference in outcome. Left
// uncorrected, that arbitrary "overshoot" then compounds for the rest of the
// horizon under Bevara kapitalet, which can make two rebalance modes look
// very different at the end age even though neither is actually doing
// better — see the linear interpolation below, which finds the fractional
// point within that year where balance ≈ required and starts decumulation
// from there instead, while still reporting the same whole-number age.
function findFireAge(startBuckets, startAge, monthlySavings, monthlySpend, params, maxAge) {
  const accPath = accumulate(startBuckets, startAge, monthlySavings, params, maxAge);

  // retiring with zero years left before the end age isn't meaningful
  // readiness — a 0-year decumulation window always trivially "succeeds"
  // (nothing left to fund), so solveRequiredBalanceBuckets would return ~0
  // here regardless of actual capital, falsely reporting "redo" right at the
  // very end age no matter how insufficient the capital really is. accPath's
  // very last point sits exactly at maxAge, so it's never a valid candidate.
  const lastCandidate = accPath.length - 2;
  if (lastCandidate < 1) return null;

  // 30 iterations already gives sub-kr precision on a range this size — this
  // only ever feeds a boolean (is this year ready, yes/no), so there's
  // nothing to gain from the default's full 60, only more calls to pay for
  // in what's by far the hottest path in "ready" mode.
  const isReady = i => {
    const point = accPath[i];
    const required = solveRequiredBalanceBuckets(monthlySpend, point.age, point, params, 30);
    return point.balance >= required;
  };

  // Capital only ever grows while the pension "bridge" required only ever
  // shrinks as retirement age approaches, so once a candidate year is ready
  // every later one stays ready too — same assumption the old walk already
  // relied on (it never re-checked later years either, it just stopped at
  // the first hit). That old walk — one solveRequiredBalanceBuckets() call
  // per accumulated year up to the crossing — used to be the single biggest
  // cost in "ready" mode, re-run in full on every slider drag.
  //
  // A plain bisection over the whole range fixes the "far off" case (it
  // costs O(log n) regardless of how many years out the crossing is) but
  // actually makes the common case worse: most people testing "when am I
  // ready" are already fairly close, and a walk that stops after only a few
  // years is cheaper than always paying O(log n) over the entire horizon.
  // Probing at doubling distances from today, then bisecting only the range
  // that doubling landed in, gets the best of both — a close crossing is
  // still found in just a couple of calls, like the walk always managed,
  // while a far-off one still costs only O(log k) instead of O(k).
  if (!isReady(lastCandidate)) return null;

  let probe = 1;
  while (probe < lastCandidate && !isReady(probe)) probe *= 2;
  let hi = Math.min(probe, lastCandidate);
  let lo = Math.floor(hi / 2);
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (isReady(mid)) hi = mid; else lo = mid + 1;
  }
  const i = lo;
  const point = accPath[i];
  const prevPoint = accPath[i - 1];

  // accumulate() only checks once a year, so the year readiness is actually
  // crossed can leave the balance sitting anywhere up to a full year's
  // growth above the requirement — an artifact of which month within that
  // year the crossing happened to fall, not a real difference in outcome.
  // Left uncorrected, that arbitrary "overshoot" then compounds for the rest
  // of the horizon under Bevara kapitalet, and a tiny slider nudge that
  // flips which whole year you cross in can make the reported outcome swing
  // wildly.
  //
  // The required threshold itself can also move within that same year —
  // with pension counted in, retiring one year later needs less bridge
  // capital, so `required` can be dropping while `balance` is rising. Rather
  // than approximate both as straight lines (which doesn't hold up well —
  // the true relationship compounds, it doesn't move linearly), bisect
  // directly for the fractional age where capital (linearly interpolated
  // between these two known accumulation points — the only two data points
  // actually available) exactly matches the ACTUAL required balance solved
  // fresh at that same fractional age, now that pensionNetIncomeAt() can
  // prorate a birthday landing mid-step instead of only ever seeing whole
  // years.
  const shape = bucketShape(point);
  const capitalAt = age => prevPoint.balance + (age - prevPoint.age) * (point.balance - prevPoint.balance);
  const bucketsAt = age => {
    const bal = capitalAt(age);
    return { age, balance: bal, stocks: shape.stocks * bal, bonds: shape.bonds * bal, savings: shape.savings * bal };
  };
  // same reasoning as isReady() above — this only feeds the sign check the
  // outer 30-step bisection below uses to pick a direction, and that outer
  // bisection re-halves the age range regardless, so it converges to the
  // same fractional age either way.
  const gapAt = age => capitalAt(age) - solveRequiredBalanceBuckets(monthlySpend, age, bucketsAt(age), params, 30);

  let loAge = prevPoint.age, hiAge = point.age;
  for (let iter = 0; iter < 30; iter++) {
    const mid = (loAge + hiAge) / 2;
    if (gapAt(mid) >= 0) hiAge = mid; else loAge = mid;
  }
  const crossing = bucketsAt(hiAge);
  return { age: point.age, required: crossing.balance, path: accPath.slice(0, i).concat([crossing]) };
}

// ---------- Chart ----------

const svg = document.getElementById('chart');
const NS = 'http://www.w3.org/2000/svg';
const tooltip = document.getElementById('chart-tooltip');

const W = 640, H = 280;
const PAD_LEFT = 64, PAD_RIGHT = 8, PAD_TOP = 10, PAD_BOTTOM = 8;

// current chart's scale + data, kept around so the hover handler can reuse it
let chartScale = null;

function niceMoneyLabel(n) {
  const { symbol, locale } = currencyMeta();
  if (n >= 1000000) {
    return `${(n / 1000000).toLocaleString(locale, { maximumFractionDigits: 1 })} M${symbol}`;
  }
  return fmtMoney(n);
}

function drawChart(path, failedAtAge) {
  svg.innerHTML = '';
  // A little headroom above the actual peak — without it, a flat "Bevara
  // kapitalet" line sitting exactly at the max value lands right on the
  // topmost gridline (same y-position, same-ish color), reading as if the
  // line weren't drawn at all. Kept small on purpose: the line should still
  // reach right up to the top and read as touching/disappearing into it,
  // not float with visible daylight above it.
  const maxBalance = Math.max(...path.map(p => p.balance), 1) * 1.015;
  const minAge = path[0].age, maxAge = path[path.length - 1].age;

  const x = age => PAD_LEFT + (age - minAge) / (maxAge - minAge || 1) * (W - PAD_LEFT - PAD_RIGHT);
  const y = balance => H - PAD_BOTTOM - (balance / maxBalance) * (H - PAD_TOP - PAD_BOTTOM);

  chartScale = { path, x, y, minAge, maxAge, maxBalance };

  // y-axis gridlines + value labels
  const tickCount = 4;
  for (let i = 0; i <= tickCount; i++) {
    const value = (maxBalance / tickCount) * i;
    const yPos = y(value);

    const grid = document.createElementNS(NS, 'line');
    grid.setAttribute('x1', PAD_LEFT); grid.setAttribute('x2', W - PAD_RIGHT);
    grid.setAttribute('y1', yPos); grid.setAttribute('y2', yPos);
    grid.setAttribute('stroke', 'var(--rule)');
    grid.setAttribute('stroke-width', '1');
    svg.appendChild(grid);

    const label = document.createElementNS(NS, 'text');
    label.setAttribute('x', PAD_LEFT - 10);
    label.setAttribute('y', yPos);
    label.setAttribute('text-anchor', 'end');
    label.setAttribute('dominant-baseline', 'middle');
    label.setAttribute('font-family', 'var(--sans)');
    label.setAttribute('font-size', '10');
    label.setAttribute('fill', 'var(--ink-soft)');
    label.textContent = niceMoneyLabel(value);
    svg.appendChild(label);
  }

  // Lysa-trial: gradient stroke so the chart line picks up --accent-gradient
  // like the pill switches and field values, instead of a flat accent fill.
  // gradientUnits is explicitly userSpaceOnUse (plain chart-pixel
  // coordinates), not the SVG default objectBoundingBox (percentages of the
  // polyline's own bounding box) — a "Bevara kapitalet" balance that stays
  // exactly flat renders every point at the same y, collapsing the
  // polyline's bounding box to zero height, and the SVG spec says a
  // zero-width-or-height objectBoundingBox gradient simply isn't painted at
  // all — the line was rendering with a stroke that resolved to nothing,
  // not merely a wrong color (confirmed directly: getBBox() on the line
  // showed a real 568px width but exactly 0 height whenever the balance
  // curve was flat). userSpaceOnUse coordinates aren't tied to the
  // element's own bounding box, so this can't happen regardless of how
  // flat the line is.
  const defs = document.createElementNS(NS, 'defs');
  const lineGradient = document.createElementNS(NS, 'linearGradient');
  lineGradient.setAttribute('id', 'chart-line-gradient');
  lineGradient.setAttribute('gradientUnits', 'userSpaceOnUse');
  lineGradient.setAttribute('x1', PAD_LEFT); lineGradient.setAttribute('y1', 0);
  lineGradient.setAttribute('x2', W - PAD_RIGHT); lineGradient.setAttribute('y2', 0);
  const stop1 = document.createElementNS(NS, 'stop');
  stop1.setAttribute('offset', '0%');
  stop1.setAttribute('stop-color', 'var(--accent)');
  const stop2 = document.createElementNS(NS, 'stop');
  stop2.setAttribute('offset', '100%');
  stop2.setAttribute('stop-color', 'var(--accent-end)');
  lineGradient.appendChild(stop1);
  lineGradient.appendChild(stop2);
  defs.appendChild(lineGradient);
  svg.appendChild(defs);

  const linePoints = path.map(p => `${x(p.age)},${y(p.balance)}`).join(' ');
  const areaPoints = `${x(minAge)},${y(0)} ${linePoints} ${x(maxAge)},${y(0)}`;

  const area = document.createElementNS(NS, 'polygon');
  area.setAttribute('points', areaPoints);
  area.setAttribute('fill', 'var(--accent-soft)');
  svg.appendChild(area);

  const line = document.createElementNS(NS, 'polyline');
  line.setAttribute('points', linePoints);
  line.setAttribute('fill', 'none');
  line.setAttribute('stroke', 'url(#chart-line-gradient)');
  line.setAttribute('stroke-width', '3');
  svg.appendChild(line);

  if (failedAtAge !== null) {
    const dot = document.createElementNS(NS, 'circle');
    dot.setAttribute('cx', x(failedAtAge));
    dot.setAttribute('cy', y(0));
    dot.setAttribute('r', '5');
    dot.setAttribute('fill', 'var(--accent)');
    svg.appendChild(dot);

    const label = document.createElementNS(NS, 'text');
    label.setAttribute('x', x(failedAtAge));
    label.setAttribute('y', y(0) - 12);
    label.setAttribute('text-anchor', x(failedAtAge) > W - 80 ? 'end' : 'middle');
    label.setAttribute('font-family', 'var(--mono)');
    label.setAttribute('font-size', '11');
    label.setAttribute('fill', 'var(--accent)');
    label.textContent = `Slut vid ${failedAtAge} år`;
    svg.appendChild(label);
  }

  // hover marker, drawn last so it sits on top
  const hoverDot = document.createElementNS(NS, 'circle');
  hoverDot.setAttribute('id', 'chart-hover-dot');
  hoverDot.setAttribute('r', '4');
  hoverDot.setAttribute('fill', 'var(--ink)');
  hoverDot.setAttribute('visibility', 'hidden');
  svg.appendChild(hoverDot);

  // transparent overlay to catch mouse movement across the whole plot area
  const overlay = document.createElementNS(NS, 'rect');
  overlay.setAttribute('x', 0); overlay.setAttribute('y', 0);
  overlay.setAttribute('width', W); overlay.setAttribute('height', H);
  overlay.setAttribute('fill', 'transparent');
  overlay.addEventListener('mousemove', handleChartHover);
  overlay.addEventListener('mouseleave', hideChartHover);
  svg.appendChild(overlay);

  document.getElementById('chart-axis').innerHTML =
    `<span>${Math.round(minAge)} år</span><span>${Math.round(maxAge)} år</span>`;
}

function handleChartHover(evt) {
  if (!chartScale) return;
  const { path, x, y, minAge, maxAge } = chartScale;
  const rect = svg.getBoundingClientRect();
  const svgX = (evt.clientX - rect.left) / rect.width * W;

  const age = minAge + (svgX - PAD_LEFT) / (W - PAD_LEFT - PAD_RIGHT) * (maxAge - minAge);
  const clampedAge = Math.min(maxAge, Math.max(minAge, age));
  // nearest point rather than an exact age match — the "blir redo" crossing
  // point can sit at a fractional age, same reasoning as capitalAtAge().
  let point = path[0], closestDiff = Math.abs(point.age - clampedAge);
  for (const p of path) {
    const diff = Math.abs(p.age - clampedAge);
    if (diff < closestDiff) { point = p; closestDiff = diff; }
  }

  const hoverDot = document.getElementById('chart-hover-dot');
  hoverDot.setAttribute('cx', x(point.age));
  hoverDot.setAttribute('cy', y(point.balance));
  hoverDot.setAttribute('visibility', 'visible');

  tooltip.hidden = false;
  tooltip.textContent = `${Math.round(point.age)} år — ${fmtMoney(point.balance)}`;

  const wrapRect = svg.parentElement.getBoundingClientRect();
  const dotClientX = rect.left + (x(point.age) / W) * rect.width;
  const dotClientY = rect.top + (y(point.balance) / H) * rect.height;
  let left = dotClientX - wrapRect.left + 14;
  const top = dotClientY - wrapRect.top - 14;
  const maxLeft = wrapRect.width - tooltip.offsetWidth - 4;
  if (left > maxLeft) left = dotClientX - wrapRect.left - tooltip.offsetWidth - 14;
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

function hideChartHover() {
  const hoverDot = document.getElementById('chart-hover-dot');
  if (hoverDot) hoverDot.setAttribute('visibility', 'hidden');
  tooltip.hidden = true;
}

// ---------- Main recalculation ----------

function recalculate() {
  syncDisplays();
  updateReturnVisibility();

  const params = getParams();
  const age = +els.age.value;
  const money = currencyMeta().symbol;

  let headline, caption, eyebrow, chartResult, fireStartAge, comparisonText;
  const compareRate = +els.comparerate.value / 100;

  if (currentMode === 'need') {
    const targetAge = +els.targetAge.value;
    const spend = +els.spend.value;
    const required = solveRequiredBalance(spend, targetAge, params);
    chartResult = simulate(required, targetAge, spend, params);
    fireStartAge = targetAge;

    eyebrow = 'Du behöver';
    headline = fmtMoney(required);
    caption = `för att kunna gå FIRE vid ${targetAge} års ålder, med en konsumtion på ${fmtMoney(spend)}/månad i dagens pengar.`;
    comparisonText = fmtMoney(spend * 12 / compareRate);

  } else if (currentMode === 'ready') {
    // Three possible answers to "när är jag redo?": already ready today (no
    // more saving needed at all), ready at some future age (given the
    // savings rate below), or never within the chosen end age. The first
    // check is a plain decumulation-from-today readiness check (independent
    // of Månatligt sparande); the other two reuse the same forward search
    // that used to live in a separate "När når jag FIRE?" tab.
    const startBuckets = computeStartBuckets();
    const monthlySavings = +els.savings.value;
    const spend = +els.spend.value;
    const balance = bucketsTotal(startBuckets);
    const maxAge = params.lifespan;

    const nowResult = simulateBuckets(startBuckets, age, spend, params);
    const nowFinalBalance = nowResult.path[nowResult.path.length - 1].balance;
    const readyNow = nowResult.failedAtAge === null && meetsEndGoal(nowFinalBalance, balance, params);

    if (readyNow) {
      chartResult = nowResult;
      fireStartAge = age;
      eyebrow = 'Du är redo';
      headline = 'Nu.';
      caption = `Redan idag räcker kapitalet hela vägen till ${params.lifespan} år, med en konsumtion på ${fmtMoney(spend)}/månad.`;
    } else {
      const found = findFireAge(startBuckets, age, monthlySavings, spend, params, maxAge);

      if (found) {
        // continue the chart through retirement too, so the x-axis always
        // spans all the way to the end age, same as every other mode.
        const endBuckets = found.path[found.path.length - 1];
        // starts from the crossing's own (possibly fractional) age, not the
        // rounded-up found.age — pensionNetIncomeAt() prorates a birthday
        // landing mid-step, so this is now the one true continuous
        // simulation consistent with what findFireAge() actually solved
        // for, rather than a whole-year approximation of it.
        const decum = simulateBuckets(endBuckets, endBuckets.age, spend, params);
        chartResult = { path: found.path.concat(decum.path.slice(1)), failedAtAge: decum.failedAtAge };
        fireStartAge = found.age;
        eyebrow = 'Du blir redo';
        headline = `Om ${found.age - age} år`;
        // how much more capital you'd need right now to be ready today —
        // the actual bucket-aware required balance at your current age,
        // same shape as your real capital, not the flat estimate
        // findFireAge uses internally for its own search. Kept short (same
        // ballpark as the other two captions) so it never wraps past two
        // lines — just the shortfall and the age it resolves at.
        // shown rounded to whole kr, so the default's full 60-iteration
        // precision (sub-öre) buys nothing here either — see findFireAge()'s
        // isReady()/gapAt() for the same reasoning.
        const requiredNow = solveRequiredBalanceBuckets(spend, age, startBuckets, params, 30);
        const missingNow = Math.max(0, requiredNow - balance);
        caption = `Du saknar ${fmtMoney(missingNow)} idag — med ${fmtMoney(monthlySavings)}/månad i sparande når du dit vid ${found.age} års ålder.`;
      } else {
        chartResult = { path: accumulate(startBuckets, age, monthlySavings, params, maxAge), failedAtAge: null };
        fireStartAge = null;
        eyebrow = 'Blir aldrig redo';
        headline = 'Aldrig.';
        caption = `inte inom de kommande ${maxAge - age} åren (till ${maxAge} års ålder), med ${fmtMoney(monthlySavings)}/månad i sparande och en konsumtion på ${fmtMoney(spend)}/månad.`;
      }
    }

    // same three-way answer, against a flat withdrawal-rule threshold
    // (spend / rate) instead of the model's own required-balance/readiness
    // check above.
    const compareRequired = spend * 12 / compareRate;
    if (balance >= compareRequired) {
      comparisonText = 'Nu.';
    } else {
      const comparePath = accumulate(startBuckets, age, monthlySavings, params, maxAge);
      const comparePoint = comparePath.find(p => p.balance >= compareRequired);
      comparisonText = comparePoint ? `Om ${comparePoint.age - age} år` : 'Aldrig.';
    }

  } else {
    // 'withdraw'
    const startBuckets = computeStartBuckets();
    const balance = bucketsTotal(startBuckets);
    const willWait = document.querySelector('input[name="withdrawTiming"]:checked').value === 'wait';

    let spendBuckets = startBuckets;
    let spendStartAge = age;
    let accPath = null;

    if (willWait) {
      const waitYears = +els.waitYears.value;
      const waitSavings = +els.waitSavings.value;
      spendStartAge = age + waitYears;
      // reuses the exact same accumulation model "När är jag redo?" uses —
      // the capital (and any continued monthly savings) just keeps
      // compounding for these extra years before withdrawal starts.
      accPath = accumulate(startBuckets, age, waitSavings, params, spendStartAge);
      const grown = accPath[accPath.length - 1];
      spendBuckets = { stocks: grown.stocks, bonds: grown.bonds, savings: grown.savings };
    }

    const maxSpend = solveMaxSpendBuckets(spendBuckets, spendStartAge, params);
    const decum = simulateBuckets(spendBuckets, spendStartAge, maxSpend, params);
    // continue the chart through the wait years too, same as "När är jag
    // redo?" does for its own accumulation-then-decumulation path.
    chartResult = willWait ? { path: accPath.concat(decum.path.slice(1)), failedAtAge: decum.failedAtAge } : decum;
    fireStartAge = spendStartAge;

    eyebrow = 'Du kan ta ut';
    headline = `${fmtMoney(maxSpend)}/mån`;
    if (willWait) {
      // the "go now" figure isn't shown anywhere else once you flip to
      // "Vänta lite till", so the caption is the one place this comparison
      // — the whole point of the toggle — actually gets seen.
      const nowMaxSpend = solveMaxSpendBuckets(startBuckets, age, params);
      caption = `riskfritt varje månad från ${spendStartAge} års ålder, om du väntar ${els.waitYears.value} år till — jämfört med ${fmtMoney(nowMaxSpend)}/månad om du gick i FIRE redan idag.`;
    } else {
      caption = `riskfritt varje månad, i dagens pengar, utan att kapitalet tar slut före ${params.lifespan} års ålder.`;
    }

    // the flat-rule sanity check stays on the same timeframe as the headline
    // above it — today's balance when going now, the grown balance when
    // waiting — rather than always comparing against today's.
    const compareBalance = willWait ? bucketsTotal(spendBuckets) : balance;
    comparisonText = `${fmtMoney(compareBalance * compareRate / 12)}/mån`;
  }

  document.getElementById('result-eyebrow').textContent = eyebrow;
  document.getElementById('result-figure').textContent = headline;
  document.getElementById('result-caption').textContent = caption;
  document.getElementById('comparison-result').textContent = comparisonText;
  // keeps the floating answer pill (see .floating-answer in style.css) in
  // sync with whichever tab's actual result this is — it only ever shows
  // the eyebrow + headline, never the caption, so no separate branch is
  // needed here for that.
  document.getElementById('floating-answer-eyebrow').textContent = eyebrow;
  document.getElementById('floating-answer-figure').textContent = headline;

  // three consistent checkpoints, in every mode: capital when FIRE starts,
  // when pension kicks in, and at the end age — labels show the actual age.
  const pensionAgeSetting = +els.pensionage.value;
  // rounded for display — the rebased decumulation path (see above) can
  // leave the very last point sitting a fraction of a year off lifespan.
  const endAge = Math.round(chartResult.path[chartResult.path.length - 1].age);

  // "Vid X år" rather than "Kapital vid X år" — shortened per the
  // Lysa-trial reference artboard's `.stat-dt` ("Vid 40 år" etc.); amounts
  // below use niceMoneyLabel() (the same "X,X Mkr" abbreviation the chart's
  // own axis labels use) rather than the full kr figure, matching that
  // artboard's `.stat-dd` ("8,09 Mkr" etc.).
  document.getElementById('dt-lasts').textContent = fireStartAge !== null ? `Vid ${fireStartAge} år` : 'Vid FIRE';
  document.getElementById('stat-lasts').textContent =
    fireStartAge !== null ? niceMoneyLabel(capitalAtAge(chartResult.path, fireStartAge)) : '—';

  document.getElementById('dt-withdrawal').textContent = `Vid ${pensionAgeSetting} år`;
  document.getElementById('stat-withdrawal').textContent = niceMoneyLabel(capitalAtAge(chartResult.path, pensionAgeSetting));

  document.getElementById('dt-pension').textContent = `Vid ${endAge} år`;
  document.getElementById('stat-pension').textContent =
    niceMoneyLabel(chartResult.path[chartResult.path.length - 1].balance);

  drawChart(chartResult.path, chartResult.failedAtAge);
}

// ---------- Wire up live updates ----------

// Dragging a range slider can fire far more 'input' events than the browser
// actually paints frames — Safari in particular — so running the full
// recalculate() (chart redraw included) on every single one just piles up
// work the user never sees a frame of. Coalescing to at most once per
// animation frame keeps the UI visually in sync with the drag without ever
// doing more than one recalculation per paint.
let recalcScheduled = false;
function scheduleRecalculate() {
  if (recalcScheduled) return;
  recalcScheduled = true;
  requestAnimationFrame(() => {
    recalcScheduled = false;
    recalculate();
  });
}

document.querySelectorAll('input[type="range"], select, input[type="checkbox"]').forEach(el => {
  el.addEventListener('input', scheduleRecalculate);
});

updateVisibility();
recalculate();
updateTabLayout();
