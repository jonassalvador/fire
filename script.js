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

// keep all range outputs and unit labels in sync
function syncDisplays() {
  const money = currencyMeta().symbol;
  els['out-age'].textContent = els.age.value;
  els['out-targetAge'].textContent = els.targetAge.value;
  els['out-spend'].textContent = fmtNumber(+els.spend.value);
  els['out-balance'].textContent = fmtNumber(+els.balance.value);
  els['out-return'].textContent = els.return.value;
  els['out-lifespan'].textContent = els.lifespan.value;
  els['out-inflation'].textContent = els.inflation.value;
  els['out-tax'].textContent = els.tax.value;
  els['out-capitaltax'].textContent = els.capitaltax.value;
  els['out-pension1amount'].textContent = fmtNumber(+els.pension1amount.value);
  els['out-pension1age'].textContent = els.pension1age.value;
  els['out-pension2amount'].textContent = fmtNumber(+els.pension2amount.value);
  els['out-pension2age'].textContent = els.pension2age.value;
  document.querySelectorAll('.field .unit').forEach(u => u.textContent = money);
}

// ---------- Simulation engine ----------

function getParams() {
  const inflationOn = els['toggle-inflation'].checked;
  const taxOn = els['toggle-tax'].checked;
  const capitalTaxOn = els['toggle-capitaltax'].checked;
  const pensionsOn = els['toggle-pensions'].checked;

  const nominalReturn = +els.return.value / 100;
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
      pensions.push({ amount: +els.pension1amount.value, startAge: +els.pension1age.value });
    }
    if (els['toggle-pension2'].checked) {
      pensions.push({ amount: +els.pension2amount.value, startAge: +els.pension2age.value });
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

// Simulates yearly balance from startAge to lifespan given a monthly net spend target.
// Returns { path: [{age, balance}], failedAtAge: number|null }
function simulate(startBalance, startAge, monthlySpend, params) {
  const { growthRate, taxRate, pensions, lifespan } = params;
  let balance = startBalance;
  const path = [{ age: startAge, balance }];
  let failedAtAge = null;

  for (let age = startAge; age < lifespan; age++) {
    const pensionIncome = pensionIncomeAt(age, pensions);
    const netGap = Math.max(0, monthlySpend - pensionIncome);
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

  let headline, caption, eyebrow, chartResult, statWithdrawal, statLasts;
  const pensionTotal = params.pensions.reduce((s, p) => s + p.amount, 0);

  if (currentMode === 'need') {
    const targetAge = +els.targetAge.value;
    const spend = +els.spend.value;
    const required = solveRequiredBalance(spend, targetAge, params);
    chartResult = simulate(required, targetAge, spend, params);

    eyebrow = 'Du behöver';
    headline = fmtMoney(required);
    caption = `för att kunna gå FIRE vid ${targetAge} års ålder, med en konsumtion på ${fmtMoney(spend)}/månad i dagens pengar.`;
    statWithdrawal = fmtMoney(spend);
    statLasts = `${params.lifespan}+`;

  } else if (currentMode === 'status') {
    const balance = +els.balance.value;
    const spend = +els.spend.value;
    const result = simulate(balance, age, spend, params);
    const finalBalance = result.path[result.path.length - 1].balance;
    const ranOut = result.failedAtAge !== null;
    const preservedOk = !params.preserveCapital || finalBalance >= balance;
    const ready = !ranOut && preservedOk;

    if (ready) {
      chartResult = result;
      eyebrow = 'Du är redo';
      headline = 'Ja.';
      caption = `Ditt kapital räcker hela vägen till ${params.lifespan} år med en konsumtion på ${fmtMoney(spend)}/månad.`;
      statLasts = `${params.lifespan}+`;
    } else {
      // not ready: chart the required scenario instead of the shortfall, so the
      // graph visibly reflects the chosen withdrawal strategy, same as "need" mode.
      const required = solveRequiredBalance(spend, age, params);
      chartResult = simulate(required, age, spend, params);
      statLasts = `${params.lifespan}+`;
      if (ranOut) {
        eyebrow = 'Inte riktigt än';
        headline = fmtMoney(required - balance);
        caption = `så mycket mer behöver du. Med dagens kapital tar pengarna slut vid ${result.failedAtAge} års ålder.`;
      } else {
        eyebrow = 'Nästan — men du äter av kapitalet';
        headline = fmtMoney(required - balance);
        caption = `så mycket mer behöver du för att aldrig äta av grundplåten. Med dagens kapital räcker pengarna till ${params.lifespan} år, men då har du bara ${fmtMoney(finalBalance)} kvar av de ${fmtMoney(balance)} du började med.`;
      }
    }
    statWithdrawal = fmtMoney(spend);

  } else {
    const balance = +els.balance.value;
    const maxSpend = solveMaxSpend(balance, age, params);
    chartResult = simulate(balance, age, maxSpend, params);

    eyebrow = 'Du kan ta ut';
    headline = `${fmtMoney(maxSpend)}/mån`;
    caption = `riskfritt varje månad, i dagens pengar, utan att kapitalet tar slut före ${params.lifespan} års ålder.`;
    statWithdrawal = fmtMoney(maxSpend);
    statLasts = `${params.lifespan}+`;
  }

  document.getElementById('result-eyebrow').textContent = eyebrow;
  document.getElementById('result-figure').textContent = headline;
  document.getElementById('result-caption').textContent = caption;
  document.getElementById('stat-lasts').textContent = statLasts;
  document.getElementById('stat-withdrawal').textContent = statWithdrawal;
  document.getElementById('stat-pension').textContent = pensionTotal > 0 ? `${fmtMoney(pensionTotal)}` : '—';

  drawChart(chartResult.path, chartResult.failedAtAge);
}

// ---------- Wire up live updates ----------

document.querySelectorAll('input[type="range"], select, input[type="checkbox"]').forEach(el => {
  el.addEventListener('input', recalculate);
});

updateVisibility();
recalculate();
