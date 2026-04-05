const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const sqlite3 = require("sqlite3").verbose();

const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET || "dev_change_me";
const ENCRYPTION_SOURCE = process.env.DATA_ENCRYPTION_KEY || "dev_data_key_change_me";
const ENCRYPTION_KEY = crypto.createHash("sha256").update(ENCRYPTION_SOURCE).digest();

const rootDir = __dirname;
const dataDir = path.join(rootDir, "data");
const uploadDir = path.join(rootDir, "uploads");
const dbPath = path.join(dataDir, "subscrkiller.db");

fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(uploadDir, { recursive: true });

const db = new sqlite3.Database(dbPath);

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(error) {
      if (error) {
        reject(error);
        return;
      }
      resolve(this);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(rows);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(row);
    });
  });
}

function encryptString(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", ENCRYPTION_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

function decryptString(payload) {
  const [ivPart, tagPart, encryptedPart] = String(payload || "").split(":");
  if (!ivPart || !tagPart || !encryptedPart) {
    return "";
  }

  const iv = Buffer.from(ivPart, "base64");
  const tag = Buffer.from(tagPart, "base64");
  const encrypted = Buffer.from(encryptedPart, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", ENCRYPTION_KEY, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString("utf8");
}

function maskIban(iban) {
  const clean = String(iban || "").replace(/\s+/g, "");
  if (clean.length < 6) {
    return "***";
  }
  return `${clean.slice(0, 4)}••••${clean.slice(-2)}`;
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

function toPublicUser(user) {
  if (!user) {
    return null;
  }

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatar_path ? `/uploads/${path.basename(user.avatar_path)}` : ""
  };
}

function createToken(user) {
  return jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: "7d" });
}

async function initDb() {
  await run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      avatar_path TEXT,
      created_at TEXT NOT NULL
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      client_id TEXT,
      name TEXT NOT NULL,
      price REAL NOT NULL,
      currency TEXT NOT NULL,
      cycle TEXT NOT NULL,
      category TEXT NOT NULL,
      last_opened TEXT,
      used_this_month INTEGER NOT NULL,
      canceled INTEGER NOT NULL,
      source TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS bank_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      bank_name TEXT NOT NULL,
      account_label TEXT NOT NULL,
      iban_encrypted TEXT NOT NULL,
      balance_encrypted TEXT NOT NULL,
      currency TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);
}

const app = express();

app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use("/uploads", express.static(uploadDir));

const storage = multer.diskStorage({
  destination: (_, __, callback) => callback(null, uploadDir),
  filename: (_, file, callback) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    callback(null, `${Date.now()}-${crypto.randomUUID()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (_, file, callback) => {
    if (file.mimetype.startsWith("image/")) {
      callback(null, true);
      return;
    }
    callback(new Error("Only image uploads are allowed."));
  }
});

async function authMiddleware(req, res, next) {
  const header = req.headers.authorization || "";
  const [, token] = header.split(" ");

  if (!token) {
    res.status(401).json({ error: "Missing auth token." });
    return;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await get("SELECT * FROM users WHERE id = ?", [decoded.id]);
    if (!user) {
      res.status(401).json({ error: "Invalid session." });
      return;
    }
    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: "Invalid auth token." });
  }
}

app.get("/api/health", (_, res) => {
  res.json({ ok: true, secureStorage: true });
});

app.post("/api/auth/register", async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    const name = String(req.body.name || "").trim();

    if (!email || !password || !name) {
      res.status(400).json({ error: "Name, email, and password are required." });
      return;
    }

    if (password.length < 8) {
      res.status(400).json({ error: "Password must be at least 8 characters." });
      return;
    }

    const existing = await get("SELECT id FROM users WHERE email = ?", [email]);
    if (existing) {
      res.status(409).json({ error: "An account with this email already exists." });
      return;
    }

    const hash = await bcrypt.hash(password, 12);
    const now = new Date().toISOString();
    const result = await run(
      "INSERT INTO users (email, password_hash, name, created_at) VALUES (?, ?, ?, ?)",
      [email, hash, name, now]
    );

    const user = await get("SELECT * FROM users WHERE id = ?", [result.lastID]);
    const token = createToken(user);
    res.status(201).json({ token, user: toPublicUser(user) });
  } catch (error) {
    res.status(500).json({ error: "Registration failed.", details: String(error.message || error) });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");

    const user = await get("SELECT * FROM users WHERE email = ?", [email]);
    if (!user) {
      res.status(401).json({ error: "Invalid email or password." });
      return;
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      res.status(401).json({ error: "Invalid email or password." });
      return;
    }

    const token = createToken(user);
    res.json({ token, user: toPublicUser(user) });
  } catch (error) {
    res.status(500).json({ error: "Login failed.", details: String(error.message || error) });
  }
});

app.get("/api/me", authMiddleware, (req, res) => {
  res.json({ user: toPublicUser(req.user) });
});

app.post("/api/me/avatar", authMiddleware, upload.single("avatar"), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "Missing avatar file." });
    return;
  }

  await run("UPDATE users SET avatar_path = ? WHERE id = ?", [req.file.filename, req.user.id]);
  res.json({ avatarUrl: `/uploads/${req.file.filename}` });
});

app.get("/api/subscriptions", authMiddleware, async (req, res) => {
  const rows = await all(
    `SELECT * FROM subscriptions WHERE user_id = ? ORDER BY updated_at DESC`,
    [req.user.id]
  );

  res.json({
    subscriptions: rows.map((row) => ({
      id: row.client_id || String(row.id),
      name: row.name,
      price: Number(row.price),
      currency: row.currency,
      cycle: row.cycle,
      category: row.category,
      lastOpened: row.last_opened || "",
      usedThisMonth: Boolean(row.used_this_month),
      canceled: Boolean(row.canceled),
      source: row.source
    }))
  });
});

app.put("/api/subscriptions/bulk", authMiddleware, async (req, res) => {
  const subscriptions = Array.isArray(req.body.subscriptions) ? req.body.subscriptions : [];
  const now = new Date().toISOString();

  await run("DELETE FROM subscriptions WHERE user_id = ?", [req.user.id]);

  for (const subscription of subscriptions) {
    await run(
      `INSERT INTO subscriptions (
        user_id, client_id, name, price, currency, cycle, category,
        last_opened, used_this_month, canceled, source, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.user.id,
        String(subscription.id || crypto.randomUUID()),
        String(subscription.name || "Untitled"),
        Number(subscription.price || 0),
        String(subscription.currency || "EUR"),
        String(subscription.cycle || "monthly"),
        String(subscription.category || "Other"),
        String(subscription.lastOpened || ""),
        subscription.usedThisMonth ? 1 : 0,
        subscription.canceled ? 1 : 0,
        String(subscription.source || "manual"),
        now,
        now
      ]
    );
  }

  res.json({ saved: subscriptions.length });
});

