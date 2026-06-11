const cron = require("node-cron");
const config = require("./config");
const logger = require("./logger");
const { createClient } = require("./razorpayClient");
const { createVtexClient } = require("./vtexClient");
const { createVtexMasterdataClient } = require("./vtexMasterdataClient");
const { loadState, saveState, loadVendors } = require("./store");
const { processPayments } = require("./paymentProcessor");
const { ensureLinkedAccount } = require("./linkedAccountService");
const { readJobRunStatus, writeJobRunStatus, isJobRunInProgress } = require("./jobRunStore");
const fs = require("fs/promises");

let isRunning = false;

async function persistVendors(filePath, vendorsPayload) {
  await fs.mkdir(require("path").dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(vendorsPayload, null, 2));
}

async function syncVendorLinkedAccounts(razorpay, vendorPayload) {
  let hasUpdates = false;

  for (const vendor of vendorPayload.vendors) {
    if (vendor.accountId) {
      continue;
    }

    try {
      const accountId = await ensureLinkedAccount(razorpay, vendor);
      vendor.accountId = accountId;
      hasUpdates = true;
      logger.info("Created linked account for vendor", {
        vendorId: vendor.vendorId,
        accountId,
      });
    } catch (error) {
      logger.warn("Skipping vendor during startup linked-account sync", {
        vendorId: vendor.vendorId,
        message: error.message,
      });
    }
  }

  if (hasUpdates) {
    await persistVendors(config.paths.vendorFile, vendorPayload);
    logger.info("Persisted newly created linked accounts");
  }
}

function buildVendorFromMasterDataRecord(record) {
  const sellerId = String(record.sellerId || "").trim();
  const sanitized = sellerId.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 30) || "seller";
  const alias = record.linkedAccountAlias || `acc_${sanitized}`;

  return {
    vendorId: `vendor_${sanitized}`,
    vtexSellerId: sellerId,
    linkedAccountAlias: alias,
    accountId: "",
    email: record.email,
    phone: Number(record.phone),
    legalBusinessName: record.legalBusinessName,
    businessType: record.businessType,
    referenceId: record.referenceId || alias,
    bankAccountName: record.bankAccountName || "",
    bankAccountNumber: record.bankAccountNumber || "",
    bankIfsc: record.bankIfsc || "",
    bankName: record.bankName || "",
    bankBranch: record.bankBranch || "",
    profile: record.profile || {},
  };
}

async function syncVendorsFromMasterData(masterData, vendorPayload) {
  if (!masterData.enabled) {
    return false;
  }

  const sellers = await masterData.listSellerKyc();
  if (!Array.isArray(vendorPayload.vendors)) {
    vendorPayload.vendors = [];
  }

  let hasUpdates = false;
  const bySellerId = new Map(
    vendorPayload.vendors
      .filter((vendor) => Boolean(vendor.vtexSellerId))
      .map((vendor) => [String(vendor.vtexSellerId), vendor])
  );

  for (const record of sellers) {
    const sellerId = String(record.sellerId || "").trim();
    if (!sellerId) {
      continue;
    }

    const existing = bySellerId.get(sellerId);
    const normalized = buildVendorFromMasterDataRecord(record);
    if (!existing) {
      vendorPayload.vendors.push(normalized);
      bySellerId.set(sellerId, normalized);
      hasUpdates = true;
      continue;
    }

    const mutableFields = [
      "email",
      "phone",
      "legalBusinessName",
      "businessType",
      "referenceId",
      "linkedAccountAlias",
      "bankAccountName",
      "bankAccountNumber",
      "bankIfsc",
      "bankName",
      "bankBranch",
      "profile",
    ];
    for (const field of mutableFields) {
      const nextValue = normalized[field];
      if (JSON.stringify(existing[field]) !== JSON.stringify(nextValue) && nextValue) {
        existing[field] = nextValue;
        hasUpdates = true;
      }
    }
  }

  if (hasUpdates) {
    await persistVendors(config.paths.vendorFile, vendorPayload);
    logger.info("Synced vendor records from VTEX Master Data", { count: vendorPayload.vendors.length });
  }

  return hasUpdates;
}

async function runCycle(options = {}) {
  const triggeredBy = options.triggeredBy || "cron";
  const statusFile = config.paths.jobRunStatusFile;

  const existingStatus = await readJobRunStatus(statusFile);
  if (isJobRunInProgress(existingStatus)) {
    const message = "A job is already running";
    logger.warn(message, { triggeredBy, startedAt: existingStatus.startedAt });
    return { ok: false, status: "skipped", message, triggeredBy };
  }

  if (isRunning) {
    const message = "This process already has a job running";
    logger.warn(message, { triggeredBy });
    return { ok: false, status: "skipped", message, triggeredBy };
  }

  const startedAt = new Date().toISOString();
  isRunning = true;
  await writeJobRunStatus(statusFile, {
    status: "running",
    startedAt,
    triggeredBy,
    message: "Job in progress…",
  });

  try {
    const razorpay = createClient(config.razorpay.keyId, config.razorpay.keySecret, {
      logPayloads: config.logging.razorpayPayloads,
    });
    const vtex = createVtexClient(config.vtex);
    const masterData = createVtexMasterdataClient(config.vtex);
    const state = await loadState(config.paths.stateFile);
    const vendorPayload = await loadVendors(config.paths.vendorFile);

    if (masterData.enabled) {
      try {
        await masterData.ensureSchema();
      } catch (error) {
        logger.warn("MasterData schema ensure step failed", { message: error.message });
      }
    }

    try {
      await syncVendorsFromMasterData(masterData, vendorPayload);
    } catch (error) {
      logger.warn("Skipping upfront seller sync from MasterData", { message: error.message });
    }

    if (!config.flow.vtexSellerFetchOnly && !config.flow.skipStartupVendorSync) {
      await syncVendorLinkedAccounts(razorpay, vendorPayload);
    } else if (config.flow.vtexSellerFetchOnly) {
      logger.info("VTEX seller fetch-only mode enabled: skipping startup linked-account sync and transfers");
    } else {
      logger.info("Skipping startup linked-account sync; seller-level sync will run inside payment loop");
    }
    const { state: nextState, stats } = await processPayments({
      config,
      razorpay,
      vtex,
      masterData,
      state,
      vendorPayload,
    });
    await saveState(config.paths.stateFile, nextState);

    const finishedAt = new Date().toISOString();
    const result = {
      ok: true,
      status: "success",
      startedAt,
      finishedAt,
      triggeredBy,
      message: "Scheduler cycle completed",
      stats,
    };
    await writeJobRunStatus(statusFile, result);
    logger.info("Scheduler cycle completed", { stats });
    return result;
  } catch (error) {
    const finishedAt = new Date().toISOString();
    const result = {
      ok: false,
      status: "failed",
      startedAt,
      finishedAt,
      triggeredBy,
      message: error.message,
    };
    await writeJobRunStatus(statusFile, result);
    logger.error("Scheduler cycle failed", { message: error.message });
    return result;
  } finally {
    isRunning = false;
  }
}

async function start() {
  const runOnce = process.env.RUN_ONCE === "true";

  if (runOnce) {
    await runCycle();
    return;
  }

  logger.info("Starting scheduler", { cron: config.scheduler.cron });
  cron.schedule(config.scheduler.cron, runCycle);
  await runCycle();
}

if (require.main === module) {
  start();
}

module.exports = {
  runCycle,
  start,
  isJobRunning: () => isRunning,
};
