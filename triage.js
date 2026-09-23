#!/usr/bin/env node
/**
 * ============================================================================
 * Easy Rent Bali - Fleet Operations Incident & Dispatch Triage Script
 * ============================================================================
 * Role: IT Operations & QA Support Engineer (AI-Oriented)
 * Task: Task 3 - Operational Scripting & Automated Alert Dispatch
 *
 * Business Rules:
 *   Filter conditions:
 *     overdue_hours > 0 OR (status == "rented" AND fuel_level < 20%)
 *
 * Expected Output:
 *   Formatted Slack and WhatsApp operational dispatch alerts with actionable
 *   urgency badges (🚨 OVERDUE, ⚠️ LOW FUEL).
 * ============================================================================
 */

const fs = require('fs');
const path = require('path');

// Configuration
const DEFAULT_INPUT_FILE = path.join(__dirname, 'fleet_status.json');
const TIMEZONE_OFFSET_HOURS = 8; // Bali / WITA is UTC+8

/**
 * Parses raw fuel_level values (e.g., "15%", 15, " 15 % ") into an integer.
 * Gracefully handles malformed or missing data.
 * @param {string|number} rawFuel
 * @returns {number} Parsed percentage (0-100) or NaN if invalid
 */
function parseFuelLevel(rawFuel) {
  if (typeof rawFuel === 'number') return rawFuel;
  if (!rawFuel || typeof rawFuel !== 'string') return NaN;
  const cleaned = rawFuel.replace(/[^0-9.]/g, '');
  return parseFloat(cleaned);
}

/**
 * Returns current timestamp formatted in WITA (UTC+8)
 * @returns {string}
 */
function getCurrentWitaTimestamp() {
  const now = new Date();
  // Adjust to UTC+8
  const witaTime = new Date(now.getTime() + (TIMEZONE_OFFSET_HOURS * 60 + now.getTimezoneOffset()) * 60000);
  return witaTime.toISOString().replace('T', ' ').substring(0, 19) + ' WITA (UTC+8)';
}

/**
 * Evaluates whether a vehicle matches triage criteria and assigns urgency tags.
 * Rule: overdue_hours > 0 OR (status == "rented" AND fuel_level < 20%)
 * @param {Object} vehicle
 * @returns {{ matches: boolean, tags: string[], parsedFuel: number, urgencyLevel: string }}
 */
function evaluateVehicle(vehicle) {
  const parsedFuel = parseFuelLevel(vehicle.fuel_level);
  const overdueHours = Number(vehicle.overdue_hours) || 0;
  const isRented = String(vehicle.status).toLowerCase() === 'rented';

  const isOverdue = overdueHours > 0;
  const isLowFuel = isRented && !isNaN(parsedFuel) && parsedFuel < 20;

  const tags = [];
  if (isOverdue) {
    tags.push(`🚨 OVERDUE (+${overdueHours}h)`);
  }
  if (isLowFuel) {
    tags.push(`⚠️ LOW FUEL (${vehicle.fuel_level})`);
  }

  // Determine overall severity
  let urgencyLevel = 'NORMAL';
  if (isOverdue && isLowFuel) {
    urgencyLevel = 'CRITICAL';
  } else if (isOverdue) {
    urgencyLevel = 'HIGH';
  } else if (isLowFuel) {
    urgencyLevel = 'MEDIUM';
  }

  return {
    matches: isOverdue || isLowFuel,
    tags,
    parsedFuel,
    urgencyLevel
  };
}

/**
 * Formats triaged vehicles for Slack incoming webhook / channel dispatch
 * @param {Array} triagedList
 * @returns {string}
 */
function formatSlackAlert(triagedList) {
  const timestamp = getCurrentWitaTimestamp();
  const divider = '─'.repeat(54);

  let message = `*📢 [EASY RENT BALI] FLEET OPS TRIAGE DISPATCH*\n`;
  message += `_Generated at: ${timestamp}_\n`;
  message += `_Attention required for *${triagedList.length} vehicle(s)*_\n`;
  message += `${divider}\n\n`;

  triagedList.forEach((item, index) => {
    const { vehicle, evaluation } = item;
    const tagHeader = evaluation.tags.join(' | ');

    message += `*${index + 1}. ${vehicle.plate}* — _${vehicle.model}_\n`;
    message += `> *Status:* \`${vehicle.status.toUpperCase()}\` | *Fuel:* \`${vehicle.fuel_level}\` | *Overdue:* \`${vehicle.overdue_hours}h\`\n`;
    message += `> *Urgency:* ${tagHeader}\n`;
    message += `> *Action:* ${
      evaluation.urgencyLevel === 'CRITICAL'
        ? 'Contact customer immediately & dispatch recovery team with reserve fuel.'
        : evaluation.tags.some(t => t.includes('OVERDUE'))
        ? 'Initiate late return protocol & contact customer via WhatsApp.'
        : 'Notify return inspection team to refuel vehicle upon counter check-in.'
    }\n\n`;
  });

  message += `${divider}\n`;
  message += `_Easy Rent Bali Ops Center • Ground Dispatch Team Denpasar / Kuta / Ubud_`;
  return message;
}

