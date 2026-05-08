const logger = require("./logger");
const fs = require("fs/promises");
const { buildAutoVendorFromSellerId, ensureLinkedAccount } = require("./linkedAccountService");
const { loadVendorsByReferenceId } = require("./vendorExcelRepository");

function nowUnix() {
  return Math.floor(Date.now() / 1000);
}

function isCapturedPayment(payment) {
  // Razorpay marks captured payments using status and captured flag.
  return payment.status === "captured" && payment.captured === true;
}

function isMature(paymentCreatedAt, holdDays) {
  const holdSeconds = holdDays * 24 * 60 * 60;
  return paymentCreatedAt + holdSeconds <= nowUnix();
}

function calculateAmountFromPercent(totalAmount, sharePercent) {
  return Math.floor((totalAmount * sharePercent) / 100);
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function buildVendorMap(vendors) {
  return new Map(vendors.map((vendor) => [vendor.vendorId, vendor]));
}

function buildSellerVendorMap(vendors) {
  const pairs = vendors
    .filter((vendor) => Boolean(vendor.vtexSellerId))
    .map((vendor) => [vendor.vtexSellerId, vendor.vendorId]);
  return new Map(pairs);
}

function buildOrderSplitMap(orderSplits) {
  return new Map(orderSplits.map((entry) => [entry.orderId, entry.splits || []]));
}

function normalizeSplitAmounts(paymentAmount, splits, minimumTransferAmount) {
  const amounts = [];
  let runningTotal = 0;

  for (let index = 0; index < splits.length; index += 1) {
    const split = splits[index];
    let amount = 0;

    if (Number.isFinite(split.amount)) {
      amount = Math.floor(split.amount);
    } else if (Number.isFinite(split.sharePercent)) {
      amount = calculateAmountFromPercent(paymentAmount, split.sharePercent);
    }

    if (amount < minimumTransferAmount) {
      return { ok: false, reason: "SPLIT_BELOW_MINIMUM", split, amount };
    }

    amounts.push({ vendorId: split.vendorId, amount });
    runningTotal += amount;
  }

  if (runningTotal > paymentAmount) {
    return { ok: false, reason: "SPLIT_EXCEEDS_PAYMENT", runningTotal, paymentAmount };
  }

  return { ok: true, amounts, runningTotal };
}

function extractVtexOrderId(payment) {
  return payment.notes?.vtexOrderId || payment.notes?.vtex_order_id || null;
}

function getItemTotal(item) {
  if (item?.priceDefinition && Number.isFinite(item.priceDefinition.total)) {
    return Math.floor(item.priceDefinition.total);
  }

  const sellingPrice = Number.isFinite(item?.sellingPrice) ? item.sellingPrice : item?.price;
  const quantity = Number.isFinite(item?.quantity) ? item.quantity : 1;
  if (Number.isFinite(sellingPrice)) {
    return Math.floor(sellingPrice * quantity);
  }

  return 0;
}

function buildSplitsFromVtexOrder(vtexOrder, sellerVendorMap) {
  const items = Array.isArray(vtexOrder.items) ? vtexOrder.items : [];
  const sellerAmounts = new Map();

  for (const item of items) {
    const sellerId = item?.seller;
    if (!sellerId) {
      continue;
    }

    const vendorId = sellerVendorMap.get(String(sellerId));
    if (!vendorId) {
      continue;
    }

    const total = getItemTotal(item);
    if (total <= 0) {
      continue;
    }

    const current = sellerAmounts.get(vendorId) || 0;
    sellerAmounts.set(vendorId, current + total);
  }

  return Array.from(sellerAmounts.entries()).map(([vendorId, amount]) => ({
    vendorId,
    amount,
  }));
}

function summarizeVtexSellers(vtexOrder) {
  const items = Array.isArray(vtexOrder.items) ? vtexOrder.items : [];
  const sellerAmounts = new Map();

  for (const item of items) {
    const sellerId = item?.seller;
    if (!sellerId) {
      continue;
    }
    const total = getItemTotal(item);
    if (total <= 0) {
      continue;
    }
    const current = sellerAmounts.get(String(sellerId)) || 0;
    sellerAmounts.set(String(sellerId), current + total);
  }

  return Array.from(sellerAmounts.entries()).map(([sellerId, amount]) => ({
    sellerId,
    amount,
  }));
}

function calculateSellerSettlement({
  sellerOrderAmount,
  sellerSharePercent,
  sellerGstPercent,
  marketplaceGstPercent,
}) {
  const sellerGross = calculateAmountFromPercent(sellerOrderAmount, sellerSharePercent);
  const sellerGst = calculateAmountFromPercent(sellerGross, sellerGstPercent);
  const sellerNet = Math.max(0, sellerGross - sellerGst);

  const marketplaceGross = Math.max(0, sellerOrderAmount - sellerGross);
  const marketplaceGst = calculateAmountFromPercent(marketplaceGross, marketplaceGstPercent);
  const marketplaceNet = Math.max(0, marketplaceGross - marketplaceGst);

  return {
    sellerSharePercent,
    sellerGstPercent,
    marketplaceGstPercent,
    sellerGross,
    sellerGst,
    sellerNet,
    marketplaceGross,
    marketplaceGst,
    marketplaceNet,
  };
}

async function persistVendorPayload(filePath, payload) {
  await fs.mkdir(require("path").dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2));
}

