/**
 * Quick VTEX order fetch test. Usage:
 *   ORDER_ID=1619500500632 npm run test:vtex-order
 */
require("dotenv").config();
const config = require("./config");
const { createVtexClient } = require("./vtexClient");
const logger = require("./logger");

const orderId = process.env.ORDER_ID || "1619500500632";

async function main() {
  const vtex = createVtexClient({ ...config.vtex, enabled: true });
  const order = await vtex.fetchOrder(orderId);
  const sellers = {};
  for (const item of order.items || []) {
    const s = String(item.seller ?? "unknown");
    sellers[s] = (sellers[s] || 0) + 1;
  }
  logger.info("VTEX order fetch test OK", {
    requested: orderId,
    resolvedOrderId: order.orderId,
    orderGroup: order.orderGroup,
    status: order.status,
    itemCount: (order.items || []).length,
    sellers,
  });
}

main().catch((e) => {
  logger.error("VTEX order fetch test failed", { message: e.message });
  process.exit(1);
});
