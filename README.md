# Alinkvault

**Vault tautan pribadi bertema glassmorphism.** Simpan, rapikan, dan temukan tautan favoritmu dalam satu tempat — offline, tanpa akun, tanpa server.

<p>
  <img alt="Android" src="https://img.shields.io/badge/Android-7.0%2B-3ddc84?logo=android&logoColor=white">
  <img alt="Offline" src="https://img.shields.io/badge/100%25-offline-45e0e6">
  <img alt="Lisensi" src="https://img.shields.io/badge/lisensi-MIT-8b7bff">
</p>

## ⬇️ Download APK

**[Unduh Alinkvault.apk](https://github.com/Alfiandi-ux/Alinkvault/releases/latest/download/Alinkvault.apk)**

Buka berkas APK di HP Android, izinkan *instal dari sumber ini* bila diminta, lalu tekan **Instal**.

> Butuh Android 7.0 (API 24) atau lebih baru. APK dibangun otomatis oleh GitHub Actions setiap kali ada perubahan di `main` dan setiap rilis tag `v*`.

## ✨ Fitur

- **Glassmorphism asli** — panel kaca buram, aurora lembut, dan grain halus. Tema **gelap, terang, dan otomatis**.
- **Simpan lengkap** — URL, judul, catatan singkat, koleksi, tag, dan tanda favorit.
- **Pencarian instan** — cari judul, domain, catatan, koleksi, atau tag sambil mengetik.
- **Filter & urutan** — filter per koleksi; urutkan terbaru, terlama, A–Z, atau favorit dulu.
- **Halaman koleksi** — lihat semua koleksi sebagai kartu, lalu masuk ke salah satunya.
- **Aksi cepat** — buka, salin, edit, hapus (dengan *urungkan*), dan bintangi tautan.
- **Tempel dari clipboard** — isi URL otomatis dari papan klip.
- **Cadangan JSON** — ekspor seluruh vault, impor kembali dengan penggabungan aman (tanpa duplikat).
- **100% lokal** — data disimpan di `localStorage` perangkat. Tidak ada akun, sinkronisasi, atau pelacakan.
- **Offline-first** — PWA dengan service worker; APK membungkus aset secara lokal.
- **Ringan & tanpa iklan** — WebView native, tanpa pustaka UI berat.

## 🧊 Tampilan

Tema gelap adalah tampilan utama: latar biru-malam dengan orb violet, sian, dan merah muda, kartu kaca dengan kilau diagonal, serta tipografi rapat yang tenang. Tema terang memakai kaca putih susu di atas lavender pastel.

## 🚀 Menjalankan versi web

```bash
./serve.sh          # http://localhost:8090
```

Atau layani folder ini dengan server statis apa pun. Karena memakai service worker, gunakan `http://localhost` atau HTTPS (bukan `file://`).

## 🛠️ Struktur proyek

```
.
├── index.html                 # shell aplikasi + sprite ikon
├── assets/
│   ├── styles.css             # tema glassmorphism & responsif
│   └── app.js                 # state, filter, editor, impor/ekspor
├── manifest.webmanifest       # PWA (nama, ikon, shortcut)
├── sw.js                      # service worker offline-first
├── icon.svg                   # ikon master
├── icon-*.png                 # ikon PWA & Apple
├── tools/gen_icons.py         # pembuat ulang seluruh ikon (PIL)
└── android/                   # wrapper WebView native
    ├── app/src/main/java/...  # MainActivity + jembatan JS
    ├── app/src/main/res/      # tema, layout, mipmap
    └── scripts/               # bantuan penandatanganan
```

## 📱 Build APK

### Otomatis (disarankan)

Workflow [`.github/workflows/build-apk.yml`](.github/workflows/build-apk.yml) berjalan saat push ke `main`, tag `v*`, atau manual dari tab **Actions**.

- Push ke `main` → memperbarui rilis bergulir **`latest-build`**.
- Push tag `v1.0.0` → membuat rilis versi + aset `Alinkvault.apk`.

```bash
git tag v1.0.0
git push origin v1.0.0
```

### Lokal

Prasyarat: JDK 17, Android SDK (platform 34 + build-tools), Gradle 8.5.

```bash
cd android
gradle assembleDebug      # APK debug, tanpa keystore rilis
# hasil: app/build/outputs/apk/debug/app-debug.apk

gradle assembleRelease    # butuh keystore rilis
# hasil: app/build/outputs/apk/release/app-release.apk
```

Aset web otomatis disalin ke `app/src/main/assets` oleh task `syncWebAssets`.

## 🔐 Menandatangani APK rilis

APK rilis harus memakai kunci yang konsisten agar pembaruan bisa dipasang di atas versi lama.

1. Buat keystore (sekali saja, simpan baik-baik):

   ```bash
   mkdir -p android/keystore
   keytool -genkeypair -v \
     -keystore android/keystore/release.jks \
     -alias alinkvault \
     -keyalg RSA -keysize 2048 -validity 10000
   ```

2. Salin `android/keystore.properties.example` menjadi `android/keystore.properties`, lalu isi sandi dan alias. Berkas ini **diabaikan git**.

3. Untuk CI, atur empat **GitHub Secrets** (Settings → Secrets and variables → Actions):

   | Secret | Isi |
   | --- | --- |
   | `ALINKVAULT_KEYSTORE_BASE64` | hasil `base64 -w0 android/keystore/release.jks` |
   | `ALINKVAULT_KEYSTORE_PASSWORD` | sandi keystore |
   | `ALINKVAULT_KEY_ALIAS` | `alinkvault` |
   | `ALINKVAULT_KEY_PASSWORD` | sandi kunci |

   Atau jalankan `./android/scripts/signing-secrets.sh` untuk mencetak semua nilainya.

> Tanpa secrets, workflow tetap menghasilkan APK yang bisa dipasang, tetapi ditandatangani dengan kunci sementara — pembaruan berikutnya bisa meminta instal ulang.

## 🔒 Privasi

- Seluruh tautan, catatan, dan pengaturan tersimpan di perangkat lewat `localStorage`.
- Aplikasi tidak mengirim data ke server mana pun.
- Satu-satunya permintaan jaringan adalah **favicon** situs (Google, dengan cadangan DuckDuckGo). Jika offline atau gagal, kartu menampilkan huruf domain.
- Izin Android yang diminta hanya `INTERNET` (favicon). Impor/ekspor memakai pemilih berkas sistem tanpa izin penyimpanan.

## 🧪 Tips pemakaian

- Tekan `/` untuk fokus ke pencarian dan `N` untuk tautan baru (desktop).
- Tempel beberapa tautan sekaligus lewat cadangan JSON, atau satu per satu dengan tombol **Tempel**.
- Gunakan koleksi untuk konteks besar (Kerja, Belajar, Inspirasi) dan tag untuk detail kecil.
- Ekspor cadangan sebelum mengosongkan vault atau berpindah perangkat.

## 📄 Lisensi

[MIT](LICENSE) © 2026 Alfiandi

---

Dibuat dengan HTML, CSS, dan JavaScript vanilla — lalu dibungkus WebView Android yang ringan.