/**
 * Formats triaged vehicles for WhatsApp Business operational group chat
 * @param {Array} triagedList
 * @returns {string}
 */
function formatWhatsAppAlert(triagedList) {
  const timestamp = getCurrentWitaTimestamp();

  let message = `🛵 *EASY RENT BALI - FLEET OPS ALERT* 🚗\n`;
  message += `📅 *Time:* ${timestamp}\n`;
  message += `⚠️ *Action Required:* ${triagedList.length} Vehicles Need Immediate Ops Intervention\n`;
  message += `==============================\n\n`;

  triagedList.forEach((item, index) => {
    const { vehicle, evaluation } = item;
    const tags = evaluation.tags.join(' ');

    message += `*#${index + 1} | ${vehicle.plate}* (${vehicle.model})\n`;
    message += `• Status: *${vehicle.status.toUpperCase()}*\n`;
    message += `• Fuel Level: *${vehicle.fuel_level}*\n`;
    message += `• Overdue Hours: *${vehicle.overdue_hours}h*\n`;
    message += `• Flags: ${tags}\n`;
    message += `• Suggested Ops Action:\n`;

    if (evaluation.urgencyLevel === 'CRITICAL') {
      message += `  👉 *URGENT:* Hubungi penyewa segera, siapkan tim penjemputan & jeriken bensin!\n\n`;
    } else if (evaluation.tags.some(t => t.includes('OVERDUE'))) {
      message += `  👉 Hubungi penyewa untuk konfirmasi perpanjangan atau penalti keterlambatan.\n\n`;
    } else {
      message += `  👉 Ingatkan penyewa ketentuan pengembalian bensin atau kenakan biaya refuel di counter.\n\n`;
    }
  });

  message += `==============================\n`;
  message += `_Silakan tim lapangan (Kuta/Seminyak/Airport Ops) koordinasikan di thread ini._`;
  return message;
}

/**
 * Main execution handler
 */
function runTriage() {
  const args = process.argv.slice(2);
  const inputFilePath = args.find(arg => !arg.startsWith('--')) || DEFAULT_INPUT_FILE;
  const formatArg = args.find(arg => arg.startsWith('--format='))?.split('=')[1] || 'all';

  console.log(`\n========================================================`);
  console.log(`  EASY RENT BALI - OPERATIONAL FLEET TRIAGE SYSTEM`);
  console.log(`========================================================`);
  console.log(`[INFO] Reading fleet data from: ${inputFilePath}`);

  if (!fs.existsSync(inputFilePath)) {
    console.error(`[ERROR] File not found: ${inputFilePath}`);
    process.exit(1);
  }

  let fleetData;
  try {
    const rawContent = fs.readFileSync(inputFilePath, 'utf8');
    fleetData = JSON.parse(rawContent);
  } catch (err) {
    console.error(`[ERROR] Failed to parse JSON input: ${err.message}`);
    process.exit(1);
  }

  if (!Array.isArray(fleetData)) {
    console.error(`[ERROR] Fleet data must be an array of vehicle records.`);
    process.exit(1);
  }

  const triaged = [];
  const safe = [];

  fleetData.forEach(vehicle => {
    const evaluation = evaluateVehicle(vehicle);
    if (evaluation.matches) {
      triaged.push({ vehicle, evaluation });
    } else {
      safe.push(vehicle);
    }
  });

  console.log(`[METRICS] Total Fleet: ${fleetData.length} | Alert Triggered: ${triaged.length} | Normal: ${safe.length}\n`);

  if (triaged.length === 0) {
    console.log(`[OK] All vehicles are within operational safety thresholds. No alerts dispatched.`);
    return;
  }

  // Display Slack dispatch
  if (formatArg === 'all' || formatArg === 'slack') {
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`[DISPATCH CHANNEL 1: SLACK WEBHOOK PAYLOAD]`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(formatSlackAlert(triaged));
    console.log();
  }

  // Display WhatsApp dispatch
  if (formatArg === 'all' || formatArg === 'whatsapp') {
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`[DISPATCH CHANNEL 2: WHATSAPP OPS BROADCAST]`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(formatWhatsAppAlert(triaged));
    console.log();
  }

  console.log(`[SUCCESS] Triage completed successfully.`);
}

// Execute if invoked directly from CLI
if (require.main === module) {
  runTriage();
}

module.exports = {
  parseFuelLevel,
  evaluateVehicle,
  formatSlackAlert,
  formatWhatsAppAlert,
  runTriage
};
