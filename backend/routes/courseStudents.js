const express = require('express');
const router = express.Router();
const db = require('../database');
const multer = require('multer');
const XLSX = require('xlsx');
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

// Resolve student/course info if not provided
async function resolveStudentAndCourse({ student_number, name, course_code, course_name }) {
  let resolvedName = name;
  let resolvedCourseName = course_name;

  if (!resolvedName && student_number) {
    const st = await getAsync('SELECT name FROM students WHERE student_number = ?', [student_number]);
    if (st && st.name) resolvedName = st.name;
  }
  if (!resolvedCourseName && course_code) {
    const cs = await getAsync('SELECT course_name FROM courses WHERE course_code = ?', [course_code]);
    if (cs && cs.course_name) resolvedCourseName = cs.course_name;
  }
  return { name: resolvedName, course_name: resolvedCourseName };
}

// List mappings (optional filters: student_number, course_code)
router.get('/', async (req, res) => {
  try {
    const { student_number, course_code } = req.query;
    const conds = [];
    const params = [];
    if (student_number) { conds.push('student_number = ?'); params.push(student_number); }
    if (course_code) { conds.push('course_code = ?'); params.push(course_code); }

    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const rows = await allAsync(
      `SELECT id, student_number, name, course_name, course_code, created_at
       FROM course_students
       ${where}
       ORDER BY created_at DESC`, params
    );
    res.json({ mappings: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get mapping by id
router.get('/:id', async (req, res) => {
  try {
    const row = await getAsync(
      'SELECT id, student_number, name, course_name, course_code, created_at FROM course_students WHERE id = ?',
      [req.params.id]
    );
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json({ mapping: row });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create mapping
router.post('/', async (req, res) => {
  try {
    const { student_number, name, course_code, course_name } = req.body;
    if (!student_number || !course_code) {
      return res.status(400).json({ error: 'student_number and course_code are required' });
    }
    const resolved = await resolveStudentAndCourse({ student_number, name, course_code, course_name });
    if (!resolved.name) {
      return res.status(400).json({ error: 'Unable to resolve student name; please provide name or ensure student exists' });
    }
    if (!resolved.course_name) {
      return res.status(400).json({ error: 'Unable to resolve course name; please provide course_name or ensure course exists' });
    }

    const ins = await runAsync(
      'INSERT OR IGNORE INTO course_students (student_number, name, course_name, course_code) VALUES (?, ?, ?, ?)',
      [student_number, resolved.name, resolved.course_name, course_code]
    );
    if (ins.changes === 0) {
      // Already exists; update name/course_name if changed
      await runAsync(
        'UPDATE course_students SET name = ?, course_name = ? WHERE student_number = ? AND course_code = ?',
        [resolved.name, resolved.course_name, student_number, course_code]
      );
    }

    const row = await getAsync(
      'SELECT id, student_number, name, course_name, course_code, created_at FROM course_students WHERE student_number = ? AND course_code = ?',
      [student_number, course_code]
    );
    res.json({ mapping: row });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update mapping
router.put('/:id', async (req, res) => {
  try {
    const { student_number, name, course_code, course_name } = req.body;
    const updates = [];
    const params = [];

    if (student_number !== undefined) { updates.push('student_number = ?'); params.push(student_number); }
    if (name !== undefined) { updates.push('name = ?'); params.push(name); }
    if (course_code !== undefined) { updates.push('course_code = ?'); params.push(course_code); }
    if (course_name !== undefined) { updates.push('course_name = ?'); params.push(course_name); }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    params.push(req.params.id);
    const result = await runAsync(`UPDATE course_students SET ${updates.join(', ')} WHERE id = ?`, params);
    if (result.changes === 0) return res.status(404).json({ error: 'Not found' });

    const row = await getAsync(
      'SELECT id, student_number, name, course_name, course_code, created_at FROM course_students WHERE id = ?',
      [req.params.id]
    );
    res.json({ mapping: row });
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'Duplicate mapping (student_number, course_code) already exists' });
    }
    res.status(500).json({ error: err.message });
  }
});

// Delete mapping
router.delete('/:id', async (req, res) => {
  try {
    const result = await runAsync('DELETE FROM course_students WHERE id = ?', [req.params.id]);
    res.json({ changes: result.changes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Bulk create/update mappings: body = { mappings: [{ student_number, name?, course_code, course_name? }, ...] }
router.post('/bulk', async (req, res) => {
  try {
    const { mappings } = req.body;
    if (!Array.isArray(mappings)) {
      return res.status(400).json({ error: 'mappings must be an array' });
    }

    let processed = 0;
    let inserted = 0;
    let updated = 0;
    const errors = [];

    for (const m of mappings) {
      processed++;
      try {
        if (!m.student_number || !m.course_code) {
          throw new Error('student_number and course_code are required');
        }
        const resolved = await resolveStudentAndCourse(m);
        if (!resolved.name) throw new Error('unable to resolve name');
        if (!resolved.course_name) throw new Error('unable to resolve course_name');

        const ins = await runAsync(
          'INSERT OR IGNORE INTO course_students (student_number, name, course_name, course_code) VALUES (?, ?, ?, ?)',
          [m.student_number, resolved.name, resolved.course_name, m.course_code]
        );
        if (ins.changes === 1) {
          inserted++;
        } else {
          const upd = await runAsync(
            'UPDATE course_students SET name = ?, course_name = ? WHERE student_number = ? AND course_code = ?',
            [resolved.name, resolved.course_name, m.student_number, m.course_code]
          );
          if (upd.changes > 0) updated++;
        }
      } catch (e) {
        errors.push({ mapping: m, error: String(e.message || e) });
      }
    }

    res.json({ processed, inserted, updated, errors });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Import mappings via Excel: expect columns 学号 / student_number and 课程编号 / course_code
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
        const student_number = String(row['学号'] ?? row['student_number'] ?? '').trim();
        const course_code = String(row['课程编号'] ?? row['course_code'] ?? '').trim();

        if (!student_number || !course_code) {
          skipped++;
          continue;
        }

        const st = await getAsync('SELECT name FROM students WHERE student_number = ?', [student_number]);
        if (!st) {
          errors.push({ row, error: 'student_number not found, please create the student first' });
          continue;
        }

        const cr = await getAsync('SELECT course_name FROM courses WHERE course_code = ?', [course_code]);
        if (!cr) {
          errors.push({ row, error: 'course_code not found, please create the course first' });
          continue;
        }

        const ins = await runAsync(
          'INSERT OR IGNORE INTO course_students (student_number, name, course_name, course_code) VALUES (?, ?, ?, ?)',
          [student_number, st.name, cr.course_name, course_code]
        );
        if (ins.changes === 1) {
          inserted++;
        } else {
          const upd = await runAsync(
            'UPDATE course_students SET name = ?, course_name = ? WHERE student_number = ? AND course_code = ?',
            [st.name, cr.course_name, student_number, course_code]
          );
          if (upd.changes > 0) updated++;
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