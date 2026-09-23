/* Fanance — zh-Hant-HK personal finance SPA
   localStorage + optional Google Drive sync (drive.file) */
(function () {
  "use strict";

  const STORAGE_KEY = "fanance-data-v1";
  const META_KEY = "fanance-meta-v1";
  const CATEGORIES = ["飲食", "交通", "購物", "娛樂", "固定", "卡數", "其他"];
  const INCOME_CATEGORY = "收入";
  const BUDGET_CATS = ["飲食", "交通", "購物", "娛樂", "其他"];
  const DEFAULT_CATEGORY_BUDGETS = {
    "飲食": 2500,
    "交通": 900,
    "購物": 1500,
    "娛樂": 800,
    "其他": 800,
  };
  const ACCOUNT_NAMES = ["HSBC", "Hang Seng", "Mox", "現金", "其他"];

  const CFG = Object.assign(
    {
      GOOGLE_CLIENT_ID: "",
      DRIVE_FILE_NAME: "fanance-data.json",
      DRIVE_FOLDER_NAME: "Fanance",
      DEMO_MODE: true,
    },
    window.FANANCE_CONFIG || {}
  );

  const hasClientId = !!(CFG.GOOGLE_CLIENT_ID && !CFG.GOOGLE_CLIENT_ID.includes("YOUR_CLIENT_ID"));
  const demoMode = CFG.DEMO_MODE || !hasClientId;

  /** @type {object} */
  let data = null;
  let meta = { lastSyncAt: null, driveFileId: null, signedIn: false, email: null };
  let currentView = "overview";
  let pushTimer = null;
  let tokenClient = null;
  let accessToken = null;
  let gsiReady = false;

  // ——— Seed (inline fallback; also loaded from data/seed.json on first run) ———
  const SEED = {
    "version": 1,
    "updatedAt": "2026-09-23T05:44:40.000Z",
    "profile": {
      "salaryGross": 22000,
      "mpfRate": 0.05,
      "takeHome": 20900,
      "monthlyCap": 8000,
      "categoryBudgets": {
        "飲食": 2500,
        "交通": 900,
        "購物": 1500,
        "娛樂": 800,
        "其他": 800
      },
      "currency": "HKD",
      "name": "Fanance"
    },
    "accounts": [
      {
        "id": "acc-hsbc",
        "name": "HSBC",
        "balance": 5270.38,
        "asOf": "2026-09-16"
      },
      {
        "id": "acc-hangseng",
        "name": "Hang Seng",
        "balance": 132.07,
        "asOf": "2026-09-16"
      },
      {
        "id": "acc-mox",
        "name": "Mox",
        "balance": 2266.09,
        "asOf": "2026-09-16"
      },
      {
        "id": "acc-cash",
        "name": "現金",
        "balance": 0
      },
      {
        "id": "acc-other",
        "name": "其他",
        "balance": 0
      }
    ],
    "cards": [
      {
        "id": "card-enjoy",
        "name": "enJoy",
        "dueDay": 12,
        "notes": "十月結單約 HK$6,342.67（已含分期+fee）；其餘消費約 3,845.70"
      },
      {
        "id": "card-mox",
        "name": "Mox",
        "dueDay": 7,
        "notes": "另有喇叭免息分期；卡數 Split Statement 待 App 確認"
      },
      {
        "id": "card-mmpower",
        "name": "MMPOWER",
        "dueDay": 14,
        "notes": "2026-09-17 已清還；2026-09-22 仍有 Finance Charge HK$151.51"
      }
    ],
    "instalments": [
      {
        "id": "inst-enjoy",
        "cardId": "card-enjoy",
        "name": "enJoy 分期",
        "monthly": 2396.33,
        "fee": 100.64,
        "remaining": null,
        "endMonth": null,
        "dueDay": 12,
        "octStatementOverride": 6342.67,
        "notes": "本金約 28,756／12 期"
      },
      {
        "id": "inst-mox-speakers",
        "cardId": "card-mox",
        "name": "Mox 喇叭",
        "monthly": 1335,
        "fee": 0,
        "remaining": 2,
        "endMonth": "2026-11",
        "dueDay": 7,
        "notes": "本金 16,020，免息 12 期（2025-12 至 2026-11）；已供約 10 期"
      },
      {
        "id": "inst-mox-split",
        "cardId": "card-mox",
        "name": "Mox Split Statement",
        "monthly": 1331,
        "fee": 0,
        "remaining": null,
        "endMonth": null,
        "dueDay": 7,
        "pendingConfirm": true,
        "notes": "由約 15,066.63 分 12 期；每月約 1,280–1,450，現用中位約 1,331；待 App 確認"
      }
    ],
    "subscriptions": [
      {
        "id": "sub-netflix",
        "name": "Netflix",
        "amount": 118,
        "dueDay": 3,
        "notes": "下次約 2026-10-03"
      },
      {
        "id": "sub-bus",
        "name": "巴士月票",
        "amount": 834,
        "dueDay": 14
      },
      {
        "id": "sub-phone",
        "name": "電話費",
        "amount": 225,
        "dueDay": 20,
        "notes": "平時 225；2026-09 例外 315"
      },
      {
        "id": "sub-icloud",
        "name": "iCloud 2TB",
        "amount": 78,
        "dueDay": 27
      }
    ],
    "transactions": [
      {
        "id": "tx-0907-speaker",
        "date": "2026-09-07",
        "amount": 1335,
        "category": "卡數",
        "account": "Mox",
        "note": "喇叭分期第10期"
      },
      {
        "id": "tx-0914-bus",
        "date": "2026-09-14",
        "amount": 834,
        "category": "交通",
        "account": "HSBC",
        "note": "巴士月票"
      },
      {
        "id": "tx-0920-phone",
        "date": "2026-09-20",
        "amount": 315,
        "category": "固定",
        "account": "HSBC",
        "note": "電話費（九月例外）"
      },
      {
        "id": "tx-0921-meal",
        "date": "2026-09-21",
        "amount": 900,
        "category": "飲食",
        "account": "HSBC",
        "note": "同屋企人食飯"
      },
      {
        "id": "tx-0922-mmpower",
        "date": "2026-09-22",
        "amount": 151.51,
        "category": "卡數",
        "account": "其他",
        "note": "MMPOWER Finance Charge"
      },
      {
        "id": "tx-0922-gift1",
        "date": "2026-09-22",
        "amount": 636.26,
        "category": "購物",
        "account": "Mox",
        "note": "週年禮物（1）"
      },
      {
        "id": "tx-0922-gift2",
        "date": "2026-09-22",
        "amount": 534.11,
        "category": "購物",
        "account": "Mox",
        "note": "週年禮物（2）"
      },
      {
        "id": "tx-0922-steam",
        "date": "2026-09-22",
        "amount": 249,
        "category": "娛樂",
        "account": "Mox",
        "note": "Steam"
      },
      {
        "id": "tx-0922-bag",
        "date": "2026-09-22",
        "amount": 2400,
        "category": "購物",
        "account": "Mox",
        "note": "買袋"
      },
      {
        "id": "tx-0927-icloud",
        "date": "2026-09-27",
        "amount": 78,
        "category": "固定",
        "account": "HSBC",
        "note": "iCloud 2TB"
      }
    ]
  };

  // ——— Utils ———
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

  function uid(prefix) {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  }

  function money(n) {
    const v = Number(n) || 0;
    const sign = v < 0 ? "-" : "";
    const abs = Math.abs(v);
    const formatted = abs.toLocaleString("en-HK", {
      minimumFractionDigits: abs % 1 ? 2 : 0,
      maximumFractionDigits: 2,
    });
    return `${sign}HK$${formatted}`;
  }

  function todayISO() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function nowISO() {
    return new Date().toISOString();
  }

  function toast(msg, type = "") {
    const wrap = $("#toasts");
    const el = document.createElement("div");
    el.className = `toast ${type}`;
    el.textContent = msg;
    wrap.appendChild(el);
    setTimeout(() => el.remove(), 3200);
  }

  function touchUpdated() {
    data.updatedAt = nowISO();
    saveLocal();
    schedulePush();
  }

  function saveLocal() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    localStorage.setItem(META_KEY, JSON.stringify(meta));
  }

  function loadLocal() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const m = localStorage.getItem(META_KEY);
      if (m) meta = Object.assign(meta, JSON.parse(m));
      if (raw) {
        data = JSON.parse(raw);
        return true;
      }
    } catch (e) {
      console.warn("loadLocal", e);
    }
    return false;
  }

  function isIncome(t) {
    return t && t.type === "income";
  }

  function isExpense(t) {
    return !isIncome(t);
  }

  /** Once: seed default categoryBudgets if missing; never wipe user edits */
  function ensureCategoryBudgets() {
    if (!data || !data.profile) return false;
    if (!data.profile.categoryBudgets || typeof data.profile.categoryBudgets !== "object") {
      data.profile.categoryBudgets = Object.assign({}, DEFAULT_CATEGORY_BUDGETS);
      return true;
    }
    return false;
  }

  function migrateData() {
    let changed = false;
    if (ensureCategoryBudgets()) changed = true;
    (data.transactions || []).forEach((t) => {
      if (t.type == null) {
        /* legacy = expense; leave unset for backward-compatible reads via isExpense */
      }
    });
    if (changed) {
      touchUpdated();
    }
    return changed;
  }

  function monthIncomeTotal() {
    return (data.transactions || [])
      .filter((t) => isIncome(t) && isCurrentMonth(t.date))
      .reduce((s, t) => s + (Number(t.amount) || 0), 0);
  }

  function monthSpendByCategory(cat) {
    return (data.transactions || [])
      .filter((t) => isExpense(t) && isCurrentMonth(t.date) && t.category === cat)
      .reduce((s, t) => s + (Number(t.amount) || 0), 0);
  }

  function adjustAccountBalance(accountName, delta) {
    const acc = (data.accounts || []).find((a) => a.name === accountName);
    if (!acc) return false;
    acc.balance = (Number(acc.balance) || 0) + (Number(delta) || 0);
    acc.asOf = todayISO();
    return true;
  }

  function maybeBudgetToast(category) {
    const budgets = (data.profile && data.profile.categoryBudgets) || {};
    const cap = Number(budgets[category]);
    if (!cap || cap <= 0) return;
    if (["固定", "卡數", INCOME_CATEGORY].includes(category)) return;
    const spent = monthSpendByCategory(category);
    if (spent > cap) {
      toast(`${category} 已超預算（${money(spent)}／${money(cap)}）`, "error");
    }
  }

  // ——— Calculations ———
  function sumSubs() {
    return (data.subscriptions || []).reduce((s, x) => s + (Number(x.amount) || 0), 0);
  }

  function instalmentMonthly(inst) {
    return (Number(inst.monthly) || 0) + (Number(inst.fee) || 0);
  }

  function isInstalmentActive(inst) {
    if (!inst || inst.active === false) return false;
    const rem = inst.remaining != null ? Number(inst.remaining) : null;
    const remP = inst.remainingPeriods != null ? Number(inst.remainingPeriods) : null;
    if (rem != null && !Number.isNaN(rem) && rem <= 0) return false;
    if (remP != null && !Number.isNaN(remP) && remP <= 0) return false;
    if (inst.endMonth && monthKey() > String(inst.endMonth)) return false;
    return true;
  }

  function activeInstalments() {
    return (data.instalments || []).filter(isInstalmentActive);
  }

  function sumInstalments() {
    return activeInstalments().reduce((s, x) => s + instalmentMonthly(x), 0);
  }

  function formatMonthLabel(mk) {
    const parts = String(mk || "").split("-");
    if (parts.length < 2) return mk || "";
    return `${parts[0]}年${parseInt(parts[1], 10)}月`;
  }

  function spendForMonthKey(mk, discretionaryOnly) {
    return (data.transactions || [])
      .filter((t) => {
        if (!isExpense(t)) return false;
        if (!String(t.date || "").startsWith(mk)) return false;
        if (discretionaryOnly && ["固定", "卡數"].includes(t.category)) return false;
        return true;
      })
      .reduce((s, t) => s + (Number(t.amount) || 0), 0);
  }

  function countTxForMonth(mk) {
    return (data.transactions || []).filter((t) => String(t.date || "").startsWith(mk)).length;
  }

  /** Automatic month rollover — archive prior month, tick instalments, no fake sub txs */
  function runMonthRolloverIfNeeded() {
    if (!data) return false;
    const current = monthKey();
    const last = data.lastMonthKey || null;

    if (!Array.isArray(data.monthHistory)) data.monthHistory = [];

    // First run / upgrade: stamp current month, no big modal
    if (!last) {
      data.lastMonthKey = current;
      touchUpdated();
      toast("已設定為本月 " + current, "ok");
      return false;
    }

    if (last === current) return false;

    // Archive the stored lastMonthKey once (even if user skipped months)
    const disc = spendForMonthKey(last, true);
    const all = spendForMonthKey(last, false);
    const txCount = countTxForMonth(last);
    const archiveEntry = {
      month: last,
      archivedAt: nowISO(),
      discretionarySpend: disc,
      allSpend: all,
      accountsTotal: accountsTotal(),
      leftoverEstimate: leftover(),
      transactionCount: txCount,
    };
    data.monthHistory.push(archiveEntry);
    if (data.monthHistory.length > 36) {
      data.monthHistory = data.monthHistory.slice(-36);
    }

    // Tick instalments for the new month
    (data.instalments || []).forEach((i) => {
      if (typeof i.remaining === "number" && !Number.isNaN(i.remaining)) {
        i.remaining = Math.max(0, i.remaining - 1);
      }
      if (typeof i.remainingPeriods === "number" && !Number.isNaN(i.remainingPeriods)) {
        i.remainingPeriods = Math.max(0, i.remainingPeriods - 1);
      }
      if (i.endMonth && current > String(i.endMonth)) {
        i.active = false;
      }
      if (
        (typeof i.remaining === "number" && i.remaining <= 0) ||
        (typeof i.remainingPeriods === "number" && i.remainingPeriods <= 0)
      ) {
        i.active = false;
      }
      // Keep octStatementOverride only during 2026-10; clear otherwise
      if (i.octStatementOverride != null && current !== "2026-10") {
        delete i.octStatementOverride;
      }
      if (i.notes && /十月結單|十月例外/.test(i.notes) && current > "2026-10") {
        i.notes = String(i.notes)
          .replace(/[；;]?\s*十月結單[^；;]*/g, "")
          .replace(/[；;]?\s*十月例外[^；;]*/g, "")
          .trim();
      }
    });

    (data.cards || []).forEach((c) => {
      if (c.notes && /十月結單/.test(c.notes) && current > "2026-10") {
        c.notes = String(c.notes)
          .replace(/[；;]?\s*十月結單[^；;]*/g, "")
          .trim();
      }
    });

    const expectedItems = [];
    (data.subscriptions || []).forEach((s) => {
      expectedItems.push({ kind: "固定", name: s.name, amount: Number(s.amount) || 0 });
    });
    activeInstalments().forEach((i) => {
      expectedItems.push({ kind: "卡數", name: i.name, amount: instalmentMonthly(i) });
    });
    const expectedTotal = expectedItems.reduce((s, x) => s + (Number(x.amount) || 0), 0);

    data.lastMonthKey = current;
    touchUpdated();

    showRolloverSheet({
      current,
      archive: archiveEntry,
      expectedItems,
      expectedTotal,
    });
    return true;
  }

  function showRolloverSheet({ current, archive, expectedItems, expectedTotal }) {
    const listHtml = expectedItems.length
      ? `<ul class="list">${expectedItems
          .map(
            (x) => `
          <li class="list-item">
            <div class="meta">
              <div class="title">${esc(x.name)}</div>
              <div class="sub">${esc(x.kind)}</div>
            </div>
            <div class="amt">${money(x.amount)}</div>
          </li>`
          )
          .join("")}</ul>`
      : `<div class="empty">未有預期固定項目</div>`;

    openSheet(`
      <div class="sheet-handle"></div>
      <h3>已進入 ${esc(formatMonthLabel(current))}</h3>
      <div class="card" style="margin-bottom:12px">
        <h2 style="font-size:0.95rem;margin:0 0 8px">上個月摘要（${esc(archive.month)}）</h2>
        <div class="hero-sub">開支合計 ${money(archive.allSpend)} · 非固定／卡數 ${money(archive.discretionarySpend)}</div>
        <div class="hero-sub">交易 ${archive.transactionCount} 筆 · 戶口合計當時 ${money(archive.accountsTotal)}</div>
      </div>
      <div class="card" style="margin-bottom:12px;padding:4px 12px">
        <div class="section-title" style="margin:8px 0"><span>本月預期固定</span><span>${money(expectedTotal)}</span></div>
        ${listHtml}
        <div class="hero-sub" style="padding:8px 4px 12px">唔會自動記帳——請你確認付款後再喺「記帳」入數。</div>
      </div>
      <div class="note-box" style="margin-bottom:14px">提醒：卡結單金額可能變，請喺「卡數」更新。</div>
      <button type="button" class="btn btn-primary" id="btnRolloverOk">知道了</button>
    `);
    const ok = $("#btnRolloverOk");
    if (ok) ok.onclick = () => closeSheet();
  }


  function monthlyFixed() {
    return sumSubs() + sumInstalments();
  }

  function leftover() {
    const take = Number(data.profile.takeHome) || 0;
    return take - monthlyFixed();
  }

  function monthKey(d = new Date()) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }

  function isCurrentMonth(dateStr) {
    return String(dateStr || "").startsWith(monthKey());
  }

  function monthSpendDiscretionary() {
    // Cap track: exclude 固定 / 卡數 / income
    return (data.transactions || [])
      .filter(
        (t) =>
          isExpense(t) &&
          isCurrentMonth(t.date) &&
          !["固定", "卡數"].includes(t.category)
      )
      .reduce((s, t) => s + (Number(t.amount) || 0), 0);
  }

  function monthSpendAll() {
    return (data.transactions || [])
      .filter((t) => isExpense(t) && isCurrentMonth(t.date))
      .reduce((s, t) => s + (Number(t.amount) || 0), 0);
  }

  function upcomingDues(withinDays = 14) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const items = [];

    function nextDueDate(dueDay) {
      if (!dueDay) return null;
      const y = today.getFullYear();
      const m = today.getMonth();
      let d = new Date(y, m, dueDay);
      if (d < today) d = new Date(y, m + 1, dueDay);
      return d;
    }

    (data.subscriptions || []).forEach((s) => {
      const d = nextDueDate(s.dueDay);
      if (!d) return;
      const diff = Math.round((d - today) / 86400000);
      if (diff <= withinDays) {
        items.push({
          kind: "固定",
          name: s.name,
          amount: s.amount,
          dueDay: s.dueDay,
          date: d,
          days: diff,
        });
      }
    });

    activeInstalments().forEach((i) => {
      const d = nextDueDate(i.dueDay);
      if (!d) return;
      const diff = Math.round((d - today) / 86400000);
      if (diff <= withinDays) {
        items.push({
          kind: "卡數",
          name: i.name,
          amount: instalmentMonthly(i),
          dueDay: i.dueDay,
          date: d,
          days: diff,
          pending: !!i.pendingConfirm,
        });
      }
    });

    items.sort((a, b) => a.date - b.date);
    return items;
  }

  function accountsTotal() {
    return (data.accounts || []).reduce((s, a) => s + (Number(a.balance) || 0), 0);
  }

  // ——— Navigation ———
  function switchView(name) {
    currentView = name;
    $$(".view").forEach((v) => v.classList.toggle("active", v.dataset.view === name));
    $$(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.nav === name));
    render();
  }

  // ——— Render ———
  function render() {
    updateChrome();
    if (currentView === "overview") renderOverview();
    else if (currentView === "ledger") renderLedger();
    else if (currentView === "subs") renderSubs();
    else if (currentView === "cards") renderCards();
    else if (currentView === "settings") renderSettings();
  }

  function updateChrome() {
    const badge = $("#modeBadge");
    const dot = $("#syncDot");
    if (demoMode || !meta.signedIn) {
      badge.textContent = demoMode ? "演示模式" : "本地";
    } else {
      badge.textContent = "已同步";
    }
    dot.className = "sync-dot";
    if (meta.signedIn && accessToken) dot.classList.add("on");
    else if (!navigator.onLine) dot.classList.add("warn");
  }

  function renderOverview() {
    const el = $("#view-overview");
    const left = leftover();
    const fixed = monthlyFixed();
    const cap = Number(data.profile.monthlyCap) || 8000;
    const room = cap - fixed; // often negative if fixed > cap — show discretionary room under 8000
    // Interpreting prior advice: room under 8000 for discretionary = cap - fixed (can be negative)
    // Also show spend vs 8000 target for this month's discretionary spend
    const discSpend = monthSpendDiscretionary();
    const allSpend = monthSpendAll();
    const pct = Math.min(100, Math.round((discSpend / cap) * 100));
    const over = discSpend > cap;
    const dues = upcomingDues(14);
    const take = data.profile.takeHome;
    const mk = monthKey();
    const incomeMonth = monthIncomeTotal();
    const budgets = (data.profile && data.profile.categoryBudgets) || {};

    const octNotes = activeInstalments().filter((i) => i.octStatementOverride);
    const octHtml = octNotes.length
      ? `<div class="note-box">十月結單提示：${octNotes
          .map((i) => `${esc(i.name)} 約 ${money(i.octStatementOverride)}（含分期）`)
          .join("；")}</div>`
      : "";

    const budgetRows = BUDGET_CATS.filter((c) => Number(budgets[c]) > 0)
      .map((c) => {
        const capB = Number(budgets[c]) || 0;
        const spent = monthSpendByCategory(c);
        const pctB = capB ? Math.min(100, Math.round((spent / capB) * 100)) : 0;
        const overB = spent > capB;
        return `
          <div class="cat-budget-row ${overB ? "over" : ""}">
            <div class="progress-meta">
              <span>${esc(c)}</span>
              <span>${money(spent)}／${money(capB)}${overB ? " · 超咗" : ""}</span>
            </div>
            <div class="progress ${overB ? "over" : ""}"><span style="width:${pctB}%"></span></div>
          </div>`;
      })
      .join("");

    el.innerHTML = `
      <div class="month-chip">本月 ${esc(mk)}</div>
      <div class="card">
        <h2>估計每月剩錢</h2>
        <div class="hero-amount ${left >= 0 ? "positive" : "negative"}">${money(left)}</div>
        <div class="hero-sub">實收 ${money(take)} − 固定 ${money(sumSubs())} − 卡數分期 ${money(sumInstalments())}</div>
        ${octHtml}
      </div>

      <div class="card payroll-card">
        <h2>出糧入帳</h2>
        <div class="hero-sub" style="margin-bottom:10px">一鍵將實收薪金記入戶口（收入）</div>
        <button type="button" class="btn btn-primary" id="btnPayroll">出糧入帳</button>
        <div class="hero-sub" style="margin-top:10px">本月已入帳收入 ${money(incomeMonth)}</div>
      </div>

      <div class="card">
        <h2>本月開支 vs 目標 HK$8,000</h2>
        <div class="progress ${over ? "over" : ""}"><span style="width:${pct}%"></span></div>
        <div class="progress-meta">
          <span>已用（非固定／卡數）${money(discSpend)}</span>
          <span>${pct}%</span>
        </div>
        <div class="hero-sub" style="margin-top:8px">
          固定＋分期共 ${money(fixed)} · 目標下可動用空間 ${money(room)}
          ${room < 0 ? "（固定已超目標）" : ""}
        </div>
        <div class="hero-sub">本月記帳總額 ${money(allSpend)}</div>
      </div>

      <div class="card">
        <h2>分類預算</h2>
        ${
          budgetRows
            ? budgetRows
            : `<div class="empty">未設定分類預算 — 去「設定」加入</div>`
        }
      </div>

      <div class="grid-2">
        <div class="stat-tile">
          <div class="label">戶口合計</div>
          <div class="value">${money(accountsTotal())}</div>
        </div>
        <div class="stat-tile">
          <div class="label">固定開支</div>
          <div class="value">${money(sumSubs())}</div>
        </div>
        <div class="stat-tile">
          <div class="label">卡數分期／月</div>
          <div class="value">${money(sumInstalments())}</div>
        </div>
        <div class="stat-tile">
          <div class="label">實收薪金</div>
          <div class="value">${money(take)}</div>
        </div>
      </div>

      <div class="section-title"><span>即將到期（14 日內）</span></div>
      <div class="card" style="padding:4px 12px">
        ${
          dues.length
            ? `<ul class="list">${dues
                .map(
                  (d) => `
              <li class="list-item due-soon">
                <div class="meta">
                  <div class="title">${esc(d.name)}${d.pending ? '<span class="tag">待確認</span>' : ""}</div>
                  <div class="sub">${d.kind} · 每月 ${d.dueDay} 號 · ${d.days === 0 ? "今日" : d.days + " 日後"}</div>
                </div>
                <div class="amt">${money(d.amount)}</div>
              </li>`
                )
                .join("")}</ul>`
            : `<div class="empty">14 日內無到期項目</div>`
        }
      </div>
    `;

    const btnPay = $("#btnPayroll");
    if (btnPay) btnPay.onclick = () => openPayrollSheet();
  }

  function openPayrollSheet() {
    const take = Number(data.profile.takeHome) || 0;
    const accNames = (data.accounts || []).map((a) => a.name);
    const names = accNames.length ? accNames : ACCOUNT_NAMES;
    const defaultAcc = names.includes("HSBC") ? "HSBC" : names[0];
    openSheet(`
      <div class="sheet-handle"></div>
      <h3>出糧入帳</h3>
      <div class="form-row"><label>金額（預設實收）</label>
        <input class="input amount" type="number" id="payAmount" step="0.01" min="0" value="${take}" />
      </div>
      <div class="form-row"><label>入邊個戶口</label>
        <div class="chips" id="payAcc">${names
          .map(
            (c) =>
              `<button type="button" class="chip ${c === defaultAcc ? "active" : ""}" data-val="${esc(c)}">${esc(c)}</button>`
          )
          .join("")}</div>
      </div>
      <div class="form-row"><label>日期</label>
        <input class="input" type="date" id="payDate" value="${todayISO()}" />
      </div>
      <div class="form-row"><label>備註</label>
        <input class="input" type="text" id="payNote" value="出糧" maxlength="80" />
      </div>
      <div class="btn-row">
        <button type="button" class="btn btn-secondary" id="payCancel">取消</button>
        <button type="button" class="btn btn-primary" id="payConfirm">確認入帳</button>
      </div>
    `);
    wireChips("#payAcc");
    $("#payCancel").onclick = closeSheet;
    $("#payConfirm").onclick = () => {
      const amount = parseFloat($("#payAmount").value);
      if (!amount || amount <= 0) {
        toast("請輸入金額", "error");
        return;
      }
      const account = chipValue("#payAcc") || defaultAcc;
      const tx = {
        id: uid("tx"),
        date: $("#payDate").value || todayISO(),
        amount,
        category: INCOME_CATEGORY,
        account,
        note: ($("#payNote").value || "").trim() || "出糧",
        type: "income",
      };
      data.transactions.push(tx);
      adjustAccountBalance(account, amount);
      touchUpdated();
      closeSheet();
      toast(`已入帳收入 ${money(amount)} → ${account}`, "ok");
      renderOverview();
    };
  }

  function renderLedger() {
    const el = $("#view-ledger");
    const txs = [...(data.transactions || [])].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

    el.innerHTML = `
      <div class="card">
        <h2>快速記帳</h2>
        <div class="form-row">
          <label>類型</label>
          <div class="chips" id="typeChips">
            <button type="button" class="chip active" data-val="expense">支出</button>
            <button type="button" class="chip" data-val="income">收入</button>
          </div>
        </div>
        <div class="form-row">
          <label>金額（HKD）</label>
          <input class="input amount" type="number" inputmode="decimal" id="txAmount" placeholder="0" step="0.01" min="0" />
        </div>
        <div class="form-row" id="catRow">
          <label>類別</label>
          <div class="chips" id="catChips">
            ${CATEGORIES.map((c, i) => `<button type="button" class="chip ${i === 0 ? "active" : ""}" data-val="${esc(c)}">${esc(c)}</button>`).join("")}
          </div>
        </div>
        <div class="form-row">
          <label>戶口</label>
          <div class="chips" id="accChips">
            ${ACCOUNT_NAMES.map((c, i) => `<button type="button" class="chip ${i === 0 ? "active" : ""}" data-val="${esc(c)}">${esc(c)}</button>`).join("")}
          </div>
        </div>
        <div class="form-row">
          <label>日期</label>
          <input class="input" type="date" id="txDate" value="${todayISO()}" />
        </div>
        <div class="form-row">
          <label>備註（可選）</label>
          <input class="input" type="text" id="txNote" placeholder="例如：午餐" maxlength="80" />
        </div>
        <button type="button" class="btn btn-primary" id="btnAddTx">記一筆</button>
      </div>

      <div class="section-title"><span>最近交易</span><span>${txs.length} 筆</span></div>
      <div class="card" style="padding:4px 12px">
        ${
          txs.length
            ? `<ul class="list">${txs
                .map((t) => {
                  const inc = isIncome(t);
                  const amtCls = inc ? "amt in" : "amt out";
                  const amtTxt = inc ? "+" + money(t.amount) : money(t.amount);
                  const typeTag = inc ? "收入" : "支出";
                  return `
              <li class="list-item" data-id="${esc(t.id)}">
                <div class="meta">
                  <div class="title">${esc(t.category)}${t.note ? " · " + esc(t.note) : ""}</div>
                  <div class="sub">${esc(t.date)} · ${esc(t.account)} · ${typeTag}</div>
                </div>
                <div class="${amtCls}">${amtTxt}</div>
                <div class="list-actions">
                  <button type="button" class="icon-btn" data-edit-tx="${esc(t.id)}" aria-label="編輯">✎</button>
                  <button type="button" class="icon-btn danger" data-del-tx="${esc(t.id)}" aria-label="刪除">✕</button>
                </div>
              </li>`;
                })
                .join("")}</ul>`
            : `<div class="empty">未有交易</div>`
        }
      </div>
    `;

    wireChips("#typeChips");
    wireChips("#catChips");
    wireChips("#accChips");
    const typeBox = $("#typeChips");
    if (typeBox) {
      const syncTypeUI = () => {
        const typ = chipValue("#typeChips") || "expense";
        const catRow = $("#catRow");
        if (typ === "income") {
          if (catRow) {
            catRow.innerHTML = `<label>類別</label><div class="chips" id="catChips"><button type="button" class="chip active" data-val="${INCOME_CATEGORY}">${INCOME_CATEGORY}</button></div>`;
            wireChips("#catChips");
          }
          const note = $("#txNote");
          if (note && !note.value) note.placeholder = "例如：出糧";
        } else {
          if (catRow) {
            catRow.innerHTML = `<label>類別</label><div class="chips" id="catChips">${CATEGORIES.map(
              (c, i) =>
                `<button type="button" class="chip ${i === 0 ? "active" : ""}" data-val="${esc(c)}">${esc(c)}</button>`
            ).join("")}</div>`;
            wireChips("#catChips");
          }
          const note = $("#txNote");
          if (note) note.placeholder = "例如：午餐";
        }
      };
      const prev = typeBox.onclick;
      typeBox.onclick = (e) => {
        if (typeof prev === "function") prev(e);
        else {
          const btn = e.target.closest(".chip");
          if (!btn) return;
          $$(".chip", typeBox).forEach((c) => c.classList.remove("active"));
          btn.classList.add("active");
        }
        syncTypeUI();
      };
    }
    $("#btnAddTx").onclick = () => addTransaction();
    $$("[data-del-tx]").forEach((b) => (b.onclick = () => deleteTx(b.dataset.delTx)));
    $$("[data-edit-tx]").forEach((b) => (b.onclick = () => openEditTx(b.dataset.editTx)));
  }

  function wireChips(sel) {
    const box = $(sel);
    if (!box) return;
    box.onclick = (e) => {
      const btn = e.target.closest(".chip");
      if (!btn) return;
      $$(".chip", box).forEach((c) => c.classList.remove("active"));
      btn.classList.add("active");
    };
  }

  function chipValue(sel) {
    const a = $(`${sel} .chip.active`);
    return a ? a.dataset.val : "";
  }

  function addTransaction() {
    const amount = parseFloat($("#txAmount").value);
    if (!amount || amount <= 0) {
      toast("請輸入金額", "error");
      return;
    }
    const typ = chipValue("#typeChips") || "expense";
    const isInc = typ === "income";
    const tx = {
      id: uid("tx"),
      date: $("#txDate").value || todayISO(),
      amount,
      category: isInc ? INCOME_CATEGORY : chipValue("#catChips") || "其他",
      account: chipValue("#accChips") || "其他",
      note: ($("#txNote").value || "").trim(),
      type: isInc ? "income" : "expense",
    };
    data.transactions.push(tx);
    if (isInc) {
      adjustAccountBalance(tx.account, amount);
    }
    touchUpdated();
    toast(isInc ? "已記收入" : "已記帳", "ok");
    if (!isInc) maybeBudgetToast(tx.category);
    renderLedger();
  }

  function deleteTx(id) {
    if (!confirm("刪除呢筆交易？")) return;
    const t = data.transactions.find((x) => x.id === id);
    if (t && isIncome(t)) {
      adjustAccountBalance(t.account, -(Number(t.amount) || 0));
    }
    data.transactions = data.transactions.filter((x) => x.id !== id);
    touchUpdated();
    toast("已刪除", "ok");
    renderLedger();
  }

  function openEditTx(id) {
    const t = data.transactions.find((x) => x.id === id);
    if (!t) return;
    const wasInc = isIncome(t);
    const typ = wasInc ? "income" : "expense";
    const catChips =
      typ === "income"
        ? `<button type="button" class="chip active" data-val="${INCOME_CATEGORY}">${INCOME_CATEGORY}</button>`
        : CATEGORIES.map(
            (c) =>
              `<button type="button" class="chip ${c === t.category ? "active" : ""}" data-val="${esc(c)}">${esc(c)}</button>`
          ).join("");
    openSheet(`
      <div class="sheet-handle"></div>
      <h3>編輯交易</h3>
      <div class="form-row"><label>類型</label>
        <div class="chips" id="eType">
          <button type="button" class="chip ${typ === "expense" ? "active" : ""}" data-val="expense">支出</button>
          <button type="button" class="chip ${typ === "income" ? "active" : ""}" data-val="income">收入</button>
        </div>
      </div>
      <div class="form-row"><label>金額</label><input class="input amount" id="eAmount" type="number" step="0.01" value="${t.amount}" /></div>
      <div class="form-row" id="eCatRow"><label>類別</label>
        <div class="chips" id="eCat">${catChips}</div>
      </div>
      <div class="form-row"><label>戶口</label>
        <div class="chips" id="eAcc">${ACCOUNT_NAMES.map((c) => `<button type="button" class="chip ${c === t.account ? "active" : ""}" data-val="${esc(c)}">${esc(c)}</button>`).join("")}</div>
      </div>
      <div class="form-row"><label>日期</label><input class="input" type="date" id="eDate" value="${esc(t.date)}" /></div>
      <div class="form-row"><label>備註</label><input class="input" id="eNote" value="${esc(t.note || "")}" /></div>
      <div class="btn-row">
        <button type="button" class="btn btn-secondary" id="eCancel">取消</button>
        <button type="button" class="btn btn-primary" id="eSave">儲存</button>
      </div>
    `);
    wireChips("#eType");
    wireChips("#eCat");
    wireChips("#eAcc");
    const eType = $("#eType");
    if (eType) {
      eType.onclick = (e) => {
        const btn = e.target.closest(".chip");
        if (!btn) return;
        $$(".chip", eType).forEach((c) => c.classList.remove("active"));
        btn.classList.add("active");
        const nt = btn.dataset.val;
        const row = $("#eCatRow");
        if (!row) return;
        if (nt === "income") {
          row.innerHTML = `<label>類別</label><div class="chips" id="eCat"><button type="button" class="chip active" data-val="${INCOME_CATEGORY}">${INCOME_CATEGORY}</button></div>`;
        } else {
          const cur = t.category === INCOME_CATEGORY ? "其他" : t.category;
          row.innerHTML = `<label>類別</label><div class="chips" id="eCat">${CATEGORIES.map(
            (c) =>
              `<button type="button" class="chip ${c === cur ? "active" : ""}" data-val="${esc(c)}">${esc(c)}</button>`
          ).join("")}</div>`;
        }
        wireChips("#eCat");
      };
    }
    $("#eCancel").onclick = closeSheet;
    $("#eSave").onclick = () => {
      const prevAmt = Number(t.amount) || 0;
      const prevAcc = t.account;
      const prevInc = isIncome(t);
      const newType = chipValue("#eType") || "expense";
      const newInc = newType === "income";
      const newAmt = parseFloat($("#eAmount").value) || t.amount;
      const newAcc = chipValue("#eAcc") || t.account;
      t.amount = newAmt;
      t.category = newInc ? INCOME_CATEGORY : chipValue("#eCat") || t.category;
      t.account = newAcc;
      t.date = $("#eDate").value || t.date;
      t.note = ($("#eNote").value || "").trim();
      t.type = newInc ? "income" : "expense";
      // Rebalance accounts if income side changed
      if (prevInc) adjustAccountBalance(prevAcc, -prevAmt);
      if (newInc) adjustAccountBalance(newAcc, newAmt);
      touchUpdated();
      closeSheet();
      toast("已更新", "ok");
      if (!newInc) maybeBudgetToast(t.category);
      renderLedger();
    };
  }

  function renderSubs() {
    const el = $("#view-subs");
    const subs = [...(data.subscriptions || [])].sort((a, b) => (a.dueDay || 99) - (b.dueDay || 99));
    const total = sumSubs();
    el.innerHTML = `
      <div class="card">
        <h2>每月固定合計</h2>
        <div class="hero-amount">${money(total)}</div>
        <div class="hero-sub">${subs.length} 項訂閱／固定開支</div>
      </div>
      <div class="btn-row" style="margin-bottom:12px">
        <button type="button" class="btn btn-primary" id="btnAddSub">新增固定</button>
      </div>
      <div class="card" style="padding:4px 12px">
        <ul class="list">
          ${subs
            .map(
              (s) => `
            <li class="list-item">
              <div class="meta">
                <div class="title">${esc(s.name)}</div>
                <div class="sub">每月 ${s.dueDay || "—"} 號到期</div>
              </div>
              <div class="amt">${money(s.amount)}</div>
              <div class="list-actions">
                <button type="button" class="icon-btn" data-edit-sub="${esc(s.id)}">✎</button>
                <button type="button" class="icon-btn danger" data-del-sub="${esc(s.id)}">✕</button>
              </div>
            </li>`
            )
            .join("")}
        </ul>
      </div>
    `;
    $("#btnAddSub").onclick = () => openSubForm();
    $$("[data-del-sub]").forEach((b) => {
      b.onclick = () => {
        if (!confirm("刪除呢項固定開支？")) return;
        data.subscriptions = data.subscriptions.filter((s) => s.id !== b.dataset.delSub);
        touchUpdated();
        renderSubs();
      };
    });
    $$("[data-edit-sub]").forEach((b) => {
      b.onclick = () => openSubForm(data.subscriptions.find((s) => s.id === b.dataset.editSub));
    });
  }

  function openSubForm(existing) {
    const s = existing || { name: "", amount: "", dueDay: 1 };
    openSheet(`
      <div class="sheet-handle"></div>
      <h3>${existing ? "編輯" : "新增"}固定開支</h3>
      <div class="form-row"><label>名稱</label><input class="input" id="sName" value="${esc(s.name)}" /></div>
      <div class="form-row"><label>金額</label><input class="input" type="number" step="0.01" id="sAmt" value="${s.amount}" /></div>
      <div class="form-row"><label>到期日（每月幾號）</label><input class="input" type="number" min="1" max="28" id="sDue" value="${s.dueDay || 1}" /></div>
      <div class="btn-row">
        <button type="button" class="btn btn-secondary" id="sCancel">取消</button>
        <button type="button" class="btn btn-primary" id="sSave">儲存</button>
      </div>
    `);
    $("#sCancel").onclick = closeSheet;
    $("#sSave").onclick = () => {
      const name = $("#sName").value.trim();
      const amount = parseFloat($("#sAmt").value);
      const dueDay = parseInt($("#sDue").value, 10);
      if (!name || !(amount >= 0)) {
        toast("請填名稱同金額", "error");
        return;
      }
      if (existing) {
        existing.name = name;
        existing.amount = amount;
        existing.dueDay = dueDay;
      } else {
        data.subscriptions.push({ id: uid("sub"), name, amount, dueDay });
      }
      touchUpdated();
      closeSheet();
      renderSubs();
    };
  }

  function renderCards() {
    const el = $("#view-cards");
    const inst = data.instalments || [];
    const cards = data.cards || [];
    const total = sumInstalments();

    el.innerHTML = `
      <div class="card">
        <h2>卡數分期每月合計</h2>
        <div class="hero-amount">${money(total)}</div>
        <div class="hero-sub">本金＋手續費</div>
      </div>

      <div class="section-title"><span>分期</span>
        <button type="button" class="btn btn-ghost" id="btnAddInst">＋新增</button>
      </div>
      <div class="card" style="padding:4px 12px">
        <ul class="list">
          ${inst
            .map((i) => {
              const card = cards.find((c) => c.id === i.cardId);
              const active = isInstalmentActive(i);
              const rem =
                i.remaining != null
                  ? `剩 ${i.remaining} 期`
                  : i.remainingPeriods != null
                    ? `剩 ${i.remainingPeriods} 期`
                    : i.endMonth
                      ? `至 ${i.endMonth}`
                      : "進行中";
              return `
              <li class="list-item${!active ? " muted-row" : ""}">
                <div class="meta">
                  <div class="title">${esc(i.name)}${i.pendingConfirm ? '<span class="tag">待確認</span>' : ""}${
                    i.octStatementOverride ? '<span class="tag muted">十月結單</span>' : ""
                  }${!active ? '<span class="tag muted">已結束</span>' : ""}</div>
                  <div class="sub">${card ? esc(card.name) : ""} · ${i.dueDay || "—"} 號 · ${rem}
                    ${i.fee ? ` · 手續費 ${money(i.fee)}` : ""}
                    ${i.notes ? " · " + esc(i.notes) : ""}
                  </div>
                </div>
                <div class="amt">${money(instalmentMonthly(i))}</div>
                <div class="list-actions">
                  <button type="button" class="icon-btn" data-edit-inst="${esc(i.id)}">✎</button>
                  <button type="button" class="icon-btn danger" data-del-inst="${esc(i.id)}">✕</button>
                </div>
              </li>`;
            })
            .join("")}
        </ul>
      </div>

      <div class="section-title"><span>信用卡</span></div>
      <div class="card" style="padding:4px 12px">
        <ul class="list">
          ${cards
            .map(
              (c) => `
            <li class="list-item">
              <div class="meta">
                <div class="title">${esc(c.name)}</div>
                <div class="sub">${c.dueDay ? "結單／到期約 " + c.dueDay + " 號" : "無固定到期"}${c.notes ? " · " + esc(c.notes) : ""}</div>
              </div>
            </li>`
            )
            .join("")}
        </ul>
      </div>

      <div class="section-title"><span>戶口結餘</span><span class="mono">截至參考</span></div>
      <div class="card" style="padding:4px 12px">
        <ul class="list">
          ${(data.accounts || [])
            .filter((a) => a.balance || ["HSBC", "Hang Seng", "Mox"].includes(a.name))
            .map(
              (a) => `
            <li class="list-item">
              <div class="meta">
                <div class="title">${esc(a.name)}</div>
                <div class="sub">${a.asOf ? "截至 " + esc(a.asOf) : ""}</div>
              </div>
              <div class="amt">${money(a.balance)}</div>
              <div class="list-actions">
                <button type="button" class="icon-btn" data-edit-acc="${esc(a.id)}">✎</button>
              </div>
            </li>`
            )
            .join("")}
        </ul>
        <div class="list-item"><div class="meta"><div class="title">合計</div></div><div class="amt">${money(accountsTotal())}</div></div>
      </div>
    `;

    $("#btnAddInst").onclick = () => openInstForm();
    $$("[data-del-inst]").forEach((b) => {
      b.onclick = () => {
        if (!confirm("刪除呢項分期？")) return;
        data.instalments = data.instalments.filter((i) => i.id !== b.dataset.delInst);
        touchUpdated();
        renderCards();
      };
    });
    $$("[data-edit-inst]").forEach((b) => {
      b.onclick = () => openInstForm(data.instalments.find((i) => i.id === b.dataset.editInst));
    });
    $$("[data-edit-acc]").forEach((b) => {
      b.onclick = () => {
        const a = data.accounts.find((x) => x.id === b.dataset.editAcc);
        if (!a) return;
        openSheet(`
          <div class="sheet-handle"></div>
          <h3>更新 ${esc(a.name)} 結餘</h3>
          <div class="form-row"><label>結餘</label><input class="input amount" type="number" step="0.01" id="aBal" value="${a.balance}" /></div>
          <div class="btn-row">
            <button type="button" class="btn btn-secondary" id="aCancel">取消</button>
            <button type="button" class="btn btn-primary" id="aSave">儲存</button>
          </div>
        `);
        $("#aCancel").onclick = closeSheet;
        $("#aSave").onclick = () => {
          a.balance = parseFloat($("#aBal").value) || 0;
          a.asOf = todayISO();
          touchUpdated();
          closeSheet();
          renderCards();
        };
      };
    });
  }

  function openInstForm(existing) {
    const i = existing || {
      name: "",
      monthly: "",
      fee: 0,
      remaining: "",
      dueDay: 1,
      cardId: (data.cards[0] && data.cards[0].id) || "",
    };
    const cardOpts = (data.cards || [])
      .map((c) => `<option value="${esc(c.id)}" ${c.id === i.cardId ? "selected" : ""}>${esc(c.name)}</option>`)
      .join("");
    openSheet(`
      <div class="sheet-handle"></div>
      <h3>${existing ? "編輯" : "新增"}分期</h3>
      <div class="form-row"><label>名稱</label><input class="input" id="iName" value="${esc(i.name || "")}" /></div>
      <div class="form-row"><label>信用卡</label><select class="input" id="iCard">${cardOpts}</select></div>
      <div class="form-row"><label>每月本金</label><input class="input" type="number" step="0.01" id="iMon" value="${i.monthly ?? ""}" /></div>
      <div class="form-row"><label>每月手續費</label><input class="input" type="number" step="0.01" id="iFee" value="${i.fee ?? 0}" /></div>
      <div class="form-row"><label>剩餘期數（可空）</label><input class="input" type="number" id="iRem" value="${i.remaining ?? ""}" /></div>
      <div class="form-row"><label>到期日</label><input class="input" type="number" min="1" max="28" id="iDue" value="${i.dueDay || 1}" /></div>
      <div class="form-row"><label><input type="checkbox" id="iPend" ${i.pendingConfirm ? "checked" : ""}/> 待確認</label></div>
      <div class="btn-row">
        <button type="button" class="btn btn-secondary" id="iCancel">取消</button>
        <button type="button" class="btn btn-primary" id="iSave">儲存</button>
      </div>
    `);
    $("#iCancel").onclick = closeSheet;
    $("#iSave").onclick = () => {
      const name = $("#iName").value.trim();
      const monthly = parseFloat($("#iMon").value);
      if (!name || !(monthly >= 0)) {
        toast("請填名稱同本金", "error");
        return;
      }
      const payload = {
        name,
        cardId: $("#iCard").value,
        monthly,
        fee: parseFloat($("#iFee").value) || 0,
        remaining: $("#iRem").value === "" ? null : parseInt($("#iRem").value, 10),
        dueDay: parseInt($("#iDue").value, 10) || null,
        pendingConfirm: $("#iPend").checked,
      };
      if (existing) Object.assign(existing, payload);
      else data.instalments.push(Object.assign({ id: uid("inst") }, payload));
      touchUpdated();
      closeSheet();
      renderCards();
    };
  }

  function renderSettings() {
    const el = $("#view-settings");
    const last = meta.lastSyncAt
      ? new Date(meta.lastSyncAt).toLocaleString("zh-HK", { timeZone: "Asia/Hong_Kong" })
      : "未同步";
    el.innerHTML = `
      <div class="card settings-block">
        <h2>Google Drive 同步</h2>
        <p>${demoMode ? "而家係<strong>演示模式</strong>：資料只存在呢部裝置嘅瀏覽器（localStorage）。填好 config.js 嘅 GOOGLE_CLIENT_ID 之後可登入同步。" : "用 Google 帳戶同步 fanance-data.json 去 Drive。"}</p>
        <p>狀態：${meta.signedIn ? `已登入${meta.email ? "（" + esc(meta.email) + "）" : ""}` : "未登入"}</p>
        <p>上次同步：<span class="mono">${esc(last)}</span></p>
        <p>本地更新：<span class="mono">${esc(data.updatedAt || "—")}</span></p>
        <div class="btn-row" style="flex-direction:column">
          <button type="button" class="btn btn-primary" id="btnLogin" ${demoMode && !hasClientId ? "disabled" : ""}>登入 Google</button>
          <button type="button" class="btn btn-secondary" id="btnSyncNow" ${!meta.signedIn ? "disabled" : ""}>立即同步</button>
          <button type="button" class="btn btn-ghost" id="btnLogout" ${!meta.signedIn ? "disabled" : ""}>登出</button>
        </div>
      </div>

      <div class="card settings-block">
        <h2>個人資料</h2>
        <div class="form-row"><label>實收薪金（take-home）</label><input class="input" type="number" id="pTake" value="${data.profile.takeHome}" /></div>
        <div class="form-row"><label>每月開支目標（cap）</label><input class="input" type="number" id="pCap" value="${data.profile.monthlyCap}" /></div>
        <button type="button" class="btn btn-secondary" id="btnSaveProfile">儲存資料</button>
      </div>

      <div class="card settings-block">
        <h2>預算分項</h2>
        <p class="hero-sub">只計非固定／卡數嘅分類。留空或 0 = 唔設上限。</p>
        ${BUDGET_CATS.map((c) => {
          const v = (data.profile.categoryBudgets && data.profile.categoryBudgets[c]) || "";
          return `<div class="form-row"><label>${esc(c)}</label><input class="input" type="number" min="0" step="1" data-budget-cat="${esc(c)}" value="${v}" placeholder="無上限" /></div>`;
        }).join("")}
        <div class="hero-sub" id="budgetSumHint" style="margin:8px 0 12px"></div>
        <button type="button" class="btn btn-secondary" id="btnSaveBudgets">儲存預算分項</button>
      </div>

      <div class="card settings-block">
        <h2>備份</h2>
        <div class="btn-row" style="flex-direction:column">
          <button type="button" class="btn btn-secondary" id="btnExport">匯出 JSON</button>
          <button type="button" class="btn btn-secondary" id="btnImport">匯入 JSON</button>
          <input type="file" id="importFile" accept="application/json,.json" hidden />
          <button type="button" class="btn btn-danger" id="btnReset">重設本地快取（還原種子資料）</button>
        </div>
      </div>

      <div class="card settings-block">
        <h2>過往月份</h2>
        ${
          (data.monthHistory || []).length
            ? `<ul class="list">${[...(data.monthHistory || [])]
                .slice()
                .reverse()
                .slice(0, 8)
                .map(
                  (h) => `
              <li class="list-item">
                <div class="meta">
                  <div class="title">${esc(h.month)}</div>
                  <div class="sub">${h.transactionCount || 0} 筆 · 非固定 ${money(h.discretionarySpend || 0)}</div>
                </div>
                <div class="amt">${money(h.allSpend || 0)}</div>
              </li>`
                )
                .join("")}</ul>
              <p class="hero-sub" style="margin-top:8px">本月標記：<span class="mono">${esc(data.lastMonthKey || "—")}</span></p>`
            : `<p>未有轉月紀錄。首次開啟會標記本月，之後每個新月會自動封存上個月摘要。</p>
              <p>本月標記：<span class="mono">${esc(data.lastMonthKey || "—")}</span></p>`
        }
      </div>

      <div class="card settings-block">
        <h2>關於</h2>
        <p>Fanance · 個人用 · zh-Hant-HK</p>
        <p>OAuth 需要 HTTPS 或 localhost。手機「加入主畫面」可用 PWA。</p>
      </div>
    `;

    $("#btnLogin").onclick = () => googleLogin();
    $("#btnSyncNow").onclick = () => syncNow(true);
    $("#btnLogout").onclick = () => googleLogout();
    $("#btnSaveProfile").onclick = () => {
      data.profile.takeHome = parseFloat($("#pTake").value) || data.profile.takeHome;
      data.profile.monthlyCap = parseFloat($("#pCap").value) || data.profile.monthlyCap;
      touchUpdated();
      toast("已儲存", "ok");
    };

    function refreshBudgetSumHint() {
      const hint = $("#budgetSumHint");
      if (!hint) return;
      let sum = 0;
      $$("[data-budget-cat]").forEach((inp) => {
        const n = parseFloat(inp.value);
        if (n > 0) sum += n;
      });
      const cap = Number(data.profile.monthlyCap) || 8000;
      hint.textContent = `分項合計 ${money(sum)} · 每月開支目標 ${money(cap)}${sum > cap ? "（分項高過總目標）" : ""}`;
    }
    refreshBudgetSumHint();
    $$("[data-budget-cat]").forEach((inp) => {
      inp.oninput = refreshBudgetSumHint;
    });
    const btnBud = $("#btnSaveBudgets");
    if (btnBud) {
      btnBud.onclick = () => {
        if (!data.profile.categoryBudgets) data.profile.categoryBudgets = {};
        $$("[data-budget-cat]").forEach((inp) => {
          const cat = inp.dataset.budgetCat;
          const n = parseFloat(inp.value);
          if (!n || n <= 0) delete data.profile.categoryBudgets[cat];
          else data.profile.categoryBudgets[cat] = n;
        });
        touchUpdated();
        toast("已儲存預算分項", "ok");
        refreshBudgetSumHint();
      };
    }
    $("#btnExport").onclick = exportJson;
    $("#btnImport").onclick = () => $("#importFile").click();
    $("#importFile").onchange = (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = JSON.parse(reader.result);
          if (!parsed || typeof parsed !== "object" || !parsed.profile) throw new Error("格式唔啱");
          data = parsed;
          ensureCategoryBudgets();
          touchUpdated();
          runMonthRolloverIfNeeded();
          toast("已匯入", "ok");
          render();
        } catch (err) {
          toast("匯入失敗：" + err.message, "error");
        }
      };
      reader.readAsText(f);
      e.target.value = "";
    };
    $("#btnReset").onclick = () => {
      if (!confirm("重設會清本地資料並還原種子。確定？")) return;
      data = JSON.parse(JSON.stringify(SEED));
      data.updatedAt = nowISO();
      ensureCategoryBudgets();
      meta.driveFileId = null;
      saveLocal();
      runMonthRolloverIfNeeded();
      toast("已重設", "ok");
      render();
    };
  }

  // ——— Sheet ———
  function openSheet(html) {
    const ov = $("#overlay");
    $("#sheet").innerHTML = html;
    ov.classList.add("open");
    ov.onclick = (e) => {
      if (e.target === ov) closeSheet();
    };
  }
  function closeSheet() {
    $("#overlay").classList.remove("open");
    $("#sheet").innerHTML = "";
  }

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `fanance-backup-${todayISO()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast("已匯出", "ok");
  }

  // ——— Google Drive Sync ———
  function initGis() {
    if (!hasClientId) return;
    const tryInit = () => {
      if (!window.google || !google.accounts || !google.accounts.oauth2) {
        setTimeout(tryInit, 200);
        return;
      }
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CFG.GOOGLE_CLIENT_ID,
        scope: "https://www.googleapis.com/auth/drive.file",
        callback: (resp) => {
          if (resp.error) {
            toast("登入失敗：" + resp.error, "error");
            return;
          }
          accessToken = resp.access_token;
          meta.signedIn = true;
          saveLocal();
          toast("已登入 Google", "ok");
          syncNow(true);
          render();
        },
      });
      gsiReady = true;
    };
    tryInit();
  }

  function googleLogin() {
    if (!hasClientId) {
      toast("請先喺 config.js 填 GOOGLE_CLIENT_ID", "error");
      return;
    }
    if (!gsiReady || !tokenClient) {
      toast("Google 登入元件未就緒，請稍後再試", "error");
      initGis();
      return;
    }
    tokenClient.requestAccessToken({ prompt: meta.signedIn ? "" : "consent" });
  }

  function googleLogout() {
    accessToken = null;
    meta.signedIn = false;
    meta.email = null;
    saveLocal();
    if (window.google && google.accounts && google.accounts.oauth2 && accessToken) {
      /* token already cleared */
    }
    toast("已登出", "ok");
    render();
  }

  async function driveFetch(path, opts = {}) {
    if (!accessToken) throw new Error("未登入");
    const headers = Object.assign(
      { Authorization: "Bearer " + accessToken },
      opts.headers || {}
    );
    const res = await fetch("https://www.googleapis.com/drive/v3" + path, { ...opts, headers });
    if (res.status === 401) {
      meta.signedIn = false;
      accessToken = null;
      saveLocal();
      throw new Error("登入已過期，請重新登入");
    }
    return res;
  }

  async function findOrCreateDriveFile() {
    if (meta.driveFileId) {
      const check = await driveFetch(`/files/${meta.driveFileId}?fields=id,name,trashed`);
      if (check.ok) {
        const j = await check.json();
        if (!j.trashed) return meta.driveFileId;
      }
      meta.driveFileId = null;
    }

    // Find by name + appProperties
    const q = encodeURIComponent(
      `name='${CFG.DRIVE_FILE_NAME}' and trashed=false and appProperties has { key='fanance' and value='true' }`
    );
    let res = await driveFetch(`/files?q=${q}&spaces=drive&fields=files(id,name)`);
    let json = await res.json();
    if (json.files && json.files.length) {
      meta.driveFileId = json.files[0].id;
      saveLocal();
      return meta.driveFileId;
    }

    // Fallback: name only (created by this app via drive.file)
    const q2 = encodeURIComponent(`name='${CFG.DRIVE_FILE_NAME}' and trashed=false`);
    res = await driveFetch(`/files?q=${q2}&spaces=drive&fields=files(id,name)`);
    json = await res.json();
    if (json.files && json.files.length) {
      meta.driveFileId = json.files[0].id;
      saveLocal();
      return meta.driveFileId;
    }

    // Create folder Fanance if needed
    let folderId = null;
    const fq = encodeURIComponent(
      `name='${CFG.DRIVE_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`
    );
    res = await driveFetch(`/files?q=${fq}&fields=files(id)`);
    json = await res.json();
    if (json.files && json.files.length) folderId = json.files[0].id;
    else {
      res = await driveFetch(`/files?fields=id`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: CFG.DRIVE_FOLDER_NAME,
          mimeType: "application/vnd.google-apps.folder",
        }),
      });
      json = await res.json();
      folderId = json.id;
    }

    // Create file
    const metadata = {
      name: CFG.DRIVE_FILE_NAME,
      mimeType: "application/json",
      parents: folderId ? [folderId] : undefined,
      appProperties: { fanance: "true" },
    };
    const boundary = "fanance_boundary";
    const body =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\nContent-Type: application/json\r\n\r\n` +
      `${JSON.stringify(data)}\r\n` +
      `--${boundary}--`;

    res = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + accessToken,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
    });
    if (!res.ok) throw new Error("建立 Drive 檔失敗：" + (await res.text()));
    json = await res.json();
    meta.driveFileId = json.id;
    saveLocal();
    return meta.driveFileId;
  }

  async function pullRemote() {
    const id = await findOrCreateDriveFile();
    const res = await driveFetch(`/files/${id}?alt=media`);
    if (!res.ok) throw new Error("下載失敗");
    const text = await res.text();
    if (!text || !text.trim()) return null;
    return JSON.parse(text);
  }

  async function pushRemote() {
    const id = await findOrCreateDriveFile();
    const res = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=media`, {
      method: "PATCH",
      headers: {
        Authorization: "Bearer " + accessToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error("上傳失敗：" + (await res.text()));
    meta.lastSyncAt = nowISO();
    saveLocal();
  }

  function schedulePush() {
    if (!meta.signedIn || !accessToken) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
      pushRemote()
        .then(() => {
          updateChrome();
        })
        .catch((e) => toast("同步失敗：" + e.message, "error"));
    }, 1500);
  }

  async function syncNow(showToast) {
    if (!meta.signedIn || !accessToken) {
      if (showToast) toast("請先登入 Google", "error");
      return;
    }
    try {
      const remote = await pullRemote();
      if (remote && remote.updatedAt) {
        const localT = Date.parse(data.updatedAt || 0) || 0;
        const remoteT = Date.parse(remote.updatedAt) || 0;
        if (remoteT > localT) {
          data = remote;
          ensureCategoryBudgets();
          saveLocal();
          runMonthRolloverIfNeeded();
          if (showToast) toast("已由 Drive 拉最新資料", "ok");
        } else if (localT > remoteT) {
          await pushRemote();
          if (showToast) toast("已推上 Drive", "ok");
        } else {
          if (showToast) toast("已係最新", "ok");
          meta.lastSyncAt = nowISO();
          saveLocal();
        }
      } else {
        await pushRemote();
        if (showToast) toast("已推上 Drive", "ok");
      }
      render();
    } catch (e) {
      console.error(e);
      toast("同步錯誤：" + e.message, "error");
    }
  }

  // ——— Boot ———
  async function boot() {
    if (!loadLocal()) {
      // try fetch seed.json
      try {
        const r = await fetch("data/seed.json", { cache: "no-store" });
        if (r.ok) data = await r.json();
        else data = JSON.parse(JSON.stringify(SEED));
      } catch {
        data = JSON.parse(JSON.stringify(SEED));
      }
      saveLocal();
    }

    $$(".nav-btn").forEach((b) => {
      b.onclick = () => switchView(b.dataset.nav);
    });

    window.addEventListener("online", () => {
      updateChrome();
      if (meta.signedIn && accessToken) syncNow(false);
    });

    initGis();
    migrateData();
    runMonthRolloverIfNeeded();
    render();

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    }
  }

  boot();
})();
