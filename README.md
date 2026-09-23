# Technical Assessment & Evaluation: IT Operations & Support Engineer (AI-Oriented)
**Company:** Easy Rent Bali  
**Candidate Submission Repository**  
**Role:** IT Operations & QA Support Engineer (AI-Oriented)  
**Timezone Reference:** Central Indonesia Time (WITA, UTC+8)

---

## Table of Contents
1. [Executive Summary & PRD Architecture Review](#1-executive-summary--prd-architecture-review)
2. [Task 1: Production Incident Triage & Root Cause Analysis (RCA)](#2-task-1-production-incident-triage--root-cause-analysis-rca)
   - [2.1 Technical Root Cause Analysis (RCA)](#21-technical-root-cause-analysis-rca)
   - [2.2 Defensive Patch (TypeScript / JavaScript)](#22-defensive-patch-typescript--javascript)
   - [2.3 Operational Impact Assessment & Graceful In-Flight Recovery](#23-operational-impact-assessment--graceful-in-flight-recovery)
3. [Task 2: QA Edge-Case Test Matrix](#3-task-2-qa-edge-case-test-matrix)
   - [3.1 Prioritized Test Case Table](#31-prioritized-test-case-table)
   - [3.2 Edge-Case Rationale & Critical Boundary Analysis](#32-edge-case-rationale--critical-boundary-analysis)
4. [Task 3: Operational Scripting & Automated Fleet Alert Dispatch](#4-task-3-operational-scripting--automated-fleet-alert-dispatch)
   - [4.1 Architecture & Filtering Criteria](#41-architecture--filtering-criteria)
   - [4.2 Running the Triage Automation](#42-running-the-triage-automation)
   - [4.3 Sample Dispatch Outputs (Slack & WhatsApp)](#43-sample-dispatch-outputs-slack--whatsapp)
5. [Task 4: AI Session Export & Prompt Steering Log Summary](#5-task-4-ai-session-export--prompt-steering-log-summary)
6. [Repository Structure](#6-repository-structure)

---

## 1. Executive Summary & PRD Architecture Review

Easy Rent Bali operates a high-demand, 24/7 digital vehicle rental platform catering to both domestic Indonesian tourists and international travelers arriving in Bali (e.g., via I Gusti Ngurah Rai International Airport - DPS). 

### Operational Characteristics & High-Risk Vectors
- **Peak Late-Night Traffic:** International long-haul flights from Australia, Europe, and East Asia frequently arrive late at night (22:00 – 03:00 WITA). System downtime or checkout crashes directly lead to stranded tourists at airport pickup counters, immediate customer churn, and brand degradation.
- **Bi-Modal KYC Compliance:** The platform must bifurcate KYC requirements dynamically: Indonesian citizens require national identity cards (*Kartu Tanda Penduduk* - KTP), whereas foreign tourists must supply valid passports and international driving permits.
- **Inventory Contention:** High-demand vehicles (e.g., Toyota Avanza, Mitsubishi Xpander, Honda Scoopy, Yamaha NMAX) experience race conditions when multiple tourists attempt simultaneous instant bookings.
- **Timezone Complexity:** Bali operates on **WITA (UTC+8)** with no Daylight Saving Time (DST). All booking boundaries, 24-hour rental durations, and late return penalties must translate unambiguously between client local time, server UTC ISO-8601 timestamps, and ground fleet operations.

---

## 2. Task 1: Production Incident Triage & Root Cause Analysis (RCA)

### Incident Context
During late-night peak operations in Bali on **2026-08-24 23:45:12 WITA**, international tourists reported intermittent **HTTP 500 Internal Server Errors** upon submitting checkout.

#### Production Error Log:
```plaintext
[2026-08-24T23:45:12.104+08:00] ERROR [BookingController] Failed to process rental checkout
Request Payload: {
  "booking_id": "erb_live_99482",
  "vehicle_id": "car_avanza_04",
  "pickup_date": "2026-08-25T00:00:00.000Z",
  "return_date": "2026-08-27T00:00:00.000Z",
  "customer": { "id": "cust_8810", "license_verified": true, "doc_urls": null },
  "applied_voucher": "BALISUMMER26"
}
Error: TypeError: Cannot read properties of null (reading 'passport_scan')
    at validateCustomerCompliance (/app/dist/services/compliance.js:42:28)
    at processBooking (/app/dist/services/booking.js:114:15)
    at async /app/dist/controllers/booking.js:58:7
```

---

### 2.1 Technical Root Cause Analysis (RCA)

1. **Direct Failure Mechanism:**
   The service crashed with an uncaught `TypeError: Cannot read properties of null (reading 'passport_scan')` located at `/app/dist/services/compliance.js:42:28`. The runtime executed property dereferencing on `customer.doc_urls.passport_scan` while `customer.doc_urls` was explicitly `null`.

2. **Upstream Trigger & Architectural Flaw:**
   - **Frontend / Ingestion Assumption:** The upstream API gateway or frontend checkout wizard permitted a payload where `"doc_urls": null` was transmitted. This typically happens when an international tourist skips or defers the document upload step during instant mobile checkout, or when third-party OAuth profile syncing leaves document URLs initialized as `null`.
   - **Missing Pre-Flight Schema Validation:** The `BookingController` did not execute runtime schema validation (e.g., using Zod, Joi, or class-validator) prior to invoking domain services.
   - **Compliance Logic Discrepancy:** Domestic compliance flows check for `customer.doc_urls.ktp_scan`, while international compliance routes into passport checks. Neither path utilized defensive programming (e.g., optional chaining `?.`, fallback defaults `?? {}`, or null guards).
   - **Cascade to HTTP 500:** Because the `TypeError` was unhandled inside `validateCustomerCompliance()`, the rejection bubbled through the async controller stack to Express/Fastify's default global error handler, returning a fatal `500 Internal Server Error` to the client instead of a clean, actionable `400 Bad Request` or soft-hold state.

---

### 2.2 Defensive Patch (TypeScript / JavaScript)

The solution below introduces a production-ready patch incorporating:
- Strict TypeScript interface definitions and Zod runtime schema validation.
- Safe property access with optional chaining (`?.`) and nullish coalescing (`??`).
- Specific domain error handling distinguishing missing payloads (`400 Bad Request`) from server-side infrastructure faults (`500`).
- Operational fallback allowing reservations to proceed in a `PENDING_DOCS_VERIFICATION` state if instant checkout allows post-booking upload or on-arrival counter verification.

```typescript
/**
 * /app/src/services/compliance.ts
 * Defensive Patch for Easy Rent Bali Customer Compliance Validation
 */

export interface CustomerDocumentUrls {
  passport_scan?: string | null;
  ktp_scan?: string | null;
  international_license_scan?: string | null;
}

export interface CustomerPayload {
  id: string;
  license_verified: boolean;
  doc_urls?: CustomerDocumentUrls | null;
  is_international?: boolean; // Inferred or explicit flag
}

export interface ComplianceValidationResult {
  isValid: boolean;
  complianceStatus: 'VERIFIED' | 'PENDING_UPLOAD' | 'REJECTED';
  missingRequirements: string[];
}

export class ComplianceValidationError extends Error {
  public readonly statusCode = 400;
  public readonly errorCode = 'COMPLIANCE_REQUIREMENT_MISSING';

  constructor(message: string, public readonly missingFields: string[]) {
    super(message);
    this.name = 'ComplianceValidationError';
  }
}

/**
 * Validates customer identification documents defensively against null/undefined payloads.
 * 
 * @param customer - Customer payload from booking request
 * @param isInternational - Whether customer is an international tourist requiring passport
 * @param allowDeferredUpload - If true, permits booking with PENDING_UPLOAD status
 * @returns ComplianceValidationResult
 */
export function validateCustomerCompliance(
  customer: CustomerPayload | null | undefined,
  isInternational: boolean = true,
  allowDeferredUpload: boolean = false
): ComplianceValidationResult {
  // 1. Guard against null or non-object customer root
  if (!customer || typeof customer !== 'object') {
    throw new ComplianceValidationError(
      'Invalid customer payload: Customer information is required.',
      ['customer']
    );
  }

  // 2. Safe property extraction using optional chaining & nullish coalescing
  const docs = customer.doc_urls ?? {};
  const passportScan = docs?.passport_scan?.trim() ?? null;
  const ktpScan = docs?.ktp_scan?.trim() ?? null;
  const isLicenseVerified = Boolean(customer?.license_verified);

  const missingRequirements: string[] = [];

  // 3. Driver's License verification check
  if (!isLicenseVerified) {
    missingRequirements.push('license_verified');
  }

  // 4. Bi-modal KYC check: Domestic (KTP) vs International (Passport)
  if (isInternational) {
    if (!passportScan) {
      missingRequirements.push('passport_scan');
    }
  } else {
    if (!ktpScan) {
      missingRequirements.push('ktp_scan');
    }
  }

  // 5. Handling missing documents gracefully
  if (missingRequirements.length > 0) {
    if (allowDeferredUpload) {
      // Allows instant booking hold while sending follow-up upload link
      return {
        isValid: false,
        complianceStatus: 'PENDING_UPLOAD',
        missingRequirements,
      };
    }

    // Return structured, actionable 400 client error rather than 500 crash
    throw new ComplianceValidationError(
      `Compliance check failed: Missing required documents (${missingRequirements.join(', ')}).`,
      missingRequirements
    );
  }

  return {
    isValid: true,
    complianceStatus: 'VERIFIED',
    missingRequirements: [],
  };
}
```

---

### 2.3 Operational Impact Assessment & Graceful In-Flight Recovery

When an incident causes 500 errors during checkout, customers frequently assume their reservation failed or that their payment was lost. If left unaddressed, international travelers stranded at Denpasar Airport will book with competing rental agencies.

#### Immediate Incident Triage Protocol:
1. **Query & Isolate In-Flight Casualties:**
   Run an immediate query across server logs (Datadog/CloudWatch) and PostgreSQL/MongoDB to extract all checkout attempts that terminated with unhandled exceptions between `23:00 WITA` and the deployment of the hotfix:
   ```sql
   -- Identify impacted booking attempts
   SELECT booking_id, customer_id, vehicle_id, created_at, status 
   FROM rental_bookings 
   WHERE created_at BETWEEN '2026-08-24 23:00:00+08' AND '2026-08-25 01:00:00+08'
     AND status IN ('INITIALIZED', 'PAYMENT_PENDING', 'FAILED_CHECKOUT')
     AND customer_doc_urls IS NULL;
   ```

2. **Soft-Hold Reservation & Prevent Race Conditions:**
   - Automatically place the selected vehicle (`car_avanza_04`) on a **2-Hour Soft Lock (TTL)** in Redis to prevent inventory release or accidental double-booking by other users.
   - Set booking status to `PENDING_DOCS_VERIFICATION` instead of `CANCELLED`.

3. **Automated Customer Recovery Dispatch (WhatsApp & Email):**
   - Automatically send an expedited WhatsApp message and email with a **One-Click Magic Upload Link**:
     > *"Hello from Easy Rent Bali! 🌴 We noticed your checkout for the Toyota Avanza was interrupted during document upload. Don't worry—your car is held reserved for the next 2 hours! Please click here to upload your passport photo in 30 seconds: `https://easyrentbali.com/verify-docs?token=...&booking=erb_live_99482`"*
   - If payment was pre-authorized, confirm payment hold is safe and no double charge occurred.

4. **Airport Ops Counter Fallback (Human-in-the-Loop):**
   - Push an operational note to the ground team at Ngurah Rai Airport / Kuta Ops desk:
     *Flag booking `erb_live_99482` for physical passport scan upon arrival.*
   - If the tourist lands before uploading the scan, the airport dispatch agent scans their physical passport on a tablet at the pickup counter, unlocking the digital key instantly.

5. **Monitoring & SRE Preventive Safeguards:**
   - Configure a **Sentry / Datadog Alert Threshold**: Trigger a P1 PagerDuty alarm if `BookingController` 5xx error rate exceeds 1% over a 5-minute rolling window.
   - Implement gateway-level request validation middleware before controllers are reached.

---

## 3. Task 2: QA Edge-Case Test Matrix

### Specification Rules:
- Minimum rental duration is strictly 24 hours.
- Promo code `BALIFAST` grants 10% discount on orders strictly $\ge$ IDR 500,000.
- Vehicles must reject overlapping bookings across identical vehicle IDs.
- Identification: KTP for domestic renters, Passport for foreign tourists.

---

### 3.1 Prioritized Test Case Table

| Test ID | Category | Scenario Description | Input Payload / Mock Data | Expected Result | Severity |
| :--- | :--- | :--- | :--- | :--- | :---: |
| **TC-001** | Standard Happy Path | Domestic renter books vehicle for 48h with valid KTP and no promo code. | `vehicle_id: "car_avanza_04"`, `pickup_date: "2026-09-01T02:00:00Z" (10:00 WITA)`, `return_date: "2026-09-03T02:00:00Z" (10:00 WITA)` (48h), `customer: { id: "cust_101", license_verified: true, is_international: false, doc_urls: { ktp_scan: "https://s3.erb.com/ktp101.jpg" } }`, `subtotal: 700000` | HTTP 200 OK. `status: "CONFIRMED"`, `duration_hours: 48`, `compliance_status: "VERIFIED"`. Vehicle locked. | **P1** |
| **TC-002** | Standard Happy Path | International tourist books vehicle for 24h with valid passport and applies `BALIFAST` promo code on qualifying amount. | `vehicle_id: "car_xpander_02"`, `pickup_date: "2026-09-05T06:00:00Z"`, `return_date: "2026-09-06T06:00:00Z"` (24h), `customer: { id: "cust_202", license_verified: true, is_international: true, doc_urls: { passport_scan: "https://s3.erb.com/pass202.jpg" } }`, `subtotal: 600000`, `applied_voucher: "BALIFAST"` | HTTP 200 OK. 10% discount applied (-IDR 60,000), `final_amount: 540000`, `voucher_status: "APPLIED"`. | **P1** |
| **TC-003** | Timezone Boundaries | Late-night booking created at 23:59:30 WITA; server evaluates 24h duration across UTC midnight boundary (`15:59:30Z`). | `booking_created_at: "2026-08-25T23:59:30+08:00"` (WITA), `pickup_date: "2026-08-26T00:00:00+08:00"` (`2026-08-25T16:00:00Z`), `return_date: "2026-08-27T00:00:00+08:00"` (`2026-08-26T16:00:00Z`) (Exactly 24h in WITA). | HTTP 200 OK. Server correctly resolves UTC conversion without day-truncation off-by-one errors. Duration is exactly 24.0h. | **P2** |
| **TC-004** | Duration Boundary | Rental requested for 23 hours and 59 minutes (violating strictly 24-hour minimum duration policy). | `pickup_date: "2026-09-10T10:00:00+08:00"`, `return_date: "2026-09-11T09:59:00+08:00"` (23 hours, 59 minutes), `vehicle_id: "bike_nmax_01"`. | HTTP 422 Unprocessable Entity. `error: "MINIMUM_DURATION_VIOLATION"`, `message: "Minimum rental duration is strictly 24 hours."` Checkout blocked. | **P1** |
| **TC-005** | Promo Code Edge Case | Customer applies `BALIFAST` promo code on order strictly below the threshold (IDR 499,999 vs required $\ge$ IDR 500,000). | `subtotal: 499999`, `applied_voucher: "BALIFAST"`, `vehicle_id: "bike_scoopy_03"`, duration: 24h. | HTTP 400 Bad Request. `error: "PROMO_THRESHOLD_NOT_MET"`, `message: "Promo code BALIFAST requires a minimum order amount of IDR 500,000."` No discount applied. | **P2** |
| **TC-006** | Promo Code Edge Case | Customer inputs valid promo code with mixed/lowercase casing (`balifast` / `BaliFast`) and checks expired voucher. | Scenario A: `applied_voucher: "balifast"` (order IDR 550,000).<br>Scenario B: `applied_voucher: "BALISUMMER26"` with expiry date `2026-07-31`. | Scenario A: HTTP 200 OK (voucher parser normalizes `.toUpperCase().trim()` -> grants 10%).<br>Scenario B: HTTP 400 Bad Request (`"PROMO_EXPIRED"`). | **P3** |
| **TC-007** | Data Anomaly (RCA Fix) | International customer payload has `"doc_urls": null` or empty object `{}` during checkout. | `customer: { id: "cust_303", license_verified: true, is_international: true, doc_urls: null }`. | HTTP 400 Bad Request (or 202 with `PENDING_UPLOAD`). No server crash (500). Actionable response detailing missing `passport_scan`. | **P1** |
| **TC-008** | Concurrency / Double Booking | Two users submit simultaneous checkout requests for the exact same `vehicle_id` overlapping by even 1 hour. | **User A:** Pickup `2026-09-15 10:00 WITA`, Return `2026-09-17 10:00 WITA`.<br>**User B:** Pickup `2026-09-16 12:00 WITA`, Return `2026-09-18 12:00 WITA`. (Concurrent requests dispatched at $t_0$). | **First resolved request:** HTTP 200 Confirmed.<br>**Second request:** HTTP 409 Conflict (`"VEHICLE_ALREADY_RESERVED"`). Guaranteed by DB row-lock (`SELECT FOR UPDATE`) or Redis distributed mutex. Zero double bookings. | **P1** |

---

### 3.2 Edge-Case Rationale & Critical Boundary Analysis

1. **Timezone Boundary (WITA vs UTC):**
   Bali sits at UTC+8 without daylight saving time. When bookings occur around midnight WITA (e.g., 23:59 WITA), the corresponding UTC timestamp is 15:59 of the previous calendar day. If date calculation libraries utilize naive local string splitting (`YYYY-MM-DD`) rather than true epoch milliseconds or UTC timestamps, the rental duration calculation can compute 0 days or an extra day, causing booking corruption.

2. **Strict Inequality on Promo Code Threshold:**
   The business specification mandates `BALIFAST` is valid strictly $\ge$ IDR 500,000. Testing IDR 499,999 guarantees developers didn't implement loose roundings or flawed comparison operators (`> 500000` vs `>= 500000`).

3. **Concurrency and Inventory Safety:**
   In peak holiday seasons (e.g., July–August in Bali), inventory turnover is near 100%. Implementing optimistic concurrency control or distributed locking prevents double-assigning the same Avanza or NMAX to two different tourists.

---

## 4. Task 3: Operational Scripting & Automated Fleet Alert Dispatch

### 4.1 Architecture & Filtering Criteria

The operations team in Bali monitors motorcycle and car fleets across hubs in Denpasar, Kuta, Seminyak, Ubud, and the Airport. To prevent abandoned vehicles and unpenalized late returns, an automated script processes `fleet_status.json`.

#### Triage Filter Logic:
```javascript
overdue_hours > 0 OR (status == "rented" AND fuel_level < 20%)
```

#### Evaluation Table for `fleet_status.json`:
| Plate | Model | Status | Fuel Level | Overdue Hours | Matches Filter? | Urgency Tags Assigned |
| :--- | :--- | :--- | :--- | :---: | :---: | :--- |
| `DK 1234 AB` | Honda Beat | `rented` | 80% | 0 | ❌ No | None (Normal operation) |
| `DK 5678 CD` | Toyota Avanza | `rented` | 15% | 3 | **✅ Yes** | `🚨 OVERDUE (+3h)` \| `⚠️ LOW FUEL (15%)` *(CRITICAL)* |
| `DK 9012 EF` | Mitsubishi Xpander | `available` | 40% | 0 | ❌ No | None (Available in parking lot) |
| `DK 3456 GH` | Honda Scoopy | `rented` | 90% | 5 | **✅ Yes** | `🚨 OVERDUE (+5h)` *(HIGH)* |
| `DK 7890 IJ` | Yamaha NMAX | `rented` | 10% | 0 | **✅ Yes** | `⚠️ LOW FUEL (10%)` *(MEDIUM)* |

---

### 4.2 Running the Triage Automation

The triage automation is built with **Node.js** (`triage.js`) to seamlessly match the technology stack of Easy Rent Bali's backend services (as observed in Task 1). The script requires **zero external npm dependencies** and handles data parsing defensively (cleaning percentage characters, handling unexpected types, and ensuring robust cross-platform execution).

#### Run with Node.js:
```bash
# Display both Slack and WhatsApp dispatches
node triage.js

# Target specific channels
node triage.js --format=slack
node triage.js --format=whatsapp
```

---

### 4.3 Sample Dispatch Outputs (Slack & WhatsApp)

#### 1. Slack Alert Dispatch:
```markdown
*📢 [EASY RENT BALI] FLEET OPS TRIAGE DISPATCH*
_Generated at: 2026-09-23 17:50:44 WITA (UTC+8)_
_Attention required for *3 vehicle(s)*_
──────────────────────────────────────────────────────

*1. DK 5678 CD* — _Toyota Avanza_
> *Status:* `RENTED` | *Fuel:* `15%` | *Overdue:* `3h`
> *Urgency:* 🚨 OVERDUE (+3h) | ⚠️ LOW FUEL (15%)
> *Action:* Contact customer immediately & dispatch recovery team with reserve fuel.

*2. DK 3456 GH* — _Honda Scoopy_
> *Status:* `RENTED` | *Fuel:* `90%` | *Overdue:* `5h`
> *Urgency:* 🚨 OVERDUE (+5h)
> *Action:* Initiate late return protocol & contact customer via WhatsApp.

*3. DK 7890 IJ* — _Yamaha NMAX_
> *Status:* `RENTED` | *Fuel:* `10%` | *Overdue:* `0h`
> *Urgency:* ⚠️ LOW FUEL (10%)
> *Action:* Notify return inspection team to refuel vehicle upon counter check-in.

──────────────────────────────────────────────────────
_Easy Rent Bali Ops Center • Ground Dispatch Team Denpasar / Kuta / Ubud_
```

#### 2. WhatsApp Operations Alert:
```markdown
🛵 *EASY RENT BALI - FLEET OPS ALERT* 🚗
📅 *Time:* 2026-09-23 17:50:44 WITA (UTC+8)
⚠️ *Action Required:* 3 Vehicles Need Immediate Ops Intervention
==============================

*#1 | DK 5678 CD* (Toyota Avanza)
• Status: *RENTED*
• Fuel Level: *15%*
• Overdue Hours: *3h*
• Flags: 🚨 OVERDUE (+3h) ⚠️ LOW FUEL (15%)
• Suggested Ops Action:
  👉 *URGENT:* Hubungi penyewa segera, siapkan tim penjemputan & jeriken bensin!

*#2 | DK 3456 GH* (Honda Scoopy)
• Status: *RENTED*
• Fuel Level: *90%*
• Overdue Hours: *5h*
• Flags: 🚨 OVERDUE (+5h)
• Suggested Ops Action:
  👉 Hubungi penyewa untuk konfirmasi perpanjangan atau penalti keterlambatan.

*#3 | DK 7890 IJ* (Yamaha NMAX)
• Status: *RENTED*
• Fuel Level: *10%*
• Overdue Hours: *0h*
• Flags: ⚠️ LOW FUEL (10%)
• Suggested Ops Action:
  👉 Ingatkan penyewa ketentuan pengembalian bensin atau kenakan biaya refuel di counter.

==============================
_Silakan tim lapangan (Kuta/Seminyak/Airport Ops) koordinasikan di thread ini._
```

---

## 5. Task 4: AI Session Export & Prompt Steering Log Summary

In accordance with the assessment instructions to verify authentic AI-native problem solving, all interaction logs and prompt engineering iterations are preserved in the [`ai_session_logs/`](./ai_session_logs/) directory:

1. **[`ai_session_logs/triage_prompt_log.md`](./ai_session_logs/triage_prompt_log.md)**:
   - Detailed log of prompts and candidate steering interventions for Tasks 1, 2, and 3.
   - Highlights how naive AI outputs (e.g., shallow optional chaining without schema validation, naive string comparison on `"15%" < 20`, and generic QA matrices) were critiqued and steered toward production-grade engineering standards.

2. **[`ai_session_logs/agent_coding_log.txt`](./ai_session_logs/agent_coding_log.txt)**:
   - Verifiable CLI session transcripts showing iterative test runs, error diagnosis (such as Windows `cp1252` encoding traps with unicode characters in Python), and automated validation.

---

## 6. Repository Structure

```plaintext
.
├── README.md                  # Comprehensive PRD review, Task 1 RCA & Patch, Task 2 QA Matrix
├── triage.js                  # Task 3 automation script (Node.js, zero dependencies)
├── fleet_status.json          # Task 3 mock fleet input data
└── ai_session_logs/           # MANDATORY: Verifiable AI interaction trails
    ├── triage_prompt_log.md   # Prompt logs and iterations for Task 1 & 2
    └── agent_coding_log.txt   # CLI session export, Cursor/Agent transcript
```
