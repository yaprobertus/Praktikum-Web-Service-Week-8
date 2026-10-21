# PANDUAN LENGKAP (untuk pemula)

Isi: A. Menjalankan lokal · B. Postman dari nol · C. Bukti rate limiting · D. Push ke GitHub · E. Deploy ke Railway · F. Cara mengumpulkan tugas · G. Jika ada error

---

## A. Menjalankan di komputer sendiri

1. Pasang **Node.js versi LTS (18 ke atas)** dari https://nodejs.org. Cek di terminal: `node -v`.
2. Ekstrak zip, lalu buka terminal di folder `proyek-kelompok` (di VS Code: menu Terminal, New Terminal).
3. Jalankan sekali saja:
   ```bash
   npm run install:all
   ```
4. Jalankan semuanya:
   ```bash
   npm run start:all
   ```
   Harus muncul tiga baris: `jadwal-service berjalan di port 3000`, `booking-service berjalan di port 3001`, `Gateway berjalan di port 8080`.
   Biarkan terminal ini terbuka. Berhenti dengan `Ctrl + C`.
5. Cek di browser: buka http://localhost:8080/jadwal/ . Harus tampil data 3 kereta.

Perintah `start:all` otomatis membuat `gateway/.env` dari `.env.example` (berisi API key bawaan untuk lokal).
Untuk cara tiga terminal sesuai modul, lihat README.md.

---

## B. Postman dari nol

### B1. Pasang dan buka Postman
1. Unduh Postman dari https://www.postman.com/downloads lalu pasang. Boleh pakai akun gratis atau pilih "Skip and go to the app" bila ada.
2. Pastikan langkah A sudah berjalan (terminal masih menampilkan 3 server hidup).

### B2. Impor koleksi dan environment
1. Klik tombol **Import** (pojok kiri atas).
2. **Drag and drop** tiga file dari folder `postman/` sekaligus:
   `reservasi-kereta.postman_collection.json`, `lokal.postman_environment.json`, `deploy-railway.postman_environment.json`.
3. Klik **Import**. Di sisi kiri tab **Collections** muncul "Reservasi Kereta - Lab 08 API Gateway"; di tab **Environments** muncul "Lokal" dan "Deploy Railway".

### B3. Pilih environment (langkah yang sering terlupa)
Di **pojok kanan atas** ada dropdown "No Environment". Klik, pilih **Lokal**.
Environment menyimpan dua variabel: `baseUrl = http://localhost:8080` dan `apiKey`.
Nilai `apiKey` harus sama dengan `API_KEY` di `gateway/.env` (bawaan: `ganti-dengan-key-rahasia-kelompok`; tentu sebaiknya kalian ganti di keduanya).

### B4. Coba request satu per satu
1. Buka koleksi, folder **2. Service A - Jadwal (publik)**, klik **Daftar perjalanan**, tekan **Send**.
   Di bagian bawah harus tampil JSON data kereta dan status **200 OK**. Tab **Test Results** berisi centang hijau.
2. Folder **3. Service B - Booking**, jalankan berurutan dari atas:
   - **Tanpa API key (401)**: harus **401 Unauthorized**. Ini bukti pengecekan API key bekerja.
   - **Buat booking (kunci kursi)**: **201 Created**. Kursi dipilih acak otomatis.
   - **Booking kursi yang sama (409)**: **409 Conflict**. Ini bukti locking.
   - **Bayar booking (simulasi)**: **200**, status `LUNAS`.
   - Buka lagi **Peta kursi KA-002** di folder 2: jumlah kursi berubah menjadi `BOOKED`/`LOCKED`.
3. Cara cepat: klik kanan koleksi, **Run collection** akan menjalankan semua request berurutan dengan centang hijau.
   (Folder 4 sebaiknya dijalankan terpisah, lihat bagian C, karena sengaja memicu rate limit.)

### B5. Membuat request sendiri (supaya paham cara kerjanya)
1. Klik **+** (tab baru). Pilih method **POST**, isi URL `http://localhost:8080/booking`.
2. Tab **Headers**: tambahkan `X-API-Key` dengan nilai API key kalian, dan `Content-Type` = `application/json`.
3. Tab **Body**, pilih **raw**, ketik:
   ```json
   { "perjalananId": "KA-001", "kursi": ["7C"], "penumpang": { "nama": "Nama Kamu" } }
   ```
