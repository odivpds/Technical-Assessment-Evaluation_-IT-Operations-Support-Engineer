#!/usr/bin/env node
/**
 * ============================================================================
 * Easy Rent Bali - Skrip Triage Operasional & Notifikasi Armada (Fleet Triage)
 * ============================================================================
 * Posisi: IT Operations & QA Support Engineer (AI-Oriented)
 * Tugas: Task 3 - Operational Scripting & Automated Alert Dispatch
 *
 * Aturan Bisnis dari Soal:
 *   Kondisi Filter Kendaraan Bermasalah:
 *     overdue_hours > 0 ATAU (status == "rented" DAN fuel_level < 20%)
 *
 * Output yang Dihasilkan:
 *   Format notifikasi operasional siap kirim untuk Slack Webhook dan WhatsApp
 *   lengkap dengan label urgensi (🚨 OVERDUE, ⚠️ LOW FUEL) dan rekomendasi aksi.
 * ============================================================================
 */

// Mengimpor modul bawaan Node.js (Zero external dependencies / tanpa perlu npm install)
const fs = require('fs');     // Modul File System: untuk membaca file fleet_status.json
const path = require('path'); // Modul Path: untuk mengelola path direktori file secara aman

// ============================================================================
// KONFIGURASI SISTEM
// ============================================================================
// Menentukan lokasi default file JSON input (mengarah ke fleet_status.json di folder yang sama)
const DEFAULT_INPUT_FILE = path.join(__dirname, 'fleet_status.json');
// Selisih waktu Bali / WITA terhadap UTC adalah +8 jam
const TIMEZONE_OFFSET_HOURS = 8;

/**
 * ============================================================================
 * FUNGSI 1: parseFuelLevel (Pembersih & Konversi Tipe Data Bensin)
 * ============================================================================
 * Mengapa fungsi ini sangat penting?
 * Di file fleet_status.json, nilai bensin berupa teks string bertanda persen ("15%").
 * Di JavaScript, jika teks "15%" langsung dibandingkan dengan angka (misal: "15%" < 20),
 * JavaScript akan menghasilkan NaN (Not a Number), dan NaN < 20 bernilai FALSE!
 * Akibatnya mobil bensin kritis TIDAK AKAN PERNAH terdeteksi.
 *
 * Solusi:
 * Fungsi ini membersihkan tanda persen (%) menggunakan Regex, lalu mengubahnya
 * menjadi angka desimal murni (float) sehingga perbandingan matematika valid.
 *
 * @param {string|number} rawFuel - Nilai input bensin mentah (contoh: "15%", 80)
 * @returns {number} Angka persentase murni (0-100) atau NaN jika data tidak valid
 */
function parseFuelLevel(rawFuel) {
  // Jika input sudah bertipe angka (number), langsung kembalikan nilainya
  if (typeof rawFuel === 'number') return rawFuel;
  
  // Jika input null, undefined, atau bukan string, kembalikan NaN (data tidak valid)
  if (!rawFuel || typeof rawFuel !== 'string') return NaN;
  
  // Menghapus semua karakter selain angka dan titik desimal (misal: "15%" -> "15")
  const cleaned = rawFuel.replace(/[^0-9.]/g, '');
  
  // Mengubah teks angka menjadi tipe data angka pecahan/desimal
  return parseFloat(cleaned);
}

/**
 * ============================================================================
 * FUNGSI 2: getCurrentWitaTimestamp (Penghasil Waktu Real-Time Bali)
 * ============================================================================
 * Menghasilkan teks waktu saat ini yang disesuaikan secara otomatis
 * ke zona Waktu Indonesia Tengah (WITA / UTC+8).
 *
 * @returns {string} Contoh output: "2026-09-25 15:30:00 WITA (UTC+8)"
 */
function getCurrentWitaTimestamp() {
  const now = new Date();
  // Menghitung selisih waktu dari UTC ke UTC+8 (WITA) dalam satuan milidetik
  const witaTime = new Date(now.getTime() + (TIMEZONE_OFFSET_HOURS * 60 + now.getTimezoneOffset()) * 60000);
  
  // Format string: YYYY-MM-DD HH:mm:ss WITA (UTC+8)
  return witaTime.toISOString().replace('T', ' ').substring(0, 19) + ' WITA (UTC+8)';
}

