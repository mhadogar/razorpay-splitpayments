const express = require("express");
const fs = require("fs/promises");
const path = require("path");
const multer = require("multer");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const cron = require("node-cron");
const config = require("./config");
const logger = require("./logger");
const { createVtexMasterdataClient } = require("./vtexMasterdataClient");
const { runCycle } = require("./index");

function renderForm() {
  return `<!doctype html>
<html>
  <head><meta charset="utf-8"/><title>Seller Onboarding Portal</title></head>
  <body style="font-family: Arial, sans-serif; max-width: 760px; margin: 24px auto;">
    <h2>CoffeeSooq Split Payments Admin</h2>
    <p>Manage seller onboarding (SE2), runtime .env config and fallback XLSX upload.</p>
    <div style="display:grid; gap:12px; max-width:380px;">
      <a href="/seller-registration" style="padding:10px 14px; border:1px solid #ccc; border-radius:6px; text-decoration:none;">Seller Registration</a>
      <a href="/job-runner" style="padding:10px 14px; border:1px solid #ccc; border-radius:6px; text-decoration:none;">Job Runner</a>
      <a href="/env-management" style="padding:10px 14px; border:1px solid #ccc; border-radius:6px; text-decoration:none;">Environment Management</a>
      <a href="/xlsx-upload" style="padding:10px 14px; border:1px solid #ccc; border-radius:6px; text-decoration:none;">Fallback XLSX Upload</a>
    </div>
  </body>
</html>`;
}

function renderLoginPage(status = {}) {
  const errorBanner = status.error
    ? `<div style="padding:10px 12px; background:#fdecea; border:1px solid #f5c6cb; border-radius:6px; margin-bottom:12px; color:#842029;">
        ${status.error}
      </div>`
    : "";
  return `<!doctype html>
<html>
  <head><meta charset="utf-8"/><title>Admin Login</title></head>
  <body style="font-family: Arial, sans-serif; max-width: 420px; margin: 48px auto;">
    <h2>Portal Login</h2>
    ${errorBanner}
    <form method="post" action="/login" style="display:grid; gap:10px;">
      <input name="username" placeholder="Username" required />
      <input name="password" type="password" placeholder="Password" required />
      <button type="submit">Login</button>
    </form>
  </body>
</html>`;
}

function renderSellerRegistrationPage(status = {}) {
  const successBanner = status.success
    ? `<div style="padding:10px 12px; background:#e8f7ee; border:1px solid #b7e4c7; border-radius:6px; margin-bottom:12px; color:#1b5e20;">
        Seller registered successfully: <strong>${status.sellerId || ""}</strong>
      </div>`
    : "";
  const errorBanner = status.error
    ? `<div style="padding:10px 12px; background:#fdecea; border:1px solid #f5c6cb; border-radius:6px; margin-bottom:12px; color:#842029;">
        Failed to register seller: ${status.error}
      </div>`
    : "";

  return `<!doctype html>
<html>
  <head><meta charset="utf-8"/><title>Seller Registration</title></head>
  <body style="font-family: Arial, sans-serif; max-width: 760px; margin: 24px auto;">
    <div style="display:flex; gap:12px; align-items:center;">
      <a href="/" style="text-decoration:none;">← Back</a>
      <a href="/logout">Logout</a>
    </div>
    <h2>Seller Registration (SE2)</h2>
    ${successBanner}
    ${errorBanner}
    <form method="post" action="/seller-registration" style="display:grid; gap:10px; margin-bottom:28px;">
      <input name="sellerId" placeholder="VTEX Seller ID" required />
      <input name="email" placeholder="Business Email" required />
      <input name="phone" placeholder="Phone (e.g. 919876543210)" required />
      <input name="legalBusinessName" placeholder="Legal Business Name" required />
      <input name="businessType" placeholder="Business Type (proprietorship/partnership/...)" required />
      <input name="referenceId" placeholder="reference_id (optional)" />
      <input name="sellerSharePercent" placeholder="Seller Share % (default 100)" />
      <input name="sellerGstPercent" placeholder="Seller GST % (default 0)" />
      <input name="marketplaceGstPercent" placeholder="Marketplace GST % (default 0)" />
      <input name="bankAccountName" placeholder="Bank Account Holder Name" required />
      <input name="bankAccountNumber" placeholder="Bank Account Number" required />
      <input name="bankIfsc" placeholder="Bank IFSC (e.g. HDFC0001234)" required />
      <small style="color:#555;">Hint: IFSC format is usually 4 letters + 0 + 6 digits (example: HDFC0001234).</small>
      <small style="color:#555;">Hint: Enter full account number; it is stored securely in Master Data and only used for linked account creation.</small>
      <input name="bankName" placeholder="Bank Name" />
      <input name="bankBranch" placeholder="Bank Branch" />
      <button type="submit">Save to VTEX Master Data</button>
    </form>
  </body>
</html>`;
}