async function syncVtexSellersToVendors({
  sellerSummary,
  vendorPayload,
  sellerVendorMap,
  vendorMap,
  razorpay,
}) {
  let changed = false;

  for (const seller of sellerSummary) {
    const sellerId = String(seller.sellerId);
    let vendorId = sellerVendorMap.get(sellerId);
    let vendor = vendorId ? vendorMap.get(vendorId) : null;

    if (!vendor) {
      vendor = buildAutoVendorFromSellerId(sellerId);
      vendorPayload.vendors.push(vendor);
      vendorId = vendor.vendorId;
      sellerVendorMap.set(sellerId, vendorId);
      vendorMap.set(vendorId, vendor);
      changed = true;
      logger.info("Created local vendor mapping from VTEX seller", {
        sellerId,
        vendorId,
        linkedAccountAlias: vendor.linkedAccountAlias,
      });
    }

    if (!vendor.accountId) {
      try {
        const accountId = await ensureLinkedAccount(razorpay, vendor);
        vendor.accountId = accountId;
        changed = true;
        logger.info("Linked account ensured for VTEX seller", {
          sellerId,
          vendorId,
          linkedAccountAlias: vendor.linkedAccountAlias || null,
          accountId,
        });
      } catch (error) {
        logger.error("Linked account creation failed for VTEX seller", {
          sellerId,
          vendorId,
          message: error.message,
        });
      }
    }
  }

  return changed;
}

async function fetchAllPaymentsInWindow({ razorpay, from, to, maxPaymentsPerPage, maxPagesPerRun }) {
  const allPayments = [];

  for (let page = 0; page < maxPagesPerRun; page += 1) {
    const skip = page * maxPaymentsPerPage;
    const result = await razorpay.fetchPayments({
      from,
      to,
      count: maxPaymentsPerPage,
      skip,
    });

    const items = Array.isArray(result.items) ? result.items : [];
    allPayments.push(...items);

    logger.info("Fetched payment page", {
      page: page + 1,
      skip,
      count: items.length,
      maxPaymentsPerPage,
    });

    if (items.length < maxPaymentsPerPage) {
      break;
    }
  }

  return allPayments;
}