/**
 * ============================================================================
 * FUNGSI 3: evaluateVehicle (Evaluasi Logika Bisnis & Penentuan Tag Urgensi)
 * ============================================================================
 * Mengevaluasi satu unit kendaraan berdasarkan rumus pada soal:
 * overdue_hours > 0 OR (status == "rented" AND fuel_level < 20%)
 *
 * @param {Object} vehicle - Objek data satu kendaraan dari fleet_status.json
 * @returns {Object} Hasil evaluasi (apakah kena filter, tag emoji, tingkat urgensi)
 */
function evaluateVehicle(vehicle) {
  // 1. Ekstrak dan konversi data bensin ke angka murni
  const parsedFuel = parseFuelLevel(vehicle.fuel_level);
  
  // 2. Pastikan overdue_hours bertipe number (jika null/kosong fallback ke 0)
  const overdueHours = Number(vehicle.overdue_hours) || 0;
  
  // 3. Cek apakah status kendaraan sedang disewa (rented), abaikan huruf besar/kecil
  const isRented = String(vehicle.status).toLowerCase() === 'rented';

  // 4. Terapkan 2 kondisi filter sesuai instruksi soal:
  // Kondisi A: Kendaraan telat dikembalikan (jam keterlambatan > 0)
  const isOverdue = overdueHours > 0;
  
  // Kondisi B: Kendaraan sedang disewa DAN bensin di bawah 20%
  const isLowFuel = isRented && !isNaN(parsedFuel) && parsedFuel < 20;

  // 5. Berikan tag/label peringatan berdasarkan kondisi yang terpenuhi
  const tags = [];
  if (isOverdue) {
    tags.push(`🚨 OVERDUE (+${overdueHours}h)`);
  }
  if (isLowFuel) {
    tags.push(`⚠️ LOW FUEL (${vehicle.fuel_level})`);
  }

  // 6. Tentukan tingkat keparahan (Urgency Level) untuk prioritas penanganan:
  // - CRITICAL: Sudah telat DAN bensin tipis (bahaya ganda!)
  // - HIGH: Telat dikembalikan (mengganggu jadwal penyewa berikutnya)
  // - MEDIUM: Bensin tipis (perlu diingatkan saat pengembalian)
  let urgencyLevel = 'NORMAL';
  if (isOverdue && isLowFuel) {
    urgencyLevel = 'CRITICAL';
  } else if (isOverdue) {
    urgencyLevel = 'HIGH';
  } else if (isLowFuel) {
    urgencyLevel = 'MEDIUM';
  }

  // Mengembalikan objek hasil analisis
  return {
    matches: isOverdue || isLowFuel, // True jika memenuhi salah satu dari 2 syarat filter
    tags,                            // Kumpulan tag emoji
    parsedFuel,                      // Nilai bensin berupa angka
    urgencyLevel                     // Tingkat keparahan (CRITICAL, HIGH, MEDIUM)
  };
}

/**
 * ============================================================================
 * FUNGSI 4: formatSlackAlert (Format Notifikasi untuk Slack Kantor)
 * ============================================================================
 * Menyusun pesan dengan sintaks Markdown Slack (*bold*, _italic_, > quote block).
 * Ditujukan untuk tim Operations Center / SRE yang memantau via laptop.
 *
 * @param {Array} triagedList - Daftar kendaraan yang bermasalah hasil filter
 * @returns {string} Teks pesan format Slack siap kirim ke Incoming Webhook
 */
