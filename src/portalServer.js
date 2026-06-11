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
const { loadVendorsByReferenceId } = require("./vendorExcelRepository");
const { readJobRunStatus } = require("./jobRunStore");
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
  const initialStatusJson = JSON.stringify(status.jobStatus || null).replace(/</g, "\\u003c");

  return `<!doctype html>
<html>
  <head><meta charset="utf-8"/><title>Job Runner</title></head>
  <body style="font-family: Arial, sans-serif; max-width: 760px; margin: 24px auto;">
    <div style="display:flex; gap:12px; align-items:center;">
      <a href="/" style="text-decoration:none;">← Back</a>
      <a href="/logout">Logout</a>
    </div>
    <h2>Job Runner</h2>
    <p>Transfers run only for <strong>captured</strong> payments after the hold period (min <strong>15 days</strong>). Splits use <strong>product subtotal</strong>; shipping stays with the marketplace.</p>
    ${successBanner}
    ${errorBanner}

    <section style="border:1px solid #ddd; border-radius:8px; padding:16px; margin-bottom:24px; background:#fafafa;">
      <h3 style="margin-top:0;">Run status</h3>
      <div id="job-status-panel" style="display:grid; gap:8px; font-size:14px; color:#333;">
        <p style="margin:0; color:#666;">Loading status…</p>
      </div>
      <div style="margin-top:16px; display:flex; gap:10px; flex-wrap:wrap;">
        <button type="button" id="run-job-btn" style="padding:10px 18px; cursor:pointer;">Run now</button>
        <button type="button" id="refresh-status-btn" style="padding:10px 18px; cursor:pointer;">Refresh status</button>
      </div>
      <p id="run-job-hint" style="margin:12px 0 0; font-size:13px; color:#666;"></p>
    </section>

    <form method="post" action="/job-runner/settings" style="display:grid; gap:10px; margin-bottom:28px;">
      <h3 style="margin:0;">Schedule settings</h3>
      <label style="display:grid; gap:4px;">
        <span>HOLD_DAYS</span>
        <input name="holdDays" value="${config.settlement.holdDays}" required />
      </label>
      <label style="display:grid; gap:4px;">
        <span>SCHEDULER_CRON</span>
        <input name="schedulerCron" value="${config.scheduler.cron}" required />
      </label>
      <small style="color:#555;">Cron example: <code>0 2 * * *</code> = daily at 02:00 server time. After saving, restart the scheduler process on the server.</small>
      <button type="submit">Save schedule</button>
    </form>

    <script>
      const initialStatus = ${initialStatusJson};
      const statusPanel = document.getElementById("job-status-panel");
      const runBtn = document.getElementById("run-job-btn");
      const refreshBtn = document.getElementById("refresh-status-btn");
      const runHint = document.getElementById("run-job-hint");
      let pollTimer = null;

      function formatInr(paise) {
        if (paise == null || paise === "") return "—";
        return "₹" + (Number(paise) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      }

      function statusBadge(status) {
        const colors = {
          running: { bg: "#fff8e1", border: "#ffe082", text: "#7a5c00", label: "Running" },
          success: { bg: "#e8f7ee", border: "#b7e4c7", text: "#1b5e20", label: "Completed" },
          failed: { bg: "#fdecea", border: "#f5c6cb", text: "#842029", label: "Failed" },
          skipped: { bg: "#eef2ff", border: "#c7d2fe", text: "#3730a3", label: "Skipped" },
        };
        const style = colors[status] || { bg: "#f5f5f5", border: "#ddd", text: "#333", label: status || "Unknown" };
        return '<span style="display:inline-block;padding:4px 10px;border-radius:999px;background:' + style.bg + ";border:1px solid " + style.border + ";color:" + style.text + ';font-weight:600;">' + style.label + "</span>";
      }

      function renderJobStatus(payload) {
        const job = payload && payload.lastRun ? payload.lastRun : null;
        const configInfo = payload && payload.config ? payload.config : {};
        if (!job) {
          statusPanel.innerHTML = '<p style="margin:0;color:#666;">No job has run yet. Click <strong>Run now</strong> to start.</p>';
          return;
        }

        let html = "";
        html += "<div><strong>Status:</strong> " + statusBadge(job.status) + "</div>";
        if (job.triggeredBy) html += "<div><strong>Triggered by:</strong> " + job.triggeredBy + "</div>";
        if (job.startedAt) html += "<div><strong>Started:</strong> " + new Date(job.startedAt).toLocaleString() + "</div>";
        if (job.finishedAt) html += "<div><strong>Finished:</strong> " + new Date(job.finishedAt).toLocaleString() + "</div>";
        if (job.message) html += "<div><strong>Message:</strong> " + job.message + "</div>";

        if (job.stats) {
          const s = job.stats;
          html += '<div style="margin-top:8px;padding:10px;background:#fff;border:1px solid #eee;border-radius:6px;">';
          html += "<div><strong>Payments fetched:</strong> " + (s.paymentsFetched ?? 0) + "</div>";
          html += "<div><strong>With VTEX order:</strong> " + (s.paymentsWithVtexOrder ?? 0) + "</div>";
          html += "<div><strong>Transferred this run:</strong> " + (s.paymentsTransferredThisRun ?? 0) + "</div>";
          html += "<div><strong>Already transferred (skipped):</strong> " + (s.paymentsSkippedAlreadyTransferred ?? 0) + "</div>";
          html += "<div><strong>Not eligible (hold/status/etc.):</strong> " + (s.paymentsSkippedNotEligible ?? 0) + "</div>";
          html += "<div><strong>Errors:</strong> " + (s.paymentsFailed ?? 0) + "</div>";
          if (Array.isArray(s.recentTransfers) && s.recentTransfers.length > 0) {
            html += "<div style=\\"margin-top:8px;\\"><strong>Recent transfers</strong><ul style=\\"margin:6px 0 0;padding-left:18px;\\">";
            for (const t of s.recentTransfers) {
              html += "<li>Payment " + t.paymentId + " → sellers: " + t.sellerCount + ", seller total " + formatInr(t.totalSellerTransferAmount) + ", marketplace " + formatInr(t.marketplaceRetained) + "</li>";
            }
            html += "</ul></div>";
          }
          html += "</div>";
        }

        html += '<div style="margin-top:8px;font-size:13px;color:#666;">';
        html += "Hold: " + (configInfo.holdDays ?? "—") + " days · Window: " + (configInfo.windowFromDaysAgo ?? "—") + "–" + (configInfo.windowToDaysAgo ?? "—") + " days ago · Cron: <code>" + (configInfo.schedulerCron ?? "—") + "</code>";
        html += "</div>";

        statusPanel.innerHTML = html;
      }

      function setRunningUi(running) {
        runBtn.disabled = running;
        runBtn.textContent = running ? "Running…" : "Run now";
        runHint.textContent = running ? "Please wait while payments are fetched and transfers are processed." : "";
      }

      async function fetchStatus() {
        const res = await fetch("/api/job-runner/status");
        const data = await res.json();
        renderJobStatus(data);
        if (data.lastRun && data.lastRun.status === "running") {
          setRunningUi(true);
          if (!pollTimer) pollTimer = setInterval(fetchStatus, 3000);
        } else {
          setRunningUi(false);
          if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
        }
      }

      runBtn.addEventListener("click", async () => {
        setRunningUi(true);
        statusPanel.innerHTML = '<p style="margin:0;color:#7a5c00;">Starting job…</p>';
        try {
          const res = await fetch("/api/job-runner/run", { method: "POST" });
          const data = await res.json();
          renderJobStatus({ lastRun: data, config: data.config });
          if (data.status === "running") {
            pollTimer = setInterval(fetchStatus, 3000);
          } else {
            setRunningUi(false);
          }
        } catch (err) {
          statusPanel.innerHTML = '<p style="margin:0;color:#842029;">Run failed: ' + err.message + "</p>";
          setRunningUi(false);
        }
      });

      refreshBtn.addEventListener("click", fetchStatus);
      renderJobStatus({ lastRun: initialStatus, config: {
        holdDays: ${config.settlement.holdDays},
        windowFromDaysAgo: ${config.scheduler.windowFromDaysAgo},
        windowToDaysAgo: ${config.scheduler.windowToDaysAgo},
        schedulerCron: ${JSON.stringify(config.scheduler.cron)},
      }});
      fetchStatus();
    </script>
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

function renderXlsxUploadPage(status = {}) {
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
  const currentFile = status.currentFile
    ? `<p style="color:#555; margin-bottom:12px;">Current file: <code>${status.currentFile}</code></p>`
    : "";

  return `<!doctype html>
