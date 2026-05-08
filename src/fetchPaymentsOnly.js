const config = require("./config");
const logger = require("./logger");
const { createClient } = require("./razorpayClient");

function nowUnix() {
  return Math.floor(Date.now() / 1000);
}

function toBoolean(value, fallback) {
  if (typeof value !== "string") {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "y"].includes(normalized)) return true;
  if (["false", "0", "no", "n"].includes(normalized)) return false;
  return fallback;
}

async function main() {
  const now = nowUnix();
  const fromDaysAgo = Math.max(config.scheduler.windowFromDaysAgo, config.scheduler.windowToDaysAgo);
  const toDaysAgo = Math.min(config.scheduler.windowFromDaysAgo, config.scheduler.windowToDaysAgo);
  const from = now - fromDaysAgo * 24 * 60 * 60;
  const to = now - toDaysAgo * 24 * 60 * 60;
  const useTimeWindow = toBoolean(process.env.FETCH_USE_TIME_WINDOW, true);

  const razorpay = createClient(config.razorpay.keyId, config.razorpay.keySecret, {
    logPayloads: config.logging.razorpayPayloads,
  });

  logger.info("Running fetch-only payment test", {
    useTimeWindow,
    from: useTimeWindow ? from : undefined,
    to: useTimeWindow ? to : undefined,
    windowFromDaysAgo: fromDaysAgo,
    windowToDaysAgo: toDaysAgo,
    maxPaymentsPerPage: config.scheduler.maxPaymentsPerPage,
    maxPagesPerRun: config.scheduler.maxPagesPerRun,
  });

  const payments = [];
  for (let page = 0; page < config.scheduler.maxPagesPerRun; page += 1) {
    const skip = page * config.scheduler.maxPaymentsPerPage;
    const request = {
      count: config.scheduler.maxPaymentsPerPage,
      skip,
    };
    if (useTimeWindow) {
      request.from = from;
      request.to = to;
    }

    const response = await razorpay.fetchPayments(request);
    const items = Array.isArray(response.items) ? response.items : [];
    payments.push(...items);

    logger.info("Fetch-only page result", {
      page: page + 1,
      skip,
      pageCount: items.length,
    });

    if (items.length < config.scheduler.maxPaymentsPerPage) {
      break;
    }
  }

  logger.info("Fetch-only completed", {
    fetchedCount: payments.length,
    samplePayments: payments.slice(0, 5).map((p) => ({
      id: p.id,
      status: p.status,
      captured: p.captured,
      created_at: p.created_at,
    })),
  });
}

main().catch((error) => {
  logger.error("Fetch-only failed", { message: error.message });
  process.exit(1);
});
