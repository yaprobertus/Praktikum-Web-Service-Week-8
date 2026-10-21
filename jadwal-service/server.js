/**
 * SERVICE A — jadwal-service (port 3000)
 * Memegang data perjalanan kereta + status tiap kursi, dan menjadi SATU-SATUNYA
 * tempat yang boleh mengubah status kursi (AVAILABLE -> LOCKED -> BOOKED).
 *
 * Locking saat booking bersamaan:
 *  - Node.js berjalan single-thread dan fungsi lockKursi() sepenuhnya sinkron
 *    (tanpa await), jadi proses "cek semua kursi kosong lalu kunci" bersifat atomik.
 *    Dua request bersamaan ke kursi yang sama -> satu berhasil (201 di booking),
 *    yang lain mendapat 409.
 *  - Lock punya TTL (default 10 menit, sesuai rancangan keamanan; bisa diubah lewat LOCK_TTL_MS). Jika tidak dibayar, kursi otomatis
 *    kembali AVAILABLE.
 * Real-time: GET /:id/kursi/stream (Server-Sent Events) mendorong perubahan kursi.
 */
const express = require('express');
const crypto = require('crypto');

const app = express();
app.disable('x-powered-by');
app.use(express.json());

const PORT = process.env.PORT || 3000;
const LOCK_TTL_MS = Number(process.env.LOCK_TTL_MS) || 10 * 60 * 1000;
const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN || 'dev-internal-token';
const MAX_KURSI_PER_BOOKING = 4;

// ---------- Data (in-memory, cukup untuk praktikum) ----------
const PERJALANAN = [
  { id: 'KA-001', nama: 'Argo Bromo Anggrek', asal: 'Jakarta Gambir', tujuan: 'Surabaya Pasarturi', berangkat: '2026-11-10T08:20:00+07:00', tiba: '2026-11-10T16:30:00+07:00', kelas: 'Eksekutif', harga: 620000 },
  { id: 'KA-002', nama: 'Sancaka', asal: 'Yogyakarta', tujuan: 'Surabaya Gubeng', berangkat: '2026-11-10T07:00:00+07:00', tiba: '2026-11-10T11:40:00+07:00', kelas: 'Eksekutif', harga: 280000 },
  { id: 'KA-003', nama: 'Gajayana', asal: 'Malang', tujuan: 'Jakarta Gambir', berangkat: '2026-11-10T17:30:00+07:00', tiba: '2026-11-11T05:45:00+07:00', kelas: 'Eksekutif', harga: 560000 },
];

const KODE_KURSI = [];
for (let baris = 1; baris <= 10; baris++) for (const k of ['A', 'B', 'C', 'D']) KODE_KURSI.push(`${baris}${k}`);

// kursiMap: perjalananId -> Map(kodeKursi -> { status, lockId, expiresAt })
const kursiMap = new Map();
for (const p of PERJALANAN) {
  const m = new Map();
  for (const kode of KODE_KURSI) m.set(kode, { status: 'AVAILABLE', lockId: null, expiresAt: null });
  kursiMap.set(p.id, m);
}
// locks: lockId -> { perjalananId, kursi[], holder, expiresAt }
const locks = new Map();

// ---------- SSE (real-time) ----------
const subscribers = new Map(); // perjalananId -> Set(res)
for (const p of PERJALANAN) subscribers.set(p.id, new Set());

function snapshotKursi(perjalananId) {
  const m = kursiMap.get(perjalananId);
  const kursi = [...m.entries()].map(([kode, s]) => ({ kode, status: s.status }));
  return {
    perjalananId,
    tersedia: kursi.filter((k) => k.status === 'AVAILABLE').length,
    terkunci: kursi.filter((k) => k.status === 'LOCKED').length,
    terjual: kursi.filter((k) => k.status === 'BOOKED').length,
    kursi,
  };
}

function broadcast(perjalananId) {
  const subs = subscribers.get(perjalananId);
  if (!subs || subs.size === 0) return;
  const payload = `event: kursi\ndata: ${JSON.stringify(snapshotKursi(perjalananId))}\n\n`;
  for (const res of subs) res.write(payload);
}

// ---------- Logika locking ----------
function sweepExpired() {
  const now = Date.now();
  const changed = new Set();
  for (const [lockId, lock] of locks) {
    if (lock.expiresAt <= now) {
      const m = kursiMap.get(lock.perjalananId);
      for (const kode of lock.kursi) {
        const s = m.get(kode);
        if (s && s.status === 'LOCKED' && s.lockId === lockId) {
          m.set(kode, { status: 'AVAILABLE', lockId: null, expiresAt: null });
        }
      }
      locks.delete(lockId);
      changed.add(lock.perjalananId);
    }
  }
  for (const id of changed) broadcast(id);
}
setInterval(sweepExpired, 1000).unref();

function lockKursi(perjalananId, kursi, holder) {
  sweepExpired();
  const m = kursiMap.get(perjalananId);
  const konflik = kursi.filter((kode) => m.get(kode).status !== 'AVAILABLE');
  if (konflik.length > 0) return { ok: false, konflik };

  const lockId = crypto.randomUUID();
  const expiresAt = Date.now() + LOCK_TTL_MS;
  for (const kode of kursi) m.set(kode, { status: 'LOCKED', lockId, expiresAt });
  locks.set(lockId, { perjalananId, kursi, holder, expiresAt });
  broadcast(perjalananId);
  return { ok: true, lockId, expiresAt };
}

