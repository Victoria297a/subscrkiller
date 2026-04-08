const STORAGE_KEY = "subscrkiller-state-v3";
const TOKEN_KEY = "subscrkiller-token";
const API_BASE = window.location.protocol === "file:" ? "http://localhost:3000/api" : "/api";

const runtime = {
  apiAvailable: false,
  token: localStorage.getItem(TOKEN_KEY) || "",
  currentPage: "dashboard"
};

const state = loadState();

const elements = {
  authView: document.getElementById("auth-view"),
  appView: document.getElementById("app-view"),
  authForm: document.getElementById("auth-form"),
  loginButton: document.getElementById("login-button"),
  logoutButton: document.getElementById("logout-button"),
  backendStatus: document.getElementById("backend-status"),
  userGreeting: document.getElementById("user-greeting"),
  navButtons: [...document.querySelectorAll("[data-page-target]")],
  pageDashboard: document.getElementById("page-dashboard"),
  pageAdd: document.getElementById("page-add"),
  gotoAdd: document.getElementById("goto-add"),
  backDashboard: document.getElementById("back-dashboard"),
  cancelAdd: document.getElementById("cancel-add"),
  monthlyTotal: document.getElementById("monthly-total"),
  spendingChart: document.getElementById("spending-chart"),
  subscriptionTable: document.getElementById("subscription-table"),
  subscriptionForm: document.getElementById("subscription-form")
};

setupEventListeners();
void initApp();

function setupEventListeners() {
  elements.authForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await register();
  });

  elements.loginButton.addEventListener("click", async () => {
    await login();
  });

  elements.logoutButton.addEventListener("click", () => {
    runtime.token = "";
    localStorage.removeItem(TOKEN_KEY);
    state.user = null;
    state.subscriptions = [];
    saveState();
    render();
  });

  elements.navButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setPage(String(button.getAttribute("data-page-target") || "dashboard"));
    });
  });

  elements.gotoAdd.addEventListener("click", () => setPage("add"));
  elements.backDashboard.addEventListener("click", () => setPage("dashboard"));
  elements.cancelAdd.addEventListener("click", () => {
    elements.subscriptionForm.reset();
    elements.subscriptionForm.elements.currency.value = "EUR";
    setPage("dashboard");
  });

  elements.subscriptionForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!state.user) {
      alert("Please sign in first.");
      return;
    }

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
      canceled: false,
      source: "manual"
    };

    if (!subscription.name || !subscription.price) {
      return;
    }

    state.subscriptions.unshift(subscription);
    await saveAndSync();
    event.currentTarget.reset();
    event.currentTarget.elements.currency.value = "EUR";
    setPage("dashboard");
  });
}

async function initApp() {
  runtime.apiAvailable = await detectApi();
  if (!runtime.apiAvailable) {
    elements.backendStatus.textContent = "Backend API is offline. Start server.js and MongoDB first.";
  } else {
    elements.backendStatus.textContent = "Backend online. You can create an account or sign in.";
  }

  if (runtime.apiAvailable && runtime.token) {
    try {
      const session = await apiRequest("/me", { method: "GET" });
      state.user = session.user;
      await hydrateRemoteSubscriptions();
    } catch {
      runtime.token = "";
      localStorage.removeItem(TOKEN_KEY);
      state.user = null;
      state.subscriptions = [];
      saveState();
    }
  }

  render();
}

async function register() {
  if (!runtime.apiAvailable) {
    alert("Backend API is offline. Start server.js for secure account storage.");
    return;
  }

  const formData = new FormData(elements.authForm);
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
    await hydrateRemoteSubscriptions();
    setPage("dashboard");
    render();
  } catch (error) {
    alert(error.message);
  }
}

async function login() {
  if (!runtime.apiAvailable) {
    alert("Backend API is offline. Start server.js for secure account storage.");
    return;
  }

  const formData = new FormData(elements.authForm);
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
    await hydrateRemoteSubscriptions();
    setPage("dashboard");
    render();
  } catch (error) {
    alert(error.message);
  }
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
        subscriptions: Array.isArray(parsed.subscriptions) ? parsed.subscriptions : []
      };
    }
  } catch {
    // Ignore malformed local state.
  }

  return {
    user: null,
    subscriptions: []
  };
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

async function saveAndSync() {
  saveState();
  render();
  await syncSubscriptions();
}

function applySession(result) {
  runtime.token = result.token;
  localStorage.setItem(TOKEN_KEY, result.token);
  state.user = result.user;
  saveState();
}

