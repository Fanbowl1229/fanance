/* Fanance — zh-Hant-HK personal finance SPA
   localStorage + optional Google Drive sync (drive.file) */
(function () {
  "use strict";

  const STORAGE_KEY = "fanance-data-v1";
  const META_KEY = "fanance-meta-v1";
  const CATEGORIES = ["飲食", "交通", "購物", "娛樂", "固定", "卡數", "其他"];
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
    "updatedAt": "2026-09-23T00:00:00.000Z",
    "profile": {
      "salaryGross": 20000,
      "mpfRate": 0.05,
      "takeHome": 19000,
      "monthlyCap": 8000,
      "currency": "HKD",
      "name": "Fanance"
    },
    "accounts": [
      {
        "id": "acc-bank1",
        "name": "銀行 A",
        "balance": 5000,
        "asOf": "2026-09-01"
      },
      {
        "id": "acc-bank2",
        "name": "銀行 B",
        "balance": 1200,
        "asOf": "2026-09-01"
      },
      {
        "id": "acc-cash",
        "name": "現金",
        "balance": 300
      },
      {
        "id": "acc-other",
        "name": "其他",
        "balance": 0
      }
    ],
    "cards": [
      {
        "id": "card-a",
        "name": "信用卡 A",
        "dueDay": 12,
        "notes": "示範卡"
      },
      {
        "id": "card-b",
        "name": "信用卡 B",
        "dueDay": 7,
        "notes": ""
      }
    ],
    "instalments": [
      {
        "id": "inst-demo-1",
        "cardId": "card-a",
        "name": "示範分期",
        "monthly": 1500,
        "fee": 50,
        "remaining": 6,
        "endMonth": "2027-03",
        "dueDay": 12,
        "notes": "公開示範資料，非真實帳目"
      }
    ],
    "subscriptions": [
      {
        "id": "sub-stream",
        "name": "串流",
        "amount": 100,
        "dueDay": 3
      },
      {
        "id": "sub-transit",
        "name": "交通月票",
        "amount": 500,
        "dueDay": 14
      },
      {
        "id": "sub-phone",
        "name": "電話費",
        "amount": 200,
        "dueDay": 20
      }
    ],
    "transactions": [
      {
        "id": "tx-demo-1",
        "date": "2026-09-10",
        "amount": 85,
        "category": "飲食",
        "account": "銀行 A",
        "note": "示範午餐"
      },
      {
        "id": "tx-demo-2",
        "date": "2026-09-12",
        "amount": 220,
        "category": "購物",
        "account": "銀行 B",
        "note": "示範購物"
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

  // ——— Calculations ———
  function sumSubs() {
    return (data.subscriptions || []).reduce((s, x) => s + (Number(x.amount) || 0), 0);
  }

  function instalmentMonthly(inst) {
    return (Number(inst.monthly) || 0) + (Number(inst.fee) || 0);
  }

  function sumInstalments() {
    return (data.instalments || []).reduce((s, x) => s + instalmentMonthly(x), 0);
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
    // Cap track: exclude 固定 / 卡數 categories as "fixed" for display of discretionary
    return (data.transactions || [])
      .filter((t) => isCurrentMonth(t.date) && !["固定", "卡數"].includes(t.category))
      .reduce((s, t) => s + (Number(t.amount) || 0), 0);
  }

  function monthSpendAll() {
    return (data.transactions || [])
      .filter((t) => isCurrentMonth(t.date))
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

    (data.instalments || []).forEach((i) => {
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

    const octNotes = (data.instalments || []).filter((i) => i.octStatementOverride);
    const octHtml = octNotes.length
      ? `<div class="note-box">十月結單提示：${octNotes
          .map((i) => `${esc(i.name)} 約 ${money(i.octStatementOverride)}（含分期）`)
          .join("；")}</div>`
      : "";

    el.innerHTML = `
      <div class="card">
        <h2>估計每月剩錢</h2>
        <div class="hero-amount ${left >= 0 ? "positive" : "negative"}">${money(left)}</div>
        <div class="hero-sub">實收 ${money(take)} − 固定 ${money(sumSubs())} − 卡數分期 ${money(sumInstalments())}</div>
        ${octHtml}
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
  }

  function renderLedger() {
    const el = $("#view-ledger");
    const txs = [...(data.transactions || [])].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

    el.innerHTML = `
      <div class="card">
        <h2>快速記帳</h2>
        <div class="form-row">
          <label>金額（HKD）</label>
          <input class="input amount" type="number" inputmode="decimal" id="txAmount" placeholder="0" step="0.01" min="0" />
        </div>
        <div class="form-row">
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
                .map(
                  (t) => `
              <li class="list-item" data-id="${esc(t.id)}">
                <div class="meta">
                  <div class="title">${esc(t.category)}${t.note ? " · " + esc(t.note) : ""}</div>
                  <div class="sub">${esc(t.date)} · ${esc(t.account)}</div>
                </div>
                <div class="amt out">${money(t.amount)}</div>
                <div class="list-actions">
                  <button type="button" class="icon-btn" data-edit-tx="${esc(t.id)}" aria-label="編輯">✎</button>
                  <button type="button" class="icon-btn danger" data-del-tx="${esc(t.id)}" aria-label="刪除">✕</button>
                </div>
              </li>`
                )
                .join("")}</ul>`
            : `<div class="empty">未有交易</div>`
        }
      </div>
    `;

    wireChips("#catChips");
    wireChips("#accChips");
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
    const tx = {
      id: uid("tx"),
      date: $("#txDate").value || todayISO(),
      amount,
      category: chipValue("#catChips") || "其他",
      account: chipValue("#accChips") || "其他",
      note: ($("#txNote").value || "").trim(),
    };
    data.transactions.push(tx);
    touchUpdated();
    toast("已記帳", "ok");
    renderLedger();
  }

  function deleteTx(id) {
    if (!confirm("刪除呢筆交易？")) return;
    data.transactions = data.transactions.filter((t) => t.id !== id);
    touchUpdated();
    toast("已刪除", "ok");
    renderLedger();
  }

  function openEditTx(id) {
    const t = data.transactions.find((x) => x.id === id);
    if (!t) return;
    openSheet(`
      <div class="sheet-handle"></div>
      <h3>編輯交易</h3>
      <div class="form-row"><label>金額</label><input class="input amount" id="eAmount" type="number" step="0.01" value="${t.amount}" /></div>
      <div class="form-row"><label>類別</label>
        <div class="chips" id="eCat">${CATEGORIES.map((c) => `<button type="button" class="chip ${c === t.category ? "active" : ""}" data-val="${esc(c)}">${esc(c)}</button>`).join("")}</div>
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
    wireChips("#eCat");
    wireChips("#eAcc");
    $("#eCancel").onclick = closeSheet;
    $("#eSave").onclick = () => {
      t.amount = parseFloat($("#eAmount").value) || t.amount;
      t.category = chipValue("#eCat") || t.category;
      t.account = chipValue("#eAcc") || t.account;
      t.date = $("#eDate").value || t.date;
      t.note = ($("#eNote").value || "").trim();
      touchUpdated();
      closeSheet();
      toast("已更新", "ok");
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
              const rem =
                i.remaining != null
                  ? `剩 ${i.remaining} 期`
                  : i.endMonth
                    ? `至 ${i.endMonth}`
                    : "進行中";
              return `
              <li class="list-item">
                <div class="meta">
                  <div class="title">${esc(i.name)}${i.pendingConfirm ? '<span class="tag">待確認</span>' : ""}${
                    i.octStatementOverride ? '<span class="tag muted">十月結單</span>' : ""
                  }</div>
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
        <h2>備份</h2>
        <div class="btn-row" style="flex-direction:column">
          <button type="button" class="btn btn-secondary" id="btnExport">匯出 JSON</button>
          <button type="button" class="btn btn-secondary" id="btnImport">匯入 JSON</button>
          <input type="file" id="importFile" accept="application/json,.json" hidden />
          <button type="button" class="btn btn-danger" id="btnReset">重設本地快取（還原種子資料）</button>
        </div>
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
          touchUpdated();
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
      meta.driveFileId = null;
      saveLocal();
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
          saveLocal();
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
    render();

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    }
  }

  boot();
})();