function renderJobRunnerPage(status = {}) {
  const successBanner = status.success
    ? `<div style="padding:10px 12px; background:#e8f7ee; border:1px solid #b7e4c7; border-radius:6px; margin-bottom:12px; color:#1b5e20;">
        ${status.success}
      </div>`
    : "";
  const errorBanner = status.error
    ? `<div style="padding:10px 12px; background:#fdecea; border:1px solid #f5c6cb; border-radius:6px; margin-bottom:12px; color:#842029;">
        ${status.error}
      </div>`
    : "";

  return `<!doctype html>
<html>
  <head><meta charset="utf-8"/><title>Job Runner</title></head>
  <body style="font-family: Arial, sans-serif; max-width: 760px; margin: 24px auto;">
    <div style="display:flex; gap:12px; align-items:center;">
      <a href="/" style="text-decoration:none;">← Back</a>
      <a href="/logout">Logout</a>
    </div>
    <h2>Job Runner</h2>
    <p>Transfers run only for captured payments after hold period. Keep <strong>HOLD_DAYS=15</strong> for refund safety.</p>
    ${successBanner}
    ${errorBanner}
    <form method="post" action="/job-runner/settings" style="display:grid; gap:10px; margin-bottom:28px;">
      <label style="display:grid; gap:4px;">
        <span>HOLD_DAYS</span>
        <input name="holdDays" value="${config.settlement.holdDays}" required />
      </label>
      <label style="display:grid; gap:4px;">
        <span>SCHEDULER_CRON</span>
        <input name="schedulerCron" value="${config.scheduler.cron}" required />
      </label>
      <small style="color:#555;">Cron example: <code>0 2 * * *</code> = run daily at 02:00 server time.</small>
      <button type="submit">Save Job Schedule</button>
    </form>

    <form method="post" action="/job-runner/run-now">
      <button type="submit">Run Now</button>
    </form>
  </body>
</html>`;
}

function renderEnvManagementPage() {
  const envFormFields = [
    "RAZORPAY_KEY_ID",
    "RAZORPAY_KEY_SECRET",
    "VTEX_ENABLED",
    "VTEX_BASE_URL",
    "VTEX_APP_KEY",
    "VTEX_APP_TOKEN",
    "VTEX_MASTERDATA_ENTITY",
    "VTEX_MASTERDATA_SELLER_ID_FIELD",
    "VTEX_SELLER_FETCH_ONLY",
    "SKIP_STARTUP_VENDOR_SYNC",
    "PAYMENT_WINDOW_FROM_DAYS_AGO",
    "PAYMENT_WINDOW_TO_DAYS_AGO",
    "MAX_PAYMENTS_PER_PAGE",
    "MAX_PAGES_PER_RUN",
    "HOLD_DAYS",
    "CURRENCY",
    "MIN_TRANSFER_AMOUNT",
    "GST_PERCENT",
    "VENDOR_XLSX_FILE",
    "LOG_RAZORPAY_PAYLOADS",
    "SCHEDULER_CRON",
  ];

  return `<!doctype html>
<html>
  <head><meta charset="utf-8"/><title>Environment Management</title></head>
  <body style="font-family: Arial, sans-serif; max-width: 760px; margin: 24px auto;">
    <div style="display:flex; gap:12px; align-items:center;">
      <a href="/" style="text-decoration:none;">← Back</a>
      <a href="/logout">Logout</a>
    </div>
    <h2>Environment Management (.env)</h2>
    <form method="post" action="/api/admin/env" style="display:grid; gap:10px; margin-bottom:28px;">
      ${envFormFields
        .map(
          (field) =>
            `<label style="display:grid; gap:4px;"><span>${field}</span><input name="${field}" placeholder="${field}" /></label>`
        )
        .join("")}
      <button type="submit">Save .env</button>
    </form>
  </body>
</html>`;
}

function renderXlsxUploadPage() {
  return `<!doctype html>
<html>
  <head><meta charset="utf-8"/><title>Fallback XLSX Upload</title></head>
  <body style="font-family: Arial, sans-serif; max-width: 760px; margin: 24px auto;">
    <div style="display:flex; gap:12px; align-items:center;">
      <a href="/" style="text-decoration:none;">← Back</a>
      <a href="/logout">Logout</a>
    </div>
    <h2>Fallback XLSX Upload</h2>
    <form method="post" action="/api/admin/upload-xlsx" enctype="multipart/form-data" style="display:grid; gap:10px;">
      <input type="file" name="vendorFile" accept=".xlsx" required />
      <button type="submit">Upload XLSX to server</button>
    </form>
  </body>
</html>`;
}

