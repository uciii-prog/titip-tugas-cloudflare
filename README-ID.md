# Titip Tugas — satu QR untuk banyak guru (Cloudflare)

Ini project awal untuk portal pengumpulan tugas dengan satu URL/QR. Guru menghubungkan Google Drive sendiri, menerima kode unik, lalu siswa memasukkan kode tersebut dan mengunggah PDF/foto ke Drive guru terkait.

**Biaya:** Cloudflare Workers dan D1 memiliki paket gratis dengan batas penggunaan. Google OAuth tidak mengenakan biaya langsung untuk alur ini, tetapi aturan verifikasi Google OAuth dapat berlaku. Kuota dan syarat layanan bisa berubah.

## Peringatan jujur

Ini starter code yang perlu dikonfigurasi dan diuji, bukan website yang sudah dipublikasikan. Tidak mungkin aman menjalankan integrasi Google Drive pribadi hanya dengan mengunggah HTML statis. Bagian Worker ini adalah backend yang mengarahkan file ke Drive guru.

Jangan gunakan dengan tugas siswa sungguhan sebelum uji keamanan, privasi, dan ketahanan penyimpanan. Kode ini belum mencakup CAPTCHA, panel pengelola untuk menyetujui guru, penghapusan akun, pengelolaan persetujuan privasi, backup, atau perlindungan spam tingkat produksi.

## Berkas

- `public/` — tampilan website siswa
- `src/worker.js` — backend OAuth, pemetaan kode guru, dan upload ke Drive
- `migrations/0001_init.sql` — tabel database
- `wrangler.toml` — konfigurasi Cloudflare

## Jalur gratis (perlu pengaturan sekali)

1. Buat akun Cloudflare dan buka Workers & Pages.
2. Buat aplikasi Worker bernama `titip-tugas`; sambungkan project ini melalui GitHub atau deploy menggunakan Wrangler.
3. Buat database D1 bernama `titip-tugas-db`; salin database ID ke `wrangler.toml`, lalu jalankan migration SQL.
4. Buat project di Google Cloud Console dan aktifkan Google Drive API.
5. Atur OAuth consent screen dan buat OAuth Client ID jenis Web application.
6. Setelah Worker ter-deploy, tambahkan Authorized redirect URI persis:
   `https://NAMA-WORKER.AKUN-ANDA.workers.dev/auth/callback`
7. Tambahkan environment variables/secrets di pengaturan Worker:
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   - `TOKEN_ENCRYPTION_KEY` = Base64 dari 32 byte acak (jangan pakai contoh publik)
8. Pastikan OAuth redirect URI di Worker cocok dengan URL di Google Cloud.
9. Uji sambungkan dua akun guru berbeda dan kirim file contoh. Pastikan tiap file muncul pada Drive akun yang tepat.
10. Baru setelah lolos uji, buat satu QR dari URL utama Worker, misalnya `https://NAMA-WORKER.AKUN-ANDA.workers.dev/`.

### Membuat kunci enkripsi Base64

Gunakan generator kriptografis tepercaya untuk membuat 32 byte acak lalu encode ke Base64. Simpan sebagai secret di Cloudflare, jangan ditaruh di file kode publik atau GitHub.

### Google OAuth — catatan penting

Untuk pengujian, masukkan akun guru sebagai test users pada OAuth consent screen. Aplikasi eksternal dalam mode Testing dapat membuat refresh token kedaluwarsa setelah 7 hari untuk scope selain dasar identitas. Untuk pemakaian berkelanjutan, atur status publikasi dan verifikasi sesuai persyaratan Google yang berlaku; mungkin ada langkah tambahan sebelum penggunaan luas. Jangan menjanjikan kepada guru bahwa koneksi akan permanen sampai diuji.

### Catatan implementasi yang wajib ditinjau

- `TOKEN_ENCRYPTION_KEY` harus berupa Base64 valid dari 32 byte, bukan string sembarang.
- OAuth callback memakai redirect URI yang sama persis dengan Google Cloud. Set `GOOGLE_REDIRECT_URI` ke URL callback Worker.
- Perlu rate limit untuk upload, validasi tipe file lebih kuat, pembatasan ukuran dan kuota, serta panel admin untuk persetujuan guru sebelum dipublikasikan.
- D1 persisten, tetapi file disimpan di Drive guru. Buat backup database dan prosedur pemulihan.
- Folder baru dibuat saat guru menghubungkan Drive; file akan diunggah ke folder tersebut.
- Jika guru mencabut akses Google atau menghapus folder, pengiriman berikutnya bisa gagal dan harus disambungkan ulang.
