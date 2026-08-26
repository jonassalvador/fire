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
wireToggle('toggle-pensions', 'sub-pensions');

// ---------- Formatting ----------

function currencyMeta() {
  const opt = els.currency.selectedOptions[0];
  return { symbol: opt.dataset.symbol, locale: opt.dataset.locale };
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
  const pensionsOn = els['toggle-pensions'].checked;

  const nominalReturn = +els.return.value / 100;
  const inflation = inflationOn ? +els.inflation.value / 100 : 0;
  // "include inflation" = discount your return by inflation, i.e. think in real terms.
  // switched off = optimistic simplification, spend and returns treated as already-real.
  const growthRate = inflationOn ? ((1 + nominalReturn) / (1 + inflation) - 1) : nominalReturn;

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

  return {
    growthRate,
    taxRate,
    pensions,
    lifespan: +els.lifespan.value,
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
  return simulate(startBalance, startAge, monthlySpend, params).failedAtAge === null;
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

function drawChart(path, failedAtAge) {
  svg.innerHTML = '';
  const W = 640, H = 280, PAD = 8;
  const maxBalance = Math.max(...path.map(p => p.balance), 1);
  const minAge = path[0].age, maxAge = path[path.length - 1].age;

  const x = age => PAD + (age - minAge) / (maxAge - minAge || 1) * (W - PAD * 2);
  const y = balance => H - PAD - (balance / maxBalance) * (H - PAD * 2);

  const linePoints = path.map(p => `${x(p.age)},${y(p.balance)}`).join(' ');
  const areaPoints = `${x(minAge)},${H} ${linePoints} ${x(maxAge)},${H}`;

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

  const zero = document.createElementNS(NS, 'line');
  zero.setAttribute('x1', PAD); zero.setAttribute('x2', W - PAD);
  zero.setAttribute('y1', H - PAD); zero.setAttribute('y2', H - PAD);
  zero.setAttribute('stroke', 'var(--rule)');
  zero.setAttribute('stroke-width', '1');
  svg.appendChild(zero);

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

  document.getElementById('chart-axis').innerHTML =
    `<span>${minAge} år</span><span>${maxAge} år</span>`;
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
    const ready = result.failedAtAge === null;
    chartResult = result;

    if (ready) {
      eyebrow = 'Du är redo';
      headline = 'Ja.';
      caption = `Ditt kapital räcker hela vägen till ${params.lifespan} år med en konsumtion på ${fmtMoney(spend)}/månad.`;
    } else {
      const required = solveRequiredBalance(spend, age, params);
      eyebrow = 'Inte riktigt än';
      headline = fmtMoney(required - balance);
      caption = `så mycket mer behöver du. Med dagens kapital tar pengarna slut vid ${result.failedAtAge} års ålder.`;
    }
    statWithdrawal = fmtMoney(spend);
    statLasts = ready ? `${params.lifespan}+` : `${result.failedAtAge}`;

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
