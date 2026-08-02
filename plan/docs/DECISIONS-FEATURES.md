# Feature & Product Decisions
> Requires: CLAUDE.md

Resolved product, feature scope, business rules, compliance, and UX decisions. Load this when building a specific feature to understand what was decided and why.

For architecture and stack decisions see `plan/docs/DECISIONS-ARCH.md`.

---

## Historical Decisions (#1 – #107)

> Historical decisions #1 through #107 are archived in [`plan/project/archive/DECISIONS-FEATURES-HISTORICAL-2026-08-02.md`](plan/project/archive/DECISIONS-FEATURES-HISTORICAL-2026-08-02.md).

| # Range | Summary | Archive Link |
|---|---|---|
| #1 – #20 | Initial MVP scope, booking statuses, discounts, intercom, reporting | [`DECISIONS-FEATURES-HISTORICAL-2026-08-02.md`](plan/project/archive/DECISIONS-FEATURES-HISTORICAL-2026-08-02.md) |
| #21 – #40 | Corporate booking, privacy, RA 10173 compliance, store operations | [`DECISIONS-FEATURES-HISTORICAL-2026-08-02.md`](plan/project/archive/DECISIONS-FEATURES-HISTORICAL-2026-08-02.md) |
| #41 – #60 | Spark Rewards, guest auth, breakfast pricing & silog selection | [`DECISIONS-FEATURES-HISTORICAL-2026-08-02.md`](plan/project/archive/DECISIONS-FEATURES-HISTORICAL-2026-08-02.md) |
| #61 – #80 | Backup export, DOT compliance, Sales Report, contact form, room blocks | [`DECISIONS-FEATURES-HISTORICAL-2026-08-02.md`](plan/project/archive/DECISIONS-FEATURES-HISTORICAL-2026-08-02.md) |
| #81 – #107 | Vouchers, PDFs, check-in reminder idempotency, admin inbox calls, corporate LOU, admin mobile UX | [`DECISIONS-FEATURES-HISTORICAL-2026-08-02.md`](plan/project/archive/DECISIONS-FEATURES-HISTORICAL-2026-08-02.md) |

---

## Active & Recent Decisions (#108 – #164)

