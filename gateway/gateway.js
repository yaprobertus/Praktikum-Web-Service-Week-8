/**
 * API GATEWAY — Sistem Reservasi Tiket Kereta (Lab 08)
 *
 * Satu-satunya alamat yang diketahui klien (port 8080):
 *   rate limit  : maks. 20 request / 10 detik per IP
 *   cek API key : header X-API-Key, khusus route /booking
 *   routing     : /jadwal/*  -> SERVICE_A_URL (jadwal-service, default http://localhost:3000)
 *                 /booking/* -> SERVICE_B_URL (booking-service, default http://localhost:3001)
 *
 * Pemetaan terhadap modul praktikum:  service-a = jadwal-service,  service-b = booking-service
 */
// Sembunyikan peringatan DEP0060 (berasal dari dependency http-proxy, tidak berbahaya)
const _emit = process.emitWarning;
process.emitWarning = (w, ...a) => {
  const code = typeof a[0] === 'object' && a[0] ? a[0].code : a[1];
  if (code === 'DEP0060') return;
  return _emit.call(process, w, ...a);
};
require('dotenv').config();
const crypto = require('crypto');
const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const { rateLimit } = require('express-rate-limit');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // diperlukan saat di-deploy di balik proxy (mis. Railway)

// Health check (sebelum rate limit supaya pengecekan platform tidak ikut dibatasi)
app.get('/health', (req, res) => res.json({ status: 'ok', service: 'gateway' }));

// rate limit: maks. 20 request per 10 detik per alamat IP
app.use(rateLimit({
  windowMs: 10 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Terlalu banyak request, coba lagi beberapa detik lagi' },
}));

// Halaman info gateway
app.get('/', (req, res) => {
  res.json({
    service: 'api-gateway',
    sistem: 'Reservasi Tiket Kereta',
    routes: {
      '/jadwal/*': 'jadwal-service (publik)',
      '/booking/*': 'booking-service (wajib header X-API-Key)',
    },
    rateLimit: 'maks. 20 request / 10 detik per IP',
  });
});

// Cek API key (tantangan opsional lab, diterapkan pada /booking)
if (!process.env.API_KEY) {
  console.warn('PERINGATAN: API_KEY belum diisi, semua request ke /booking akan ditolak (401). Salin .env.example menjadi .env.');
}
const requireApiKey = (req, res, next) => {
  const expected = process.env.API_KEY;
  const given = req.get('X-API-Key') || '';
  let valid = false;
  if (expected) {
    const a = Buffer.from(given);
    const b = Buffer.from(expected);
    valid = a.length === b.length && crypto.timingSafeEqual(a, b);
  }
  if (!valid) return res.status(401).json({ error: 'Unauthorized' });
  next();
};
app.use('/booking', requireApiKey);

// Route internal jadwal-service tidak boleh diakses dari luar
app.use('/jadwal/internal', (req, res) => res.status(404).json({ error: 'Route tidak ditemukan' }));

// Helper: cocokkan tepat "/prefix" atau "/prefix/..." (bukan "/prefixxyz")
const cocok = (prefix) => (pathname) => pathname === prefix || pathname.startsWith(prefix + '/');
const hapusPrefix = (prefix) => (path) => path.replace(new RegExp('^' + prefix), '') || '/';

const onError = (err, req, res) => {
  console.error(`Proxy error (${req.method} ${req.originalUrl || req.url}):`, err.code || err.message);
  if (res && typeof res.writeHead === 'function' && !res.headersSent) {
    res.writeHead(504, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Gateway tidak dapat menjangkau service tujuan' }));
  }
};

// routing: /jadwal/* diteruskan ke service-a (jadwal-service)
app.use(createProxyMiddleware({
  pathFilter: cocok('/jadwal'),
  target: process.env.SERVICE_A_URL || 'http://localhost:3000',
  changeOrigin: true,
  pathRewrite: hapusPrefix('/jadwal'),
  on: { error: onError },
}));

// routing: /booking/* diteruskan ke service-b (booking-service)
app.use(createProxyMiddleware({
  pathFilter: cocok('/booking'),
  target: process.env.SERVICE_B_URL || 'http://localhost:3001',
  changeOrigin: true,
  pathRewrite: hapusPrefix('/booking'),
  on: { error: onError },
}));

app.use((req, res) => res.status(404).json({ error: 'Route tidak ditemukan' }));

app.listen(process.env.PORT || 8080, () => console.log(`Gateway berjalan di port ${process.env.PORT || 8080}`));
