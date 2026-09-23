# AI Interaction & Prompt Steering Log
**Role:** IT Operations & QA Support Engineer (AI-Oriented)  
**Company:** Easy Rent Bali  
**Scope:** Task 1 (Production RCA & Patch), Task 2 (QA Edge-Case Matrix), & Task 3 (Operational Scripting)

---

## Overview & Methodology
This log documents the prompt engineering journey, quality assurance verification, and candidate steering interventions throughout the technical assessment. Rather than accepting raw, first-turn AI outputs, a rigorous evaluation framework was employed:
1. **Critical Review:** Identify naive assumptions, hidden type errors, or lack of production hardening.
2. **Context Injection:** Inject domain-specific realities of Bali operations (late-night arrivals at DPS Airport, WITA UTC+8 timezone boundaries, and WhatsApp ground ops communication).
3. **Iterative Steering:** Demand precise edge-case coverage, runtime defensive programming, and zero-dependency operational tooling.

---

## Session 1: Task 1 (Production Incident Triage & Defensive Patch)

### Initial Prompt:
> *"Here is the production log from our Bali checkout service:*  
> `TypeError: Cannot read properties of null (reading 'passport_scan') at validateCustomerCompliance (/app/dist/services/compliance.js:42:28)`  
> *Payload has `customer: { id: "cust_8810", license_verified: true, doc_urls: null }`. Explain why it failed and give me a patch."*

### AI Initial (Suboptimal) Output:
The AI generated a brief 2-sentence explanation and a simple one-line optional chaining fix:
```javascript
// AI initial naive patch
function validateCustomerCompliance(customer) {
  const passport = customer?.doc_urls?.passport_scan;
  return passport ? true : false;
}
```

### Candidate Evaluation & Critique:
- **Flaw 1 (Insufficient Error Signaling):** Returning `false` or `undefined` masks the root issue. An unhandled exception or silent boolean failure would still cause the controller to either return 500 or give no actionable feedback to the customer.
- **Flaw 2 (Missing Schema Validation):** In enterprise Node.js/TypeScript architectures, incoming JSON payloads must be validated at runtime before accessing nested properties.
- **Flaw 3 (No In-Flight Recovery Strategy):** The AI did not explain what operations engineers should do with the customers who already failed checkout tonight in Bali.

### Candidate Steering Prompt:
> *"This patch is too simplistic and brittle for production. Address the following issues:*
> 1. *If `doc_urls` is `null`, simply returning false does not help the client understand what failed. Rewrite `validateCustomerCompliance` in TypeScript with proper interfaces and throw a descriptive `ComplianceValidationError` with an HTTP 400 Bad Request status code and a list of missing fields.*
> 2. *Distinguish between domestic renters (who use KTP) and foreign tourists (who require passport scans).*
> 3. *Add an operational recovery strategy: Tonight is high season in Bali. International tourists are landing at Ngurah Rai Airport right now. How do we recover the bookings that failed with 500 errors without forcing them to re-enter dates or losing their car to someone else? Detail soft-locks, automated WhatsApp magic links, and airport counter fallback."*

### Refined Outcome:
The AI produced the comprehensive TypeScript defensive patch, custom domain exception class, and operational recovery plan now documented in `README.md` Section 2.

---

## Session 2: Task 2 (QA Edge-Case Test Matrix)

### Initial Prompt:
> *"Construct a QA test matrix with 6 test cases for our 24-hour instant rental and voucher system with promo code BALIFAST (10% off for orders >= IDR 500k)."*

### AI Initial (Suboptimal) Output:
The AI produced a generic table with tests like:
- "Test 1: Valid rental duration"
- "Test 2: Invalid promo code"
- "Test 3: Missing phone number"
- "Test 4: Invalid credit card"
- "Test 5: Vehicle not found"
- "Test 6: Expired voucher"