| # | Decision |
|---|---|
| 108 | **Booking payment methods are a fully dynamic, admin-managed list** (Settings → Payment Methods). Structured `accountName` + `accountNumber` fields and `isEnabled` toggle replace legacy `accountInfo`. QR images stored at `assets/payment-methods/{method}/{filename}` in Firebase Storage. |
| 109 | **Protected payment methods:** `pay-at-hotel` and `add-to-bill` cannot be deleted from Settings or via direct API calls (`PROTECTED_PAYMENT_METHODS`). |
| 110 | **In-room store payment methods unified:** `settings/hotelConfig.paymentMethods[]` is the single source for booking, store, and corporate payment visibility. |
| 111 | **Independent surface visibility switches:** each payment method owns `isEnabled` (booking), `showInStore` (store), and `showInCorporate` (corporate). |
| 112 | **Google Sign-In is authentication only;** Spark Rewards enrollment requires explicit consent via Privacy Policy / Terms checkbox. |
| 113 | **Homepage featured room cards do not expose live per-room operational status.** Cards are type-driven marketing cards; operational status is not rendered on homepage cards. |
| 114 | **Self-service cross-provider auth linking is deferred to Phase 2.** Provider conflict message directs guests to sign in with their existing method first. |
| 115 | **BIR/VAT scope decision:** tax breakdown (12% VAT, VATable Sales, VAT-Exempt Sales, VAT Amount) calculated client-side for reports & XLSX exports. |
| 116 | **Direct-paid store orders join the shared collections ledger on delivery.** COD recorded as Cash; Add to Bill remains unsettled booking-folio charge. |
| 117 | **Early departure retains the contracted booking total.** Operational checkout shortens dates without auto-reducing total price. |
| 118 | **Spark Rewards points require a fully settled folio** and cover net booking spend only. |
| 119 | **Production environment split:** production database starts clean for bookings and transactions; active staff accounts pre-provisioned. |
| 120 | **Notification Center (Phase 12):** persisted `notifications` collection for admin alerts with 30-day retention cron. |
| 121 | **Purpose of stay is required at physical check-in and defaults to `Leisure`.** Add to admin drawer & guest registration form. |
| 122 | **Confirm with balance (CWB-01..05):** allows staff to transition a `payment-uploaded` booking to `confirmed` with an intentional partial payment. Reuses `unpaidCheckoutApprovalThreshold` (default 5,000) as four-eyes gate. |
| 123 | **Multi-booking picker for `/my-booking`:** when email-alone search matches >1 booking, returns a privacy-preserving list of 10 most recent stays. |
| 124 | **Unify payment reference number on payment ledger:** retired top-level `paymentReferenceNumber` in favor of per-payment `transactionReference`. |
| 125 | **HEIC client-side conversion:** use `heic-to@1.5.2` (LGPL-3.0) via dynamic `import()` for HEIC photo conversions in admin guest ID upload. |
| 126 | **Multi-booking picker privacy tightening:** uniform row shape with `maskedEmail` (`j***@gmail.com`), omitting `guestName`. |
| 127 | **Walk-in first/last name split:** modal collects first and last name separately, dropping string split. |
| 128 | **Drop `guestName` from email-alone 1-match single card:** public `/my-booking` does not reflect guest name back for email-alone queries. |
| 129 | **Turnstile token reuse for picker clicks:** prevents "Bot verification token missing" error during multi-booking navigation. |
| 130 | **Search form stays always-mounted:** suppresses with `hidden` / `aria-hidden` rather than unmounting, keeping Turnstile widget alive. |
| 131 | **Masked email on single-booking lookup card:** public `/my-booking` never exposes full email or guest name on any lookup path. |
| 132 | **Breakfast served map hydration:** `AdminContext` snapshot mapper hydates `breakfastServed` to persist "Mark Served" toggles across refreshes. |
| 137 | **Editable Terms & Conditions & consent versioning:** terms body editable from Settings; booking consent captures version string. |
| 138 | **Guest store search & category browsing:** intercom store panel includes live search bar and category filters. |
| 139 | **House Rules in transactional emails:** embedded in payment-confirmed, booking-confirmed, and check-in reminder templates. |
| 141 | **Walk-in Payment Method from Settings (WPM):** walk-in modal payment selector dynamically loads from `settings/hotelConfig.paymentMethods[]`. |
| 142 | **New Booking & Customizable Booking Sources (NBS):** renamed modal to "New Booking", widened source to string, admin-editable booking sources in Settings. |
| 144 | **Child Capacity & Occupancy Rules (CHD):** max 2 children, adult and child capacity validated independently, extra beds apply to adult or child overflow. |
| 145 | **Extra Bed Pricing & Capacity (EXB):** per-room-type `maxExtraBeds` and `extraBedRate`, snapshotted on booking, extra bed total included in folio. |
| 146 | **Discount Scope Configuration (DSC):** admin-toggleable scope (room / breakfast / extra bed) per discount class (Senior/PWD, Voucher, Member). |
| 147 | **Pending Booking Expiry & Hold Window (PEX):** 24h default payment hold window, `holdExpiresAt` timestamp snapshot, daily cleanup cron (`/api/holds/expire`). |
| 148 | **DSC Scope Snapshots & Senior Guardrails:** `discountScopeSnapshot` persisted on booking; senior/PWD scope restricted to admin with statutory warning. |
| 149 | **VAT Breakdown Calculation (DSC-06):** 12% VAT, VATable Sales, VAT-Exempt Sales (Senior/PWD), and VAT Amount calculated client-side for reports & XLSX exports. |
| 150 | **VAT Breakdown Surfaces (DSC-07):** receipt PDF, admin drawer, and guest confirmation preview display 12% VAT reconciliation. |
| 151 | **Weekend Rate Visibility (WRV):** Step 1 room cards and Step 3 breakdown display non-regular nightly rate lines whenever non-regular rates apply. |
| 159 | **Multi-Room Bookings & Reservation Header (MRB):** reservation header collection `reservations/{id}` with `reservationRef` (`R-YYYYMMDD-NNNNN`), linking child bookings. |
| 164 | **Reservation Header Idempotency & Write Operations:** transactional pre-allocated `reservationId` UUIDv4 + `requestFingerprint` SHA-256 for create, walk-in, reschedule, and corporate flows. |