function formatSlackAlert(triagedList) {
  const timestamp = getCurrentWitaTimestamp();
  const divider = '─'.repeat(54); // Garis pemisah visual

  // Header notifikasi Slack
  let message = `*📢 [EASY RENT BALI] FLEET OPS TRIAGE DISPATCH*\n`;
  message += `_Generated at: ${timestamp}_\n`;
  message += `_Attention required for *${triagedList.length} vehicle(s)*_\n`;
  message += `${divider}\n\n`;

  // Iterasi setiap kendaraan yang bermasalah
  triagedList.forEach((item, index) => {
    const { vehicle, evaluation } = item;
    const tagHeader = evaluation.tags.join(' | ');

    // Detail plat nomor, model, status, dan tag urgensi
    message += `*${index + 1}. ${vehicle.plate}* — _${vehicle.model}_\n`;
    message += `> *Status:* \`${vehicle.status.toUpperCase()}\` | *Fuel:* \`${vehicle.fuel_level}\` | *Overdue:* \`${vehicle.overdue_hours}h\`\n`;
    message += `> *Urgency:* ${tagHeader}\n`;
    
    // Rekomendasi aksi operasional sesuai tingkat keparahan
    message += `> *Action:* ${
      evaluation.urgencyLevel === 'CRITICAL'
        ? 'Contact customer immediately & dispatch recovery team with reserve fuel.'
        : evaluation.tags.some(t => t.includes('OVERDUE'))
        ? 'Initiate late return protocol & contact customer via WhatsApp.'
        : 'Notify return inspection team to refuel vehicle upon counter check-in.'
    }\n\n`;
  });

  // Footer notifikasi Slack
  message += `${divider}\n`;
  message += `_Easy Rent Bali Ops Center • Ground Dispatch Team Denpasar / Kuta / Ubud_`;
  return message;
}

/**
 * ============================================================================
 * FUNGSI 5: formatWhatsAppAlert (Format Notifikasi untuk WhatsApp Lapangan)
 * ============================================================================
 * Menyusun pesan dengan sintaks WhatsApp (*bold*, bullet point, instruksi bahasa Indonesia).
 * Ditujukan untuk staf lapangan (driver, kru counter bandara Ngurah Rai, tim penjemput).
 *
 * @param {Array} triagedList - Daftar kendaraan yang bermasalah hasil filter
 * @returns {string} Teks pesan format WhatsApp siap kirim ke Grup Operasional
 */
function formatWhatsAppAlert(triagedList) {
  const timestamp = getCurrentWitaTimestamp();

  // Header notifikasi WhatsApp
  let message = `🛵 *EASY RENT BALI - FLEET OPS ALERT* 🚗\n`;
  message += `📅 *Time:* ${timestamp}\n`;
  message += `⚠️ *Action Required:* ${triagedList.length} Vehicles Need Immediate Ops Intervention\n`;
  message += `==============================\n\n`;

  // Iterasi setiap kendaraan yang bermasalah
  triagedList.forEach((item, index) => {
    const { vehicle, evaluation } = item;
    const tags = evaluation.tags.join(' ');

    message += `*#${index + 1} | ${vehicle.plate}* (${vehicle.model})\n`;
    message += `• Status: *${vehicle.status.toUpperCase()}*\n`;
    message += `• Fuel Level: *${vehicle.fuel_level}*\n`;
    message += `• Overdue Hours: *${vehicle.overdue_hours}h*\n`;
    message += `• Flags: ${tags}\n`;
    message += `• Suggested Ops Action:\n`;

    // Instruksi tindakan praktis dalam Bahasa Indonesia untuk tim lapangan
    if (evaluation.urgencyLevel === 'CRITICAL') {
      message += `  👉 *URGENT:* Hubungi penyewa segera, siapkan tim penjemputan & jeriken bensin!\n\n`;
    } else if (evaluation.tags.some(t => t.includes('OVERDUE'))) {
      message += `  👉 Hubungi penyewa untuk konfirmasi perpanjangan atau penalti keterlambatan.\n\n`;
    } else {
      message += `  👉 Ingatkan penyewa ketentuan pengembalian bensin atau kenakan biaya refuel di counter.\n\n`;
    }
  });

  // Footer notifikasi WhatsApp
  message += `==============================\n`;
  message += `_Silakan tim lapangan (Kuta/Seminyak/Airport Ops) koordinasikan di thread ini._`;
  return message;
}

