const STORAGE_KEY = "subscrkiller-state-v2";
const TOKEN_KEY = "subscrkiller-token";
const API_BASE = "/api";

const runtime = {
  apiAvailable: false,
  token: localStorage.getItem(TOKEN_KEY) || ""
};

const demoTransactions = `date,merchant,amount
2026-04-01,Spotify,9.99
2026-03-01,Spotify,9.99
2026-02-01,Spotify,9.99
2026-04-02,Adobe,24.99
2026-03-02,Adobe,24.99
2026-02-02,Adobe,24.99
2026-04-03,Headspace,12.99
2026-03-03,Headspace,12.99
2026-04-03,Netflix,15.99
2026-03-03,Netflix,15.99`;

const providerHelp = [
  {
    match: ["spotify"],
    title: "Spotify",
    steps: [
      "Open account settings.",
      "Go to plan details and choose cancel premium.",
      "Keep the reminder: you paid for music you barely played."
    ]
  },
  {
    match: ["netflix"],
    title: "Netflix",
    steps: [
      "Open account settings and membership details.",
      "Cancel the plan or pause it if you really need a break.",
      "If you watched one thing, that is not a lifestyle."
    ]
  },
  {
    match: ["adobe"],
    title: "Adobe",
    steps: [
      "Visit Adobe account subscriptions.",
      "Select manage plan and cancel before the next billing date.",
      "You paid for productivity and got invoice anxiety instead."
    ]
  },
  {
    match: ["apple", "icloud", "itunes"],
    title: "Apple",
    steps: [
      "Open Apple ID subscriptions.",
      "Cancel the subscription from your device settings.",
      "Storage is not a personality trait."
    ]
  },
  {
    match: ["google", "youtube"],
    title: "Google",
    steps: [
      "Open Google payments and subscriptions.",
      "Cancel the membership from the subscription page.",
      "You can survive without premium. Probably."
    ]
  }
];

const state = loadState();

const elements = {
  monthlyWaste: document.getElementById("monthly-waste"),
  annualWaste: document.getElementById("annual-waste"),
  unusedCount: document.getElementById("unused-count"),
  alertBadge: document.getElementById("alert-badge"),
  alertList: document.getElementById("alert-list"),
  spendingChart: document.getElementById("spending-chart"),
  cancelCoach: document.getElementById("cancel-coach"),
  subscriptionTable: document.getElementById("subscription-table"),
  subscriptionForm: document.getElementById("subscription-form"),
  transactionInput: document.getElementById("transaction-input"),
  importButton: document.getElementById("import-button"),
  loadDemo: document.getElementById("load-demo"),
  clearAll: document.getElementById("clear-all"),
  registerForm: document.getElementById("register-form"),
  loginButton: document.getElementById("login-button"),
  logoutButton: document.getElementById("logout-button"),
  uploadAvatar: document.getElementById("upload-avatar"),
  avatarInput: document.getElementById("avatar-input"),
  avatarPreview: document.getElementById("avatar-preview"),
  authState: document.getElementById("auth-state"),
  accountCopy: document.getElementById("account-copy"),
  storageModeBadge: document.getElementById("storage-mode-badge"),
  bankRecordForm: document.getElementById("bank-record-form"),
  bankRecords: document.getElementById("bank-records"),
  rewardSettingsForm: document.getElementById("reward-settings-form"),
  voucherBadge: document.getElementById("voucher-badge"),
  savedMonthly: document.getElementById("saved-monthly"),
  voucherCopy: document.getElementById("voucher-copy"),
  goalTitle: document.getElementById("goal-title"),
  goalCopy: document.getElementById("goal-copy")
};

setupEventListeners();
void initApp();

