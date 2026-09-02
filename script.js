// ---------- DOM refs ----------

const els = {};
document.querySelectorAll('input, select').forEach(el => els[el.id] = el);
document.querySelectorAll('output').forEach(el => els[el.id] = el);

// Collapsible field-groups (Tillväxt & inflation, Skatter) — closed by
// default (per the HTML's own hidden attribute); the chevron's rotation is
// driven purely by aria-expanded in CSS, so this just needs to flip that and
// the content's hidden state together.
document.querySelectorAll('.field-group__header').forEach(header => {
  header.addEventListener('click', () => {
    const expanded = header.getAttribute('aria-expanded') === 'true';
    header.setAttribute('aria-expanded', String(!expanded));
    document.getElementById(header.getAttribute('aria-controls')).hidden = expanded;
  });
});

let currentMode = 'need';
const modesNav = document.querySelector('.modes');
const modeTabs = document.querySelectorAll('.modes__tab');
const modeFields = document.querySelectorAll('[data-modes]');

// Whether the badge+label pair reads best centered (every label fits on one
// line) or top-aligned (at least one has wrapped to two+ lines) depends on
// the actual rendered text, not just the viewport width — a label can wrap
// at all sorts of in-between widths depending on which word breaks where, so
// this measures real label heights instead of guessing from a breakpoint.
function updateModesAlignment() {
  let wrapped = false;
  document.querySelectorAll('.modes__label').forEach(label => {
    // counting actual line boxes (via a Range over the text) rather than
    // comparing scrollHeight to line-height — line-height often computes to
    // the unresolved keyword "normal" rather than a pixel value, which broke
    // that comparison silently instead of just being less precise.
    const range = document.createRange();
    range.selectNodeContents(label);
    if (range.getClientRects().length > 1) wrapped = true;
  });
  modesNav.classList.toggle('is-wrapped', wrapped);
}

window.addEventListener('resize', updateModesAlignment);
if (document.fonts && document.fonts.ready) {
  // the label font (Inter) loads asynchronously — re-check once it's actually
  // in, since the fallback font's line-wrapping can differ from the real one.
  document.fonts.ready.then(updateModesAlignment);
}

modeTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    currentMode = tab.dataset.mode;
    modeTabs.forEach(t => t.classList.toggle('is-active', t === tab));
    modeTabs.forEach(t => t.setAttribute('aria-selected', t === tab ? 'true' : 'false'));
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
  // Tillgångar still only shows the three hinkar once you actually split —
  // Tillväxt & inflation and Skatter, by contrast, always show every slider
  // regardless of split/combined, pension on/off, or anything else.
  const isSplit = document.querySelector('input[name="capitalMode"]:checked').value === 'split';
  capitalSplitFields.hidden = !isSplit;

  // always visible, on either side of the switch — just what it explains
  // changes. Blandportfölj only ever describes the assumed asset mix (its
  // tax rate is explained under its own slider in Skatter instead); once you
  // switch to Egen fördelning, the bucket cards below speak for themselves,
  // so this points there rather than repeating each one's own explanation.
  const capitalModeHint = document.getElementById('capital-mode-hint');
  capitalModeHint.textContent = isSplit
    ? 'Du delar själv upp kapitalet i Aktie/fondportfölj, Ränteportfölj och Sparkonto nedan, med egen avkastning och skatt för var och en.'
    : `Förutsätter en generell blandportfölj med 60–70 % aktier, 30–40 % räntor, och ${els.return.value} % förväntad avkastning nominellt.`;
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
    dieWithZeroFields.hidden = preserve;
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
    pensionFields.hidden = ignore;
    pensionHint.textContent = ignore
      ? 'Beräkningen bygger enbart på ditt eget sparande — ingen pension räknas in, även om du faktiskt har rätt till det.'
      : 'Din allmänna pension och tjänstepension räknas in och minskar hur mycket du själv behöver ta ur ditt kapital.';
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

// ---------- Capital allocation (percentage of one total capital slider) ----------

let currentAllocation = { stocks: 1, bonds: 0, savings: 0 };

