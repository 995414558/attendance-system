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
// Try to recover UTF-8 filenames that arrived as latin1 (common on Windows uploads)
function decodeMaybeUtf8FromLatin1(str) {
  try {
    // If already contains CJK, keep it
    if (/[\u4e00-\u9fff]/.test(str)) return str;
    const u = Buffer.from(str, 'latin1').toString('utf8');
    // Prefer decoded if it reveals CJK and no replacement chars
    if (/[\u4e00-\u9fff]/.test(u) && !/\ufffd/.test(u)) return u;
    // if decoding changed content without introducing replacement char, prefer it
    if (u !== str && !/\ufffd/.test(u)) return u;
    return str;
  } catch (_) {
    return str;
  }
}

const storage = multer.diskStorage({
  destination: function (_req, _file, cb) {
    cb(null, UPLOAD_DIR);
  },
  filename: function (_req, file, cb) {
    const orig = decodeMaybeUtf8FromLatin1(file.originalname || '');
    const base = path.parse(orig).name.replace(/\s+/g, '_');
    const ext = path.extname(orig) || '.jpg';
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
  const fixed = decodeMaybeUtf8FromLatin1(originalname || '');
  const nameWithoutExt = path.parse(fixed).name;
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
      "SELECT id, student_number, name, gender, class_name, photo_path, strftime('%Y-%m-%d %H:%M:%S', created_at, '+8 hours') AS created_at FROM students ORDER BY created_at DESC"
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
      "SELECT id, student_number, name, gender, face_descriptors, photo_path, strftime('%Y-%m-%d %H:%M:%S', created_at, '+8 hours') AS created_at FROM students WHERE id = ?",
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
    const { student_number, name, gender, class_name, face_descriptors, photo_path } = req.body;
    if (!student_number || !name) {
      return res.status(400).json({ error: 'student_number and name are required' });
    }
    const fd = face_descriptors ? JSON.stringify(face_descriptors) : null;
    await runAsync(
      'INSERT INTO students (student_number, name, gender, class_name, face_descriptors, photo_path) VALUES (?, ?, ?, ?, ?, ?)',
      [student_number, name, gender || null, class_name || null, fd, photo_path || null]
    );
    const created = await getAsync("SELECT id, student_number, name, gender, class_name, face_descriptors, photo_path, strftime('%Y-%m-%d %H:%M:%S', created_at, '+8 hours') AS created_at FROM students WHERE student_number = ?", [student_number]);
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
    const { student_number, name, gender, class_name, face_descriptors, photo_path } = req.body;
    const fd = face_descriptors ? JSON.stringify(face_descriptors) : null;
    const updates = [];
    const params = [];

    if (student_number !== undefined) { updates.push('student_number = ?'); params.push(student_number); }
    if (name !== undefined) { updates.push('name = ?'); params.push(name); }
    if (gender !== undefined) { updates.push('gender = ?'); params.push(gender); }
    if (class_name !== undefined) { updates.push('class_name = ?'); params.push(class_name); }
    if (face_descriptors !== undefined) { updates.push('face_descriptors = ?'); params.push(fd); }
    if (photo_path !== undefined) { updates.push('photo_path = ?'); params.push(photo_path); }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    params.push(req.params.id);
    const result = await runAsync(`UPDATE students SET ${updates.join(', ')} WHERE id = ?`, params);
    if (result.changes === 0) return res.status(404).json({ error: 'Not found' });

    const row = await getAsync("SELECT id, student_number, name, gender, class_name, face_descriptors, photo_path, strftime('%Y-%m-%d %H:%M:%S', created_at, '+8 hours') AS created_at FROM students WHERE id = ?", [req.params.id]);
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
    const defaultClass = req.body.class_name || null;
    let meta = {};
    try {
      if (req.body.meta) meta = JSON.parse(req.body.meta);
    } catch (e) {
      // ignore meta parse errors; proceed without
    }

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

        // Try multiple keys to robustly match meta (handles encoding and basename)
        const orig = file.originalname || '';
        const decoded = decodeMaybeUtf8FromLatin1(orig);
        const candidates = [
          orig,
          decoded,
          path.basename(orig),
          path.basename(decoded),
          path.basename(file.path)
        ].filter(Boolean);
        let m = {};
        for (const k of candidates) {
          if (meta && Object.prototype.hasOwnProperty.call(meta, k)) { m = meta[k] || {}; break; }
        }
        const gender = (m.gender != null ? m.gender : defaultGender) || null;
        const class_name = (m.class_name != null ? m.class_name : defaultClass) || null;

        // Insert if not exists (with class_name)
        const ins = await runAsync(
          'INSERT OR IGNORE INTO students (student_number, name, gender, class_name, photo_path) VALUES (?, ?, ?, ?, ?)',
          [student_number, name, gender, class_name, relPath]
        );
        if (ins.changes === 1) {
          inserted++;
        } else {
          // Update existing record's key fields with COALESCE to avoid overwriting with null
          const upd = await runAsync(
            'UPDATE students SET name = ?, photo_path = ?, gender = COALESCE(?, gender), class_name = COALESCE(?, class_name) WHERE student_number = ?',
            [name, relPath, gender, class_name, student_number]
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

/**
 * Upload a single student photo and upsert photo_path (and optional fields)
 * multipart/form-data:
 *  - photo: file
 *  - student_number: required
 *  - name, gender, class_name: optional (COALESCE update)
 */
router.post('/upload/photo', upload.single('photo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'photo is required' });
    const { student_number, name, gender, class_name } = req.body || {};
    if (!student_number) return res.status(400).json({ error: 'student_number is required' });

    const relPath = `/uploads/students/${path.basename(req.file.path)}`;

    // Insert if not exists
    await runAsync(
      'INSERT OR IGNORE INTO students (student_number, name, gender, class_name, photo_path) VALUES (?, ?, ?, ?, ?)',
      [student_number, name || null, gender || null, class_name || null, relPath]
    );

    // Update existing with COALESCE (avoid overwriting with null)
    await runAsync(
      'UPDATE students SET photo_path = ?, name = COALESCE(?, name), gender = COALESCE(?, gender), class_name = COALESCE(?, class_name) WHERE student_number = ?',
      [relPath, name || null, gender || null, class_name || null, student_number]
    );

    const row = await getAsync("SELECT id, student_number, name, gender, class_name, face_descriptors, photo_path, strftime('%Y-%m-%d %H:%M:%S', created_at, '+8 hours') AS created_at FROM students WHERE student_number = ?", [student_number]);
    res.json({ student: row });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
