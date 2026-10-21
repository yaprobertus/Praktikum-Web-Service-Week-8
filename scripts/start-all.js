// Menjalankan 3 proses sekaligus (jadwal-service :3000, booking-service :3001, gateway :8080)
// agar tidak perlu membuka tiga terminal. Tekan Ctrl+C untuk menghentikan semuanya.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const envFile = path.join(root, 'gateway', '.env');
if (!fs.existsSync(envFile)) {
  fs.copyFileSync(path.join(root, 'gateway', '.env.example'), envFile);
  console.log('[start-all] gateway/.env dibuat dari .env.example');
}

const procs = [
  { name: 'jadwal ', dir: 'jadwal-service', file: 'server.js' },
  { name: 'booking', dir: 'booking-service', file: 'server.js' },
  { name: 'gateway', dir: 'gateway', file: 'gateway.js' },
].map(({ name, dir, file }) => {
  const p = spawn(process.execPath, [file], { cwd: path.join(root, dir), env: process.env });
  const out = (d) => d.toString().trimEnd().split('\n').forEach((l) => console.log(`[${name}] ${l}`));
  p.stdout.on('data', out);
  p.stderr.on('data', out);
  p.on('exit', (code) => console.log(`[${name}] berhenti (kode ${code})`));
  return p;
});

const stop = () => { procs.forEach((p) => p.kill()); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