function setupEventListeners() {
  document.querySelectorAll("[data-jump]").forEach((button) => {
    button.addEventListener("click", () => {
      const target = document.getElementById(button.dataset.jump);
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  elements.subscriptionForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const subscription = {
      id: crypto.randomUUID(),
      name: String(formData.get("name") || "").trim(),
      price: Number(formData.get("price") || 0),
      currency: String(formData.get("currency") || "EUR").trim().toUpperCase(),
      cycle: String(formData.get("cycle") || "monthly"),
      category: String(formData.get("category") || "Other").trim() || "Other",
      lastOpened: String(formData.get("lastOpened") || ""),
      usedThisMonth: String(formData.get("usedThisMonth") || "no") === "yes",
      source: "manual",
      canceled: false
    };

    if (!subscription.name || !subscription.price) {
      return;
    }

    state.subscriptions.unshift(subscription);
    saveAndRender();
    event.currentTarget.reset();
    event.currentTarget.elements.currency.value = "EUR";
  });

  elements.importButton.addEventListener("click", () => {
    const parsed = parseTransactions(elements.transactionInput.value);
    const detected = detectSubscriptions(parsed);
    if (!detected.length) {
      alert("No repeating charges found yet. Try 2-3 monthly charges for the same merchant.");
      return;
    }

    detected.forEach((subscription) => {
      const exists = state.subscriptions.some((entry) => normalize(entry.name) === normalize(subscription.name));
      if (!exists) {
        state.subscriptions.unshift(subscription);
      }
    });
    state.transactions = parsed;
    saveAndRender();
  });

  elements.loadDemo.addEventListener("click", () => {
    elements.transactionInput.value = demoTransactions;
  });

  elements.clearAll.addEventListener("click", () => {
    if (!confirm("Clear all subscriptions and imported transactions?")) {
      return;
    }
    state.subscriptions = [];
    state.transactions = [];
    state.bankRecords = [];
    saveAndRender();
  });

  elements.registerForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!runtime.apiAvailable) {
      alert("Backend API is offline. Start server.js for secure account storage.");
      return;
    }

    const formData = new FormData(event.currentTarget);
    const payload = {
      name: String(formData.get("name") || "").trim(),
      email: String(formData.get("email") || "").trim(),
      password: String(formData.get("password") || "")
    };

    try {
      const result = await apiRequest("/auth/register", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      applySession(result);
      await hydrateRemoteData();
      alert("Account created and synced.");
    } catch (error) {
      alert(error.message);
    }
  });

  elements.loginButton.addEventListener("click", async () => {
    if (!runtime.apiAvailable) {
      alert("Backend API is offline. Start server.js for secure account storage.");
      return;
    }

    const formData = new FormData(elements.registerForm);
    const payload = {
      email: String(formData.get("email") || "").trim(),
      password: String(formData.get("password") || "")
    };

    try {
      const result = await apiRequest("/auth/login", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      applySession(result);
      await hydrateRemoteData();
      alert("Signed in.");
    } catch (error) {
      alert(error.message);
    }
  });

  elements.logoutButton.addEventListener("click", () => {
    runtime.token = "";
    localStorage.removeItem(TOKEN_KEY);
    state.user = null;
    saveAndRender(false);
  });

  elements.uploadAvatar.addEventListener("click", async () => {
    if (!state.user || !runtime.apiAvailable) {
      alert("Sign in with backend enabled to upload profile pictures.");
      return;
    }

    const file = elements.avatarInput.files?.[0];
    if (!file) {
      alert("Select an image first.");
      return;
    }

    const payload = new FormData();
    payload.append("avatar", file);

    try {
      const result = await apiRequest("/me/avatar", {
        method: "POST",
        body: payload,
        isFormData: true
      });
      state.user.avatarUrl = result.avatarUrl;
      saveAndRender(false);
      alert("Avatar uploaded.");
    } catch (error) {
      alert(error.message);
    }
  });

  elements.bankRecordForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const record = {
      bankName: String(formData.get("bankName") || "").trim(),
      accountLabel: String(formData.get("accountLabel") || "").trim(),
      iban: String(formData.get("iban") || "").trim(),
      balance: Number(formData.get("balance") || 0),
      currency: String(formData.get("currency") || "EUR").trim().toUpperCase()
    };

    if (!record.bankName || !record.accountLabel || !record.iban || !record.balance) {
      return;
    }

    if (runtime.apiAvailable && state.user) {
      try {
        await apiRequest("/bank-records", {
          method: "POST",
          body: JSON.stringify(record)
        });
        await hydrateRemoteBankRecords();
      } catch (error) {
        alert(error.message);
      }
    } else {
      state.bankRecords.unshift({
        id: crypto.randomUUID(),
        bankName: record.bankName,
        accountLabel: record.accountLabel,
        ibanMasked: maskIban(record.iban),
        balance: record.balance,
        currency: record.currency,
        localOnly: true
      });
      saveAndRender(false);
    }

    event.currentTarget.reset();
    event.currentTarget.elements.currency.value = "EUR";
  });

  elements.rewardSettingsForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    state.rewardSettings = {
      voucherStep: Math.max(1, Number(formData.get("voucherStep") || 10)),
      goalPrice: Math.max(50, Number(formData.get("goalPrice") || 1200)),
      goalName: String(formData.get("goalName") || "new iPhone").trim() || "new iPhone"
    };
    saveAndRender(false);
  });
}

