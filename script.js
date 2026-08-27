// ---------- DOM refs ----------

const els = {};
document.querySelectorAll('input, select').forEach(el => els[el.id] = el);
document.querySelectorAll('output').forEach(el => els[el.id] = el);

let currentMode = 'need';
const modeTabs = document.querySelectorAll('.modes__tab');
const modeFields = document.querySelectorAll('[data-modes]');

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

// ---------- Toggle sub-panels ----------

function wireToggle(toggleId, subId) {
  const toggle = els[toggleId];
  const sub = document.getElementById(subId);
  toggle.addEventListener('change', () => {
    sub.hidden = !toggle.checked;
    recalculate();
  });
}

wireToggle('toggle-inflation', 'sub-inflation');
wireToggle('toggle-tax', 'sub-tax');
wireToggle('toggle-capitaltax', 'sub-capitaltax');
wireToggle('toggle-pensions', 'sub-pensions');

const bucketToggle = document.getElementById('toggle-buckets');
const singleReturnBlock = document.getElementById('single-return');
const bucketsBlock = document.getElementById('sub-buckets');

// bucket allocation only makes sense during decumulation ("Är jag redo?" / "Hur mycket
function updateReturnVisibility() {
  const showBuckets = bucketToggle.checked;
  singleReturnBlock.hidden = showBuckets;
  bucketsBlock.hidden = !showBuckets;
}

bucketToggle.addEventListener('change', () => {
  updateReturnVisibility();
  recalculate();
});