4. Tekan **Send**. Hapus header `X-API-Key` lalu Send lagi: hasilnya berubah menjadi 401.

### B6. Screenshot untuk tugas
Tugas meminta screenshot Postman yang menunjukkan **kedua service diakses lewat satu port**. Ambil satu layar (atau dua) yang memperlihatkan:
- request `GET http://localhost:8080/jadwal/` (service A) dengan hasil 200, dan
- request `GET http://localhost:8080/booking` (service B) dengan hasil 200 saat memakai API key (dan 401 tanpa key, bila ingin menunjukkan tantangan opsional).
Pastikan URL `localhost:8080` terlihat jelas di kolom alamat.

---

## C. Bukti rate limiting (screenshot wajib)

**Cara 1 (sesuai modul)** - di terminal baru (bukan terminal server):
```bash
cd gateway
node test-rate-limit.js
```
Hasil yang benar: baris `1 200` sampai `20 200`, lalu `21 429` sampai `30 429`. Screenshot seluruh output.
Bila hasil 429 muncul dari baris pertama, itu karena kamu baru saja menjalankannya: tunggu lebih dari 10 detik lalu ulangi.

**Cara 2 (via Postman, opsional)**: klik kanan folder **4. Bukti Rate Limiting**, **Run folder**, isi **Iterations = 30**, **Delay = 0**, klik **Run**. 20 request pertama 200, sisanya 429.

---

## D. Push ke GitHub

1. Buat repository kosong di https://github.com/new (mis. `reservasi-kereta`), jangan centang README.
2. Di folder `proyek-kelompok`:
   ```bash
   git init
   git add .
   git status
   ```
   Periksa daftar: **tidak boleh ada** `.env` atau `node_modules` (keduanya sudah diabaikan oleh `.gitignore`).
   ```bash
   git commit -m "Lab 08: API gateway reservasi kereta"
   git branch -M main
   git remote add origin https://github.com/USERNAME/reservasi-kereta.git
   git push -u origin main
   ```
3. Tautan repository inilah yang dikumpulkan (berisi `gateway/gateway.js` dan `gateway/package.json`).

---

## E. Deploy ke Railway (opsional di lab, tapi berguna untuk code freeze minggu 12)

### Kenapa Railway, bukan Vercel
Sistem ini menyimpan status kursi dan lock **di memori proses**. Vercel menjalankan fungsi serverless yang singkat dan bisa berjalan di banyak instance sekaligus, sehingga memori tidak dibagi dan hilang di antara pemanggilan: locking kursi akan rusak. Koneksi yang terbuka lama (Server-Sent Events, dan WebSocket/gRPC untuk kebutuhan kelompok lain) juga bukan kekuatan Vercel. Railway menjalankan aplikasi Node.js sebagai **proses yang terus hidup**, sama seperti di laptop, jadi cocok untuk gateway dan dua service ini.
Untuk gRPC di Railway: aku belum memverifikasinya; cek dokumentasi Railway (biasanya lewat TCP proxy) bila nanti kelompok memilih gRPC. GraphQL tidak ada masalah.

### Biaya (per dokumentasi Railway saat panduan ini dibuat, Oktober 2026)
Akun baru mendapat Trial dengan kredit sekali pakai $5 (30 hari). Setelah itu turun ke plan Free dengan kredit $1 per bulan, atau Hobby $5 per bulan (termasuk kredit pemakaian $5). Tiga service kecil kemungkinan melebihi kredit $1, jadi siapkan opsi Hobby (patungan satu akun kelompok) untuk periode minggu 12 sampai UAS. Cek halaman pricing Railway untuk angka terbaru; mungkin juga diminta verifikasi akun.

### Langkah deploy (3 service dari 1 repository)
Siapkan dua nilai rahasia acak (jalankan dua kali di terminal, simpan hasilnya):
```bash
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```
Sebut hasil pertama `API_KEY` dan hasil kedua `INTERNAL_TOKEN`.

**1. jadwal-service**
1. Masuk https://railway.com dengan akun GitHub, **New Project**, **Deploy from GitHub repo**, pilih repository kalian (izinkan akses bila diminta).
2. Klik service yang terbentuk, buka **Settings**, bagian **Source**, isi **Root Directory** = `/jadwal-service`. Ganti nama service menjadi `jadwal-service`.
3. Tab **Variables**, tambah: `INTERNAL_TOKEN` = (nilai kedua). **Jangan** menambah `PORT` (Railway mengisi sendiri).
4. **Settings**, bagian **Networking**, klik **Generate Domain**. Catat URL-nya, mis. `https://jadwal-service-production.up.railway.app`.
5. Tunggu deployment berstatus hijau. Tes di browser: `URL-nya/health` harus menampilkan `{"status":"ok",...}`.