function confirmLock(lockId) {
  sweepExpired();
  const lock = locks.get(lockId);
  if (!lock) return { ok: false };
  const m = kursiMap.get(lock.perjalananId);
  for (const kode of lock.kursi) m.set(kode, { status: 'BOOKED', lockId: null, expiresAt: null });
  locks.delete(lockId);
  broadcast(lock.perjalananId);
  return { ok: true, perjalananId: lock.perjalananId, kursi: lock.kursi };
}

function releaseLock(lockId) {
  const lock = locks.get(lockId);
  if (!lock) return { ok: false };
  const m = kursiMap.get(lock.perjalananId);
  for (const kode of lock.kursi) {
    const s = m.get(kode);
    if (s && s.status === 'LOCKED' && s.lockId === lockId) {
      m.set(kode, { status: 'AVAILABLE', lockId: null, expiresAt: null });
    }
  }
  locks.delete(lockId);
  broadcast(lock.perjalananId);
  return { ok: true };
}

// ---------- Route publik (diakses klien lewat gateway: /jadwal/...) ----------
app.get('/health', (req, res) => res.json({ status: 'ok', service: 'jadwal-service' }));

app.get('/', (req, res) => {
  sweepExpired();
  const data = PERJALANAN.map((p) => {
    const s = snapshotKursi(p.id);
    return { ...p, kursiTersedia: s.tersedia, kursiTerkunci: s.terkunci, kursiTerjual: s.terjual };
  });
  res.json({ service: 'jadwal-service', jumlah: data.length, data });
});

app.get('/:id', (req, res) => {
  const p = PERJALANAN.find((x) => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Perjalanan tidak ditemukan' });
  sweepExpired();
  const s = snapshotKursi(p.id);
  res.json({ ...p, kursiTersedia: s.tersedia, kursiTerkunci: s.terkunci, kursiTerjual: s.terjual });
});

app.get('/:id/kursi', (req, res) => {
  if (!kursiMap.has(req.params.id)) return res.status(404).json({ error: 'Perjalanan tidak ditemukan' });
  sweepExpired();
  res.json(snapshotKursi(req.params.id));
});

// Real-time via Server-Sent Events
app.get('/:id/kursi/stream', (req, res) => {
  const subs = subscribers.get(req.params.id);
  if (!subs) return res.status(404).json({ error: 'Perjalanan tidak ditemukan' });
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.write(`event: kursi\ndata: ${JSON.stringify(snapshotKursi(req.params.id))}\n\n`);
  subs.add(res);
  const hb = setInterval(() => res.write(': ping\n\n'), 15000);
  req.on('close', () => {
    clearInterval(hb);
    subs.delete(res);
  });
});

// ---------- Route internal (hanya untuk booking-service, pakai token) ----------
function requireInternal(req, res, next) {
  const token = req.get('X-Internal-Token') || '';
  const a = Buffer.from(token);
  const b = Buffer.from(INTERNAL_TOKEN);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}

app.post('/internal/lock', requireInternal, (req, res) => {
  const { perjalananId, kursi, holder } = req.body || {};
  const p = PERJALANAN.find((x) => x.id === perjalananId);
  if (!p) return res.status(404).json({ error: 'Perjalanan tidak ditemukan' });
  if (!Array.isArray(kursi) || kursi.length === 0) {
    return res.status(400).json({ error: 'kursi harus berupa array berisi minimal 1 kode kursi' });
  }
  if (kursi.length > MAX_KURSI_PER_BOOKING) {
    return res.status(400).json({ error: `Maksimal ${MAX_KURSI_PER_BOOKING} kursi per booking` });
  }
  const unik = [...new Set(kursi.map((k) => String(k).toUpperCase()))];
  if (unik.length !== kursi.length) return res.status(400).json({ error: 'Kode kursi tidak boleh duplikat' });
  const tidakAda = unik.filter((k) => !KODE_KURSI.includes(k));
  if (tidakAda.length > 0) return res.status(400).json({ error: 'Kode kursi tidak valid', kursiTidakValid: tidakAda });

  const hasil = lockKursi(p.id, unik, holder || 'anonim');
  if (!hasil.ok) {
    return res.status(409).json({ error: 'Kursi sudah tidak tersedia', kursiBentrok: hasil.konflik });
  }
  res.status(201).json({
    lockId: hasil.lockId,
    expiresAt: new Date(hasil.expiresAt).toISOString(),
    perjalananId: p.id,
    kursi: unik,
    hargaPerKursi: p.harga,
    total: p.harga * unik.length,
  });
});

app.post('/internal/confirm', requireInternal, (req, res) => {
  const hasil = confirmLock((req.body || {}).lockId);
  if (!hasil.ok) return res.status(410).json({ error: 'Lock tidak ditemukan atau sudah kedaluwarsa' });
  res.json({ status: 'BOOKED', perjalananId: hasil.perjalananId, kursi: hasil.kursi });
});

app.post('/internal/release', requireInternal, (req, res) => {
  const hasil = releaseLock((req.body || {}).lockId);
  res.json({ released: hasil.ok });
});

// ---------- Error handling ----------
app.use((req, res) => res.status(404).json({ error: 'Route tidak ditemukan di jadwal-service' }));
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Body JSON tidak valid' });
  console.error(err);
  res.status(500).json({ error: 'Kesalahan internal server' });
});

app.listen(PORT, () => console.log(`jadwal-service berjalan di port ${PORT}`));
