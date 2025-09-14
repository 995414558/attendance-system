const express = require('express');
const router = express.Router();
const db = require('../database');
const multer = require('multer');
const XLSX = require('xlsx');

// Multer memory storage for Excel uploads
const upload = multer({ storage: multer.memoryStorage() });

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

// Normalize headers for Excel import
function extractCourseRecord(row) {
  // Accept both Chinese and English headers
  const code = row['课程编号'] ?? row['course_code'] ?? row['代码'] ?? row['code'] ?? row['课程代码'] ?? row['课程code'];
  const name = row['课程名称'] ?? row['course_name'] ?? row['名称'] ?? row['name'] ?? row['课程名'];
  const hoursRaw = row['课程学时'] ?? row['course_hours'] ?? row['学时'] ?? row['hours'] ?? row['时长'];
  if (!code || !name) return null;
  const hours = hoursRaw === undefined || hoursRaw === null || hoursRaw === '' ? null : Number.parseInt(hoursRaw, 10);
  return {
    course_code: String(code).trim(),
    course_name: String(name).trim(),
    course_hours: Number.isNaN(hours) ? null : hours
  };
}

// CRUD: List courses
router.get('/', async (_req, res) => {
  try {
    const rows = await allAsync(
      'SELECT id, course_code, course_name, course_hours, created_at FROM courses ORDER BY created_at DESC'
    );
    res.json({ courses: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// CRUD: Get course by id
router.get('/:id', async (req, res) => {
  try {
    const row = await getAsync(
      'SELECT id, course_code, course_name, course_hours, created_at FROM courses WHERE id = ?',
      [req.params.id]
    );
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json({ course: row });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// CRUD: Create course (manual form)
router.post('/', async (req, res) => {
  try {
    const { course_code, course_name, course_hours } = req.body;
    if (!course_code || !course_name) {
      return res.status(400).json({ error: 'course_code and course_name are required' });
    }
    const hours = course_hours === undefined || course_hours === null || course_hours === '' ? null : Number(course_hours);
    await runAsync(
      'INSERT INTO courses (course_code, course_name, course_hours) VALUES (?, ?, ?)',
      [String(course_code).trim(), String(course_name).trim(), Number.isNaN(hours) ? null : hours]
    );
    const created = await getAsync('SELECT * FROM courses WHERE course_code = ?', [String(course_code).trim()]);
    res.json({ course: created });
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'course_code already exists' });
    }
    res.status(500).json({ error: err.message });
  }
});

// CRUD: Update course
router.put('/:id', async (req, res) => {
  try {
    const { course_code, course_name, course_hours } = req.body;
    const updates = [];
    const params = [];

    if (course_code !== undefined) { updates.push('course_code = ?'); params.push(String(course_code).trim()); }
    if (course_name !== undefined) { updates.push('course_name = ?'); params.push(String(course_name).trim()); }
    if (course_hours !== undefined) {
      const hours = course_hours === null || course_hours === '' ? null : Number(course_hours);
      updates.push('course_hours = ?'); params.push(Number.isNaN(hours) ? null : hours);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    params.push(req.params.id);
    const result = await runAsync(`UPDATE courses SET ${updates.join(', ')} WHERE id = ?`, params);
    if (result.changes === 0) return res.status(404).json({ error: 'Not found' });

    const row = await getAsync('SELECT * FROM courses WHERE id = ?', [req.params.id]);
    res.json({ course: row });
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'course_code already exists' });
    }
    res.status(500).json({ error: err.message });
  }
});

// CRUD: Delete course
router.delete('/:id', async (req, res) => {
  try {
    const result = await runAsync('DELETE FROM courses WHERE id = ?', [req.params.id]);
    res.json({ changes: result.changes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Import courses via Excel: expect a file field named "file"
// Headers supported: 课程编号, 课程名称, 课程学时 (or English equivalents)
router.post('/import/excel', upload.single('file'), async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) return res.status(400).json({ error: 'Empty workbook' });

    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

    let processed = 0;
    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    const errors = [];

    for (const row of rows) {
      processed++;
      try {
        const rec = extractCourseRecord(row);
        if (!rec) {
          skipped++;
          continue;
        }

        // Try insert or update existing
        const ins = await runAsync(
          'INSERT OR IGNORE INTO courses (course_code, course_name, course_hours) VALUES (?, ?, ?)',
          [rec.course_code, rec.course_name, rec.course_hours]
        );
        if (ins.changes === 1) {
          inserted++;
        } else {
          const upd = await runAsync(
            'UPDATE courses SET course_name = ?, course_hours = ? WHERE course_code = ?',
            [rec.course_name, rec.course_hours, rec.course_code]
          );
          if (upd.changes > 0) updated++;
          else skipped++;
        }
      } catch (e) {
        errors.push({ row, error: String(e.message || e) });
      }
    }

    res.json({ processed, inserted, updated, skipped, errors });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;