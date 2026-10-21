/**
 * SERVICE B — booking-service (port 3001)
 * Membuat & mengelola booking tiket. Tidak menyimpan status kursi sendiri:
 * untuk mengunci / mengonfirmasi / melepas kursi ia memanggil jadwal-service.
 * Di belakang gateway, route ini diakses lewat /booking/* dan DILINDUNGI API key.
 *
 * Alur status booking:
 *  MENUNGGU_PEMBAYARAN --bayar--> LUNAS
 *                      --batal--> DIBATALKAN
 *                      --lewat batas waktu--> KEDALUWARSA
 */
const express = require('express');
const crypto = require('crypto');

const app = express();
app.disable('x-powered-by');
app.use(express.json());

const PORT = process.env.PORT || 3001;
const JADWAL_URL = (process.env.JADWAL_URL || 'http://localhost:3000').replace(/\/+$/, '');
const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN || 'dev-internal-token';

const bookings = new Map(); // id -> booking
const idempotency = new Map(); // Idempotency-Key -> Promise<{status, body}>

async function panggilJadwal(path, body) {
  const resp = await fetch(`${JADWAL_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Internal-Token': INTERNAL_TOKEN },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  let data = {};
  try { data = await resp.json(); } catch { /* body kosong */ }
  return { status: resp.status, data };
}

function tandaiKedaluwarsaJikaPerlu(b) {
  if (b.status === 'MENUNGGU_PEMBAYARAN' && Date.now() > new Date(b.batasBayar).getTime()) {
    b.status = 'KEDALUWARSA';
    b.diperbarui = new Date().toISOString();
  }
  return b;
}

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'booking-service' }));

// GET / -> daftar booking (opsional ?status=LUNAS)
app.get('/', (req, res) => {
  let data = [...bookings.values()].map(tandaiKedaluwarsaJikaPerlu);
  if (req.query.status) data = data.filter((b) => b.status === String(req.query.status).toUpperCase());
  res.json({ service: 'booking-service', jumlah: data.length, data });
});

// POST / -> buat booking (mengunci kursi)
// Header opsional "Idempotency-Key": request ulang dengan key yang sama
// mengembalikan hasil yang sama dan TIDAK membuat booking/lock ganda.
app.post('/', async (req, res) => {
  const key = req.get('Idempotency-Key');
  if (!key) {
    const hasil = await buatBooking(req.body);
    return res.status(hasil.status).json(hasil.body);
  }
  if (key.length > 100) return res.status(400).json({ error: 'Idempotency-Key maksimal 100 karakter' });
  let promise = idempotency.get(key);
  const ulang = Boolean(promise);
  if (!promise) {
    promise = buatBooking(req.body);
    idempotency.set(key, promise);
  }
  const hasil = await promise;
  if (hasil.status >= 500) idempotency.delete(key); // kegagalan sementara boleh dicoba lagi
  if (ulang) res.set('Idempotent-Replayed', 'true');
  res.status(hasil.status).json(hasil.body);
});

function resp(status, body) { return { status, body }; }

async function buatBooking(body) {
  const { perjalananId, kursi, penumpang } = body || {};
  if (!perjalananId || typeof perjalananId !== 'string') {
    return resp(400, { error: 'perjalananId wajib diisi (contoh: "KA-001")' });
  }
  if (!Array.isArray(kursi) || kursi.length === 0) {
    return resp(400, { error: 'kursi wajib berupa array, contoh: ["1A","1B"]' });
  }
  if (!penumpang || typeof penumpang.nama !== 'string' || penumpang.nama.trim() === '') {
    return resp(400, { error: 'penumpang.nama wajib diisi' });
  }

  const id = 'BK-' + crypto.randomBytes(4).toString('hex').toUpperCase();
  try {
    const lock = await panggilJadwal('/internal/lock', {
      perjalananId,
      kursi,
      holder: penumpang.nama.trim(),
    });
    if (lock.status !== 201) {
      // teruskan alasan dari jadwal-service (400 / 404 / 409)
      const status = [400, 404, 409].includes(lock.status) ? lock.status : 502;
      return resp(status, lock.data.error ? lock.data : { error: 'Gagal mengunci kursi' });
    }
    const b = {
      id,
      status: 'MENUNGGU_PEMBAYARAN',
      perjalananId,
      kursi: lock.data.kursi,
      penumpang: { nama: penumpang.nama.trim() },
      total: lock.data.total,
      batasBayar: lock.data.expiresAt,
      lockId: lock.data.lockId,
      dibuat: new Date().toISOString(),
      diperbarui: new Date().toISOString(),
    };
    bookings.set(id, b);
    return resp(201, b);
  } catch (err) {
    console.error('Gagal menghubungi jadwal-service:', err.message);
    return resp(502, { error: 'jadwal-service tidak dapat dihubungi' });
  }
}

app.get('/:id', (req, res) => {
  const b = bookings.get(req.params.id);
  if (!b) return res.status(404).json({ error: 'Booking tidak ditemukan' });
  res.json(tandaiKedaluwarsaJikaPerlu(b));
});

// POST /:id/bayar -> simulasi pembayaran, kursi menjadi BOOKED
app.post('/:id/bayar', async (req, res) => {
  const b = bookings.get(req.params.id);
  if (!b) return res.status(404).json({ error: 'Booking tidak ditemukan' });
  tandaiKedaluwarsaJikaPerlu(b);
  if (b.status === 'KEDALUWARSA') {
    await panggilJadwal('/internal/release', { lockId: b.lockId }).catch(() => {});
    return res.status(410).json({ error: 'Batas waktu pembayaran sudah lewat, silakan booking ulang' });
  }
  if (b.status !== 'MENUNGGU_PEMBAYARAN') {
    return res.status(409).json({ error: `Booking berstatus ${b.status}, tidak bisa dibayar` });
  }
  try {
    const r = await panggilJadwal('/internal/confirm', { lockId: b.lockId });
    if (r.status === 410) {
      b.status = 'KEDALUWARSA';
      b.diperbarui = new Date().toISOString();
      return res.status(410).json({ error: 'Kursi sudah dilepas karena waktu habis, silakan booking ulang' });
    }
    if (r.status !== 200) return res.status(502).json({ error: 'Gagal mengonfirmasi kursi' });
    b.status = 'LUNAS';
    b.dibayar = new Date().toISOString();
    b.diperbarui = b.dibayar;
    res.json(b);
  } catch (err) {
    console.error('Gagal menghubungi jadwal-service:', err.message);
    res.status(502).json({ error: 'jadwal-service tidak dapat dihubungi' });
  }
});

// POST /:id/batal -> batalkan booking yang belum dibayar, kursi dilepas
app.post('/:id/batal', async (req, res) => {
  const b = bookings.get(req.params.id);
  if (!b) return res.status(404).json({ error: 'Booking tidak ditemukan' });
  tandaiKedaluwarsaJikaPerlu(b);
  if (b.status !== 'MENUNGGU_PEMBAYARAN') {
    return res.status(409).json({ error: `Booking berstatus ${b.status}, tidak bisa dibatalkan` });
  }
  try {
    await panggilJadwal('/internal/release', { lockId: b.lockId });
    b.status = 'DIBATALKAN';
    b.diperbarui = new Date().toISOString();
    res.json(b);
  } catch (err) {
    console.error('Gagal menghubungi jadwal-service:', err.message);
    res.status(502).json({ error: 'jadwal-service tidak dapat dihubungi' });
  }
});

app.use((req, res) => res.status(404).json({ error: 'Route tidak ditemukan di booking-service' }));
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Body JSON tidak valid' });
  console.error(err);
  res.status(500).json({ error: 'Kesalahan internal server' });
});

app.listen(PORT, () => console.log(`booking-service berjalan di port ${PORT}`));
