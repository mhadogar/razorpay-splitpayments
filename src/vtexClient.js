const logger = require("./logger");

function trimTrailingSlash(url) {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

function createVtexClient(config) {
  const enabled = config.enabled === true;
  if (!enabled) {
    return {
      enabled: false,
      async fetchOrder() {
        throw new Error("VTEX client is disabled");
      },
    };
  }

  if (!config.baseUrl || !config.appKey || !config.appToken) {
    throw new Error("VTEX_BASE_URL, VTEX_APP_KEY and VTEX_APP_TOKEN are required when VTEX_ENABLED=true");
  }

  const baseUrl = trimTrailingSlash(config.baseUrl);

  function candidateOrderIds(rawId) {
    const id = String(rawId).trim();
    if (!id) {
      return [];
    }
    // OMS order id is often "orderGroup-01"; Razorpay notes may store group only.
    if (!id.includes("-")) {
      return [id, `${id}-01`];
    }
    return [id];
  }

  return {
    enabled: true,
    async fetchOrder(orderId) {
      const candidates = candidateOrderIds(orderId);
      let lastError = null;

      for (const candidate of candidates) {
        const url = `${baseUrl}/api/oms/pvt/orders/${encodeURIComponent(candidate)}`;
        logger.info("VTEX API request", { operation: "orders.get", orderId: candidate, url });

        const response = await fetch(url, {
          method: "GET",
          headers: {
            "X-VTEX-API-AppKey": config.appKey,
            "X-VTEX-API-AppToken": config.appToken,
            Accept: "application/json",
          },
        });

        if (response.status === 404 && candidates.length > 1 && candidate === candidates[0]) {
          logger.warn("VTEX order not found, retrying with -01 suffix", {
            tried: candidate,
            next: candidates[1],
          });
          lastError = new Error(`VTEX order fetch failed for ${candidate} with status 404`);
          continue;
        }

        if (!response.ok) {
          logger.error("VTEX API error", {
            operation: "orders.get",
            orderId: candidate,
            status: response.status,
            statusText: response.statusText,
          });
          throw new Error(`VTEX order fetch failed for ${candidate} with status ${response.status}`);
        }

        const payload = await response.json();
        logger.info("VTEX API response", {
          operation: "orders.get",
          orderId: candidate,
          orderGroup: payload.orderGroup || null,
          itemCount: Array.isArray(payload.items) ? payload.items.length : 0,
        });

        return payload;
      }

      throw lastError || new Error(`VTEX order fetch failed for ${orderId}`);
    },
  };
}

module.exports = { createVtexClient };
