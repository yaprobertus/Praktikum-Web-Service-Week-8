// Bukti rate limiting: 30 request beruntun ke gateway.
// Hasil yang diharapkan: 20 pertama = 200, sisanya = 429.
// Jalankan: node test-rate-limit.js   (butuh Node.js 18+; tunggu >10 detik jika baru saja menjalankannya)
const BASE = process.env.GATEWAY_URL || 'http://localhost:8080';
(async () => {
  for (let i = 1; i <= 30; i++) {
    const res = await fetch(`${BASE}/jadwal/`);
    console.log(i, res.status);
  }
})();
