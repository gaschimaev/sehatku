const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');              // ← pakai pg, bukan mysql2
const multer = require('multer');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// ─── S3 Client ────────────────────────────────────────────────────────────────
const s3 = new S3Client({ region: process.env.AWS_REGION });
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

// ─── PostgreSQL Pool ──────────────────────────────────────────────────────────
const pool = new Pool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  port: 5432,
  ssl: { rejectUnauthorized: false }   // wajib untuk RDS
});

// Test koneksi database saat server start
pool.connect((err, client, release) => {
  if (err) {
    console.error('❌ Gagal konek ke database:', err.message);
  } else {
    console.log('✅ Berhasil konek ke PostgreSQL RDS');
    release();
  }
});

// ─── Auth Middleware ──────────────────────────────────────────────────────────
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token diperlukan' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token tidak valid' });
  }
}

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date() });
});

// ─── REGISTER ─────────────────────────────────────────────────────────────────
app.post('/api/auth/register', async (req, res) => {
  const { nama, email, password, role = 'masyarakat', no_hp } = req.body;
  if (!nama || !email || !password)
    return res.status(400).json({ error: 'Data tidak lengkap' });
  try {
    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (nama, email, password, role, no_hp)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [nama, email, hash, role, no_hp]
    );
    // ↑ PostgreSQL pakai $1,$2,$3 bukan ?
    // ↑ pakai RETURNING id untuk ambil id yang baru dibuat
    res.status(201).json({
      message: 'Registrasi berhasil',
      id: result.rows[0].id    // ← PostgreSQL pakai .rows[0]
    });
  } catch (e) {
    if (e.code === '23505')    // ← kode duplikat di PostgreSQL (bukan ER_DUP_ENTRY)
      return res.status(409).json({ error: 'Email sudah terdaftar' });
    res.status(500).json({ error: e.message });
  }
});

// ─── LOGIN ────────────────────────────────────────────────────────────────────
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await pool.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );
    const user = result.rows[0];    // ← ambil baris pertama dengan .rows[0]

    if (!user || !(await bcrypt.compare(password, user.password)))
      return res.status(401).json({ error: 'Email atau password salah' });

    const token = jwt.sign(
      { id: user.id, role: user.role, nama: user.nama },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.json({
      token,
      user: { id: user.id, nama: user.nama, email: user.email, role: user.role }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── GET PUSKESMAS ────────────────────────────────────────────────────────────
app.get('/api/puskesmas', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM puskesmas WHERE aktif = true'
    );
    res.json(result.rows);    // ← selalu pakai .rows untuk ambil semua data
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── BUAT BOOKING ─────────────────────────────────────────────────────────────
app.post('/api/booking', authMiddleware, async (req, res) => {
  const { puskesmas_id, tanggal, keluhan, jenis_layanan } = req.body;
  if (!puskesmas_id || !tanggal || !keluhan)
    return res.status(400).json({ error: 'Data tidak lengkap' });
  try {
    const result = await pool.query(
      `INSERT INTO bookings (user_id, puskesmas_id, tanggal, keluhan, jenis_layanan, status)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [req.user.id, puskesmas_id, tanggal, keluhan, jenis_layanan, 'menunggu']
    );
    res.status(201).json({
      message: 'Booking berhasil',
      id: result.rows[0].id
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── GET BOOKING SAYA ─────────────────────────────────────────────────────────
app.get('/api/booking/saya', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT b.*, p.nama AS puskesmas_nama, p.alamat
       FROM bookings b
       JOIN puskesmas p ON b.puskesmas_id = p.id
       WHERE b.user_id = $1
       ORDER BY b.created_at DESC`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── ADMIN: GET SEMUA BOOKING ─────────────────────────────────────────────────
app.get('/api/admin/booking', authMiddleware, async (req, res) => {
  if (req.user.role !== 'admin')
    return res.status(403).json({ error: 'Akses ditolak' });
  try {
    const result = await pool.query(
      `SELECT b.*, u.nama AS nama_pasien, u.no_hp,
              p.nama AS puskesmas_nama
       FROM bookings b
       JOIN users u ON b.user_id = u.id
       JOIN puskesmas p ON b.puskesmas_id = p.id
       ORDER BY b.created_at DESC`
    );
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── ADMIN: UPDATE STATUS BOOKING ────────────────────────────────────────────
app.patch('/api/admin/booking/:id', authMiddleware, async (req, res) => {
  if (req.user.role !== 'admin')
    return res.status(403).json({ error: 'Akses ditolak' });
  const { status } = req.body;
  try {
    await pool.query(
      'UPDATE bookings SET status = $1 WHERE id = $2',
      [status, req.params.id]
    );
    res.json({ message: 'Status diperbarui' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── BUAT LAPORAN (upload foto ke S3) ────────────────────────────────────────
app.post('/api/laporan', authMiddleware, upload.single('foto'), async (req, res) => {
  const { judul, deskripsi, lokasi, kategori } = req.body;
  if (!judul || !deskripsi)
    return res.status(400).json({ error: 'Data tidak lengkap' });

  let foto_url = null;
  if (req.file) {
    const key = `laporan/${Date.now()}_${req.file.originalname}`;
    await s3.send(new PutObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: key,
      Body: req.file.buffer,
      ContentType: req.file.mimetype,
    }));
    foto_url = `https://${process.env.S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
  }

  try {
    const result = await pool.query(
      `INSERT INTO laporan (user_id, judul, deskripsi, lokasi, kategori, foto_url, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [req.user.id, judul, deskripsi, lokasi, kategori, foto_url, 'diproses']
    );
    res.status(201).json({
      message: 'Laporan berhasil dikirim',
      id: result.rows[0].id,
      foto_url
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── GET SEMUA LAPORAN ────────────────────────────────────────────────────────
app.get('/api/laporan', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT l.*, u.nama AS pelapor
       FROM laporan l
       JOIN users u ON l.user_id = u.id
       ORDER BY l.created_at DESC`
    );
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── GET MONITORING ───────────────────────────────────────────────────────────
app.get('/api/monitoring', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM monitoring_penyakit ORDER BY tanggal DESC LIMIT 100'
    );
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── TAMBAH MONITORING (admin only) ──────────────────────────────────────────
app.post('/api/monitoring', authMiddleware, async (req, res) => {
  if (req.user.role !== 'admin')
    return res.status(403).json({ error: 'Akses ditolak' });
  const { penyakit, jumlah_kasus, wilayah, tanggal, keterangan } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO monitoring_penyakit (penyakit, jumlah_kasus, wilayah, tanggal, keterangan)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [penyakit, jumlah_kasus, wilayah, tanggal, keterangan]
    );
    res.status(201).json({
      message: 'Data monitoring ditambahkan',
      id: result.rows[0].id
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── START SERVER ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 SehatKu Backend berjalan di port ${PORT}`);
});