### Candidate Evaluation & Critique:
- **Flaw 1 (Ignored Timezone Boundaries):** No mention of Bali's WITA timezone (UTC+8) vs UTC server translation, which is notorious for off-by-one day bugs when bookings happen late at night (23:59 WITA).
- **Flaw 2 (Vague Inputs):** Inputs were qualitative text descriptions rather than realistic mock JSON payloads.
- **Flaw 3 (Ignored Concurrency & Double-Booking):** The specification requires vehicles to reject overlapping bookings across identical vehicle IDs. Race conditions / concurrent checkouts were omitted.
- **Flaw 4 (Loose Boundary Testing):** Failed to test the exact mathematical boundary of IDR 500,000 (e.g., IDR 499,999 vs 500,000).

### Candidate Steering Prompt:
> *"The test cases are too generic and miss the specific business rules in our PRD. Refactor the test matrix with the following mandatory requirements:*
> 1. *Include the exact columns: `Test ID | Category | Scenario Description | Input Payload / Mock Data | Expected Result | Severity (P1-P4)`.*
> 2. *Add an explicit Timezone Boundary test: A user creating a booking at 23:59:30 WITA where the server must evaluate 24-hour duration across the UTC midnight boundary (15:59Z).*
> 3. *Add a strict inequality edge case for promo code `BALIFAST`: Test an order value of exactly IDR 499,999 (sub-threshold) vs IDR 500,000.*
> 4. *Add a Concurrent Double Booking race condition test: Two users hitting checkout simultaneously for vehicle `car_avanza_04` with overlapping rental dates, validating row-level database locking (`SELECT FOR UPDATE`) or Redis mutex locks.*
> 5. *Add the exact Task 1 regression test: International customer with `"doc_urls": null`."*

### Refined Outcome:
The resulting 8-scenario matrix in `README.md` Section 3 covers end-to-end edge cases with explicit JSON inputs, expected status codes, and severity classifications.

---

## Session 3: Task 3 (Operational Scripting & Fleet Triage)

### Initial Prompt:
> *"Write a script in JavaScript that reads `fleet_status.json` and filters vehicles where `overdue_hours > 0 OR (status == 'rented' AND fuel_level < 20%)`. Output an alert."*

### AI Initial (Suboptimal) Output:
```javascript
// AI initial naive implementation
const data = require('./fleet_status.json');
const alerts = data.filter(v => v.overdue_hours > 0 || (v.status === 'rented' && v.fuel_level < 20));
console.log(alerts);
```

### Candidate Evaluation & Critique:
- **CRITICAL BUG (String vs Number Comparison):** In `fleet_status.json`, `fuel_level` is stored as a formatted percentage string (e.g., `"15%"` or `"80%"`). In JavaScript, `"15%" < 20` evaluates to `false` because `Number("15%")` yields `NaN`! The low fuel condition failed silently for all vehicles.
- **Flaw 2 (Lack of Dispatch Formatting):** The assessment explicitly requested formatted WhatsApp and Slack operational dispatch alerts with urgency badges (e.g., `🚨 OVERDUE`, `⚠️ LOW FUEL`), not raw `console.log(alerts)`.
- **Flaw 3 (Missing Error Handling):** The script lacked file existence checks, JSON parse safety, and command-line arguments.

### Candidate Steering Prompt:
> *"There is a critical bug in your code: `fuel_level` in `fleet_status.json` is a string containing `%` (e.g. `'15%'`). Direct numerical comparison `v.fuel_level < 20` evaluates to false due to NaN coercion.*
> *Fix this immediately:*
> 1. *Implement a robust `parseFuelLevel()` function that sanitizes string and numerical inputs.*
> 2. *Format two distinct operational dispatches: one for Slack incoming webhooks (using markdown bullet points, block dividers, and WITA timestamps), and one for WhatsApp ground operations group chat.*
> 3. *Tag urgent items with `🚨 OVERDUE` and `⚠️ LOW FUEL`.*
> 4. *Ensure zero external npm dependencies so the script runs instantly with `node triage.js`.*
> 5. *Align runtime strictly with Easy Rent Bali's Node.js backend ecosystem, adding CLI argument flags (`--format=slack`, `--format=whatsapp`) for operational flexibility.*"

### Refined Outcome:
The automation script `triage.js` was generated, refined, and verified under Node.js. It correctly identifies all 3 problem vehicles (`DK 5678 CD`, `DK 3456 GH`, `DK 7890 IJ`), handles CLI formatting arguments cleanly, and executes with exit code 0.
