const Razorpay = require("razorpay");
const logger = require("./logger");

function redact(value) {
  if (typeof value !== "string") {
    return value;
  }

  if (value.length <= 6) {
    return "***";
  }

  return `${value.slice(0, 3)}***${value.slice(-3)}`;
}

function normalizeError(error) {
  return {
    message: error.message,
    statusCode: error.statusCode || error.status_code || null,
    code: error.code || null,
    description: error.error?.description || null,
    field: error.error?.field || null,
    step: error.error?.step || null,
    reason: error.error?.reason || null,
  };
}

async function withApiLogs({ operation, request, execute, logPayloads }) {
  logger.info("Razorpay API request", {
    operation,
    request: logPayloads ? request : { note: "payload logging disabled" },
  });

  try {
    const response = await execute();
    logger.info("Razorpay API response", {
      operation,
      response: logPayloads ? response : { note: "payload logging disabled" },
    });
    return response;
  } catch (error) {
    logger.error("Razorpay API error", {
      operation,
      request: logPayloads ? request : { note: "payload logging disabled" },
      error: normalizeError(error),
    });
    throw error;
  }
}

function createClient(keyId, keySecret, options = {}) {
  if (!keyId || !keySecret) {
    throw new Error("RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are required");
  }

  const logPayloads = options.logPayloads !== false;
  const client = new Razorpay({
    key_id: keyId,
    key_secret: keySecret,
  });

  logger.info("Initialized Razorpay client", {
    keyId: redact(keyId),
    keySecret: redact(keySecret),
    logPayloads,
  });

  return {
    async fetchPayments({ from, to, count = 100, skip = 0 }) {
      const request = { from, to, count, skip };
      return withApiLogs({
        operation: "payments.all",
        request,
        logPayloads,
        execute: () => client.payments.all(request),
      });
    },

    async createLinkedAccount(payload) {
      return withApiLogs({
        operation: "accounts.create",
        request: payload,
        logPayloads,
        execute: () => client.accounts.create(payload),
      });
    },

    async fetchLinkedAccount(accountId) {
      return withApiLogs({
        operation: "accounts.fetch",
        request: { accountId },
        logPayloads,
        execute: () => client.accounts.fetch(accountId),
      });
    },

    async createTransferFromPayment(paymentId, transfers) {
      const request = { paymentId, transfers };
      return withApiLogs({
        operation: "payments.transfer",
        request,
        logPayloads,
        execute: () => client.payments.transfer(paymentId, { transfers }),
      });
    },
  };
}

module.exports = { createClient };