async function initApp() {
  runtime.apiAvailable = await detectApi();
  if (runtime.apiAvailable && runtime.token) {
    try {
      const session = await apiRequest("/me", { method: "GET" });
      state.user = session.user;
      await hydrateRemoteData();
    } catch {
      runtime.token = "";
      localStorage.removeItem(TOKEN_KEY);
      state.user = null;
    }
  }
  render();
}

async function detectApi() {
  try {
    const response = await fetch(`${API_BASE}/health`);
    return response.ok;
  } catch {
    return false;
  }
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        user: parsed.user || null,
        subscriptions: Array.isArray(parsed.subscriptions) ? parsed.subscriptions : [],
        transactions: Array.isArray(parsed.transactions) ? parsed.transactions : [],
        bankRecords: Array.isArray(parsed.bankRecords) ? parsed.bankRecords : [],
        rewardSettings: {
          voucherStep: Number(parsed.rewardSettings?.voucherStep || 10),
          goalPrice: Number(parsed.rewardSettings?.goalPrice || 1200),
          goalName: String(parsed.rewardSettings?.goalName || "new iPhone")
        }
      };
    }
  } catch {
    // Ignore malformed state and rebuild from scratch.
  }

  return {
    user: null,
    subscriptions: [
      {
        id: crypto.randomUUID(),
        name: "Netflix",
        price: 15.99,
        currency: "EUR",
        cycle: "monthly",
        category: "Entertainment",
        lastOpened: "",
        usedThisMonth: false,
        source: "manual",
        canceled: false
      },
      {
        id: crypto.randomUUID(),
        name: "Figma",
        price: 12,
        currency: "EUR",
        cycle: "monthly",
        category: "Work",
        lastOpened: "2026-01-15",
        usedThisMonth: false,
        source: "manual",
        canceled: false
      }
    ],
    transactions: [],
    bankRecords: [],
    rewardSettings: {
      voucherStep: 10,
      goalPrice: 1200,
      goalName: "new iPhone"
    }
  };
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function saveAndRender(sync = true) {
  saveState();
  render();
  if (sync) {
    void syncSubscriptions();
  }
}

function applySession(result) {
  runtime.token = result.token;
  localStorage.setItem(TOKEN_KEY, result.token);
  state.user = result.user;
  saveState();
}

async function hydrateRemoteData() {
  await Promise.all([hydrateRemoteSubscriptions(), hydrateRemoteBankRecords()]);
  render();
}

async function hydrateRemoteSubscriptions() {
  const result = await apiRequest("/subscriptions", { method: "GET" });
  state.subscriptions = Array.isArray(result.subscriptions) ? result.subscriptions : [];
  saveState();
}

async function hydrateRemoteBankRecords() {
  const result = await apiRequest("/bank-records", { method: "GET" });
  state.bankRecords = Array.isArray(result.records) ? result.records : [];
  saveState();
  render();
}

