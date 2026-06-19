const STORAGE_KEY = 'financeTracker';

const DEFAULT_DATA = {
  income: 35000,
  savingsGoal: 3000,
  paydayFrom: 5,
  paydayTo: 10,
  expenses: [
    { id: crypto.randomUUID(), name: 'Mobilní tarif', amount: 599 },
    { id: crypto.randomUUID(), name: 'Internet', amount: 499 },
    { id: crypto.randomUUID(), name: 'Netflix', amount: 259 },
    { id: crypto.randomUUID(), name: 'Spotify', amount: 169 },
  ],
  spending: {},
  thirds: [],
  accountBalance: null,
  useManualBalance: false,
  manualBudgetBase: null,
};

const EXPENSE_ICONS = ['📱', '🌐', '📺', '🎵', '☁️', '💳', '🏠', '⚡', '🎮', '📦'];

const fmt = new Intl.NumberFormat('cs-CZ', {
  style: 'currency',
  currency: 'CZK',
  maximumFractionDigits: 0,
});

const dayMonthFmt = new Intl.DateTimeFormat('cs-CZ', {
  day: 'numeric',
  month: 'long',
});

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULT_DATA);
    const saved = JSON.parse(raw);
    return {
      ...structuredClone(DEFAULT_DATA),
      ...saved,
      spending: saved.spending ?? {},
      spendingEntries: saved.spendingEntries ?? {},
      expenses: saved.expenses ?? structuredClone(DEFAULT_DATA.expenses),
      thirds: saved.thirds ?? [],
    };
  } catch {
    return structuredClone(DEFAULT_DATA);
  }
}

function saveData(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    showSaveStatus(true);
  } catch {
    showSaveStatus(false);
  }
}

let saveStatusTimer;
function showSaveStatus(ok) {
  const el = document.getElementById('saveStatus');
  if (!el) return;
  el.textContent = ok ? 'Uloženo v prohlížeči' : 'Nepodařilo se uložit data';
  el.classList.toggle('save-error', !ok);
  clearTimeout(saveStatusTimer);
  saveStatusTimer = setTimeout(() => {
    el.textContent = 'Data se ukládají automaticky';
    el.classList.remove('save-error');
  }, 2500);
}

let data = loadData();

function dateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function daysBetween(from, to) {
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const end = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((end - start) / 86400000);
}

function parseDateKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function clampPaydayRange(from, to) {
  const safeFrom = Math.min(28, Math.max(1, Number(from) || 5));
  let safeTo = Math.min(31, Math.max(1, Number(to) || 10));
  if (safeTo < safeFrom) safeTo = safeFrom;
  return { from: safeFrom, to: safeTo };
}

function getPaydayInfo(now = new Date()) {
  const { from, to } = clampPaydayRange(data.paydayFrom, data.paydayTo);
  const day = now.getDate();
  const year = now.getFullYear();
  const month = now.getMonth();

  let windowStart;
  let windowEnd;
  let status;

  if (day < from) {
    windowStart = new Date(year, month, from);
    windowEnd = new Date(year, month, to);
    status = 'upcoming';
  } else if (day <= to) {
    windowStart = new Date(year, month, from);
    windowEnd = new Date(year, month, to);
    status = 'in_window';
  } else {
    windowStart = new Date(year, month + 1, from);
    windowEnd = new Date(year, month + 1, to);
    status = 'passed';
  }

  const daysUntilEarliest = daysBetween(now, windowStart);
  const daysUntilLatest = daysBetween(now, windowEnd);

  return { from, to, status, windowStart, windowEnd, daysUntilEarliest, daysUntilLatest };
}

function getNextPaydayFrom(now = new Date()) {
  const { from } = clampPaydayRange(data.paydayFrom, data.paydayTo);
  const day = now.getDate();
  const y = now.getFullYear();
  const m = now.getMonth();

  if (day < from) {
    return new Date(y, m, from);
  }
  return new Date(y, m + 1, from);
}

