# Refleksi Singkat (draft - sesuaikan dengan kata-kata kelompok sendiri)

Dengan gateway, klien (Postman, browser, atau aplikasi mobile) cukup mengetahui satu alamat saja, sehingga port dan
jumlah service di belakangnya bisa berubah tanpa memaksa klien ikut berubah. Gateway juga menjadi satu titik untuk
menerapkan rate limiting dan pengecekan API key, jadi aturan keamanan tidak perlu ditulis ulang di setiap service.
Namun, gateway menjadi single point of failure: jika gateway mati, seluruh sistem (jadwal maupun booking) tidak bisa
diakses klien walaupun kedua service di belakangnya masih sehat.