async function syncSubscriptions() {
  if (!runtime.apiAvailable || !state.user || !runtime.token) {
    return;
  }

  try {
    await apiRequest("/subscriptions/bulk", {
      method: "PUT",
      body: JSON.stringify({ subscriptions: state.subscriptions })
    });
  } catch {
    // Keep local changes even if backend sync fails.
  }
}

async function apiRequest(path, options) {
  const headers = {};
  if (!options.isFormData) {
    headers["Content-Type"] = "application/json";
  }
  if (runtime.token) {
    headers.Authorization = `Bearer ${runtime.token}`;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    method: options.method,
    headers,
    body: options.body
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "Request failed");
  }

  return payload;
}

function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function parseMoney(value) {
  const numeric = String(value || "")
    .replace(/[^0-9,.-]/g, "")
    .replace(/,(?=\d{1,2}$)/, ".");
  return Number.parseFloat(numeric);
}

function parseTransactions(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) {
    return [];
  }

  const delimiter = lines[0].includes(";") ? ";" : ",";
  const rows = lines.map((line) => line.split(delimiter).map((part) => part.trim().replace(/^"|"$/g, "")));
  const header = rows[0].map((cell) => normalize(cell));

  const dateIndex = findHeaderIndex(header, ["date", "transaction date", "booking date"]);
  const merchantIndex = findHeaderIndex(header, ["merchant", "description", "name", "payee", "transaction"]);
  const amountIndex = findHeaderIndex(header, ["amount", "value", "sum", "price"]);

  if (dateIndex === -1 || merchantIndex === -1 || amountIndex === -1) {
    return lines.map((line) => ({
      date: new Date().toISOString().slice(0, 10),
      merchant: line,
      amount: 0
    }));
  }

  return rows.slice(1).flatMap((row) => {
    if (row.length <= Math.max(dateIndex, merchantIndex, amountIndex)) {
      return [];
    }

    const date = new Date(row[dateIndex]);
    const amount = parseMoney(row[amountIndex]);
    const merchant = row[merchantIndex].trim();

    if (!merchant || Number.isNaN(amount) || Number.isNaN(date.getTime())) {
      return [];
    }

    return [{
      date: date.toISOString().slice(0, 10),
      merchant,
      amount: Math.abs(amount)
    }];
  });
}

function findHeaderIndex(header, candidates) {
  for (const candidate of candidates) {
    const index = header.indexOf(candidate);
    if (index !== -1) {
      return index;
    }
  }
  return -1;
}

function detectSubscriptions(transactions) {
  const grouped = new Map();

  transactions.forEach((transaction) => {
    const key = normalize(transaction.merchant);
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key).push(transaction);
  });

  return [...grouped.entries()]
    .map(([key, items]) => {
      const sorted = [...items].sort((left, right) => new Date(right.date) - new Date(left.date));
      const amounts = sorted.map((item) => item.amount);
      const average = amounts.reduce((sum, amount) => sum + amount, 0) / amounts.length;
      const cadence = detectCadence(sorted.map((item) => item.date));
      const recurring = sorted.length >= 2 && cadence !== "one-off";

      if (!recurring) {
        return null;
      }

      return {
        id: crypto.randomUUID(),
        name: formatMerchant(key),
        price: Number(average.toFixed(2)),
        currency: "EUR",
        cycle: cadence,
        category: inferCategory(key),
        lastOpened: "",
        usedThisMonth: false,
        source: "bank",
        canceled: false
      };
    })
    .filter(Boolean);
}

function detectCadence(dateValues) {
  if (dateValues.length < 2) {
    return "one-off";
  }

  const gaps = [];
  for (let index = 1; index < dateValues.length; index += 1) {
    const previous = new Date(dateValues[index - 1]);
    const current = new Date(dateValues[index]);
    const gapDays = Math.round(Math.abs(previous - current) / 86400000);
    gaps.push(gapDays);
  }

  const averageGap = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;

  if (averageGap >= 25 && averageGap <= 35) {
    return "monthly";
  }

  if (averageGap >= 320 && averageGap <= 400) {
    return "yearly";
  }

  if (averageGap >= 5 && averageGap <= 10) {
    return "weekly";
  }

  return "recurring";
}