/**
 * ============================================================================
 * FUNGSI UTAMA: runTriage (Eksekutor Triage & Antarmuka CLI)
 * ============================================================================
 * Alur Kerja:
 * 1. Membaca argumen command-line (opsional: path file kustom atau filter format).
 * 2. Membaca file fleet_status.json dari disk.
 * 3. Melakukan parsing JSON secara aman (dengan penanganan error try/catch).
 * 4. Melakukan looping pada setiap kendaraan dan mengevaluasi kondisinya.
 * 5. Memisahkan armada ke dalam kelompok 'triaged' (bermasalah) dan 'safe' (aman).
 * 6. Mencetak metrik dan menampilkan pesan alert untuk Slack dan WhatsApp.
 */
function runTriage() {
  // Mengambil argumen tambahan dari CLI (misal: node triage.js --format=slack)
  const args = process.argv.slice(2);
  const inputFilePath = args.find(arg => !arg.startsWith('--')) || DEFAULT_INPUT_FILE;
  const formatArg = args.find(arg => arg.startsWith('--format='))?.split('=')[1] || 'all';

  console.log(`\n========================================================`);
  console.log(`  EASY RENT BALI - OPERATIONAL FLEET TRIAGE SYSTEM`);
  console.log(`========================================================`);
  console.log(`[INFO] Reading fleet data from: ${inputFilePath}`);

  // Validasi 1: Pastikan file input benar-benar ada di disk
  if (!fs.existsSync(inputFilePath)) {
    console.error(`[ERROR] File not found: ${inputFilePath}`);
    process.exit(1); // Keluar dengan status error (code 1)
  }

  // Validasi 2: Membaca dan mem-parsing JSON dengan perlindungan try-catch
  let fleetData;
  try {
    const rawContent = fs.readFileSync(inputFilePath, 'utf8');
    fleetData = JSON.parse(rawContent);
  } catch (err) {
    console.error(`[ERROR] Failed to parse JSON input: ${err.message}`);
    process.exit(1);
  }

  // Validasi 3: Pastikan struktur data berupa Array/List
  if (!Array.isArray(fleetData)) {
    console.error(`[ERROR] Fleet data must be an array of vehicle records.`);
    process.exit(1);
  }

  const triaged = []; // Menampung kendaraan yang memicu alarm
  const safe = [];    // Menampung kendaraan yang beroperasi normal

  // Looping untuk mengevaluasi setiap kendaraan dalam armada
  fleetData.forEach(vehicle => {
    const evaluation = evaluateVehicle(vehicle);
    if (evaluation.matches) {
      // Jika memenuhi kriteria filter, masukkan ke daftar alarm (triaged)
      triaged.push({ vehicle, evaluation });
    } else {
      // Jika tidak memenuhi kriteria, tandai sebagai aman (safe)
      safe.push(vehicle);
    }
  });

  // Tampilkan ringkasan metrik operasional di konsol
  console.log(`[METRICS] Total Fleet: ${fleetData.length} | Alert Triggered: ${triaged.length} | Normal: ${safe.length}\n`);

  // Jika tidak ada armada yang bermasalah, selesai tanpa dispatch alert
  if (triaged.length === 0) {
    console.log(`[OK] All vehicles are within operational safety thresholds. No alerts dispatched.`);
    return;
  }

  // Menampilkan format notifikasi Slack jika diminta
  if (formatArg === 'all' || formatArg === 'slack') {
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`[DISPATCH CHANNEL 1: SLACK WEBHOOK PAYLOAD]`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(formatSlackAlert(triaged));
    console.log();
  }

  // Menampilkan format notifikasi WhatsApp jika diminta
  if (formatArg === 'all' || formatArg === 'whatsapp') {
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`[DISPATCH CHANNEL 2: WHATSAPP OPS BROADCAST]`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(formatWhatsAppAlert(triaged));
    console.log();
  }

  console.log(`[SUCCESS] Triage completed successfully.`);
}

// Menjalankan fungsi runTriage jika file ini dieksekusi langsung dari terminal
if (require.main === module) {
  runTriage();
}

// Mengekspor fungsi-fungsi agar dapat diuji (Unit Testing) jika diperlukan
module.exports = {
  parseFuelLevel,
  evaluateVehicle,
  formatSlackAlert,
  formatWhatsAppAlert,
  runTriage
};