app.get("/api/bank-records", authMiddleware, async (req, res) => {
  const records = await all(
    "SELECT * FROM bank_records WHERE user_id = ? ORDER BY created_at DESC",
    [req.user.id]
  );

  res.json({
    records: records.map((record) => {
      const iban = decryptString(record.iban_encrypted);
      const balance = Number(decryptString(record.balance_encrypted));
      return {
        id: record.id,
        bankName: record.bank_name,
        accountLabel: record.account_label,
        ibanMasked: maskIban(iban),
        balance: Number.isFinite(balance) ? balance : 0,
        currency: record.currency,
        createdAt: record.created_at
      };
    })
  });
});

app.post("/api/bank-records", authMiddleware, async (req, res) => {
  const bankName = String(req.body.bankName || "").trim();
  const accountLabel = String(req.body.accountLabel || "").trim();
  const iban = String(req.body.iban || "").trim();
  const balance = Number(req.body.balance || 0);
  const currency = String(req.body.currency || "EUR").trim().toUpperCase();

  if (!bankName || !accountLabel || !iban || !Number.isFinite(balance)) {
    res.status(400).json({ error: "bankName, accountLabel, iban, and balance are required." });
    return;
  }

  const now = new Date().toISOString();

  await run(
    `INSERT INTO bank_records (user_id, bank_name, account_label, iban_encrypted, balance_encrypted, currency, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      req.user.id,
      bankName,
      accountLabel,
      encryptString(iban),
      encryptString(String(balance)),
      currency,
      now
    ]
  );

  res.status(201).json({ ok: true });
});

app.delete("/api/bank-records/:id", authMiddleware, async (req, res) => {
  const id = Number(req.params.id);
  await run("DELETE FROM bank_records WHERE id = ? AND user_id = ?", [id, req.user.id]);
  res.json({ ok: true });
});

app.get("/api/rewards/summary", authMiddleware, async (req, res) => {
  const goalName = String(req.query.goalName || "new iPhone");
  const goalPrice = Math.max(50, Number(req.query.goalPrice || 1200));
  const voucherStep = Math.max(1, Number(req.query.voucherStep || 10));

  const rows = await all("SELECT * FROM subscriptions WHERE user_id = ?", [req.user.id]);
  const canceled = rows.filter((row) => row.canceled === 1);
  const monthlySaved = canceled.reduce((sum, row) => sum + monthlyCost(row), 0);
  const vouchers = Math.floor(monthlySaved / voucherStep);
  const monthsToGoal = monthlySaved > 0 ? Math.ceil(goalPrice / monthlySaved) : null;

  res.json({
    monthlySaved,
    vouchers,
    goalName,
    goalPrice,
    monthsToGoal,
    projection: monthsToGoal
      ? `At this savings pace, you can reach ${goalName} in about ${monthsToGoal} months.`
      : `Cancel more subscriptions to start your ${goalName} countdown.`
  });
});

app.use(express.static(rootDir));

app.get("*", (_, res) => {
  res.sendFile(path.join(rootDir, "index.html"));
});

void initDb().then(() => {
  app.listen(PORT, () => {
    console.log(`Subscription Killer server running at http://localhost:${PORT}`);
  });
});