async function updateEnvFile(updates) {
  const envPath = path.join(process.cwd(), ".env");
  const content = await fs.readFile(envPath, "utf8");
  const lines = content.split("\n");
  const keys = new Set(Object.keys(updates));

  const nextLines = lines.map((line) => {
    if (!line || line.startsWith("#") || !line.includes("=")) {
      return line;
    }
    const idx = line.indexOf("=");
    const key = line.slice(0, idx).trim();
    if (!keys.has(key)) {
      return line;
    }
    const value = String(updates[key] ?? "").trim();
    keys.delete(key);
    return `${key}=${value}`;
  });

  for (const key of keys) {
    const value = String(updates[key] ?? "").trim();
    nextLines.push(`${key}=${value}`);
  }

  await fs.writeFile(envPath, nextLines.join("\n"));
}

async function startPortal() {
  if (!config.portal.enabled) {
    logger.info("Portal disabled, skipping server startup");
    return;
  }

  const app = express();
  const masterData = createVtexMasterdataClient(config.vtex);
  if (masterData.enabled) {
    try {
      await masterData.ensureSchema();
    } catch (error) {
      logger.warn("Portal schema ensure failed", { message: error.message });
    }
  }
  const uploadDir = path.join(process.cwd(), "data", "uploads");
  await fs.mkdir(uploadDir, { recursive: true });
  const upload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, uploadDir),
      filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname || ".xlsx") || ".xlsx";
        cb(null, `vendors-fallback${ext}`);
      },
    }),
    fileFilter: (_req, file, cb) => {
      cb(null, String(file.originalname || "").toLowerCase().endsWith(".xlsx"));
    },
  });
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(
    session({
      name: "coffeesooq_portal_session",
      secret: config.auth.sessionSecret || "change-this-session-secret",
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: config.auth.secureCookie,
        sameSite: "lax",
        maxAge: 12 * 60 * 60 * 1000,
      },
    })
  );

  async function verifyPassword(inputPassword) {
    if (config.auth.passwordHash) {
      return bcrypt.compare(String(inputPassword || ""), config.auth.passwordHash);
    }
    return String(inputPassword || "") === String(config.auth.password || "");
  }

  function requireAuth(req, res, next) {
    if (req.session && req.session.authenticated) {
      return next();
    }
    return res.redirect(303, "/login");
  }

  app.get("/login", (req, res) => {
    if (req.session && req.session.authenticated) {
      return res.redirect(303, "/");
    }
    const error = req.query.error ? String(req.query.error) : "";
    return res.type("html").send(renderLoginPage({ error }));
  });

  app.post("/login", async (req, res) => {
    const username = String(req.body.username || "").trim();
    const password = String(req.body.password || "");
    const usernameOk = username === config.auth.username;
    const passwordOk = await verifyPassword(password);
    if (!usernameOk || !passwordOk) {
      return res.redirect(303, "/login?error=Invalid%20credentials");
    }
    req.session.authenticated = true;
    req.session.username = username;
    return res.redirect(303, "/");
  });

  app.get("/logout", (req, res) => {
    req.session.destroy(() => {
      res.redirect(303, "/login");
    });
  });

  app.use(requireAuth);

  app.get("/", (_req, res) => {
    res.type("html").send(renderForm());
  });

  app.get("/seller-registration", (_req, res) => {
    const status = {
      success: _req.query.success === "1",
      sellerId: _req.query.sellerId || "",
      error: _req.query.error || "",
    };
    res.type("html").send(renderSellerRegistrationPage(status));
  });

  app.get("/env-management", (_req, res) => {
    res.type("html").send(renderEnvManagementPage());
  });

  app.get("/job-runner", (req, res) => {
    const status = {
      success: req.query.success ? String(req.query.success) : "",
      error: req.query.error ? String(req.query.error) : "",
    };
    res.type("html").send(renderJobRunnerPage(status));
  });

  app.get("/xlsx-upload", (_req, res) => {
    res.type("html").send(renderXlsxUploadPage());
  });

  async function saveSeller(req) {
    const sellerId = String(req.body.sellerId || "").trim();
    const sanitizedSellerId = sellerId.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 30) || "seller";
    const alias = `acc_${sanitizedSellerId}`;
    const payload = {
      sellerId,
      email: req.body.email,
      phone: req.body.phone,
      legalBusinessName: req.body.legalBusinessName,
      businessType: req.body.businessType,
      referenceId: req.body.referenceId || alias,
      linkedAccountAlias: alias,
      sellerSharePercent: Number(req.body.sellerSharePercent || 100),
      sellerGstPercent: Number(req.body.sellerGstPercent || 0),
      marketplaceGstPercent: Number(req.body.marketplaceGstPercent || 0),
      bankAccountName: req.body.bankAccountName,
      bankAccountNumber: req.body.bankAccountNumber,
      bankIfsc: String(req.body.bankIfsc || "").toUpperCase(),
      bankName: req.body.bankName,
      bankBranch: req.body.bankBranch,
      profile: {
        category: req.body.category || "ecommerce",
        subcategory: req.body.subcategory || "marketplace",
        addresses: {
          registered: {
            street1: req.body.street1 || "NA",
            street2: req.body.street2 || "NA",
            city: req.body.city || "NA",
            state: req.body.state || "NA",
            postal_code: req.body.postalCode || "560001",
            country: req.body.country || "IN",
          },
        },
      },
    };
    const response = await masterData.upsertSellerKyc(payload);
    return { sellerId, alias, response };
  }

  app.post("/seller-registration", async (req, res) => {
    try {
      const saved = await saveSeller(req);
      res.redirect(303, `/seller-registration?success=1&sellerId=${encodeURIComponent(saved.sellerId)}`);
    } catch (error) {
      logger.error("Portal seller save failed", { message: error.message });
      res.redirect(303, `/seller-registration?error=${encodeURIComponent(error.message)}`);
    }
  });

  app.post("/api/sellers", async (req, res) => {
    try {
      const saved = await saveSeller(req);
      res.status(201).json({ ok: true, sellerId: saved.sellerId, linkedAccountAlias: saved.alias, masterData: saved.response });
    } catch (error) {
      logger.error("Portal seller save failed", { message: error.message });
      res.status(500).json({ ok: false, message: error.message });
    }
  });

  app.get("/api/sellers", async (_req, res) => {
    try {
      const sellers = await masterData.listSellerKyc();
      res.json({ ok: true, count: sellers.length, sellers });
    } catch (error) {
      logger.error("Portal seller list failed", { message: error.message });
      res.status(500).json({ ok: false, message: error.message });
    }
  });

  app.post("/api/admin/env", async (req, res) => {
    try {
      const updates = {};
      for (const [key, value] of Object.entries(req.body || {})) {
        if (!String(key).trim()) {
          continue;
        }
        if (String(value || "").trim() === "") {
          continue;
        }
        updates[key] = String(value).trim();
      }
      await updateEnvFile(updates);
      logger.info("Updated .env through portal", { updatedKeys: Object.keys(updates) });
      res.json({ ok: true, updatedKeys: Object.keys(updates) });
    } catch (error) {
      logger.error("Portal env update failed", { message: error.message });
      res.status(500).json({ ok: false, message: error.message });
    }
  });

  app.post("/api/admin/upload-xlsx", upload.single("vendorFile"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ ok: false, message: "No file uploaded" });
      }
      const absolutePath = path.resolve(req.file.path);
      await updateEnvFile({ VENDOR_XLSX_FILE: absolutePath });
      logger.info("Uploaded fallback XLSX and updated env", { path: absolutePath });
      return res.json({ ok: true, vendorXlsxFile: absolutePath });
    } catch (error) {
      logger.error("Portal xlsx upload failed", { message: error.message });
      return res.status(500).json({ ok: false, message: error.message });
    }
  });

  app.post("/job-runner/settings", async (req, res) => {
    try {
      const holdDays = Number(req.body.holdDays);
      const schedulerCron = String(req.body.schedulerCron || "").trim();

      if (!Number.isFinite(holdDays) || holdDays < 15) {
        return res.redirect(303, "/job-runner?error=HOLD_DAYS%20must%20be%20at%20least%2015");
      }
      if (!cron.validate(schedulerCron)) {
        return res.redirect(303, "/job-runner?error=Invalid%20SCHEDULER_CRON");
      }

      await updateEnvFile({
        HOLD_DAYS: String(Math.floor(holdDays)),
        SCHEDULER_CRON: schedulerCron,
      });
      return res.redirect(303, "/job-runner?success=Saved%20schedule.%20Restart%20scheduler%20process%20to%20apply.");
    } catch (error) {
      logger.error("Job runner settings update failed", { message: error.message });
      return res.redirect(303, `/job-runner?error=${encodeURIComponent(error.message)}`);
    }
  });

  app.post("/job-runner/run-now", async (_req, res) => {
    try {
      await runCycle();
      return res.redirect(303, "/job-runner?success=Manual%20run%20completed");
    } catch (error) {
      logger.error("Manual run failed from portal", { message: error.message });
      return res.redirect(303, `/job-runner?error=${encodeURIComponent(error.message)}`);
    }
  });

  app.listen(config.portal.port, () => {
    logger.info("Seller portal started", { port: config.portal.port });
  });
}

startPortal();