// Aktier/fonder, Räntor and Sparkonto each have their own draggable %-slider
// (all 0–100), kept summing to 100 by a priority order rather than every pair
// trading with every other: dragging Aktier/fonder rebalances Räntor and
// Sparkonto together (proportionally, in whatever ratio they already have to
// each other); dragging either Räntor or Sparkonto instead trades directly
// with the other one of the two, leaving Aktier/fonder untouched.
function rebalanceAlloc(changedKey) {
  const sliders = { stocks: els['alloc-stocks'], bonds: els['alloc-bonds'], savings: els['alloc-savings'] };

  if (changedKey === 'stocks') {
    const stocks = +sliders.stocks.value;
    const remainder = 100 - stocks;
    const otherSum = +sliders.bonds.value + +sliders.savings.value;

    ['bonds', 'savings'].forEach(k => {
      const share = otherSum > 0 ? (+sliders[k].value / otherSum) : 0.5;
      sliders[k].value = Math.max(0, Math.round(remainder * share));
    });

    // rounding can leave the total slightly off 100 — absorb it into savings.
    const leftover = remainder - (+sliders.bonds.value + +sliders.savings.value);
    sliders.savings.value = Math.max(0, +sliders.savings.value + leftover);
  } else {
    // Räntor and Sparkonto trade directly with each other; Aktier/fonder is
    // fixed, so neither can push their combined total past what it leaves.
    const partnerKey = changedKey === 'bonds' ? 'savings' : 'bonds';
    const stocks = +sliders.stocks.value;
    const changedValue = Math.max(0, Math.min(+sliders[changedKey].value, 100 - stocks));
    sliders[changedKey].value = changedValue;
    sliders[partnerKey].value = Math.max(0, 100 - stocks - changedValue);
  }
}

els['alloc-stocks'].addEventListener('input', () => rebalanceAlloc('stocks'));
els['alloc-bonds'].addEventListener('input', () => rebalanceAlloc('bonds'));
els['alloc-savings'].addEventListener('input', () => rebalanceAlloc('savings'));

