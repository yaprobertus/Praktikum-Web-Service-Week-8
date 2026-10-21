// Bukti locking: 5 klien memesan kursi YANG SAMA secara bersamaan lewat gateway.
// Hasil yang diharapkan: tepat 1 request berstatus 201, sisanya 409.
// Jalankan: node test-concurrent-booking.js
// (butuh API_KEY: dibaca dari .env, atau set sendiri: API_KEY=xxx node test-concurrent-booking.js)
require('dotenv').config();
const BASE = process.env.GATEWAY_URL || 'http://localhost:8080';
const KEY = process.env.API_KEY;
if (!KEY) { console.error('API_KEY belum diisi (buat file .env dari .env.example).'); process.exit(1); }

(async () => {
  // pilih kursi acak supaya skrip bisa diulang tanpa bentrok dengan kursi yang sudah dikunci
  const kursi = `${1 + Math.floor(Math.random() * 10)}${'ABCD'[Math.floor(Math.random() * 4)]}`;
  console.log(`Memesan kursi ${kursi} di KA-002 oleh 5 klien bersamaan...\n`);
  const kirim = (n) => fetch(`${BASE}/booking`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': KEY },
    body: JSON.stringify({ perjalananId: 'KA-002', kursi: [kursi], penumpang: { nama: `Penumpang ${n}` } }),
  }).then((r) => r.status);
  const hasil = await Promise.all([1, 2, 3, 4, 5].map(kirim));
  hasil.forEach((s, i) => console.log(`Klien ${i + 1}: ${s}`));
  const ok = hasil.filter((s) => s === 201).length;
  console.log(`\n${ok === 1 ? 'LULUS' : 'GAGAL'}: ${ok} booking berhasil (harus tepat 1).`);
  process.exit(ok === 1 ? 0 : 1);
})();
