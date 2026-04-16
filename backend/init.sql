-- ============================================================
-- SehatKu - Database Schema
-- ============================================================

CREATE DATABASE IF NOT EXISTS sehatku;
USE sehatku;

-- Users
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nama VARCHAR(100) NOT NULL,
  email VARCHAR(150) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  role ENUM('masyarakat','admin','petugas') DEFAULT 'masyarakat',
  no_hp VARCHAR(20),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Puskesmas
CREATE TABLE IF NOT EXISTS puskesmas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nama VARCHAR(150) NOT NULL,
  alamat TEXT,
  kecamatan VARCHAR(100),
  telepon VARCHAR(20),
  jam_buka TIME,
  jam_tutup TIME,
  kuota_harian INT DEFAULT 50,
  aktif TINYINT(1) DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Bookings
CREATE TABLE IF NOT EXISTS bookings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  puskesmas_id INT NOT NULL,
  tanggal DATE NOT NULL,
  jenis_layanan VARCHAR(100),
  keluhan TEXT NOT NULL,
  status ENUM('menunggu','dikonfirmasi','selesai','dibatalkan') DEFAULT 'menunggu',
  nomor_antrian INT,
  catatan_petugas TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (puskesmas_id) REFERENCES puskesmas(id)
);

-- Laporan Kesehatan Lingkungan
CREATE TABLE IF NOT EXISTS laporan (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  judul VARCHAR(200) NOT NULL,
  deskripsi TEXT NOT NULL,
  lokasi VARCHAR(200),
  kategori ENUM('sanitasi','wabah','pencemaran','gizi','lainnya') DEFAULT 'lainnya',
  foto_url VARCHAR(500),
  status ENUM('diproses','ditindaklanjuti','selesai') DEFAULT 'diproses',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Monitoring Penyakit
CREATE TABLE IF NOT EXISTS monitoring_penyakit (
  id INT AUTO_INCREMENT PRIMARY KEY,
  penyakit VARCHAR(150) NOT NULL,
  jumlah_kasus INT NOT NULL,
  wilayah VARCHAR(150) NOT NULL,
  tanggal DATE NOT NULL,
  keterangan TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ─── Seed Data ────────────────────────────────────────────────────────────────

-- Admin default (password: Admin@123)
INSERT IGNORE INTO users (nama, email, password, role) VALUES
('Administrator', 'admin@sehatku.id', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'admin');

-- Puskesmas sample
INSERT IGNORE INTO puskesmas (nama, alamat, kecamatan, telepon, jam_buka, jam_tutup, kuota_harian) VALUES
('Puskesmas Sukajaya', 'Jl. Raya Sukajaya No. 12', 'Sukajaya', '0811-0000-001', '07:30:00', '14:00:00', 60),
('Puskesmas Cibadak', 'Jl. Cibadak Raya No. 45', 'Cibadak', '0811-0000-002', '07:30:00', '14:00:00', 50),
('Puskesmas Bojong', 'Jl. Bojong Timur No. 8', 'Bojong', '0811-0000-003', '08:00:00', '15:00:00', 40);

-- Sample monitoring
INSERT IGNORE INTO monitoring_penyakit (penyakit, jumlah_kasus, wilayah, tanggal, keterangan) VALUES
('DBD', 12, 'Sukajaya', '2025-04-01', 'Peningkatan kasus di musim hujan'),
('ISPA', 45, 'Cibadak', '2025-04-05', 'Polusi udara meningkat'),
('Diare', 18, 'Bojong', '2025-04-08', 'Kualitas air bersih menurun'),
('DBD', 8, 'Sukajaya', '2025-04-12', 'Penyemprotan fogging dilakukan'),
('COVID-19', 3, 'Cibadak', '2025-04-13', 'Kasus baru ditemukan');
