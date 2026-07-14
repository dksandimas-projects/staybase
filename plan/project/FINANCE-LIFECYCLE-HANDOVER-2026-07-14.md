# Finance Lifecycle Operational Handover — 2026-07-14

> Owner-facing closeout record for Finance Lifecycle recommendation FLR-05.
> This document records the historical Daily Close convention and provides the
> two sign-off checklists that must be completed before the next `dev → main`
> milestone merge. It is not accounting or tax advice.

## Status

| Item | Status | Completion evidence |
|---|---|---|
| Historical pre-FL-05 Daily Close annotation | ✅ Documented 2026-07-14 | Convention below; immutable close documents remain untouched |
| FIN-06 VAT posture reviewed with accountant | ⬜ Awaiting accountant | Accountant sign-off section below |
| Owner staging money-path walkthrough | ⬜ Awaiting walkthrough | Staging evidence and owner sign-off sections below |

FLR-05 remains **In progress** until both pending sign-offs are filled in. Do
not mark it complete based only on preparation of this document.

## 1. Historical Daily Close convention

FL-05 began recording direct-paid store tenders at delivery on 2026-07-13.
Daily Close documents recorded before that date can therefore show an expected
cash/collection shortfall when a delivered direct-paid store order contributed
store revenue but had no corresponding tender entry in the shared collections
ledger.

Operational convention:

- Do not edit or replace historical Daily Close documents. They are locked
  reconciliation records.
- For a close dated before 2026-07-13, a variance may be annotated externally
  as: **“Pre-FL-05 store tender gap — direct-paid store delivery was recognized
  as revenue before store tenders joined the collections ledger.”**
- This explanation applies only to the amount that can be traced to delivered,
  direct-paid store orders for that hotel date. It does not excuse unrelated
  drawer, GCash, refund, booking-payment, or staff-entry discrepancies.
- If the variance does not reconcile exactly to those historical store orders,
  investigate the remainder normally and escalate it to the owner.
- From 2026-07-13 onward, direct-paid store delivery creates the deterministic
  `delivery-tender`; a missing amount is not a historical exception and must be
  investigated.

The one historical tender gap found by the FLR-01 scan was repaired on
2026-07-14 with an append-only ₱1,500 tender plus a
`financeIntegrityRepairs` audit record. The post-repair scan returned zero
findings. Existing Daily Close documents were not changed.

## 2. FIN-06 accountant confirmation

Current decision (`plan/docs/DECISIONS-FEATURES.md #115`):

- Staybase is a PMS/income-monitoring system, not the statutory books of
  account.
- The system does not generate or print BIR-registered official receipts or
  sales invoices.
- Front desk issuance of official documents remains manual or external.
- Reports and XLSX exports calculate 12% VAT, VATable Sales, VAT Amount, and
  VAT-exempt Senior/PWD sales client-side to assist the accountant.
- Exports feed the external accounting/filing process; they do not themselves
  constitute a filed return or official source document.

Accountant review checklist:

- [ ] Confirm whether this exported breakdown is sufficient as a supporting
  schedule for the hotel's first filing period using Staybase.
- [ ] Confirm the correct treatment of Senior/PWD VAT-exempt sales and any
  required separation of discount reporting.
- [ ] Confirm whether the accountant needs additional fields, rounding rules,
  document references, or export columns.
- [ ] Confirm the manual/external official receipt or invoice process and who
  owns reconciliation between those documents and Staybase exports.
- [ ] Record any required system change as a new scoped roadmap item before
  filing; do not silently adjust exported figures outside the documented
  accounting workflow.

### Accountant sign-off record

| Field | Record |
|---|---|
| Accountant / firm | _Pending_ |
| Review date | _Pending_ |
| Filing period covered | _Pending_ |
| Outcome | ⬜ Accepted as documented · ⬜ Changes required |
| Required changes / advice | _Pending_ |
| Supporting reference or attachment | _Pending — store outside the repository if it contains confidential data_ |
| Owner acknowledgment | _Pending_ |

## 3. Owner staging money-path walkthrough

### Safety gate and prerequisites