function formatMerchant(key) {
  return key
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function inferCategory(key) {
  const categoryMap = [
    { terms: ["spotify", "netflix", "youtube", "disney", "apple tv", "hbo"], value: "Entertainment" },
    { terms: ["adobe", "figma", "notion", "microsoft", "google"], value: "Work" },
    { terms: ["gym", "fit", "headspace", "meditation", "calm"], value: "Wellness" },
    { terms: ["icloud", "dropbox", "drive"], value: "Storage" }
  ];

  const match = categoryMap.find((entry) => entry.terms.some((term) => key.includes(term)));
  return match ? match.value : "Other";
}

function annualizedWaste(subscription) {
  return monthlyCost(subscription) * 12;
}

function monthlyCost(subscription) {
  switch (subscription.cycle) {
    case "yearly":
      return subscription.price / 12;
    case "weekly":
      return subscription.price * 4.33;
    default:
      return subscription.price;
  }
}

function isUnusedThisMonth(subscription) {
  if (subscription.canceled || subscription.usedThisMonth) {
    return false;
  }

  if (!subscription.lastOpened) {
    return true;
  }

  const opened = new Date(subscription.lastOpened);
  const now = new Date();
  return opened.getMonth() !== now.getMonth() || opened.getFullYear() !== now.getFullYear();
}

function getAlertCopy(subscription) {
  const monthPrice = monthlyCost(subscription).toFixed(2);
  const usagePhrase = subscription.lastOpened
    ? `Last opened ${subscription.lastOpened}.`
    : "No usage signal has ever been logged.";

  return `You paid €${monthPrice} for ${subscription.name} and did not use it this month. ${usagePhrase} This is a clean monthly leak.`;
}

function getProviderHelp(name) {
  const key = normalize(name);
  return providerHelp.find((provider) => provider.match.some((term) => key.includes(term))) || {
    title: name,
    steps: [
      "Open the provider account settings.",
      "Find billing, membership, or plan management.",
      "Cancel before the next charge lands."
    ]
  };
}

function maskIban(iban) {
  const clean = String(iban || "").replace(/\s+/g, "");
  if (clean.length <= 6) {
    return "***";
  }
  return `${clean.slice(0, 4)}••••${clean.slice(-2)}`;
}

function render() {
  const subscriptions = [...state.subscriptions].sort((left, right) => monthlyCost(right) - monthlyCost(left));
  const activeSubscriptions = subscriptions.filter((subscription) => !subscription.canceled);
  const canceledSubscriptions = subscriptions.filter((subscription) => subscription.canceled);
  const totalMonthlyWaste = activeSubscriptions.reduce((sum, subscription) => sum + monthlyCost(subscription), 0);
  const yearlyWaste = activeSubscriptions.reduce((sum, subscription) => sum + annualizedWaste(subscription), 0);
  const alerts = subscriptions.filter(isUnusedThisMonth);

  elements.monthlyWaste.textContent = formatCurrency(totalMonthlyWaste);
  elements.annualWaste.textContent = formatCurrency(yearlyWaste);
  elements.unusedCount.textContent = String(alerts.length);
  elements.alertBadge.textContent = `${alerts.length} alert${alerts.length === 1 ? "" : "s"}`;
  elements.authState.textContent = state.user ? `Signed in as ${state.user.email}` : "Guest mode";
  elements.storageModeBadge.textContent = state.user && runtime.apiAvailable ? "Synced + encrypted" : "Local only";
  elements.accountCopy.textContent = state.user
    ? "Your subscriptions and bank snapshots are stored in your account backend."
    : "Create an account to store users, profile pictures, bank data, and subscriptions securely.";
  elements.avatarPreview.src = state.user?.avatarUrl || "";
  elements.avatarPreview.style.display = state.user?.avatarUrl ? "block" : "none";

  elements.alertList.innerHTML = alerts.length
    ? alerts.map((subscription) => {
        const waste = formatCurrency(monthlyCost(subscription));
        const age = subscription.lastOpened || "never";
        return `
          <div class="alert">
            <strong>${subscription.name}</strong>
            <div class="alert-copy">
              <span class="highlight">${waste}</span> monthly and apparently invisible to you.
              ${getAlertCopy(subscription)}
            </div>
            <div class="alert-meta">Category: ${subscription.category} • Last opened: ${age}</div>
          </div>
        `;
      }).join("")
    : `<div class="alert"><strong>No alerts right now.</strong><div class="alert-copy">Either you are disciplined, or the app is not yet convinced.</div></div>`;

  const chartItems = groupByCategory(activeSubscriptions);
  const chartMax = Math.max(...chartItems.map((item) => item.total), 1);
  elements.spendingChart.innerHTML = chartItems
    .map((item) => {
      const width = Math.max((item.total / chartMax) * 100, 6);
      return `
        <div class="chart-bar">
          <div class="label">${item.category}</div>
          <div class="track"><span style="width:${width}%"></span></div>
          <div>${formatCurrency(item.total)}</div>
        </div>
      `;
    })
    .join("");

  elements.cancelCoach.innerHTML = subscriptions.length
    ? subscriptions.slice(0, 5).map((subscription) => {
        const provider = getProviderHelp(subscription.name);
        const canceledText = subscription.canceled ? "Already canceled" : "Still active";
        return `
          <div class="coach-item">
            <strong>${provider.title}</strong>
            <div class="meta">${formatCurrency(monthlyCost(subscription))} per month • ${subscription.category} • ${canceledText}</div>
            <div>${provider.steps.map((step) => `<div class="alert-meta">${step}</div>`).join("")}</div>
            <div class="coach-actions">
              <button class="small-button primaryish" data-cancel="${subscription.id}">${subscription.canceled ? "Canceled" : "Mark as canceled"}</button>
              <button class="small-button" data-opened="${subscription.id}">Mark as used today</button>
            </div>
          </div>
        `;
      }).join("")
    : `<div class="coach-item"><strong>No subscriptions yet.</strong><div class="meta">Add one manually or import your bank activity to start the guilt machine.</div></div>`;

  elements.subscriptionTable.innerHTML = subscriptions.length
    ? subscriptions.map((subscription) => {
        const waste = formatCurrency(monthlyCost(subscription));
        const statusClass = isUnusedThisMonth(subscription) ? "danger" : "good";
        const statusText = isUnusedThisMonth(subscription) ? "Neglected" : "Active";
        return `
          <tr class="subscription-row">
            <td>
              <span class="name">${subscription.name}</span>
              <span class="detail">${subscription.category} • source: ${subscription.source}</span>
            </td>
            <td>${formatCurrency(subscription.price, subscription.currency)}</td>
            <td>${subscription.cycle}</td>
            <td class="status ${subscription.canceled ? "warn" : statusClass}">${subscription.canceled ? "Canceled" : statusText}</td>
            <td>${waste}</td>
            <td><button class="remove-button" data-remove="${subscription.id}">Delete</button></td>
          </tr>
        `;
      }).join("")
    : `<tr><td colspan="6">No subscriptions yet. Add a recurring charge or import one from your bank exports.</td></tr>`;

  elements.bankRecords.innerHTML = state.bankRecords.length
    ? state.bankRecords.map((record) => `
      <div class="alert">
        <strong>${record.bankName} • ${record.accountLabel}</strong>
        <div class="alert-meta">Account: ${record.ibanMasked}</div>
        <div class="alert-copy">Balance snapshot: ${formatCurrency(Number(record.balance || 0), record.currency || "EUR")}</div>
        <div class="coach-actions">
          <button class="small-button" data-delete-bank="${record.id}">Delete record</button>
        </div>
      </div>
    `).join("")
    : `<div class="alert"><strong>No bank snapshots yet.</strong><div class="alert-copy">Save one to track balances with encrypted backend storage.</div></div>`;

  const monthlySaved = canceledSubscriptions.reduce((sum, subscription) => sum + monthlyCost(subscription), 0);
  const voucherStep = Math.max(1, Number(state.rewardSettings.voucherStep || 10));
  const goalPrice = Math.max(50, Number(state.rewardSettings.goalPrice || 1200));
  const goalName = state.rewardSettings.goalName || "new iPhone";
  const vouchers = Math.floor(monthlySaved / voucherStep);
  const biggestActive = activeSubscriptions[0];
  const withOneCancel = monthlySaved + (biggestActive ? monthlyCost(biggestActive) : 0);
  const monthsToGoal = monthlySaved > 0 ? Math.ceil(goalPrice / monthlySaved) : null;
  const monthsIfCancelBiggest = withOneCancel > 0 ? Math.ceil(goalPrice / withOneCancel) : null;

  elements.savedMonthly.textContent = `${formatCurrency(monthlySaved)} saved / month`;
  elements.voucherBadge.textContent = `${vouchers} voucher${vouchers === 1 ? "" : "s"}`;
  elements.voucherCopy.textContent = `Every ${formatCurrency(voucherStep)} saved gives you 1 shopping voucher. Current monthly voucher score: ${vouchers}.`;
  elements.goalTitle.textContent = `${goalName} projection`;

  if (!monthsToGoal) {
    elements.goalCopy.textContent = biggestActive
      ? `If you cancel ${biggestActive.name}, you could reach ${goalName} in about ${monthsIfCancelBiggest} months.`
      : `Cancel at least one recurring payment to start your ${goalName} countdown.`;
  } else if (biggestActive) {
    elements.goalCopy.textContent = `At your current canceled savings, ${goalName} takes about ${monthsToGoal} months. If you also cancel ${biggestActive.name}, that drops to ${monthsIfCancelBiggest} months.`;
  } else {
    elements.goalCopy.textContent = `At your current savings pace, you can fund ${goalName} in about ${monthsToGoal} months.`;
  }

  elements.cancelCoach.querySelectorAll("[data-cancel]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.getAttribute("data-cancel");
      state.subscriptions = state.subscriptions.map((subscription) => (
        subscription.id === id
          ? { ...subscription, canceled: true, usedThisMonth: false }
          : subscription
      ));
      saveAndRender();
    });
  });

  elements.cancelCoach.querySelectorAll("[data-opened]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.getAttribute("data-opened");
      const today = new Date().toISOString().slice(0, 10);
      state.subscriptions = state.subscriptions.map((subscription) => (
        subscription.id === id
          ? { ...subscription, lastOpened: today, usedThisMonth: true }
          : subscription
      ));
      saveAndRender();
    });
  });

  elements.subscriptionTable.querySelectorAll("[data-remove]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.getAttribute("data-remove");
      state.subscriptions = state.subscriptions.filter((subscription) => subscription.id !== id);
      saveAndRender();
    });
  });

  elements.bankRecords.querySelectorAll("[data-delete-bank]").forEach((button) => {
    button.addEventListener("click", async () => {
      const id = button.getAttribute("data-delete-bank");
      if (runtime.apiAvailable && state.user) {
        try {
          await apiRequest(`/bank-records/${id}`, { method: "DELETE" });
          await hydrateRemoteBankRecords();
        } catch (error) {
          alert(error.message);
        }
      } else {
        state.bankRecords = state.bankRecords.filter((record) => String(record.id) !== String(id));
        saveAndRender(false);
      }
    });
  });
}

function groupByCategory(subscriptions) {
  const grouped = subscriptions.reduce((accumulator, subscription) => {
    const category = subscription.category || "Other";
    const bucket = accumulator.get(category) || { category, total: 0 };
    bucket.total += monthlyCost(subscription);
    accumulator.set(category, bucket);
    return accumulator;
  }, new Map());

  return [...grouped.values()].sort((left, right) => right.total - left.total);
}

function formatCurrency(value, currency = "EUR") {
  return new Intl.NumberFormat("en-IE", {
    style: "currency",
    currency,
    maximumFractionDigits: 2
  }).format(value);
}
