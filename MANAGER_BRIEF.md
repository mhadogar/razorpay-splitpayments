# CoffeeSooq Split Payments — Executive Brief for Management

**Purpose:** This document summarizes the Razorpay split-payments solution for **decision-makers and managers**. It focuses on business outcomes, scope, risks, and what the organization must own—not implementation detail.

**Related:** Technical and operational depth → [DOCUMENTATION.md](./DOCUMENTATION.md)

---

## 1. Executive summary

CoffeeSooq receives customer payments through Razorpay for marketplace orders that may include **multiple sellers** in a single payment. This application **automates** how long funds are held for refunds, how each seller’s share is calculated (using VTEX order data where configured), and how money is **routed** to sellers’ **Razorpay linked accounts** while the **marketplace retains commission** according to configured rules. An **admin portal** allows authorized staff to register sellers, manage configuration, upload fallback data, and trigger or schedule the background job.

---

## 2. Business problem addressed

| Challenge | How this system helps |
|-----------|------------------------|
| Manual or ad-hoc splitting across sellers | Uses order and seller data to prepare **per-seller** Route transfers where configured. |
| Refund exposure | Enforces a **minimum hold period** (aligned with policy, e.g. 15 days) before processing payouts. |
| Seller onboarding | Central **registration** path into VTEX Master Data, including bank details for linked accounts. |
| Operational control | **Scheduled** runs plus **on-demand** execution; configuration without developer involvement for many day-to-day changes. |

---

## 3. Scope — what the system does

- Pulls eligible **captured** payments from Razorpay within a defined **time window**.
- Applies a **hold** (days after payment) before treating a payment as ready for settlement logic.
- When VTEX is enabled: uses the **VTEX order** linked from the payment to determine **per-seller amounts from product subtotals only**; **shipping** attributed to each seller is **deducted** from their payout (marketplace retains it, as CoffeeSooq funds shipping).
- Ensures **Razorpay linked accounts** exist for sellers (creation when missing, using KYC and bank data where provided).
- Applies **GST and share** rules per seller configuration (defaults from environment where not overridden).
- Records completed work to **avoid duplicate transfers** for the same payment.
- Provides a **password-protected admin portal** for seller registration, env updates, XLSX fallback upload, and job controls.

---

## 4. Scope — what the system does *not* do (management expectations)

- It does **not** replace Razorpay’s own product terms, settlement timelines, or Route approval status—those remain with **Razorpay and your account setup**.
- It does **not** replace VTEX as the system of record for orders; payout accuracy depends on **correct order IDs on payments** and consistent VTEX configuration.
- It is **not** a full accounting or tax filing system; treat commission and GST outputs as inputs to your **finance processes**.
- **Horizontal scaling** (multiple app instances) would require moving session/state off single-server files—plan before scaling traffic or redundancy.

---

## 5. Key stakeholders and responsibilities

| Role | Typical responsibility |
|------|-------------------------|
| **Management / Product** | Approve hold period, payout policy, and escalation paths; approve use of production keys and hosting. |
| **Finance** | Reconcile Razorpay statements, commissions, and tax treatment with outputs from the system. |
| **Operations** | Seller onboarding via portal, monitoring job runs, handling Razorpay/VTEX incidents. |
| **Engineering / DevOps** | Deployment, secrets, backups, SSL, access control, upgrades, incident response. |
| **Razorpay / VTEX** | External platforms—contracts, limits, API access, and support. |

---

## 6. Risk summary and mitigations

| Risk | Mitigation (current or recommended) |
|------|-------------------------------------|
| **Incorrect splits** (wrong seller or amount) | Validate VTEX–Razorpay linkage in UAT; spot-check high-value orders; monitor logs. |
| **Duplicate or missed transfers** | Idempotency file tracks processed payments; investigate any Razorpay errors in logs. |
| **Credential compromise** | Strong portal password / hash, rotate keys if exposed, restrict SSH, HTTPS in production. |
| **Single-server failure** | Backups of `.env` (securely), `data/state.json`, and deployment docs; consider DO snapshots. |
| **Refund disputes after payout** | Hold period is the primary control; align policy with customer support and Razorpay capabilities. |

---

## 7. Security and data sensitivity (manager view)

- The solution handles **financial and PII** (emails, phones, bank identifiers). Access must be **role-limited**.
- Production should use **HTTPS**, strong **session secrets**, and **non-default** admin credentials.
- **API keys** must not be shared broadly; prefer secure vaults and least-privilege Razorpay key scopes where possible.
- Verbose API logging may capture sensitive payloads—**disable** detailed payload logging in production if policy requires.

---

## 8. Dependencies management must be aware of

1. **Razorpay** — API availability, Route / linked account readiness, and account limits.  
2. **VTEX** — Correct environment (B2B vs B2C), Master Data entity access, and order data quality.  
3. **Hosting** — Server (e.g. DigitalOcean), DNS for the admin hostname, SSL certificate renewal.  
4. **Internal process** — Who approves seller bank details and commission rules.

---

## 9. Operational rhythm (what “good” looks like)

- Scheduler runs on the **agreed cron**; failures are visible in **process logs** (e.g. PM2).
- New sellers are registered **before** they appear on orders requiring payout, or fallback data is maintained.
- After configuration changes that affect scheduling, the **scheduler process is restarted** so new cron values apply.
- Periodic **reconciliation** between VTEX orders, Razorpay payments, and transfers.

---

## 10. Decisions for management to confirm

- [ ] **Hold period** (minimum business requirement vs. configured `HOLD_DAYS`).  
- [ ] **Who** may access the admin portal and how credentials are rotated.  
- [ ] **Approval workflow** for seller bank details before go-live.  
- [ ] **DNS and hostname** for the portal (e.g. `payments.coffeesooq.com`) and ownership of DNS.  
- [ ] **Support model** when Razorpay or VTEX APIs fail (retry policy, customer communication).  
- [ ] **Retention** of logs and `state` backups for audit.

---

## 11. Document control

| Item | Detail |
|------|--------|
| **Audience** | Management, product owners, IT leadership |
| **Detail level** | Executive; implementation → [DOCUMENTATION.md](./DOCUMENTATION.md) |
| **Repository** | [razorpay-splitpayments](https://github.com/mhadogar/razorpay-splitpayments) |

*Prepared for CoffeeSooq marketplace payment operations. Update this brief when policy or scope changes.*