function getPeriodStart(now = new Date()) {
  const { from, to } = clampPaydayRange(data.paydayFrom, data.paydayTo);
  const day = now.getDate();
  const y = now.getFullYear();
  const m = now.getMonth();

  if (day > to) {
    return new Date(y, m, to + 1);
  }
  if (day >= from) {
    return new Date(y, m, from);
  }
  return new Date(y, m - 1, to + 1);
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

function getNextPeriodStartAfter(currentPeriodStart) {
  const { to } = clampPaydayRange(data.paydayFrom, data.paydayTo);
  const nextPayday = getNextPaydayFrom(currentPeriodStart);
  return new Date(nextPayday.getFullYear(), nextPayday.getMonth(), to + 1);
}

function getFirstInstallmentPeriodStart(now = new Date()) {
  const { to } = clampPaydayRange(data.paydayFrom, data.paydayTo);
  const upcomingPayday = getNextPaydayFrom(now);
  let candidate = new Date(upcomingPayday.getFullYear(), upcomingPayday.getMonth(), to + 1);
  const currentPeriodStart = getPeriodStart(now);

  if (candidate <= currentPeriodStart) {
    candidate = getNextPeriodStartAfter(currentPeriodStart);
  }
  return candidate;
}

function getNthInstallmentPeriodStart(firstStart, index) {
  let start = new Date(firstStart);
  for (let i = 0; i < index; i++) {
    start = getNextPeriodStartAfter(start);
  }
  return start;
}

function getInstallmentAmount(total, installmentNumber) {
  const perThird = Math.round(total / 3);
  if (installmentNumber < 3) return perThird;
  return total - perThird * 2;
}

function getThirdStatus(third, currentPeriodStart) {
  const firstStart = parseDateKey(third.firstPeriodStart);
  const periods = [0, 1, 2].map((i) => getNthInstallmentPeriodStart(firstStart, i));

  for (let i = 0; i < 3; i++) {
    if (sameDay(periods[i], currentPeriodStart)) {
      return {
        phase: 'active',
        installment: i + 1,
        amount: getInstallmentAmount(third.totalAmount, i + 1),
        firstPeriod: periods[0],
        lastPeriod: periods[2],
      };
    }
  }

  if (currentPeriodStart < periods[0]) {
    return {
      phase: 'upcoming',
      installment: 0,
      amount: getInstallmentAmount(third.totalAmount, 1),
      firstPeriod: periods[0],
      lastPeriod: periods[2],
    };
  }

  return {
    phase: 'done',
    installment: 3,
    amount: 0,
    firstPeriod: periods[0],
    lastPeriod: periods[2],
  };
}

function getThirdsDeduction(periodStart) {
  if (!data.thirds?.length) return 0;
  return data.thirds.reduce((sum, third) => {
    const status = getThirdStatus(third, periodStart);
    return status.phase === 'active' ? sum + status.amount : sum;
  }, 0);
}

function formatShortDate(date) {
  return `${date.getDate()}. ${dayMonthFmt.format(date).replace(/^\d+\.\s*/, '')}`;
}

function getBudgetPeriod(now = new Date()) {
  const periodStart = getPeriodStart(now);
  const nextPayday = getNextPaydayFrom(now);
  const daysLeft = Math.max(1, daysBetween(now, nextPayday));
  const totalDays = Math.max(1, daysBetween(periodStart, nextPayday));
  const elapsedDays = daysBetween(periodStart, now);

  return { periodStart, nextPayday, daysLeft, totalDays, elapsedDays };
}

function formatPeriodRange(start, end) {
  const startDay = start.getDate();
  const endDay = end.getDate();
  const startMonth = dayMonthFmt.format(start).replace(/^\d+\.\s*/, '');
  const endMonth = dayMonthFmt.format(end).replace(/^\d+\.\s*/, '');

  if (start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()) {
    return `${startDay}.–${endDay}. ${endMonth}`;
  }
  return `${startDay}. ${startMonth} – ${endDay}. ${endMonth}`;
}

function formatPaydayWindow(start, end) {
  const sameMonth = start.getMonth() === end.getMonth();
  if (sameMonth) {
    return `${start.getDate()}.–${end.getDate()}. ${dayMonthFmt.format(end).replace(/^\d+\.\s*/, '')}`;
  }
  return `${dayMonthFmt.format(start)} – ${dayMonthFmt.format(end)}`;
}

function formatPaydayCount(info) {
  const { status, daysUntilEarliest, daysUntilLatest } = info;

  if (status === 'in_window') {
    if (daysUntilLatest === 0) return 'Poslední den období výplaty';
    if (daysUntilLatest === 1) return 'Nejpozději zítra';
    return `Období výplaty · nejpozději za ${daysUntilLatest} dní`;
  }

  if (daysUntilEarliest === 0) return 'Nejdříve dnes';
  if (daysUntilEarliest === 1) return 'Nejdříve zítra';
  return `Nejdříve za ${daysUntilEarliest} dní`;
}

function getSpentInPeriod(periodStart, now = new Date()) {
  const start = new Date(periodStart.getFullYear(), periodStart.getMonth(), periodStart.getDate());
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  return Object.entries(data.spending).reduce((sum, [key, amount]) => {
    const date = parseDateKey(key);
    if (date >= start && date <= end) return sum + amount;
    return sum;
  }, 0);
}

function getTodaySpends() {
  const key = dateKey();
  const entries = data.spendingEntries?.[key] || [];
  return entries;
}

function getFixedTotal() {
  return data.expenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
}

function getCalculatedAvailable(periodStart) {
  const income = Number(data.income) || 0;
  const savings = Number(data.savingsGoal) || 0;
  const fixed = getFixedTotal();
  const thirds = getThirdsDeduction(periodStart);
  return income - fixed - savings - thirds;
}

function calculate(now = new Date()) {
  const period = getBudgetPeriod(now);
  const calculatedAvailable = getCalculatedAvailable(period.periodStart);
  const spent = getSpentInPeriod(period.periodStart, now);
  const savings = Number(data.savingsGoal) || 0;
  const thirds = getThirdsDeduction(period.periodStart);
  const manual = data.useManualBalance && data.accountBalance !== null;

  let remaining;
  if (manual) {
    // Stav účtu už reflektuje minulé útraty; úspory a třetinky se strhávají z toho, co je k utracení
    remaining = Number(data.accountBalance) - savings - thirds;
  } else {
    remaining = calculatedAvailable - spent;
  }

  const daily = remaining / period.daysLeft;

  return {
    calculatedAvailable,
    spent,
    remaining,
    daily,
    period,
    manual,
    savings,
    thirds,
    fixed: getFixedTotal(),
  };
}

function expenseIcon(index) {
  return EXPENSE_ICONS[index % EXPENSE_ICONS.length];
}

function render() {
  const now = new Date();
  const calc = calculate();

  document.getElementById('currentMonth').textContent =
    formatPeriodRange(calc.period.periodStart, calc.period.nextPayday);

  const dailyEl = document.getElementById('dailyBudget');
  dailyEl.textContent = fmt.format(Math.max(0, calc.daily));
  dailyEl.className = 'hero-amount';
  if (calc.remaining < 0) dailyEl.classList.add('danger');
  else if (calc.daily < 200) dailyEl.classList.add('warning');

  const subParts = [];
  if (calc.period.daysLeft > 1) {
    subParts.push(`zbývá ${calc.period.daysLeft} dní do výplaty`);
  } else {
    subParts.push('výplata může přijít zítra');
  }
  if (calc.remaining < 0) {
    subParts.push('překročen rozpočet!');
  }
  document.getElementById('dailyBudgetSub').textContent = subParts.join(' · ');

  const payday = getPaydayInfo(now);
  document.getElementById('paydayCount').textContent = formatPaydayCount(payday);
  document.getElementById('paydayRange').textContent =
    `Období ${formatPaydayWindow(payday.windowStart, payday.windowEnd)}`;
  document.getElementById('paydayBanner').classList.toggle('in-window', payday.status === 'in_window');

  document.getElementById('remainingMonth').textContent = fmt.format(calc.remaining);
  document.getElementById('spentMonth').textContent = fmt.format(calc.spent);
  document.getElementById('fixedTotal').textContent = fmt.format(calc.fixed);

  const balanceInput = document.getElementById('accountBalance');
  const balanceHint = document.getElementById('balanceHint');
  const balanceStat = document.getElementById('balanceStat');

  if (document.activeElement !== balanceInput) {
    balanceInput.value = Math.round(calc.manual ? calc.remaining : calc.calculatedAvailable);
  }

  balanceStat.classList.toggle('manual', calc.manual);
  if (calc.manual) {
    const parts = [`Ruční stav účtu`];
    if (calc.savings > 0) parts.push(`−${fmt.format(calc.savings)} úspory`);
    if (calc.thirds > 0) parts.push(`−${fmt.format(calc.thirds)} třetinky`);
    parts.push(`dle příjmu by bylo ${fmt.format(calc.calculatedAvailable)}`);
    balanceHint.innerHTML =
      parts.join(' · ') +
      ` · <button type="button" class="btn-link" id="resetToCalculated">přepočítat z příjmu</button>`;
    document.getElementById('resetToCalculated')?.addEventListener('click', resetToCalculated);
  } else {
    balanceHint.textContent =
      calc.spent > 0
        ? `Po odečtení ${fmt.format(calc.spent)} utracených v appce`
        : 'Uprav na aktuální zůstatek účtu, pokud startuješ později';
  }

  const thirdsStat = document.getElementById('thirdsStat');
  if (data.thirds?.length) {
    thirdsStat.hidden = false;
    document.getElementById('thirdsTotal').textContent = fmt.format(calc.thirds);
  } else {
    thirdsStat.hidden = true;
  }

  const spendProgress = calc.manual
    ? (data.manualBudgetBase > 0
      ? Math.min(100, ((data.manualBudgetBase - calc.remaining) / data.manualBudgetBase) * 100)
      : 0)
    : calc.calculatedAvailable > 0
      ? Math.min(100, (calc.spent / calc.calculatedAvailable) * 100)
      : calc.spent > 0 ? 100 : 0;
  const timeProgress = calc.period.totalDays > 0
    ? Math.min(100, (calc.period.elapsedDays / calc.period.totalDays) * 100)
    : 0;

  document.getElementById('progressLabel').textContent =
    `den ${calc.period.elapsedDays + 1} / ${calc.period.totalDays} · utraceno ${Math.round(spendProgress)} %`;

  const fill = document.getElementById('progressFill');
  fill.style.width = `${spendProgress}%`;
  fill.classList.toggle('over', spendProgress >= 90 || (spendProgress > timeProgress + 15));

  document.getElementById('income').value = data.income;
  document.getElementById('savingsGoal').value = data.savingsGoal;
  document.getElementById('paydayFrom').value = data.paydayFrom ?? 5;
  document.getElementById('paydayTo').value = data.paydayTo ?? 10;
  document.getElementById('expenseListTotal').textContent = fmt.format(calc.fixed);

  renderExpenseList();
  renderThirdList();
  renderTodaySpends();
}

function renderThirdList() {
  const list = document.getElementById('thirdList');
  list.innerHTML = '';
  const periodStart = getBudgetPeriod().periodStart;

  if (!data.thirds?.length) {
    list.innerHTML = '<li class="spend-empty">Zatím žádné třetinky</li>';
    return;
  }

  data.thirds.forEach((third) => {
    const status = getThirdStatus(third, periodStart);
    const perThird = getInstallmentAmount(third.totalAmount, 1);
    const li = document.createElement('li');
    li.className = `expense-item${status.phase === 'done' ? ' done' : ''}`;

    let badgeClass = 'upcoming';
    let badgeText = `Od ${formatShortDate(status.firstPeriod)}`;
    if (status.phase === 'active') {
      badgeClass = 'active';
      badgeText = `Splátka ${status.installment}/3 · ${fmt.format(status.amount)}`;
    } else if (status.phase === 'done') {
      badgeClass = 'done';
      badgeText = 'Doplaceno';
    }

    li.innerHTML = `
      <div class="expense-icon">⅓</div>
      <div class="expense-info">
        <div class="expense-name">${escapeHtml(third.name)}</div>
        <div class="expense-sub">${fmt.format(third.totalAmount)} celkem · cca ${fmt.format(perThird)}/období</div>
        <span class="third-badge ${badgeClass}">${badgeText}</span>
      </div>
      <div class="expense-actions">
        <button type="button" class="btn btn-danger" data-delete-third="${third.id}">✕</button>
      </div>
    `;
    list.appendChild(li);
  });

  list.querySelectorAll('[data-delete-third]').forEach((btn) => {
    btn.addEventListener('click', () => {
      data.thirds = data.thirds.filter((t) => t.id !== btn.dataset.deleteThird);
      saveData(data);
      render();
    });
  });
}

function renderExpenseList() {
  const list = document.getElementById('expenseList');
  list.innerHTML = '';

  if (data.expenses.length === 0) {
    list.innerHTML = '<li class="spend-empty">Zatím žádné pravidelné výdaje</li>';
    return;
  }

  data.expenses.forEach((expense, i) => {
    const li = document.createElement('li');
    li.className = 'expense-item';
    li.innerHTML = `
      <div class="expense-icon">${expenseIcon(i)}</div>
      <div class="expense-info">
        <div class="expense-name">${escapeHtml(expense.name)}</div>
      </div>
      <span class="expense-amount">${fmt.format(expense.amount)}</span>
      <div class="expense-actions">
        <button type="button" class="btn btn-ghost btn-sm" data-edit="${expense.id}">Upravit</button>
        <button type="button" class="btn btn-danger" data-delete="${expense.id}">✕</button>
      </div>
    `;
    list.appendChild(li);
  });

  list.querySelectorAll('[data-edit]').forEach(btn => {
    btn.addEventListener('click', () => openExpenseModal(btn.dataset.edit));
  });

  list.querySelectorAll('[data-delete]').forEach(btn => {
    btn.addEventListener('click', () => {
      data.expenses = data.expenses.filter(e => e.id !== btn.dataset.delete);
      saveData(data);
      render();
    });
  });
}

function renderTodaySpends() {
  const list = document.getElementById('todaySpends');
  const entries = getTodaySpends();
  list.innerHTML = '';

  if (entries.length === 0) {
    list.innerHTML = '<li class="spend-empty">Dnes zatím nic</li>';
    return;
  }

  entries.slice().reverse().forEach((entry, i) => {
    const li = document.createElement('li');
    li.className = 'spend-item';
    li.innerHTML = `
      <div class="spend-item-info">
        ${entry.note ? `<div class="spend-item-note">${escapeHtml(entry.note)}</div>` : '<div class="spend-item-note">Útrata</div>'}
      </div>
      <span class="spend-item-amount">${fmt.format(entry.amount)}</span>
      <button type="button" class="btn btn-danger" data-remove="${entries.length - 1 - i}">✕</button>
    `;
    list.appendChild(li);
  });

  list.querySelectorAll('[data-remove]').forEach(btn => {
    btn.addEventListener('click', () => removeSpend(Number(btn.dataset.remove)));
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function setManualBalance(value) {
  data.accountBalance = value;
  data.useManualBalance = true;
  data.manualBudgetBase = value;
  saveData(data);
  render();
}

function resetToCalculated() {
  data.useManualBalance = false;
  data.accountBalance = null;
  data.manualBudgetBase = null;
  saveData(data);
  render();
}

function addSpend(amount, note) {
  const key = dateKey();
  if (!data.spendingEntries) data.spendingEntries = {};
  if (!data.spendingEntries[key]) data.spendingEntries[key] = [];

  data.spendingEntries[key].push({ amount, note, time: Date.now() });
  data.spending[key] = (data.spending[key] || 0) + amount;

  if (data.useManualBalance && data.accountBalance !== null) {
    data.accountBalance = Number(data.accountBalance) - amount;
  }

  saveData(data);
  render();
}

function removeSpend(index) {
  const key = dateKey();
  const entries = data.spendingEntries?.[key];
  if (!entries || !entries[index]) return;

  const removed = entries.splice(index, 1)[0];
  data.spending[key] = Math.max(0, (data.spending[key] || 0) - removed.amount);

  if (data.spending[key] === 0) delete data.spending[key];
  if (entries.length === 0) delete data.spendingEntries[key];

  if (data.useManualBalance && data.accountBalance !== null) {
    data.accountBalance = Number(data.accountBalance) + removed.amount;
  }

  saveData(data);
  render();
}

function openThirdModal() {
  const modal = document.getElementById('thirdModal');
  const start = getFirstInstallmentPeriodStart();

  document.getElementById('thirdModalTitle').textContent = 'Přidat třetinku';
  document.getElementById('thirdId').value = '';
  document.getElementById('thirdName').value = '';
  document.getElementById('thirdAmount').value = '';
  document.getElementById('thirdStartHint').textContent =
    `První splátka se strhne od období začínajícího ${formatShortDate(start)} (3 období po sobě).`;

  modal.showModal();
}

function openExpenseModal(id = null) {
  const modal = document.getElementById('expenseModal');
  const expense = id ? data.expenses.find(e => e.id === id) : null;

  document.getElementById('expenseModalTitle').textContent =
    expense ? 'Upravit výdaj' : 'Přidat výdaj';
  document.getElementById('expenseId').value = expense?.id || '';
  document.getElementById('expenseName').value = expense?.name || '';
  document.getElementById('expenseAmount').value = expense?.amount ?? '';

  modal.showModal();
}

function init() {
  if (!data.spendingEntries) data.spendingEntries = {};
  if (!data.thirds) data.thirds = [];

  document.getElementById('income').addEventListener('input', (e) => {
    data.income = Number(e.target.value) || 0;
    saveData(data);
    render();
  });

  document.getElementById('savingsGoal').addEventListener('input', (e) => {
    data.savingsGoal = Number(e.target.value) || 0;
    saveData(data);
    render();
  });

  function updatePaydayRange() {
    const range = clampPaydayRange(
      document.getElementById('paydayFrom').value,
      document.getElementById('paydayTo').value,
    );
    data.paydayFrom = range.from;
    data.paydayTo = range.to;
    saveData(data);
    render();
  }

  document.getElementById('paydayFrom').addEventListener('change', updatePaydayRange);
  document.getElementById('paydayTo').addEventListener('change', updatePaydayRange);

  document.getElementById('accountBalance').addEventListener('change', (e) => {
    setManualBalance(Number(e.target.value) || 0);
  });

  document.getElementById('accountBalance').addEventListener('input', (e) => {
    data.accountBalance = Number(e.target.value) || 0;
    data.useManualBalance = true;
    data.manualBudgetBase = data.accountBalance;
    saveData(data);
    render();
  });

  window.addEventListener('pagehide', () => saveData(data));

  if (location.protocol === 'file:') {
    const sub = document.querySelector('.footer-sub');
    if (sub) {
      sub.textContent +=
        ' · Pro spolehlivé ukládání otevři appku přes lokální server (např. Live Server), ne jen soubor z disku';
    }
  }

  document.getElementById('spendForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const amount = Number(document.getElementById('spendAmount').value);
    const note = document.getElementById('spendNote').value.trim();
    if (amount > 0) {
      addSpend(amount, note);
      document.getElementById('spendAmount').value = '';
      document.getElementById('spendNote').value = '';
    }
  });

  document.getElementById('addExpenseBtn').addEventListener('click', () => openExpenseModal());
  document.getElementById('addThirdBtn').addEventListener('click', () => openThirdModal());

  document.getElementById('thirdForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = document.getElementById('thirdName').value.trim();
    const totalAmount = Number(document.getElementById('thirdAmount').value) || 0;
    if (!name || totalAmount <= 0) return;

    const firstPeriodStart = dateKey(getFirstInstallmentPeriodStart());
    data.thirds.push({
      id: crypto.randomUUID(),
      name,
      totalAmount,
      firstPeriodStart,
    });

    saveData(data);
    document.getElementById('thirdModal').close();
    render();
  });

  document.getElementById('cancelThird').addEventListener('click', () => {
    document.getElementById('thirdModal').close();
  });

  document.getElementById('expenseForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const id = document.getElementById('expenseId').value;
    const name = document.getElementById('expenseName').value.trim();
    const amount = Number(document.getElementById('expenseAmount').value) || 0;

    if (!name) return;

    if (id) {
      const expense = data.expenses.find(exp => exp.id === id);
      if (expense) {
        expense.name = name;
        expense.amount = amount;
      }
    } else {
      data.expenses.push({ id: crypto.randomUUID(), name, amount });
    }

    saveData(data);
    document.getElementById('expenseModal').close();
    render();
  });

  document.getElementById('cancelExpense').addEventListener('click', () => {
    document.getElementById('expenseModal').close();
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  render();
}

init();
