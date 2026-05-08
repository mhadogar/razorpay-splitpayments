const path = require("path");
const dotenv = require("dotenv");

dotenv.config();

function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toBoolean(value, fallback) {
  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "y"].includes(normalized)) {
    return true;
  }
  if (["false", "0", "no", "n"].includes(normalized)) {
    return false;
  }

  return fallback;
}

const config = {
  razorpay: {
    keyId: process.env.RAZORPAY_KEY_ID || "",
    keySecret: process.env.RAZORPAY_KEY_SECRET || "",
  },
  vtex: {
    enabled: toBoolean(process.env.VTEX_ENABLED, false),
    baseUrl: process.env.VTEX_BASE_URL || "",
    appKey: process.env.VTEX_APP_KEY || "",
    appToken: process.env.VTEX_APP_TOKEN || "",
    masterDataEntity: process.env.VTEX_MASTERDATA_ENTITY || "SL",
    masterDataSellerIdField: process.env.VTEX_MASTERDATA_SELLER_ID_FIELD || "sellerId",
  },
  scheduler: {
    cron: process.env.SCHEDULER_CRON || "*/10 * * * *",
    windowFromDaysAgo: toNumber(process.env.PAYMENT_WINDOW_FROM_DAYS_AGO, 45),
    windowToDaysAgo: toNumber(process.env.PAYMENT_WINDOW_TO_DAYS_AGO, 15),
    maxPaymentsPerPage: toNumber(process.env.MAX_PAYMENTS_PER_PAGE, 100),
    maxPagesPerRun: toNumber(process.env.MAX_PAGES_PER_RUN, 50),
  },
  settlement: {
    holdDays: Math.max(15, toNumber(process.env.HOLD_DAYS, 15)),
    currency: process.env.CURRENCY || "INR",
    minimumTransferAmount: toNumber(process.env.MIN_TRANSFER_AMOUNT, 100),
    gstPercent: toNumber(process.env.GST_PERCENT, 16),
  },
  paths: {
    stateFile: process.env.STATE_FILE || path.join(process.cwd(), "data", "state.json"),
    vendorFile: process.env.VENDOR_FILE || path.join(process.cwd(), "data", "vendors.json"),
    vendorXlsxFile:
      process.env.VENDOR_XLSX_FILE || "/Users/mhadogar/Downloads/coffeesooq_vendor_information (2).xlsx",
  },
  logging: {
    razorpayPayloads: toBoolean(process.env.LOG_RAZORPAY_PAYLOADS, true),
  },
  flow: {
    vtexSellerFetchOnly: toBoolean(process.env.VTEX_SELLER_FETCH_ONLY, false),
    skipStartupVendorSync: toBoolean(process.env.SKIP_STARTUP_VENDOR_SYNC, true),
  },
  portal: {
    enabled: toBoolean(process.env.PORTAL_ENABLED, true),
    port: toNumber(process.env.PORTAL_PORT, 3030),
  },
  auth: {
    username: process.env.ADMIN_USERNAME || "",
    password: process.env.ADMIN_PASSWORD || "",
    passwordHash: process.env.ADMIN_PASSWORD_HASH || "",
    sessionSecret: process.env.SESSION_SECRET || "",
    secureCookie: toBoolean(process.env.SESSION_SECURE_COOKIE, false),
  },
};

module.exports = config;
