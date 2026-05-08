const logger = require("./logger");

function trimTrailingSlash(url) {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

function createVtexMasterdataClient(config) {
  if (!config.enabled) {
    return {
      enabled: false,
      async ensureSchema() {
        return false;
      },
      async upsertSellerKyc() {
        throw new Error("VTEX masterdata client is disabled");
      },
      async listSellerKyc() {
        return [];
      },
      async getSellerKycBySellerId() {
        return null;
      },
      async saveSellerLinkedAccount() {
        throw new Error("VTEX masterdata client is disabled");
      },
    };
  }

  if (!config.baseUrl || !config.appKey || !config.appToken || !config.masterDataEntity) {
    throw new Error("VTEX masterdata client requires baseUrl, appKey, appToken and masterDataEntity");
  }

  const baseUrl = trimTrailingSlash(config.baseUrl);
  const account = (() => {
    try {
      return new URL(baseUrl).hostname.split(".")[0] || "";
    } catch {
      return "";
    }
  })();
  const entity = config.masterDataEntity;
  const sellerFieldCandidates = Array.from(
    new Set([config.masterDataSellerIdField, "sellerId", "sellerid", "seller_id", "idSeller"].filter(Boolean))
  );
  const canonicalSellerField = config.masterDataSellerIdField || "sellerId";
  const schemaName = `${entity}_seller_schema`;
  const schemaQuery = `_schema=${encodeURIComponent(schemaName)}`;
  const baseHeaders = {
    "X-VTEX-API-AppKey": config.appKey,
    "X-VTEX-API-AppToken": config.appToken,
    Accept: "application/json",
    "Content-Type": "application/json",
  };

  function withAccountParam(rawUrl) {
    if (!account) {
      return rawUrl;
    }
    try {
      const url = new URL(rawUrl);
      if (!url.searchParams.get("an")) {
        url.searchParams.set("an", account);
      }
      return url.toString();
    } catch {
      return rawUrl;
    }
  }

  return {
    enabled: true,
    async ensureSchema() {
      const schemaUrl = `${baseUrl}/api/dataentities/${entity}/schemas/${schemaName}`;
      const schemaPayload = {
        name: schemaName,
        properties: {
          [canonicalSellerField]: { type: "string", title: "Seller ID" },
          email: { type: "string", title: "Email" },
          phone: { type: "string", title: "Phone" },
          legalBusinessName: { type: "string", title: "Legal Business Name" },
          businessType: { type: "string", title: "Business Type" },
          referenceId: { type: "string", title: "Reference ID" },
          linkedAccountAlias: { type: "string", title: "Linked Account Alias" },
          razorpayLinkedAccountId: { type: "string", title: "Razorpay Linked Account ID" },
          sellerSharePercent: { type: "number", title: "Seller Share Percent" },
          sellerGstPercent: { type: "number", title: "Seller GST Percent" },
          marketplaceGstPercent: { type: "number", title: "Marketplace GST Percent" },
          profile: { type: "object", title: "Profile" },
          bankAccountName: { type: "string", title: "Bank Account Holder Name" },
          bankAccountNumber: { type: "string", title: "Bank Account Number" },
          bankIfsc: { type: "string", title: "Bank IFSC" },
          bankName: { type: "string", title: "Bank Name" },
          bankBranch: { type: "string", title: "Bank Branch" },
          submittedAt: { type: "string", title: "Submitted At" },
          linkedAccountUpdatedAt: { type: "string", title: "Linked Account Updated At" },
        },
        required: [canonicalSellerField, "email", "phone", "legalBusinessName", "businessType", "referenceId"],
      };

      logger.info("VTEX MasterData ensure schema request", { entity, schemaName, canonicalSellerField });
      const response = await fetch(schemaUrl, {
        method: "PUT",
        headers: baseHeaders,
        body: JSON.stringify(schemaPayload),
      });

      if (response.status === 304) {
        logger.info("VTEX MasterData schema already up-to-date", { entity, schemaName });
        return true;
      }

      if (!response.ok) {
        const body = await response.text();
        logger.warn("VTEX MasterData ensure schema failed", {
          entity,
          schemaName,
          status: response.status,
          body,
        });
        return false;
      }

      logger.info("VTEX MasterData schema ensured", { entity, schemaName });
      return true;
    },
    async findSellerDoc({ sellerId, email }) {
      const fields =
        "_id,sellerId,email,phone,legalBusinessName,businessType,referenceId,linkedAccountAlias,razorpayLinkedAccountId,sellerSharePercent,sellerGstPercent,marketplaceGstPercent,profile,bankAccountName,bankAccountNumber,bankIfsc,bankName,bankBranch";

      const queries = [];
      const normalizedSeller = String(sellerId || "").trim();
      const normalizedEmail = String(email || "").trim();

      if (normalizedSeller) {
        for (const sellerField of sellerFieldCandidates) {
          queries.push({
            label: `seller:${sellerField}`,
            where: `${sellerField}=${normalizedSeller}`,
          });
        }
      }
      if (normalizedEmail) {
        queries.push({
          label: "email",
          where: `email=${normalizedEmail}`,
        });
      }

      for (const query of queries) {
        const url = `${baseUrl}/api/dataentities/${entity}/search?${schemaQuery}&_fields=${encodeURIComponent(
          fields
        )}&_where=${encodeURIComponent(query.where)}&_size=1`;
        logger.info("VTEX MasterData find seller request", {
          entity,
          query: query.label,
        });
        const response = await fetch(url, {
          method: "GET",
          headers: baseHeaders,
        });

        if (!response.ok) {
          const body = await response.text();
          const bodyLower = body.toLowerCase();
          // Match coffeesouq-main behavior: schema-field errors are non-fatal lookups.
          if (response.status === 400 && bodyLower.includes("not found in schema")) {
            logger.warn("VTEX MasterData lookup skipped due to schema field mismatch", {
              entity,
              query: query.label,
              body,
            });
            continue;
          }
          logger.warn("VTEX MasterData lookup failed", {
            entity,
            query: query.label,
            status: response.status,
            body,
          });
          continue;
        }

        const data = await response.json();
        if (Array.isArray(data) && data.length > 0) {
          return data[0];
        }
      }

      return null;
    },
    async upsertSellerKyc(doc) {
      const payload = {
        [canonicalSellerField]: String(doc.sellerId || "").trim(),
        email: String(doc.email || "").trim(),
        phone: Number(doc.phone),
        legalBusinessName: String(doc.legalBusinessName || "").trim(),
        businessType: String(doc.businessType || "").trim(),
        referenceId: String(doc.referenceId || "").trim(),
        linkedAccountAlias: String(doc.linkedAccountAlias || "").trim(),
        razorpayLinkedAccountId: String(doc.razorpayLinkedAccountId || "").trim(),
        sellerSharePercent: Number(doc.sellerSharePercent),
        sellerGstPercent: Number(doc.sellerGstPercent),
        marketplaceGstPercent: Number(doc.marketplaceGstPercent),
        profile: doc.profile || {},
        bankAccountName: String(doc.bankAccountName || "").trim(),
        bankAccountNumber: String(doc.bankAccountNumber || "").trim(),
        bankIfsc: String(doc.bankIfsc || "").trim().toUpperCase(),
        bankName: String(doc.bankName || "").trim(),
        bankBranch: String(doc.bankBranch || "").trim(),
        submittedAt: new Date().toISOString(),
      };

      const existing = await this.findSellerDoc({
        sellerId: payload[canonicalSellerField],
        email: payload.email,
      }).catch((error) => {
        logger.warn("VTEX MasterData lookup before upsert failed; proceeding with create", {
          entity,
          message: error.message,
        });
        return null;
      });

      const method = existing?._id ? "PATCH" : "POST";
      const url = existing?._id
        ? `${baseUrl}/api/dataentities/${entity}/documents/${existing._id}?${schemaQuery}`
        : `${baseUrl}/api/dataentities/${entity}/documents?${schemaQuery}`;

      logger.info("VTEX MasterData upsert request", {
        entity,
        sellerId: payload[canonicalSellerField],
        canonicalSellerField,
        mode: method === "PATCH" ? "update" : "create",
      });
      let response = await fetch(url, {
        method,
        headers: baseHeaders,
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const body = await response.text();
        const bodyLower = body.toLowerCase();
        const shouldRetryWithoutSchema =
          response.status === 400 &&
          (bodyLower.includes("data entity not found") || bodyLower.includes("schema"));

        if (shouldRetryWithoutSchema) {
          const fallbackUrl = existing?._id
            ? `${baseUrl}/api/dataentities/${entity}/documents/${existing._id}`
            : `${baseUrl}/api/dataentities/${entity}/documents`;
          logger.warn("Retrying VTEX MasterData upsert without _schema", {
            entity,
            sellerId: payload[canonicalSellerField],
            mode: method === "PATCH" ? "update" : "create",
          });
          response = await fetch(fallbackUrl, {
            method,
            headers: baseHeaders,
            body: JSON.stringify(payload),
          });
          if (response.ok) {
            const raw = await response.text();
            const data = raw ? JSON.parse(raw) : {};
            logger.info("VTEX MasterData upsert response", {
              entity,
              sellerId: payload[canonicalSellerField],
              id: data.Id || data.id || null,
              fallbackNoSchema: true,
            });
            return data;
          }
        }

        const shouldRetryWithAccountParam =
          response.status === 400 && bodyLower.includes("data entity not found");
        if (shouldRetryWithAccountParam) {
          const accountUrl = withAccountParam(
            existing?._id
              ? `${baseUrl}/api/dataentities/${entity}/documents/${existing._id}`
              : `${baseUrl}/api/dataentities/${entity}/documents`
          );
          logger.warn("Retrying VTEX MasterData upsert with account parameter", {
            entity,
            sellerId: payload[canonicalSellerField],
            account,
          });
          response = await fetch(accountUrl, {
            method,
            headers: baseHeaders,
            body: JSON.stringify(payload),
          });
          if (response.ok) {
            const raw = await response.text();
            const data = raw ? JSON.parse(raw) : {};
            logger.info("VTEX MasterData upsert response", {
              entity,
              sellerId: payload[canonicalSellerField],
              id: data.Id || data.id || null,
              fallbackAccountParam: true,
            });
            return data;
          }
        }

        const fallbackBody = await response.text();
        logger.error("VTEX MasterData upsert error", {
          entity,
          sellerId: payload[canonicalSellerField],
          status: response.status,
          body: fallbackBody || body,
        });
        throw new Error(`VTEX MasterData upsert failed with status ${response.status}`);
      }

      const raw = await response.text();
      const data = raw ? JSON.parse(raw) : {};
      logger.info("VTEX MasterData upsert response", {
        entity,
        sellerId: payload[canonicalSellerField],
        id: data.Id || data.id || null,
      });
      return data;
    },

    async getSellerKycBySellerId(sellerId) {
      const seller = String(sellerId || "").trim();
      if (!seller) {
        return null;
      }
      const fields =
        "_id,sellerId,email,phone,legalBusinessName,businessType,referenceId,linkedAccountAlias,razorpayLinkedAccountId,sellerSharePercent,sellerGstPercent,marketplaceGstPercent,profile,bankAccountName,bankAccountNumber,bankIfsc,bankName,bankBranch";
      for (const sellerField of sellerFieldCandidates) {
        const where = `${sellerField}=${seller}`;
        const url = `${baseUrl}/api/dataentities/${entity}/search?${schemaQuery}&_fields=${encodeURIComponent(
          fields
        )}&_where=${encodeURIComponent(where)}&_size=1`;
        logger.info("VTEX MasterData seller fetch request", { entity, sellerId: seller, sellerField });
        const response = await fetch(url, {
          method: "GET",
          headers: baseHeaders,
        });

        if (!response.ok) {
          const body = await response.text();
          logger.warn("VTEX MasterData seller fetch attempt failed", {
            entity,
            sellerId: seller,
            sellerField,
            status: response.status,
            body,
          });
          continue;
        }

        const data = await response.json();
        if (Array.isArray(data) && data.length > 0) {
          return data[0];
        }
      }
      return null;
    },

    async saveSellerLinkedAccount(sellerDoc, linkedAccountId) {
      const docId = sellerDoc?._id;
      if (!docId) {
        throw new Error("MasterData document id is required to save linked account");
      }
      const url = `${baseUrl}/api/dataentities/${entity}/documents/${docId}?${schemaQuery}`;
      const payload = {
        razorpayLinkedAccountId: linkedAccountId,
        linkedAccountUpdatedAt: new Date().toISOString(),
      };
      logger.info("VTEX MasterData linked account update request", {
        entity,
        sellerId: sellerDoc.sellerId,
        linkedAccountId,
      });
      const response = await fetch(url, {
        method: "PATCH",
        headers: baseHeaders,
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const body = await response.text();
        logger.error("VTEX MasterData linked account update error", {
          entity,
          sellerId: sellerDoc.sellerId,
          status: response.status,
          body,
        });
        throw new Error(`VTEX MasterData linked account update failed with status ${response.status}`);
      }
      return true;
    },

    async listSellerKyc() {
      const fields =
        "_id,sellerId,email,phone,legalBusinessName,businessType,referenceId,linkedAccountAlias,razorpayLinkedAccountId,sellerSharePercent,sellerGstPercent,marketplaceGstPercent,profile,bankAccountName,bankAccountNumber,bankIfsc,bankName,bankBranch";
      for (const sellerField of sellerFieldCandidates) {
        const url = `${baseUrl}/api/dataentities/${entity}/search?${schemaQuery}&_fields=${encodeURIComponent(
          fields
        )}&_where=${encodeURIComponent(`${sellerField} is not null`)}&_size=1000`;
        logger.info("VTEX MasterData search request", { entity, sellerField });
        const response = await fetch(url, {
          method: "GET",
          headers: baseHeaders,
        });

        if (!response.ok) {
          const body = await response.text();
          logger.warn("VTEX MasterData search attempt failed", {
            entity,
            sellerField,
            status: response.status,
            body,
          });
          continue;
        }

        const data = await response.json();
        logger.info("VTEX MasterData search response", {
          entity,
          sellerField,
          count: Array.isArray(data) ? data.length : 0,
        });
        return Array.isArray(data) ? data : [];
      }
      return [];
    },
  };
}

module.exports = { createVtexMasterdataClient };
