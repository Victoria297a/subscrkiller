const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

require("dotenv").config();

const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const { MongoClient, ObjectId } = require("mongodb");

const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET || "dev_change_me";
const ENCRYPTION_SOURCE = process.env.DATA_ENCRYPTION_KEY || "dev_data_key_change_me";
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017";
const MONGODB_DB = process.env.MONGODB_DB || "subscrkiller";
const ENCRYPTION_KEY = crypto.createHash("sha256").update(ENCRYPTION_SOURCE).digest();

const rootDir = __dirname;
const dataDir = path.join(rootDir, "data");
const uploadDir = path.join(rootDir, "uploads");

fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(uploadDir, { recursive: true });

let db;
let usersCollection;
let subscriptionsCollection;
let bankRecordsCollection;

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
    id: String(user._id),
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarPath ? `/uploads/${path.basename(user.avatarPath)}` : ""
  };
}

function createToken(user) {
  return jwt.sign({ id: String(user._id), email: user.email }, JWT_SECRET, { expiresIn: "7d" });
}

function parseObjectId(id) {
  if (!ObjectId.isValid(id)) {
    return null;
  }
  return new ObjectId(id);
}

async function initDb() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();

  db = client.db(MONGODB_DB);
  usersCollection = db.collection("users");
  subscriptionsCollection = db.collection("subscriptions");
  bankRecordsCollection = db.collection("bank_records");

  await usersCollection.createIndex({ email: 1 }, { unique: true });
  await subscriptionsCollection.createIndex({ userId: 1, updatedAt: -1 });
  await bankRecordsCollection.createIndex({ userId: 1, createdAt: -1 });
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
    const userId = parseObjectId(decoded.id);
    if (!userId) {
      res.status(401).json({ error: "Invalid session." });
      return;
    }

    const user = await usersCollection.findOne({ _id: userId });
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
  res.json({ ok: true, secureStorage: true, storage: "mongodb" });
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

    const existing = await usersCollection.findOne({ email }, { projection: { _id: 1 } });
    if (existing) {
      res.status(409).json({ error: "An account with this email already exists." });
      return;
    }

    const hash = await bcrypt.hash(password, 12);
    const now = new Date().toISOString();
    const insert = await usersCollection.insertOne({
      email,
      passwordHash: hash,
      name,
      avatarPath: "",
      createdAt: now
    });

    const user = await usersCollection.findOne({ _id: insert.insertedId });
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

    const user = await usersCollection.findOne({ email });
    if (!user) {
      res.status(401).json({ error: "Invalid email or password." });
      return;
    }

    const ok = await bcrypt.compare(password, user.passwordHash || "");
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

  await usersCollection.updateOne({ _id: req.user._id }, { $set: { avatarPath: req.file.filename } });
  res.json({ avatarUrl: `/uploads/${req.file.filename}` });
});

app.get("/api/subscriptions", authMiddleware, async (req, res) => {
  const rows = await subscriptionsCollection
    .find({ userId: req.user._id })
    .sort({ updatedAt: -1 })
    .toArray();

  res.json({
    subscriptions: rows.map((row) => ({
      id: row.clientId || String(row._id),
      name: row.name,
      price: Number(row.price),
      currency: row.currency,
      cycle: row.cycle,
      category: row.category,
      lastOpened: row.lastOpened || "",
      usedThisMonth: Boolean(row.usedThisMonth),
      canceled: Boolean(row.canceled),
      source: row.source
    }))
  });
});

app.put("/api/subscriptions/bulk", authMiddleware, async (req, res) => {
  const subscriptions = Array.isArray(req.body.subscriptions) ? req.body.subscriptions : [];
  const now = new Date().toISOString();

  await subscriptionsCollection.deleteMany({ userId: req.user._id });

  if (subscriptions.length) {
    const docs = subscriptions.map((subscription) => ({
      userId: req.user._id,
      clientId: String(subscription.id || crypto.randomUUID()),
      name: String(subscription.name || "Untitled"),
      price: Number(subscription.price || 0),
      currency: String(subscription.currency || "EUR"),
      cycle: String(subscription.cycle || "monthly"),
      category: String(subscription.category || "Other"),
      lastOpened: String(subscription.lastOpened || ""),
      usedThisMonth: Boolean(subscription.usedThisMonth),
      canceled: Boolean(subscription.canceled),
      source: String(subscription.source || "manual"),
      createdAt: now,
      updatedAt: now
    }));

    await subscriptionsCollection.insertMany(docs);
  }

  res.json({ saved: subscriptions.length });
});

app.get("/api/bank-records", authMiddleware, async (req, res) => {
  const records = await bankRecordsCollection
    .find({ userId: req.user._id })
    .sort({ createdAt: -1 })
    .toArray();

  res.json({
    records: records.map((record) => {
      const iban = decryptString(record.ibanEncrypted);
      const balance = Number(decryptString(record.balanceEncrypted));
      return {
        id: String(record._id),
        bankName: record.bankName,
        accountLabel: record.accountLabel,
        ibanMasked: maskIban(iban),
        balance: Number.isFinite(balance) ? balance : 0,
        currency: record.currency,
        createdAt: record.createdAt
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

  await bankRecordsCollection.insertOne({
    userId: req.user._id,
    bankName,
    accountLabel,
    ibanEncrypted: encryptString(iban),
    balanceEncrypted: encryptString(String(balance)),
    currency,
    createdAt: now
  });

  res.status(201).json({ ok: true });
});

app.delete("/api/bank-records/:id", authMiddleware, async (req, res) => {
  const recordId = parseObjectId(req.params.id);
  if (!recordId) {
    res.status(400).json({ error: "Invalid record id." });
    return;
  }

  await bankRecordsCollection.deleteOne({ _id: recordId, userId: req.user._id });
  res.json({ ok: true });
});

app.get("/api/rewards/summary", authMiddleware, async (req, res) => {
  const goalName = String(req.query.goalName || "new iPhone");
  const goalPrice = Math.max(50, Number(req.query.goalPrice || 1200));
  const voucherStep = Math.max(1, Number(req.query.voucherStep || 10));

  const rows = await subscriptionsCollection.find({ userId: req.user._id }).toArray();
  const canceled = rows.filter((row) => row.canceled === true);
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

void initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Subscription Killer server running at http://localhost:${PORT}`);
    });
  })
  .catch((error) => {
    console.error("MongoDB connection failed:", error);
    process.exit(1);
  });