function updateAllocationDisplay() {
  const isSplit = document.querySelector('input[name="capitalMode"]:checked').value === 'split';
  let stocks, bonds, savings;

  if (isSplit) {
    stocks = +els['alloc-stocks'].value;
    bonds = +els['alloc-bonds'].value;
    savings = +els['alloc-savings'].value;
  } else {
    // "samlat kapital" — treated as 100% aktier/fonder, same as tab 1's model.
    stocks = 100;
    bonds = 0;
    savings = 0;
  }
  const total = stocks + bonds + savings || 1; // guard against all three being 0

  els['out-alloc-stocks'].textContent = stocks;
  els['out-alloc-bonds'].textContent = bonds;
  els['out-alloc-savings'].textContent = savings;
  els['out-return-stocks'].textContent = els['return-stocks'].value;
  els['out-return-bonds'].textContent = els['return-bonds'].value;
  els['out-return-savings'].textContent = els['return-savings'].value;

  const totalCapital = +els['total-capital'].value;
  els['out-alloc-stocks-kr'].textContent = fmtNumber(totalCapital * stocks / 100);
  els['out-alloc-bonds-kr'].textContent = fmtNumber(totalCapital * bonds / 100);
  els['out-alloc-savings-kr'].textContent = fmtNumber(totalCapital * savings / 100);

  currentAllocation = { stocks: stocks / total, bonds: bonds / total, savings: savings / total };

  // "Blandad avkastning" — the single nominal rate your custom split works
  // out to overall, weighted by each bucket's own share, so you can compare
  // it at a glance to the plain Blandportfölj rate above.
  const blendedReturn = (stocks * (+els['return-stocks'].value)
    + bonds * (+els['return-bonds'].value)
    + savings * (+els['return-savings'].value)) / total;
  document.getElementById('blended-return-hint').textContent =
    `Blandad avkastning: ${blendedReturn.toFixed(1).replace('.', ',')} % nominellt, givet din fördelning ovan.`;
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
const FIRE_LEVELS = [
  { min: 5000, name: 'Barista FIRE', desc: 'Portföljen täcker en liten bas, men du måste fortfarande jobba deltid eller ha en sidoinkomst för att klara dig.' },
  { min: 10000, name: 'Lean FIRE', desc: 'Du är helt fri men lever extremt minimalistiskt. Täcker endast mat, billigt boende och absoluta måsten.' },
  { min: 15000, name: 'Slender FIRE', desc: 'Steget mellan fattig och lagom. Du har råd med lite rörliga utgifter men måste fortfarande budgetera strikt.' },
  { min: 20000, name: 'Regular FIRE', desc: 'Den klassiska FIRE-nivån. Motsvarar en genomsnittlig svensk nettoinkomst. Du lever ett normalt, bra liv utan ekonomisk stress.' },
  { min: 30000, name: 'Chubby FIRE', desc: 'Det välbärgade gränslandet. Du har en guldkant på tillvaron med utrymme för resor, restauranger och extra bekvämligheter.' },
  { min: 40000, name: 'Fat FIRE', desc: 'Ren lyxnivå i Sverige. Du kan bo dyrt, resa i business class och köpa kvalitetsprodukter utan att titta på prislappen.' },
  { min: 60000, name: 'Obese FIRE', desc: 'Extremt hög levnadsstandard. Ekonomin begränsar dig inte på något realistiskt sätt i vardagen.' },
  { min: 100000, name: 'Whale FIRE', desc: 'Ekonomiskt oberoende på generationsnivå. Du rör dig i samma ekonomiska sfär som höginkomsttagare, egendomsägare och mångmiljonärer.' },
];

function fireLevelFor(spend) {
  let level = FIRE_LEVELS[0];
  for (const l of FIRE_LEVELS) {
    if (spend >= l.min) level = l;
  }
  return level;
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
}

// ---------- Simulation engine ----------

function getParams() {
  const useBuckets = currentMode !== 'need';

  const inflation = +els.inflation.value / 100;

  // discount a nominal rate by inflation to get a real one. A 0% inflation
  // slider is a no-op here, so there's no need for a separate on/off toggle.
  const toReal = nominal => (1 + nominal) / (1 + inflation) - 1;

  // Blandportfölj, Aktie/fondportfölj and Ränteportfölj are all assumed to
  // sit in an ISK — schablonskatt, applied annually on the account's full
  // value, withdrawals then tax-free — independently adjustable, they just
  // happen to share the same 1% default.
  const BLEND_TAX = +els['tax-isk-blend'].value / 100;
  const STOCKS_TAX = +els['tax-isk-stocks'].value / 100;
  const BONDS_TAX = +els['tax-bonds'].value / 100;
  const SAVINGS_TAX = +els['tax-savings'].value / 100;

  // The simplified 100%-aktier model (tab 1, no buckets) always uses the
  // Blandportfölj rate — never the Aktier/fonder bucket rate, even if
  // "Egen fördelning" happens to be selected.
  const simpleReal = (1 + toReal(+els.return.value / 100)) * (1 - BLEND_TAX) - 1;

  let growthRate = simpleReal;
  let stocksRate = simpleReal, bondsRate = simpleReal, savingsRate = simpleReal;
  const taxRate = 0; // every bucket here is ISK, so nothing is ever taxed at withdrawal

  if (useBuckets) {
    // ISK: schablonskatt on the account value every year, withdrawals then free.
    const iskGrowth = (nominal, tax) => (1 + toReal(nominal)) * (1 - tax) - 1;

    // "samlat kapital" (Blandportfölj) reuses the same rate and ISK tax as
    // tab 1; it's literally the same model, just also usable in tabs 2-4.
    // Only once you actually split into buckets does Aktier/fonder's own
    // rate and tax come into play.
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

function pensionIncomeAt(age, pensions) {
  return pensions.reduce((sum, p) => sum + (age >= p.startAge ? p.amount : 0), 0);
}

// each pension is taxed as ordinary income at its own rate — separate from,
// and usually different than, the tax on withdrawals from the portfolio.
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

// Binary search for the maximum monthly spend a given balance can sustain.
function solveMaxSpend(startBalance, startAge, params) {
  let lo = 0, hi = startBalance; // a spend of 100% of balance per month is always way more than enough as an upper bound
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (succeeds(startBalance, startAge, mid, params)) lo = mid; else hi = mid;
  }
  return lo;
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
  const shape = bucketShape(startBuckets);
  const path = [{ age: startAge, balance: stocks + bonds + savings }];
  let failedAtAge = null;

  for (let age = startAge; age < lifespan; age++) {
    const pensionNet = pensionNetIncomeAt(age, pensions);
    const netGap = Math.max(0, monthlySpend - pensionNet);
    const total = stocks + bonds + savings;
    const annualWithdrawal = netGap * 12;

    if (annualWithdrawal > total) {
      if (failedAtAge === null) failedAtAge = age;
      stocks = 0; bonds = 0; savings = 0;
    } else if (total > 0) {
      // withdraw proportionally across all three, same blended-by-allocation
      // philosophy the rest of the tool uses elsewhere.
      stocks = Math.max(0, stocks - annualWithdrawal * (stocks / total));
      bonds = Math.max(0, bonds - annualWithdrawal * (bonds / total));
      savings = Math.max(0, savings - annualWithdrawal * (savings / total));
    }

    stocks *= (1 + stocksRate);
    bonds *= (1 + bondsRate);
    savings *= (1 + savingsRate);

    // annual rebalance back to the target split.
    const rebalanced = stocks + bonds + savings;
    stocks = rebalanced * shape.stocks;
    bonds = rebalanced * shape.bonds;
    savings = rebalanced * shape.savings;

    path.push({ age: age + 1, balance: Math.max(0, stocks + bonds + savings) });
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
// as `buckets` — that survives to lifespan.
function solveRequiredBalanceBuckets(monthlySpend, startAge, buckets, params) {
  const total = bucketsTotal(buckets);
  if (total <= 0) return solveRequiredBalance(monthlySpend, startAge, params); // no shape to scale — fall back
  const shape = { stocks: buckets.stocks / total, bonds: buckets.bonds / total, savings: buckets.savings / total };

  let lo = 0, hi = monthlySpend * 12 * 100;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const scaledBuckets = { stocks: shape.stocks * mid, bonds: shape.bonds * mid, savings: shape.savings * mid };
    if (succeedsBuckets(scaledBuckets, startAge, monthlySpend, params)) hi = mid; else lo = mid;
  }
  return hi;
}

// Looks up the balance at a given age along a path, clamped to the path's own range.
function capitalAtAge(path, age) {
  const minAge = path[0].age, maxAge = path[path.length - 1].age;
  const clamped = Math.min(maxAge, Math.max(minAge, age));
  const point = path.find(p => p.age === clamped) || path[path.length - 1];
  return point.balance;
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
  const shape = bucketShape(startBuckets);
  const path = [{ age: startAge, balance: stocks + bonds + savings, stocks, bonds, savings }];
  for (let age = startAge; age < maxAge; age++) {
    stocks += monthlySavings * 12;
    stocks *= (1 + params.stocksRate);
    bonds *= (1 + params.bondsRate);
    savings *= (1 + params.savingsRate);

    // annual rebalance back to the target split.
    const total = stocks + bonds + savings;
    stocks = total * shape.stocks;
    bonds = total * shape.bonds;
    savings = total * shape.savings;

    path.push({ age: age + 1, balance: stocks + bonds + savings, stocks, bonds, savings });
  }
  return path;
}

// Finds the first age at which accumulated savings meet the required FIRE number
// for retiring at that same age (reusing solveRequiredBalance for each candidate age).
function findFireAge(startBuckets, startAge, monthlySavings, monthlySpend, params, maxAge) {
  const accPath = accumulate(startBuckets, startAge, monthlySavings, params, maxAge);
  for (const point of accPath) {
    const required = solveRequiredBalance(monthlySpend, point.age, params);
    if (point.balance >= required) {
      return { age: point.age, required, path: accPath.filter(p => p.age <= point.age) };
    }
  }
  return null;
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
  const maxBalance = Math.max(...path.map(p => p.balance), 1);
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
    label.setAttribute('font-family', 'var(--mono)');
    label.setAttribute('font-size', '10');
    label.setAttribute('fill', 'var(--ink-soft)');
    label.textContent = niceMoneyLabel(value);
    svg.appendChild(label);
  }

  const linePoints = path.map(p => `${x(p.age)},${y(p.balance)}`).join(' ');
  const areaPoints = `${x(minAge)},${y(0)} ${linePoints} ${x(maxAge)},${y(0)}`;

  const area = document.createElementNS(NS, 'polygon');
  area.setAttribute('points', areaPoints);
  area.setAttribute('fill', 'var(--accent-soft)');
  svg.appendChild(area);

  const line = document.createElementNS(NS, 'polyline');
  line.setAttribute('points', linePoints);
  line.setAttribute('fill', 'none');
  line.setAttribute('stroke', 'var(--ink)');
  line.setAttribute('stroke-width', '2');
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
    `<span>${minAge} år</span><span>${maxAge} år</span>`;
}

function handleChartHover(evt) {
  if (!chartScale) return;
  const { path, x, y, minAge, maxAge } = chartScale;
  const rect = svg.getBoundingClientRect();
  const svgX = (evt.clientX - rect.left) / rect.width * W;

  const age = Math.round(minAge + (svgX - PAD_LEFT) / (W - PAD_LEFT - PAD_RIGHT) * (maxAge - minAge));
  const clampedAge = Math.min(maxAge, Math.max(minAge, age));
  const point = path.find(p => p.age === clampedAge) || path[path.length - 1];

  const hoverDot = document.getElementById('chart-hover-dot');
  hoverDot.setAttribute('cx', x(point.age));
  hoverDot.setAttribute('cy', y(point.balance));
  hoverDot.setAttribute('visibility', 'visible');

  tooltip.hidden = false;
  tooltip.textContent = `${point.age} år — ${fmtMoney(point.balance)}`;

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
        const decum = simulateBuckets(endBuckets, found.age, spend, params);
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
        const requiredNow = solveRequiredBalanceBuckets(spend, age, startBuckets, params);
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

    const maxSpend = solveMaxSpendBuckets(startBuckets, age, params);
    const decum = simulateBuckets(startBuckets, age, maxSpend, params);
    chartResult = decum;
    fireStartAge = age;

    eyebrow = 'Du kan ta ut';
    headline = `${fmtMoney(maxSpend)}/mån`;
    caption = `riskfritt varje månad, i dagens pengar, utan att kapitalet tar slut före ${params.lifespan} års ålder.`;
    comparisonText = `${fmtMoney(balance * compareRate / 12)}/mån`;
  }

  document.getElementById('result-eyebrow').textContent = eyebrow;
  document.getElementById('result-figure').textContent = headline;
  document.getElementById('result-caption').textContent = caption;
  document.getElementById('comparison-result').textContent = comparisonText;

  // three consistent checkpoints, in every mode: capital when FIRE starts,
  // when pension kicks in, and at the end age — labels show the actual age.
  const pensionAgeSetting = +els.pensionage.value;
  const endAge = chartResult.path[chartResult.path.length - 1].age;

  document.getElementById('dt-lasts').textContent = fireStartAge !== null ? `Kapital vid ${fireStartAge} år` : 'Kapital vid FIRE';
  document.getElementById('stat-lasts').textContent =
    fireStartAge !== null ? fmtMoney(capitalAtAge(chartResult.path, fireStartAge)) : '—';

  document.getElementById('dt-withdrawal').textContent = `Kapital vid ${pensionAgeSetting} år`;
  document.getElementById('stat-withdrawal').textContent = fmtMoney(capitalAtAge(chartResult.path, pensionAgeSetting));

  document.getElementById('dt-pension').textContent = `Kapital vid ${endAge} år`;
  document.getElementById('stat-pension').textContent =
    fmtMoney(chartResult.path[chartResult.path.length - 1].balance);

  drawChart(chartResult.path, chartResult.failedAtAge);
}

// ---------- Wire up live updates ----------

document.querySelectorAll('input[type="range"], select, input[type="checkbox"]').forEach(el => {
  el.addEventListener('input', recalculate);
});

updateVisibility();
recalculate();
updateModesAlignment();