- [ ] Confirm the browser is connected to an isolated staging Firebase project
  and staging email/payment services. The currently configured project name
  contains `stg` but has historically served production traffic; the name alone
  is not proof of isolation.
- [ ] If isolation cannot be confirmed, stop. Do not create synthetic money,
  guest, payment, or Daily Close records in the production dataset.
- [ ] Use synthetic guest/contact details and test payment proof assets only.
- [ ] Record booking/order references in the evidence table below; never paste
  guest PII, access tokens, private keys, or payment-proof URLs into this file.
- [ ] Use a fresh hotel date with no unrelated transactions where possible.
- [ ] Have an owner and front-desk representative present for the final pass.

### Walkthrough

1. **Create and price a booking**
   - [ ] Create an online or staff booking with room and breakfast lines.
   - [ ] Confirm the displayed breakdown reconciles to `totalPrice` and the
     booking appears once in Sales.
2. **Collect and verify payment**
   - [ ] Exercise payment upload/verification or record an onsite payment.
   - [ ] Confirm the immutable payment row, booking status transition, receipt,
     and Collections-by-method/staff entry agree.
3. **Add an incidental charge**
   - [ ] Add one charge from the booking folio.
   - [ ] Confirm the folio, Sales incidentals, billed amount, and Receivables
     include it exactly once. If testing a correction, use a void entry rather
     than editing/deleting the original charge.
4. **Deliver a direct-paid store order**
   - [ ] Create a COD or configured direct-payment store order and mark it
     delivered.
   - [ ] Confirm store revenue uses delivery date and exactly one store-scoped
     `delivery-tender` appears in Collections and Daily Close.
   - [ ] Confirm the store tender does not reduce the booking folio balance.
5. **Deliver an Add-to-Bill store order**
   - [ ] Create and deliver an Add-to-Bill order linked to the booking.
   - [ ] Confirm it appears once in store revenue and the booking folio.
   - [ ] Confirm no store tender is created until the folio is collected.
6. **Settle and check out**
   - [ ] Record the remaining payment, verify the charge-inclusive folio is
     settled, and check out.
   - [ ] Confirm the room is released and any eligible loyalty award follows
     the settled-folio rule.
7. **Reconcile Daily Close**
   - [ ] Confirm recorded Cash/GCash/other totals match the booking payment plus
     the direct store tender, with no Add-to-Bill double count.
   - [ ] Enter counted amounts and submit the test close only if the environment
     was confirmed isolated staging.
8. **Verify exports**
   - [ ] Export Sales XLSX, Collections CSV, Receivables CSV, and Full Backup.
   - [ ] Confirm room, breakfast, store, incidentals, payments/refunds, charges,
     receivables, and VAT fields reconcile to the browser views.
   - [ ] Store generated evidence outside git if it contains operational or
     personal data.

### Evidence record

| Evidence | Reference / result |
|---|---|
| Environment/project confirmed isolated by | _Pending_ |
| Walkthrough date and hotel timezone | _Pending_ |
| Owner / front-desk participants | _Pending_ |
| Test booking reference | _Pending_ |
| Direct-paid order reference | _Pending_ |
| Add-to-Bill order reference | _Pending_ |
| Daily Close date / result | _Pending_ |
| Sales XLSX reconciled | ⬜ Pass · ⬜ Fail |
| Collections CSV reconciled | ⬜ Pass · ⬜ Fail |
| Receivables CSV reconciled | ⬜ Pass · ⬜ Fail |
| Full Backup reconciled | ⬜ Pass · ⬜ Fail |
| Defects or follow-up roadmap IDs | _Pending_ |

### Owner sign-off

| Field | Record |
|---|---|
| Outcome | ⬜ Pass · ⬜ Pass with follow-ups · ⬜ Fail |
| Owner name / acknowledgment | _Pending_ |
| Date | _Pending_ |
| Notes | _Pending_ |

## Completion rule

FLR-05 may be marked complete only when:

1. the accountant sign-off record has an outcome and owner acknowledgment;
2. the staging safety gate is satisfied;
3. all walkthrough steps and export checks have recorded results; and
4. the owner sign-off has a final outcome, with every defect linked to a
   roadmap item.