async function processPayments({
  config,
  razorpay,
  vtex,
  masterData,
  state,
  vendorPayload,
}) {
  const now = nowUnix();
  const fromDaysAgo = Math.max(config.scheduler.windowFromDaysAgo, config.scheduler.windowToDaysAgo);
  const toDaysAgo = Math.min(config.scheduler.windowFromDaysAgo, config.scheduler.windowToDaysAgo);
  const from = now - fromDaysAgo * 24 * 60 * 60;
  const to = now - toDaysAgo * 24 * 60 * 60;
  const payments = await fetchAllPaymentsInWindow({
    razorpay,
    from,
    to,
    maxPaymentsPerPage: config.scheduler.maxPaymentsPerPage,
    maxPagesPerRun: config.scheduler.maxPagesPerRun,
  });
  const vendors = Array.isArray(vendorPayload.vendors) ? vendorPayload.vendors : [];
  const vendorMap = buildVendorMap(vendors);
  const vendorExcelMap = loadVendorsByReferenceId(config.paths.vendorXlsxFile);

  logger.info("Fetched payments", { count: payments.length, from, to });
  logger.info("Using payment day-range window", {
    windowFromDaysAgo: fromDaysAgo,
    windowToDaysAgo: toDaysAgo,
    holdDays: config.settlement.holdDays,
    maxPaymentsPerPage: config.scheduler.maxPaymentsPerPage,
    maxPagesPerRun: config.scheduler.maxPagesPerRun,
  });

  let vendorPayloadChanged = false;
  for (const payment of payments) {
    if (!config.flow.vtexSellerFetchOnly) {
      if (!isCapturedPayment(payment)) {
        continue;
      }

      if (!payment.order_id) {
        logger.warn("Skipping payment with no order_id", { paymentId: payment.id });
        continue;
      }

      if (!isMature(payment.created_at, config.settlement.holdDays)) {
        continue;
      }

      if (state.transferredPayments[payment.id]) {
        continue;
      }
    }

    const vtexOrderId = extractVtexOrderId(payment);
    if (vtex.enabled && vtexOrderId) {
      try {
        const vtexOrder = await vtex.fetchOrder(vtexOrderId);
        logger.info("Fetched VTEX order full payload", {
          paymentId: payment.id,
          vtexOrderId,
          order: vtexOrder,
        });
        const sellerSummary = summarizeVtexSellers(vtexOrder);
        logger.info("Fetched VTEX seller details", {
          paymentId: payment.id,
          vtexOrderId,
          sellerSummary,
        });
        const transfers = [];
        let totalSellerTransferAmount = 0;

        for (const seller of sellerSummary) {
          const sellerId = String(seller.sellerId);
          const sellerOrderAmount = toNumber(seller.amount, 0);
          if (sellerOrderAmount <= 0) {
            continue;
          }

          let sellerDetails = null;
          try {
            sellerDetails = await masterData.getSellerKycBySellerId(sellerId);
          } catch (error) {
            logger.warn("MasterData fetch failed for seller, falling back to file data", {
              sellerId,
              message: error.message,
            });
          }
          if (!sellerDetails) {
            logger.warn("Seller details not found in VTEX MasterData, creating placeholder", {
              sellerId,
              paymentId: payment.id,
            });
            const autoVendor = buildAutoVendorFromSellerId(sellerId);
            try {
              await masterData.upsertSellerKyc({
                sellerId,
                email: autoVendor.email,
                phone: autoVendor.phone,
                legalBusinessName: autoVendor.legalBusinessName,
                businessType: autoVendor.businessType,
                referenceId: autoVendor.referenceId,
                linkedAccountAlias: autoVendor.linkedAccountAlias,
                bankAccountName: autoVendor.bankAccountName,
                bankAccountNumber: autoVendor.bankAccountNumber,
                bankIfsc: autoVendor.bankIfsc,
                bankName: autoVendor.bankName,
                bankBranch: autoVendor.bankBranch,
                profile: autoVendor.profile,
                sellerSharePercent: 100,
                sellerGstPercent: config.settlement.gstPercent,
                marketplaceGstPercent: config.settlement.gstPercent,
              });
              sellerDetails = await masterData.getSellerKycBySellerId(sellerId);
            } catch (error) {
              logger.warn("MasterData upsert unavailable, proceeding with file-only data", {
                sellerId,
                message: error.message,
              });
            }
          }

          const fileVendor = vendorExcelMap.get(sellerId);
          if (!sellerDetails && !fileVendor) {
            logger.warn("Skipping seller due to missing VTEX MasterData and Excel record", { sellerId });
            continue;
          }

          const vendor = {
            vendorId: `vendor_${sellerId}`,
            vtexSellerId: sellerId,
            linkedAccountAlias:
              (sellerDetails && sellerDetails.linkedAccountAlias) ||
              `acc_${String(sellerId).toLowerCase().replace(/[^a-z0-9]/g, "")}`,
            accountId: (sellerDetails && sellerDetails.razorpayLinkedAccountId) || "",
            email: sellerDetails ? sellerDetails.email : "",
            phone: sellerDetails ? Number(sellerDetails.phone) : 0,
            legalBusinessName: sellerDetails ? sellerDetails.legalBusinessName : "",
            businessType: sellerDetails ? sellerDetails.businessType : "",
            referenceId: sellerDetails ? sellerDetails.referenceId : "",
            bankAccountName: sellerDetails ? sellerDetails.bankAccountName : "",
            bankAccountNumber: sellerDetails ? sellerDetails.bankAccountNumber : "",
            bankIfsc: sellerDetails ? sellerDetails.bankIfsc : "",
            bankName: sellerDetails ? sellerDetails.bankName : "",
            bankBranch: sellerDetails ? sellerDetails.bankBranch : "",
            profile: (sellerDetails && sellerDetails.profile) || {},
          };

          if (fileVendor) {
            vendor.email = fileVendor.email || vendor.email;
            vendor.phone = fileVendor.phone || vendor.phone;
            vendor.legalBusinessName = fileVendor.legalBusinessName || vendor.legalBusinessName;
            vendor.businessType = fileVendor.businessType || vendor.businessType;
            vendor.referenceId = fileVendor.referenceId || vendor.referenceId;
            vendor.linkedAccountAlias = fileVendor.linkedAccountAlias || vendor.linkedAccountAlias;
            vendor.bankAccountName = fileVendor.bankAccountName || vendor.bankAccountName;
            vendor.bankAccountNumber = fileVendor.bankAccountNumber || vendor.bankAccountNumber;
            vendor.bankIfsc = fileVendor.bankIfsc || vendor.bankIfsc;
            vendor.bankName = fileVendor.bankName || vendor.bankName;
            vendor.bankBranch = fileVendor.bankBranch || vendor.bankBranch;
            vendor.profile = fileVendor.profile || vendor.profile;
            logger.info("Using Excel vendor KYC for linked account create", {
              sellerId,
              referenceId: vendor.referenceId,
            });
          }

          let accountId = vendor.accountId;
          if (accountId) {
            try {
              const linked = await razorpay.fetchLinkedAccount(accountId);
              accountId = linked.id;
            } catch {
              accountId = "";
            }
          }

          if (!accountId) {
            const createdAccountId = await ensureLinkedAccount(razorpay, vendor);
            if (sellerDetails) {
              try {
                await masterData.saveSellerLinkedAccount(sellerDetails, createdAccountId);
              } catch (error) {
                logger.warn("Failed to save linked account back to MasterData", {
                  sellerId,
                  message: error.message,
                });
              }
            }
            accountId = createdAccountId;
          }

          const sellerSharePercent = Math.min(
            100,
            Math.max(
              0,
              toNumber(
                (sellerDetails && sellerDetails.sellerSharePercent) || (fileVendor && fileVendor.sellerSharePercent),
                100
              )
            )
          );
          const sellerGstPercent = toNumber(
            (sellerDetails && sellerDetails.sellerGstPercent) || (fileVendor && fileVendor.sellerGstPercent),
            config.settlement.gstPercent
          );
          const marketplaceGstPercent = toNumber(
            (sellerDetails && sellerDetails.marketplaceGstPercent) || (fileVendor && fileVendor.marketplaceGstPercent),
            config.settlement.gstPercent
          );

          const linkedAccount = await razorpay.fetchLinkedAccount(accountId);
          const breakdown = calculateSellerSettlement({
            sellerOrderAmount,
            sellerSharePercent,
            sellerGstPercent,
            marketplaceGstPercent,
          });

          if (breakdown.sellerNet < config.settlement.minimumTransferAmount) {
            logger.warn("Seller transfer amount below minimum after GST deduction", {
              sellerId,
              sellerNet: breakdown.sellerNet,
            });
            continue;
          }

          totalSellerTransferAmount += breakdown.sellerNet;
          transfers.push({
            account: linkedAccount.id,
            amount: breakdown.sellerNet,
            currency: config.settlement.currency,
            notes: {
              payment_id: payment.id,
              order_id: payment.order_id,
              seller_id: sellerId,
              seller_share_percent: String(breakdown.sellerSharePercent),
              seller_gst_percent: String(breakdown.sellerGstPercent),
              seller_gst_amount: String(breakdown.sellerGst),
              marketplace_commission_amount: String(breakdown.marketplaceGross),
              marketplace_gst_percent: String(breakdown.marketplaceGstPercent),
              marketplace_gst_amount: String(breakdown.marketplaceGst),
            },
            linked_account_notes: [
              "payment_id",
              "order_id",
              "seller_id",
              "seller_share_percent",
              "seller_gst_amount",
            ],
            on_hold: false,
          });
        }

        if (transfers.length === 0) {
          logger.warn("No valid seller transfers prepared for payment", { paymentId: payment.id, vtexOrderId });
          continue;
        }

        if (totalSellerTransferAmount > payment.amount) {
          logger.error("Total seller transfer exceeds payment amount", {
            paymentId: payment.id,
            paymentAmount: payment.amount,
            totalSellerTransferAmount,
          });
          continue;
        }

        const commission = payment.amount - totalSellerTransferAmount;
        logger.info("Creating seller transfers from payment", {
          paymentId: payment.id,
          sellerCount: transfers.length,
          totalSellerTransferAmount,
          marketplaceCommissionAfterGST: commission,
        });
        const transferRes = await razorpay.createTransferFromPayment(payment.id, transfers);
        state.transferredPayments[payment.id] = {
          transferredAt: new Date().toISOString(),
          orderId: payment.order_id,
          sellerCount: transfers.length,
          commission,
          transferResponse: transferRes,
        };

        if (config.flow.vtexSellerFetchOnly) {
          continue;
        }
      } catch (error) {
        logger.error("Failed to derive splits from VTEX order", {
          paymentId: payment.id,
          vtexOrderId,
          message: error.message,
        });
        if (config.flow.vtexSellerFetchOnly) {
          continue;
        }
      }
    }

    logger.warn("Skipping payment due to missing vtexOrderId or VTEX disabled", {
      paymentId: payment.id,
    });
  }

  if (vendorPayloadChanged) {
    await persistVendorPayload(config.paths.vendorFile, vendorPayload);
    logger.info("Persisted vendor mappings and linked account ids from VTEX sellers");
  }

  return state;
}

module.exports = { processPayments };