**2. booking-service**
1. Di project yang sama: **+ New**, **GitHub Repo**, pilih repository yang sama. Root Directory = `/booking-service`. Nama: `booking-service`.
2. Variables: `JADWAL_URL` = URL jadwal-service (tanpa garis miring di akhir), `INTERNAL_TOKEN` = nilai kedua (harus sama).
3. Generate Domain, catat URL-nya, tes `/health`.

**3. gateway**
1. **+ New**, **GitHub Repo**, repository yang sama. Root Directory = `/gateway`. Nama: `gateway`.
2. Variables:
   - `SERVICE_A_URL` = URL jadwal-service
   - `SERVICE_B_URL` = URL booking-service
   - `API_KEY` = nilai pertama
3. Generate Domain. Inilah **satu URL publik sistem**. Start command otomatis `npm start` (= `node gateway.js`).
4. Tes: `https://URL-gateway/jadwal/` harus menampilkan data kereta.

**4. Uji lewat Postman**: di Postman buka **Environments, Deploy Railway**, isi `baseUrl` (URL gateway) dan `apiKey` (nilai pertama), simpan, pilih environment itu di pojok kanan atas, lalu jalankan koleksi seperti bagian B.

### Hal yang perlu diingat setelah deploy
- Service harus tetap **1 replica**; jangan menaikkan jumlah instance (status kursi ada di memori).
- Setiap redeploy/restart mengosongkan data booking dan kursi. Untuk UAS, ganti ke database/Redis.
- Domain jadwal-service dan booking-service juga publik (karena gateway memanggilnya lewat URL publik). Untuk pengamanan lanjutan nanti, bisa memakai private networking Railway agar hanya gateway yang bisa menjangkaunya. Itu tidak diwajibkan di lab ini.
- Jangan memasukkan `API_KEY` ke GitHub. Isi hanya lewat tab Variables.

---

## F. Mengumpulkan tugas (dikumpulkan sebelum lab 09)

| Yang diminta | Dari mana |
|---|---|
| 1. Tautan repository berisi `gateway.js` dan `package.json` | Bagian D |
| 2. Screenshot Postman, dua service lewat satu port | Bagian B6 |
| 3. Screenshot output `test-rate-limit.js` (200 lalu 429) | Bagian C |
| 4. Diagram arsitektur sederhana | `docs/arsitektur.png` (boleh dibuat ulang dengan gaya kelompok) |
| Refleksi 3-4 kalimat | `docs/refleksi.md` (ubah dengan kalimat kelompok sendiri) |

Checklist kesiapan modul:
- [x] Dua service diakses lewat satu port gateway (8080)
- [x] Rate limiting terbukti (429 setelah batas)
- [x] Gateway jalan dengan `node gateway.js`, URL service dari environment variable
- [x] Tidak ada secret di repository (`.env` diabaikan git)
- [x] (Opsional) API key: 401 tanpa header, 200 dengan header benar

---

## G. Jika ada error

| Gejala | Penyebab dan solusi |
|---|---|
| `EADDRINUSE: address already in use :::8080` | Port dipakai proses lain (mungkin server lama belum berhenti). Tutup terminal lama atau tekan Ctrl+C, lalu jalankan ulang. |
| Postman: `Could not get response` / `ECONNREFUSED` | Server belum jalan. Jalankan `npm run start:all`. |
| Postman 401 padahal sudah isi key | Environment belum dipilih (pojok kanan atas), atau `apiKey` berbeda dengan `API_KEY` di `gateway/.env`. |
| `504` dari gateway | Salah satu service mati atau URL/port salah. Cek terminal service tersebut. Saat deploy, cek `SERVICE_A_URL`/`SERVICE_B_URL`. |
| `429` terus-menerus | Normal setelah banyak request. Tunggu 10 detik. |
| Booking 409 terus | Kursi memang sedang terkunci (10 menit) atau sudah dibeli. Pilih kursi lain atau restart server (data kembali kosong). |
| `npm: command not found` | Node.js belum terpasang atau terminal belum dibuka ulang setelah instalasi. |