document.querySelectorAll('input[name="strategy"]').forEach(radio => {
  radio.addEventListener('change', () => {
    document.getElementById('strategy-hint').textContent =
      radio.value === 'preserve'
        ? 'Du ska aldrig äta av det kapital du började med — bara leva på avkastningen.'
        : 'Kapitalet ska ta slut precis vid den ålder du räknar till.';
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

// ---------- Capital allocation (three buckets) ----------

let currentAllocation = { stocks: 0.7, bonds: 0.2, savings: 0.1 };

function updateAllocationDisplay() {
  const stocksEl = els['alloc-stocks'];
  const bondsEl = els['alloc-bonds'];
  let stocks = +stocksEl.value;
  let bonds = +bondsEl.value;
  if (stocks + bonds > 100) {
    bonds = 100 - stocks;
    bondsEl.value = bonds;
  }
  const savings = 100 - stocks - bonds;

  els['out-alloc-stocks'].textContent = stocks;
  els['out-alloc-bonds'].textContent = bonds;
  els['out-alloc-savings'].textContent = savings;
  els['out-return-stocks'].textContent = els['return-stocks'].value;
  els['out-return-bonds'].textContent = els['return-bonds'].value;
  els['out-return-savings'].textContent = els['return-savings'].value;

  currentAllocation = { stocks: stocks / 100, bonds: bonds / 100, savings: savings / 100 };

  const blended = currentAllocation.stocks * (+els['return-stocks'].value / 100)
    + currentAllocation.bonds * (+els['return-bonds'].value / 100)
    + currentAllocation.savings * (+els['return-savings'].value / 100);
  document.getElementById('blended-return-hint').textContent =
    `Blandad avkastning: ${(blended * 100).toLocaleString('sv-SE', { maximumFractionDigits: 1 })} %`;
}

// keep all range outputs and unit labels in sync
function syncDisplays() {
  const money = currencyMeta().symbol;
  els['out-age'].textContent = els.age.value;
  els['out-targetAge'].textContent = els.targetAge.value;
  els['out-spend'].textContent = fmtNumber(+els.spend.value);
  els['out-balance'].textContent = fmtNumber(+els.balance.value);
  els['out-savings'].textContent = fmtNumber(+els.savings.value);
  els['out-return'].textContent = els.return.value;
  els['out-lifespan'].textContent = els.lifespan.value;
  els['out-inflation'].textContent = els.inflation.value;
  els['out-tax'].textContent = els.tax.value;
  els['out-capitaltax'].textContent = els.capitaltax.value;
  els['out-pension1amount'].textContent = fmtNumber(+els.pension1amount.value);
  els['out-pension1age'].textContent = els.pension1age.value;
  els['out-pension1tax'].textContent = els.pension1tax.value;
  els['out-pension2amount'].textContent = fmtNumber(+els.pension2amount.value);
  els['out-pension2age'].textContent = els.pension2age.value;
  els['out-pension2tax'].textContent = els.pension2tax.value;
  document.querySelectorAll('.field .unit').forEach(u => u.textContent = money);
  updateAllocationDisplay();
}

// ---------- Simulation engine ----------

function getParams() {
  const inflationOn = els['toggle-inflation'].checked;
  const taxOn = els['toggle-tax'].checked;
  const capitalTaxOn = els['toggle-capitaltax'].checked;
  const pensionsOn = els['toggle-pensions'].checked;
  const useBuckets = els['toggle-buckets'].checked;

  // blended return across the three allocation buckets (stocks/bonds/savings) —
  // withdrawal order doesn't matter here since there's no volatility in this model,
  // only the weighted-average return of however the capital is split.
  const nominalReturn = useBuckets
    ? currentAllocation.stocks * (+els['return-stocks'].value / 100)
      + currentAllocation.bonds * (+els['return-bonds'].value / 100)
      + currentAllocation.savings * (+els['return-savings'].value / 100)
    : +els.return.value / 100;
  const inflation = inflationOn ? +els.inflation.value / 100 : 0;
  // "include inflation" = discount your return by inflation, i.e. think in real terms.
  // switched off = optimistic simplification, spend and returns treated as already-real.
  let growthRate = inflationOn ? ((1 + nominalReturn) / (1 + inflation) - 1) : nominalReturn;

  // capital tax (e.g. Swedish ISK schablonskatt) taxes the account value each year,
  // independent of withdrawals — modeled as a flat annual haircut on the balance.
  if (capitalTaxOn) {
    const capitalTaxRate = +els.capitaltax.value / 100;
    growthRate = (1 + growthRate) * (1 - capitalTaxRate) - 1;
  }

  const taxRate = taxOn ? +els.tax.value / 100 : 0;

  const pensions = [];
  if (pensionsOn) {
    if (els['toggle-pension1'].checked) {
      pensions.push({ amount: +els.pension1amount.value, startAge: +els.pension1age.value, taxRate: +els.pension1tax.value / 100 });
    }
    if (els['toggle-pension2'].checked) {
      pensions.push({ amount: +els.pension2amount.value, startAge: +els.pension2age.value, taxRate: +els.pension2tax.value / 100 });
    }
  }

  const preserveCapital = document.querySelector('input[name="strategy"]:checked').value === 'preserve';

  return {
    growthRate,
    taxRate,
    pensions,
    lifespan: +els.lifespan.value,
    preserveCapital,
  };
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
  if (!params.preserveCapital) return true;
  // "bevara kapitalet": the real value of the capital must be intact (or grown) by the end.
  const finalBalance = result.path[result.path.length - 1].balance;
  return finalBalance >= startBalance;
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

// Looks up the balance at a given age along a path, clamped to the path's own range.
function capitalAtAge(path, age) {
  const minAge = path[0].age, maxAge = path[path.length - 1].age;
  const clamped = Math.min(maxAge, Math.max(minAge, age));
  const point = path.find(p => p.age === clamped) || path[path.length - 1];
  return point.balance;
}

// Simulates the accumulation phase: balance grows by the same return assumption,
// plus a fixed monthly contribution added each year — no withdrawals.
function accumulate(startBalance, startAge, monthlySavings, params, maxAge) {
  let balance = startBalance;
  const path = [{ age: startAge, balance }];
  for (let age = startAge; age < maxAge; age++) {
    balance += monthlySavings * 12;
    balance *= (1 + params.growthRate);
    path.push({ age: age + 1, balance });
  }
  return path;
}

// Finds the first age at which accumulated savings meet the required FIRE number
// for retiring at that same age (reusing solveRequiredBalance for each candidate age).
function findFireAge(startBalance, startAge, monthlySavings, monthlySpend, params, maxAge) {
  const accPath = accumulate(startBalance, startAge, monthlySavings, params, maxAge);
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
  const params = getParams();
  const age = +els.age.value;
  const money = currencyMeta().symbol;

  let headline, caption, eyebrow, chartResult, fireStartAge;

  if (currentMode === 'need') {
    const targetAge = +els.targetAge.value;
    const spend = +els.spend.value;
    const required = solveRequiredBalance(spend, targetAge, params);
    chartResult = simulate(required, targetAge, spend, params);
    fireStartAge = targetAge;

    eyebrow = 'Du behöver';
    headline = fmtMoney(required);
    caption = `för att kunna gå FIRE vid ${targetAge} års ålder, med en konsumtion på ${fmtMoney(spend)}/månad i dagens pengar.`;

  } else if (currentMode === 'when') {
    const balance = +els.balance.value;
    const monthlySavings = +els.savings.value;
    const spend = +els.spend.value;
    const maxAge = params.lifespan;
    const found = findFireAge(balance, age, monthlySavings, spend, params, maxAge);

    if (found) {
      // continue the chart through retirement too, so the x-axis always spans
      // all the way to the end age, same as every other mode.
      const startBalance = found.path[found.path.length - 1].balance;
      const decum = simulate(startBalance, found.age, spend, params);
      chartResult = { path: found.path.concat(decum.path.slice(1)), failedAtAge: decum.failedAtAge };
      fireStartAge = found.age;
      eyebrow = 'Du når FIRE om';
      headline = `${found.age - age} år`;
      caption = `vid ${found.age} års ålder, med ${fmtMoney(monthlySavings)}/månad i sparande utöver ditt nuvarande kapital, och en konsumtion på ${fmtMoney(spend)}/månad i dagens pengar.`;
    } else {
      chartResult = { path: accumulate(balance, age, monthlySavings, params, maxAge), failedAtAge: null };
      fireStartAge = null;
      eyebrow = 'Med nuvarande sparande';
      headline = 'Räcker inte';
      caption = `inom de kommande ${maxAge - age} åren (till ${maxAge} års ålder), med ${fmtMoney(monthlySavings)}/månad i sparande och en konsumtion på ${fmtMoney(spend)}/månad.`;
    }

  } else if (currentMode === 'status') {
    const balance = +els.balance.value;
    const spend = +els.spend.value;
    const result = simulate(balance, age, spend, params);
    const finalBalance = result.path[result.path.length - 1].balance;
    const ranOut = result.failedAtAge !== null;
    const preservedOk = !params.preserveCapital || finalBalance >= balance;
    const ready = !ranOut && preservedOk;
    fireStartAge = age;

    // always chart what's actually configured — your real capital and spend —
    // never a hypothetical target scenario, so the graph always matches the inputs.
    chartResult = result;

    if (ready) {
      eyebrow = 'Du är redo';
      headline = 'Ja.';
      caption = `Ditt kapital räcker hela vägen till ${params.lifespan} år med en konsumtion på ${fmtMoney(spend)}/månad.`;
    } else {
      const required = solveRequiredBalance(spend, age, params);
      if (ranOut) {
        eyebrow = 'Inte riktigt än';
        headline = fmtMoney(required - balance);
        caption = `så mycket mer behöver du. Med ditt nuvarande kapital tar pengarna slut vid ${result.failedAtAge} års ålder, som grafen visar.`;
      } else {
        eyebrow = 'Nästan — men du äter av kapitalet';
        headline = fmtMoney(required - balance);
        caption = `så mycket mer behöver du för att aldrig äta av grundplåten. Grafen visar hur ditt nuvarande kapital äts upp — vid ${params.lifespan} år har du bara ${fmtMoney(finalBalance)} kvar.`;
      }
    }

  } else {
    const balance = +els.balance.value;
    const maxSpend = solveMaxSpend(balance, age, params);
    chartResult = simulate(balance, age, maxSpend, params);
    fireStartAge = age;

    eyebrow = 'Du kan ta ut';
    headline = `${fmtMoney(maxSpend)}/mån`;
    caption = `riskfritt varje månad, i dagens pengar, utan att kapitalet tar slut före ${params.lifespan} års ålder.`;
  }

  document.getElementById('result-eyebrow').textContent = eyebrow;
  document.getElementById('result-figure').textContent = headline;
  document.getElementById('result-caption').textContent = caption;

  // three consistent checkpoints, in every mode: capital when FIRE starts,
  // when pension kicks in (if any), and at the end age.
  const pensionStartAge = params.pensions.length ? Math.min(...params.pensions.map(p => p.startAge)) : null;
  document.getElementById('stat-lasts').textContent =
    fireStartAge !== null ? fmtMoney(capitalAtAge(chartResult.path, fireStartAge)) : '—';
  document.getElementById('stat-withdrawal').textContent =
    pensionStartAge !== null ? fmtMoney(capitalAtAge(chartResult.path, pensionStartAge)) : '—';
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
