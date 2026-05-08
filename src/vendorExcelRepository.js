const XLSX = require("xlsx");
const logger = require("./logger");

function normalizeBusinessType(raw) {
  const value = String(raw || "").trim().toLowerCase();
  if (value.includes("propriet")) return "proprietorship";
  if (value.includes("partner")) return "partnership";
  if (value.includes("private")) return "private_limited";
  if (value.includes("public")) return "public_limited";
  return "proprietorship";
}

function loadVendorsByReferenceId(filePath) {
  try {
    const wb = XLSX.readFile(filePath);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
    const map = new Map();

    for (const row of rows) {
      const referenceId = String(row.reference_id || "").trim();
      if (!referenceId) {
        continue;
      }
      map.set(referenceId, {
        email: String(row.email || "").trim(),
        phone: Number(row.phone || 0),
        legalBusinessName: String(row.legal_business_name || "").trim(),
        businessType: normalizeBusinessType(row.business_type),
        referenceId,
        linkedAccountAlias: `acc_${referenceId.toLowerCase().replace(/[^a-z0-9]/g, "")}`,
        sellerSharePercent: Number(row.seller_share_percent || 0),
        sellerGstPercent: Number(row.seller_gst_percent || 0),
        marketplaceGstPercent: Number(row.marketplace_gst_percent || 0),
        bankAccountName: String(row.bank_account_name || row.account_holder_name || "").trim(),
        bankAccountNumber: String(row.bank_account_number || row.account_number || "").trim(),
        bankIfsc: String(row.bank_ifsc || row.ifsc || "").trim().toUpperCase(),
        bankName: String(row.bank_name || "").trim(),
        bankBranch: String(row.bank_branch || "").trim(),
        profile: {
          category: "ecommerce",
          subcategory: "marketplace",
          business_model: String(row.profile || "").trim(),
          legal_info: {
            pan: String(row["legal_info/PAN"] || "").trim(),
            gst: String(row.GSTIN || "").trim(),
          },
        },
      });
    }

    logger.info("Loaded vendor rows from Excel", { filePath, count: map.size });
    return map;
  } catch (error) {
    logger.warn("Failed to read vendor Excel file", { filePath, message: error.message });
    return new Map();
  }
}

module.exports = { loadVendorsByReferenceId };
