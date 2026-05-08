async function ensureLinkedAccount(razorpay, vendor) {
  if (vendor.accountId) {
    const existing = await razorpay.fetchLinkedAccount(vendor.accountId);
    return existing.id;
  }

  const referenceId = vendor.linkedAccountAlias || vendor.referenceId || `acc_${sanitizeSellerId(vendor.vtexSellerId || vendor.vendorId || "seller")}`;

  const payload = {
    email: vendor.email,
    phone: vendor.phone,
    legal_business_name: vendor.legalBusinessName,
    business_type: vendor.businessType,
    reference_id: referenceId,
    profile: vendor.profile,
  };

  if (vendor.bankAccountNumber && vendor.bankIfsc) {
    payload.bank_account = {
      name: vendor.bankAccountName || vendor.legalBusinessName,
      account_number: String(vendor.bankAccountNumber),
      ifsc: String(vendor.bankIfsc).toUpperCase(),
    };
  }

  const account = await razorpay.createLinkedAccount(payload);

  return account.id;
}

function sanitizeSellerId(sellerId) {
  return String(sellerId).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 30) || "seller";
}

function buildAutoVendorFromSellerId(sellerId) {
  const sanitized = sanitizeSellerId(sellerId);
  const alias = `acc_${sanitized}`;
  const phoneSeed = String(
    Array.from(sanitized).reduce((acc, ch) => acc + ch.charCodeAt(0), 0)
  ).slice(0, 8);

  return {
    vendorId: `vendor_${sanitized}`,
    vtexSellerId: String(sellerId),
    linkedAccountAlias: alias,
    accountId: "",
    email: `${sanitized}@coffeesooq.local`,
    phone: Number(`91${phoneSeed.padStart(8, "0")}`),
    legalBusinessName: `Seller ${sanitized}`,
    businessType: "proprietorship",
    referenceId: alias,
    bankAccountName: `Seller ${sanitized}`,
    bankAccountNumber: "",
    bankIfsc: "",
    bankName: "",
    bankBranch: "",
    profile: {
      category: "ecommerce",
      subcategory: "marketplace",
      addresses: {
        registered: {
          street1: "NA",
          street2: "NA",
          city: "NA",
          state: "NA",
          postal_code: "560001",
          country: "IN",
        },
      },
    },
  };
}

module.exports = { ensureLinkedAccount, buildAutoVendorFromSellerId };