<html>
  <head><meta charset="utf-8"/><title>Fallback XLSX Upload</title></head>
  <body style="font-family: Arial, sans-serif; max-width: 760px; margin: 24px auto;">
    <div style="display:flex; gap:12px; align-items:center;">
      <a href="/" style="text-decoration:none;">← Back</a>
      <a href="/logout">Logout</a>
    </div>
    <h2>Fallback XLSX Upload</h2>
    ${successBanner}
    ${errorBanner}
    ${currentFile}
    <p style="color:#555; font-size:14px;">First row must be column headers. Required: <code>reference_id</code> (VTEX seller id). Recommended: email, phone, legal_business_name, business_type, seller_share_percent, bank_account_number, bank_ifsc.</p>
    <form method="post" action="/xlsx-upload" enctype="multipart/form-data" style="display:grid; gap:10px;">
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

  function buildJobRunnerConfigPayload() {
    return {
      holdDays: config.settlement.holdDays,
      windowFromDaysAgo: config.scheduler.windowFromDaysAgo,
      windowToDaysAgo: config.scheduler.windowToDaysAgo,
      schedulerCron: config.scheduler.cron,
      vtexEnabled: config.vtex.enabled,
      vtexSellerFetchOnly: config.flow.vtexSellerFetchOnly,
    };
  }

  app.get("/job-runner", async (req, res) => {
    const lastRun = await readJobRunStatus(config.paths.jobRunStatusFile);
    const status = {
      success: req.query.success ? String(req.query.success) : "",
      error: req.query.error ? String(req.query.error) : "",
      jobStatus: lastRun,
    };
    res.type("html").send(renderJobRunnerPage(status));
  });

  app.get("/api/job-runner/status", async (_req, res) => {
    try {
      const lastRun = await readJobRunStatus(config.paths.jobRunStatusFile);
      res.json({ ok: true, lastRun, config: buildJobRunnerConfigPayload() });
    } catch (error) {
      res.status(500).json({ ok: false, message: error.message });
    }
  });

  app.post("/api/job-runner/run", async (_req, res) => {
    try {
      const result = await runCycle({ triggeredBy: "manual" });
      res.json({ ...result, config: buildJobRunnerConfigPayload() });
    } catch (error) {
      logger.error("Manual job run failed", { message: error.message });
      res.status(500).json({ ok: false, status: "failed", message: error.message });
    }
  });

  app.get("/xlsx-upload", (_req, res) => {
    const status = {
      success:
        _req.query.success === "1"
          ? `File uploaded successfully (${_req.query.count || "0"} vendor rows). Path: ${_req.query.path || ""}`
          : "",
      error: _req.query.error ? String(_req.query.error) : "",
      currentFile: config.paths.vendorXlsxFile || "",
    };
    res.type("html").send(renderXlsxUploadPage(status));
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

  async function handleXlsxUpload(req, res, { respondWithJson }) {
    try {
      if (!req.file) {
        const message = "No file uploaded";
        if (respondWithJson) {
          return res.status(400).json({ ok: false, message });
        }
        return res.redirect(303, `/xlsx-upload?error=${encodeURIComponent(message)}`);
      }
      const absolutePath = path.resolve(req.file.path);
      await updateEnvFile({ VENDOR_XLSX_FILE: absolutePath });
      config.paths.vendorXlsxFile = absolutePath;
      const vendorMap = loadVendorsByReferenceId(absolutePath);
      const count = vendorMap.size;
      logger.info("Uploaded fallback XLSX and updated env", { path: absolutePath, count });
      if (respondWithJson) {
        return res.json({ ok: true, vendorXlsxFile: absolutePath, vendorCount: count });
      }
      return res.redirect(
        303,
        `/xlsx-upload?success=1&count=${count}&path=${encodeURIComponent(absolutePath)}`
      );
    } catch (error) {
      logger.error("Portal xlsx upload failed", { message: error.message });
      if (respondWithJson) {
        return res.status(500).json({ ok: false, message: error.message });
      }
      return res.redirect(303, `/xlsx-upload?error=${encodeURIComponent(error.message)}`);
    }
  }

  app.post("/xlsx-upload", upload.single("vendorFile"), (req, res) =>
    handleXlsxUpload(req, res, { respondWithJson: false })
  );

  app.post("/api/admin/upload-xlsx", upload.single("vendorFile"), (req, res) =>
    handleXlsxUpload(req, res, { respondWithJson: true })
  );

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
    return res.redirect(303, "/job-runner");
  });

  app.listen(config.portal.port, () => {
    logger.info("Seller portal started", { port: config.portal.port });
  });
}

startPortal();
