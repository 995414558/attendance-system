const express = require('express');
const router = express.Router();
const db = require('../database');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Ensure upload directory exists
function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads', 'students');
ensureDir(UPLOAD_DIR);

// Multer storage for student photos
const storage = multer.diskStorage({
  destination: function (_req, _file, cb) {
    cb(null, UPLOAD_DIR);
  },
  filename: function (_req, file, cb) {
    const base = path.parse(file.originalname).name.replace(/\s+/g, '_');
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `${Date.now()}_${base}${ext}`);
  }
});
const upload = multer({ storage });

// Helpers to use sqlite3 with async/await
function runAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}
function getAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, function (err, row) {
      if (err) return reject(err);
      resolve(row);
    });
  });
}
function allAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, function (err, rows) {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

// Parse "学号-姓名" from filename (supports "-" or "_" as delimiter)
function parseStudentFromFilename(originalname) {
  const nameWithoutExt = path.parse(originalname).name;
  let parts = nameWithoutExt.split('-');
  if (parts.length < 2) {
    parts = nameWithoutExt.split('_');
  }
  if (parts.length < 2) {
    return null;
  }
  const student_number = (parts[0] || '').trim();
  const name = (parts.slice(1).join('-') || '').trim();
  if (!student_number || !name) return null;
  return { student_number, name };
}

// CRUD: List students
router.get('/', async (_req, res) => {
  try {
    const rows = await allAsync(
      'SELECT id, student_number, name, gender, photo_path, created_at FROM students ORDER BY created_at DESC'
    );
    res.json({ students: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// CRUD: Get student by id
router.get('/:id', async (req, res) => {
  try {
    const row = await getAsync(
      'SELECT id, student_number, name, gender, face_descriptors, photo_path, created_at FROM students WHERE id = ?',
      [req.params.id]
    );
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json({ student: row });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// CRUD: Create student (manual form)
router.post('/', async (req, res) => {
  try {
    const { student_number, name, gender, face_descriptors, photo_path } = req.body;
    if (!student_number || !name) {
      return res.status(400).json({ error: 'student_number and name are required' });
    }
    const fd = face_descriptors ? JSON.stringify(face_descriptors) : null;
    await runAsync(
      'INSERT INTO students (student_number, name, gender, face_descriptors, photo_path) VALUES (?, ?, ?, ?, ?)',
      [student_number, name, gender || null, fd, photo_path || null]
    );
    const created = await getAsync('SELECT * FROM students WHERE student_number = ?', [student_number]);
    res.json({ student: created });
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'student_number already exists' });
    }
    res.status(500).json({ error: err.message });
  }
});

// CRUD: Update student (manual form)
router.put('/:id', async (req, res) => {
  try {
    const { student_number, name, gender, face_descriptors, photo_path } = req.body;
    const fd = face_descriptors ? JSON.stringify(face_descriptors) : null;
    const updates = [];
    const params = [];

    if (student_number !== undefined) { updates.push('student_number = ?'); params.push(student_number); }
    if (name !== undefined) { updates.push('name = ?'); params.push(name); }
    if (gender !== undefined) { updates.push('gender = ?'); params.push(gender); }
    if (face_descriptors !== undefined) { updates.push('face_descriptors = ?'); params.push(fd); }
    if (photo_path !== undefined) { updates.push('photo_path = ?'); params.push(photo_path); }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    params.push(req.params.id);
    const result = await runAsync(`UPDATE students SET ${updates.join(', ')} WHERE id = ?`, params);
    if (result.changes === 0) return res.status(404).json({ error: 'Not found' });

    const row = await getAsync('SELECT * FROM students WHERE id = ?', [req.params.id]);
    res.json({ student: row });
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'student_number already exists' });
    }
    res.status(500).json({ error: err.message });
  }
});

// CRUD: Delete student
router.delete('/:id', async (req, res) => {
  try {
    const result = await runAsync('DELETE FROM students WHERE id = ?', [req.params.id]);
    res.json({ changes: result.changes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update only face_descriptors for a student
router.put('/:id/face-descriptors', async (req, res) => {
  try {
    const { face_descriptors } = req.body;
    if (!Array.isArray(face_descriptors)) {
      return res.status(400).json({ error: 'face_descriptors must be an array' });
    }
    const fd = JSON.stringify(face_descriptors);
    const result = await runAsync('UPDATE students SET face_descriptors = ? WHERE id = ?', [fd, req.params.id]);
    if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
    const row = await getAsync('SELECT * FROM students WHERE id = ?', [req.params.id]);
    res.json({ student: row });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Import students by uploading a folder of photos (multiple files)
// Expect field name "photos" and filenames like "学号-姓名.jpg"
router.post('/import/photos', upload.array('photos', 2000), async (req, res) => {
  try {
    const files = req.files || [];
    const defaultGender = req.body.gender || null;

    let processed = 0;
    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    const errors = [];

    for (const file of files) {
      processed++;
      try {
        const parsed = parseStudentFromFilename(file.originalname);
        if (!parsed) {
          skipped++;
          continue;
        }
        const { student_number, name } = parsed;
        const relPath = `/uploads/students/${path.basename(file.path)}`;

        // Insert if not exists
        const ins = await runAsync(
          'INSERT OR IGNORE INTO students (student_number, name, gender, photo_path) VALUES (?, ?, ?, ?)',
          [student_number, name, defaultGender, relPath]
        );
        if (ins.changes === 1) {
          inserted++;
        } else {
          // Update existing record's name and photo
          const upd = await runAsync(
            'UPDATE students SET name = ?, photo_path = ? WHERE student_number = ?',
            [name, relPath, student_number]
          );
          if (upd.changes > 0) updated++;
        }
      } catch (e) {
        errors.push({ file: file.originalname, error: String(e.message || e) });
      }
    }

    res.json({ processed, inserted, updated, skipped, errors });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Serve upload directory listing (optional, debugging)
router.get('/uploads/list', async (_req, res) => {
  try {
    const files = fs.readdirSync(UPLOAD_DIR).map(f => `/uploads/students/${f}`);
    res.json({ files });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;