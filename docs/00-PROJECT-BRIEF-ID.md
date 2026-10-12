# FaultWorks — Ringkasan Keputusan Proyek

**Tanggal:** 12 Oktober 2026  
**Status:** v0.1 sudah diimplementasikan dan teruji, lalu dipublikasikan sebagai open source di [`gmedia/fault-works`](https://github.com/gmedia/fault-works) dengan lisensi Apache-2.0 (12 Oktober 2026). Pemeriksaan merek dagang untuk nama FaultWorks belum dilakukan. Langkah berikutnya adalah pilot dengan 3–5 pengguna sesuai [rencana validasi](10-VALIDATION-PLAN.md).  
**Nama usulan:** FaultWorks by GMEDIA  
**Tagline:** Experiment with failure. Build more resilient systems.

## Kenapa proyek baru?

Failab lama merupakan prototype private di GitLab GMEDIA untuk presentasi kampus, terutama ide high availability dan kegagalan service. Kita **tidak mengasumsikan** struktur, hak cipta, atau detail implementasi lama karena source-nya belum direview. FaultWorks adalah proyek clean-room yang dirancang sejak awal sebagai open-source internasional. Konsep umum boleh menjadi inspirasi; jangan menyalin kode, diagram internal, secret, atau aset tanpa izin tertulis.

## Masalah pengguna

Diagram arsitektur memperlihatkan *apa yang terhubung* tetapi tidak selalu memperlihatkan *bagaimana sistem berperilaku* di bawah load, latency, dan kegagalan. Eksperimen real membutuhkan resource, waktu, serta isolasi. Simulator existing banyak yang bagus; nilai yang akan diuji oleh FaultWorks adalah **experiment-first workflow**: definisi skenario eksplisit, hasil reproducible, perbandingan A/B, batas asumsi, kemudian (jika layak) perbandingan dengan real sandbox.

## Hal yang diutamakan

1. **Satu eksperimen lengkap** lebih penting daripada katalog 30 node.
2. Engine deterministik, teruji, transparan, dan tidak terikat UI.
3. Tidak memerlukan server/backend untuk MVP; static hosting cukup.
4. Mode sandbox bukan simulasi: ia menjalankan software sungguhan dengan boundary keamanan berbeda.
5. Proyek memberi manfaat dari penggunaan pertama: built-in scenario *Load Balancer Failure*.
6. Tetap ada jalan untuk menghentikan proyek jika tidak ada pengguna yang memperoleh manfaat.

## Persona awal

- **Learner/engineer:** ingin melihat dampak desain dan parameter terhadap antrean, kegagalan, serta failover.
- **Mentor/instruktur:** ingin eksperimen yang bisa direproduksi peserta dan dibandingkan secara konsisten.
- **DevOps/SRE:** ingin diskusi desain dengan evidence sintetis, bukan prediksi pasti mengenai production.

## Janji produk yang jujur

> FaultWorks membantu menjalankan **eksperimen model** yang reproducible. Ia **tidak** menjamin bahwa metrik simulated sama dengan performance NGINX, HAProxy, PostgreSQL, atau environment produksi.

## Scope disepakati untuk v0.1

Client; load balancer; dua application servers; traffic konstan + burst sederhana; server crash terjadwal; health-check model yang eksplisit; event engine deterministik; error/success, p50/p95 latency, throughput, queue depth; perbandingan dua run; import/export skenario JSON. Di luar scope: Docker, real networking, multiplayer, LLM, auth, billing, database server, Kubernetes, klaim prediksi SLA/RTO.

## Ukuran keberhasilan pertama

Satu engineer atau peserta magang mampu, tanpa instruksi langsung dari pembuat, mengubah skenario dan **menjelaskan mengapa** dua hasilnya berbeda. Hasil simulasi yang sama (seed dan versi engine identik) harus menghasilkan artifacts identik; event conservation dan status lifecycle harus lulus test. Jika nilai edukasi atau eksperimen tidak terbukti, stop/ubah arah sebelum mode sandbox.

## Catatan perusahaan

Memakai nama GMEDIA, menerbitkan repo, memilih lisensi, atau mengekstraksi aset hasil kerja perusahaan butuh persetujuan pihak yang berwenang. **Status dokumen bukan authorization.** Branding final, namespace, domain, dan hak cipta harus diperiksa.