async function hydrateRemoteSubscriptions() {
  const result = await apiRequest("/subscriptions", { method: "GET" });
  state.subscriptions = Array.isArray(result.subscriptions) ? result.subscriptions : [];
  saveState();
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
    // Keep local changes if remote sync temporarily fails.
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

function setPage(page) {
  runtime.currentPage = page === "add" ? "add" : "dashboard";
  render();
}

function render() {
  const signedIn = Boolean(state.user);

  elements.authView.classList.toggle("hidden", signedIn);
  elements.appView.classList.toggle("hidden", !signedIn);

  if (!signedIn) {
    return;
  }

  const userName = state.user.name || state.user.email || "User";
  elements.userGreeting.textContent = `${userName}, here is your subscription overview`;

  const showDashboard = runtime.currentPage === "dashboard";
  elements.pageDashboard.classList.toggle("hidden", !showDashboard);
  elements.pageAdd.classList.toggle("hidden", showDashboard);

  elements.navButtons.forEach((button) => {
    const target = String(button.getAttribute("data-page-target") || "dashboard");
    button.classList.toggle("active", target === runtime.currentPage);
  });

  renderChart();
  renderTable();
}

function renderChart() {
  const grouped = groupByTheme(state.subscriptions);
  const monthlyTotal = grouped.reduce((sum, item) => sum + item.total, 0);
  const pieColors = ["#2f79ff", "#0aa7a0", "#f59e0b", "#64748b", "#ef4444", "#8b5cf6", "#14b8a6", "#f97316"];

  elements.monthlyTotal.textContent = `${formatCurrency(monthlyTotal)} / month`;

  if (monthlyTotal <= 0) {
    elements.spendingChart.innerHTML =
      '<div class="hint">No subscriptions yet. Add one to generate your pie chart.</div>';
    return;
  }

  let angle = 0;
  const segments = grouped.map((item, index) => {
    const slice = (item.total / monthlyTotal) * 360;
    const start = angle;
    angle += slice;
    return `${pieColors[index % pieColors.length]} ${start}deg ${angle}deg`;
  });

  const legend = grouped
    .map((item, index) => {
      const percent = monthlyTotal > 0 ? Math.round((item.total / monthlyTotal) * 100) : 0;
      return `
        <div class="legend-item">
          <span class="dot" style="background:${pieColors[index % pieColors.length]}"></span>
          <span class="legend-label">${item.theme}</span>
          <span class="legend-value">${formatCurrency(item.total)} (${percent}%)</span>
        </div>
      `;
    })
    .join("");

  elements.spendingChart.innerHTML = `
    <div class="pie-layout">
      <div
        class="pie-chart"
        role="img"
        aria-label="Subscription share by theme"
        style="background: conic-gradient(${segments.join(",")});"
      ></div>
      <div class="pie-legend">${legend}</div>
    </div>
  `;
}

function renderTable() {
  const rows = [...state.subscriptions].sort((a, b) => monthlyCost(b) - monthlyCost(a));

  if (!rows.length) {
    elements.subscriptionTable.innerHTML =
      '<tr><td colspan="5">No subscriptions yet. Use "Add subscription" to create your first one.</td></tr>';
    return;
  }

  elements.subscriptionTable.innerHTML = rows
    .map((subscription) => {
      const lastOpened = subscription.lastOpened || "Never";
      return `
        <tr>
          <td>${subscription.name}</td>
          <td>${formatCurrency(subscription.price, subscription.currency)}</td>
          <td>${lastOpened}</td>
          <td>${normalizeCategory(subscription.category)}</td>
          <td><button class="remove-button" data-remove="${subscription.id}" type="button">Delete</button></td>
        </tr>
      `;
    })
    .join("");

  elements.subscriptionTable.querySelectorAll("[data-remove]").forEach((button) => {
    button.addEventListener("click", async () => {
      const id = button.getAttribute("data-remove");
      state.subscriptions = state.subscriptions.filter((subscription) => subscription.id !== id);
      await saveAndSync();
    });
  });
}

function groupByTheme(subscriptions) {
  const totals = new Map();

  subscriptions.forEach((subscription) => {
    const theme = normalizeCategory(subscription.category);
    totals.set(theme, (totals.get(theme) || 0) + monthlyCost(subscription));
  });

  return [...totals.entries()]
    .map(([theme, total]) => ({ theme, total }))
    .sort((left, right) => right.total - left.total);
}

function normalizeCategory(category) {
  const value = String(category || "").trim();
  if (!value) {
    return "Other";
  }

  return value
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function monthlyCost(subscription) {
  const amount = Number(subscription.price || 0);
  switch (subscription.cycle) {
    case "yearly":
      return amount / 12;
    case "weekly":
      return amount * 4.33;
    default:
      return amount;
  }
}

function formatCurrency(value, currency = "EUR") {
  return new Intl.NumberFormat("en-IE", {
    style: "currency",
    currency,
    maximumFractionDigits: 2
  }).format(Number(value || 0));
}
