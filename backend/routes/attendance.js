const express = require('express');
const db = require('../database');
const router = express.Router();

// CN timezone helpers (store DB times in Asia/Shanghai)
function formatCN(dateInput) {
  const d0 = dateInput ? new Date(dateInput) : new Date();
  // Normalize to UTC then add +08:00 (China has no DST)
  const utcMs = d0.getTime() + d0.getTimezoneOffset() * 60000;
  const cnMs = utcMs + 8 * 60 * 60000;
  const d = new Date(cnMs);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function cnNow() { return formatCN(new Date()); }

// Get all attendance records
router.get('/', (req, res) => {
  const { session_id, face_id } = req.query;
  let query = `
    SELECT a.*, f.label, f.class, f.name, f.course
    FROM attendance a
    LEFT JOIN faces f ON a.face_id = f.id
  `;
  const params = [];

  if (session_id) {
    query += ' WHERE a.session_id = ?';
    params.push(session_id);
  }

  if (face_id) {
    query += session_id ? ' AND' : ' WHERE';
    query += ' a.face_id = ?';
    params.push(face_id);
  }

  query += ' ORDER BY a.timestamp DESC';

  db.all(query, params, (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json({ attendance: rows });
  });
});

// Get attendance summary by session
router.get('/summary/:session_id', (req, res) => {
  const { session_id } = req.params;
  const query = `
    SELECT f.label, f.class, f.name, f.course, COUNT(a.id) as count
    FROM attendance a
    JOIN faces f ON a.face_id = f.id
    WHERE a.session_id = ?
    GROUP BY f.id
    ORDER BY count DESC
  `;

  db.all(query, [session_id], (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json({ summary: rows });
  });
});
// Get attendees list for a session (from session_attendees)
// Returns: { attendees: [{ session_id, student_number, name, class_name, course_name, photo_path }] }
router.get('/session/:session_id', (req, res) => {
  const { session_id } = req.params;
  const sql = `
    SELECT 
      sa.session_id,
      sa.student_number,
      st.name,
      st.class_name,
      ss.course_name,
      st.photo_path
    FROM session_attendees sa
    LEFT JOIN students st ON st.student_number = sa.student_number
    LEFT JOIN sessions ss ON ss.id = sa.session_id
    WHERE sa.session_id = ?
    ORDER BY COALESCE(st.class_name, ''), COALESCE(st.name, ''), sa.student_number
  `;
  db.all(sql, [session_id], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json({ attendees: rows || [] });
  });
});

// Count attendance by face_id (total history)
router.get('/count/:face_id', (req, res) => {
  const { face_id } = req.params;
  db.get('SELECT COUNT(*) as count FROM attendance WHERE face_id = ?', [face_id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ count: (row && row.count) || 0 });
  });
});

// Get statistics by course
router.get('/stats/by-course', (req, res) => {
  const query = `
    WITH course_sessions AS (
      SELECT course_name AS course, COUNT(DISTINCT id) AS total_sessions
      FROM sessions
      GROUP BY course_name
    ),
    students_in_course AS (
      SELECT DISTINCT f.name, f.class, f.course
      FROM faces f
      WHERE f.course IS NOT NULL
    ),
    per_student AS (
      SELECT sic.course,
             sic.name,
             sic.class,
             COUNT(DISTINCT a.session_id) AS attended
      FROM students_in_course sic
      LEFT JOIN faces f ON f.name = sic.name AND f.class = sic.class AND f.course = sic.course
      LEFT JOIN attendance a ON a.face_id = f.id
      LEFT JOIN sessions s ON s.id = a.session_id AND s.course_name = sic.course
      GROUP BY sic.course, sic.name, sic.class
    )
    SELECT
      cs.course,
      COUNT(DISTINCT ps.name || '|' || ps.class) AS total_students,
      cs.total_sessions,
      COALESCE(SUM(ps.attended), 0) AS total_attendance,
      ROUND(AVG(CASE WHEN cs.total_sessions = 0 THEN 0 ELSE CAST(ps.attended AS FLOAT) / cs.total_sessions END) * 100, 2) AS attendance_rate
    FROM course_sessions cs
    LEFT JOIN per_student ps ON ps.course = cs.course
    GROUP BY cs.course
    ORDER BY attendance_rate DESC
  `;

  db.all(query, [], (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json({ stats: rows });
  });
});

// Get statistics by class
router.get('/stats/by-class', (req, res) => {
  const query = `
    WITH class_sessions AS (
      SELECT class_name AS class, COUNT(DISTINCT id) AS total_sessions
      FROM sessions
      GROUP BY class_name
    ),
    students_in_class AS (
      SELECT DISTINCT f.name, f.class
      FROM faces f
      WHERE f.class IS NOT NULL
    ),
    per_student AS (
      SELECT sic.class,
             sic.name,
             COUNT(DISTINCT a.session_id) AS attended
      FROM students_in_class sic
      LEFT JOIN faces f ON f.name = sic.name AND f.class = sic.class
      LEFT JOIN attendance a ON a.face_id = f.id
      LEFT JOIN sessions s ON s.id = a.session_id AND s.class_name = sic.class
      GROUP BY sic.class, sic.name
    )
    SELECT
      cs.class,
      COUNT(DISTINCT ps.name) AS total_students,
      cs.total_sessions,
      COALESCE(SUM(ps.attended), 0) AS total_attendance,
      ROUND(AVG(CASE WHEN cs.total_sessions = 0 THEN 0 ELSE CAST(ps.attended AS FLOAT) / cs.total_sessions END) * 100, 2) AS attendance_rate
    FROM class_sessions cs
    LEFT JOIN per_student ps ON ps.class = cs.class
    GROUP BY cs.class
    ORDER BY attendance_rate DESC
  `;

  db.all(query, [], (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json({ stats: rows });
  });
});

// Get overall statistics
router.get('/stats/overall', (req, res) => {
  const queries = {
    total_students: 'SELECT COUNT(*) as count FROM faces',
    total_sessions: 'SELECT COUNT(DISTINCT id) as count FROM sessions',
    total_attendance: 'SELECT COUNT(DISTINCT id) as count FROM attendance',
    avg_attendance_rate: `
      SELECT ROUND(
        CAST((SELECT COUNT(DISTINCT id) FROM attendance) AS FLOAT) /
        (SELECT COUNT(DISTINCT id) FROM sessions) * 100,
        2
      ) as rate
    `
  };

  const results = {};

  const executeQueries = (keys) => {
    if (keys.length === 0) {
      res.json({ stats: results });
      return;
    }

    const key = keys[0];
    db.get(queries[key], [], (err, row) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      results[key] = row.count || row.rate;
      executeQueries(keys.slice(1));
    });
  };

  executeQueries(Object.keys(queries));
});

// Record attendance with per-session de-duplication by student_number
// Accepts: { session_id, student_number?, face_id? }
// Behavior:
// - If student_number provided: UPSERT into session_attendees (session_id, student_number) UNIQUE.
//   On first insert, also insert a single legacy attendance row (face_id + session_id) for summary compatibility.
// - If only face_id provided: try to resolve student_number via (faces.name,class) -> students.
//   If resolved, same as above; otherwise fallback to legacy dedupe by (face_id, session_id).
router.post('/', (req, res) => {
  const { face_id, session_id, student_number } = req.body || {};
  if (!session_id || (!student_number && !face_id)) {
    return res.status(400).json({ error: 'session_id and (student_number or face_id) are required' });
  }

  // Verify session exists
  db.get('SELECT id FROM sessions WHERE id = ?', [session_id], (errSession, sessionRow) => {
    if (errSession) return res.status(500).json({ error: errSession.message });
    if (!sessionRow) return res.status(404).json({ error: 'Session not found' });

    const insertLegacyAttendance = (finalFaceId, sn) => {
      // If no face id, try to derive one from student for legacy summary
      const doInsert = (fid) => {
        if (!fid) {
          // No face available; still acknowledge session attendee insertion
          return res.json({ ok: true, inserted: true, student_number: sn, face_id: null });
        }
        db.run(
          'INSERT INTO attendance (face_id, session_id, timestamp) VALUES (?, ?, ?)',
          [fid, session_id, cnNow()],
          function (errIns) {
            if (errIns) return res.status(500).json({ error: errIns.message });
            res.json({ ok: true, inserted: true, id: this.lastID, student_number: sn, face_id: fid });
          }
        );
      };

      if (finalFaceId) return doInsert(finalFaceId);

      // Derive face_id by matching student.name + student.class_name with faces
      db.get(`
        SELECT f.id AS face_id
        FROM faces f
        JOIN students s ON s.name = f.name AND s.class_name = f.class
        WHERE s.student_number = ?
        LIMIT 1
      `, [sn], (errFind, rowFind) => {
        if (errFind) return res.status(500).json({ error: errFind.message });
        doInsert(rowFind && rowFind.face_id);
      });
    };

    const proceedWithSN = (sn, fid) => {
      // Ensure student exists
      db.get('SELECT student_number FROM students WHERE student_number = ?', [sn], (errStu, stuRow) => {
        if (errStu) return res.status(500).json({ error: errStu.message });
        if (!stuRow) return res.status(404).json({ error: 'Student not found' });

        // Insert or ignore session attendee (de-dup per session_id + student_number)
        db.run(
          'INSERT OR IGNORE INTO session_attendees (session_id, student_number, first_seen) VALUES (?, ?, ?)',
          [session_id, sn, cnNow()],
          function (errInsAtt) {
            if (errInsAtt) return res.status(500).json({ error: errInsAtt.message });
            const inserted = this.changes > 0;
            if (!inserted) {
              // Duplicate within session, do not insert legacy attendance again
              return res.json({ ok: true, duplicate: true, student_number: sn });
            }
            // First time seen in this session -> insert one legacy attendance row for summary compatibility
            insertLegacyAttendance(fid, sn);
          }
        );
      });
    };

    if (student_number) {
      proceedWithSN(student_number, face_id || null);
    } else {
      // Resolve student_number from face_id via name + class_name
      db.get(`
        SELECT s.student_number AS sn
        FROM faces f
        JOIN students s ON s.name = f.name AND s.class_name = f.class
        WHERE f.id = ?
        LIMIT 1
      `, [face_id], (errResolve, rowResolve) => {
        if (errResolve) return res.status(500).json({ error: errResolve.message });
        if (rowResolve && rowResolve.sn) {
          proceedWithSN(rowResolve.sn, face_id);
        } else {
          // Legacy fallback: de-dup by (face_id, session_id)
          db.get(
            'SELECT 1 FROM attendance WHERE face_id = ? AND session_id = ? LIMIT 1',
            [face_id, session_id],
            (errChk, exists) => {
              if (errChk) return res.status(500).json({ error: errChk.message });
              if (exists) return res.json({ ok: true, duplicate: true, legacy: true });
              db.run(
                'INSERT INTO attendance (face_id, session_id, timestamp) VALUES (?, ?, ?)',
                [face_id, session_id, cnNow()],
                function (errIns) {
                  if (errIns) return res.status(500).json({ error: errIns.message });
                  res.json({ ok: true, legacy: true, id: this.lastID });
                }
              );
            }
          );
        }
      });
    }
  });
});

// Delete attendance record
router.delete('/:id', (req, res) => {
  const { id } = req.params;
  db.run('DELETE FROM attendance WHERE id = ?', [id], function(err) {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json({ changes: this.changes });
  });
});

// Get unique class-course combinations from faces
router.get('/classes-courses', (req, res) => {
  db.all(`
    SELECT DISTINCT class as class_name, course as course_name
    FROM faces
    WHERE class IS NOT NULL AND course IS NOT NULL
    ORDER BY class, course
  `, [], (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json({ combinations: rows });
  });
});

// Sessions management
router.get('/sessions', (req, res) => {
  db.all(`
    SELECT *,
           class_name || '-' || course_name as display_name,
           class_name || '-' || course_name || '(' ||
           strftime('%Y-%m-%d %H:%M:%S', start_time) || ' - ' ||
           CASE WHEN end_time IS NOT NULL THEN strftime('%Y-%m-%d %H:%M:%S', end_time) ELSE '进行中' END || ')' as full_session_id
    FROM sessions
    ORDER BY start_time DESC
  `, [], (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json({ sessions: rows });
  });
});

router.post('/sessions', (req, res) => {
  const { class_name, course_name, start_time } = req.body;
  const sessionId = `${class_name}-${course_name}(${start_time})`;
  const start_time_cn = formatCN(start_time);

  db.run(
    'INSERT INTO sessions (id, class_name, course_name, start_time, status) VALUES (?, ?, ?, ?, ?)',
    [sessionId, class_name, course_name, start_time_cn, 'active'],
    function (err) {
      if (err) {
        // If primary key conflict, append a unique suffix and try once
        if (String(err.message || '').toLowerCase().includes('unique')) {
          const uniqueId = `${sessionId}#${Date.now()}`;
          db.run(
            'INSERT INTO sessions (id, class_name, course_name, start_time, status) VALUES (?, ?, ?, ?, ?)',
            [uniqueId, class_name, course_name, start_time_cn, 'active'],
            function (err2) {
              if (err2) return res.status(500).json({ error: err2.message });
              return res.json({ id: uniqueId, duplicate: false });
            }
          );
        } else {
          return res.status(500).json({ error: err.message });
        }
      } else {
        res.json({ id: sessionId, duplicate: false });
      }
    }
  );
});

router.put('/sessions/:id/end', (req, res) => {
   const { id } = req.params;
   const { end_time } = req.body;
   const end_cn = formatCN(end_time);

   // Update session with end time and change status to completed
   // Do NOT mutate primary key (id) to keep references intact.
   db.run(
     'UPDATE sessions SET end_time = ?, status = ? WHERE id = ?',
     [end_cn, 'completed', id],
     function(err) {
       if (err) {
         res.status(500).json({ error: err.message });
         return;
       }
       res.json({ ok: true, id, end_time: end_cn });
     }
   );
 });

// Override duplicate session
router.post('/sessions/override', (_req, res) => {
  // Duplicate-session override has been disabled per requirements.
  res.status(410).json({ error: 'duplicate session override has been disabled' });
});

// Get detailed statistics for a specific course
router.get('/stats/course-details/:course', (req, res) => {
  const { course } = req.params;

  // First get total sessions for this course
  const totalSessionsQuery = `
    SELECT COUNT(DISTINCT id) as total_sessions
    FROM sessions
    WHERE course_name = ?
  `;

  db.get(totalSessionsQuery, [course], (err, totalResult) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }

    const totalSessions = totalResult.total_sessions;

    // Then get attendance details for each student
    const detailsQuery = `
      SELECT
        f.name,
        f.class,
        COUNT(DISTINCT a.session_id) as attendance_count,
        ROUND(CAST(COUNT(DISTINCT a.session_id) AS FLOAT) / NULLIF(?, 0) * 100, 2) as attendance_rate
      FROM faces f
      LEFT JOIN attendance a ON f.id = a.face_id
      LEFT JOIN sessions s ON a.session_id = s.id AND s.course_name = ?
      WHERE f.course = ?
      GROUP BY f.id
      ORDER BY attendance_rate DESC
    `;

    db.all(detailsQuery, [totalSessions, course, course], (err, rows) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      res.json({ details: rows, total_sessions: totalSessions });
    });
  });
});

// Get detailed statistics for a specific class
router.get('/stats/class-details/:class', (req, res) => {
  const { class: className } = req.params;

  // Per-student aggregated details for the class:
  // attendance_rate = (student's total attended sessions in this class) / (sum of total sessions of courses the student took in this class)
  const query = `
    WITH student_courses AS (
      SELECT DISTINCT f.name, f.class, f.course
      FROM faces f
      WHERE f.class = ? AND f.course IS NOT NULL
    ),
    student_total_sessions AS (
      SELECT sc.name, sc.class, COUNT(DISTINCT s.id) AS total_sessions
      FROM student_courses sc
      JOIN sessions s ON s.class_name = sc.class AND s.course_name = sc.course
      GROUP BY sc.name, sc.class
    ),
    students_in_class AS (
      SELECT DISTINCT f.name, f.class
      FROM faces f
      WHERE f.class = ?
    ),
    attendance_per_student AS (
      SELECT sic.name, sic.class, COUNT(DISTINCT a.session_id) AS attendance_count
      FROM students_in_class sic
      LEFT JOIN faces f ON f.name = sic.name AND f.class = sic.class
      LEFT JOIN attendance a ON a.face_id = f.id
      LEFT JOIN sessions s ON s.id = a.session_id AND s.class_name = sic.class
      GROUP BY sic.name, sic.class
    )
    SELECT aps.name,
           aps.class,
           NULL AS course,
           aps.attendance_count,
           COALESCE(sts.total_sessions, 0) AS total_sessions,
           CASE WHEN COALESCE(sts.total_sessions, 0) = 0 THEN 0
                ELSE ROUND(CAST(aps.attendance_count AS FLOAT) / sts.total_sessions * 100, 2) END AS attendance_rate
    FROM attendance_per_student aps
    LEFT JOIN student_total_sessions sts ON sts.name = aps.name AND sts.class = aps.class
    ORDER BY attendance_rate DESC
  `;

  db.all(query, [className, className], (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json({ details: rows });
  });
});

// Get students overview statistics (grouped by name + class)
router.get('/stats/students', (req, res) => {
  const query = `
    WITH student_overview AS (
      SELECT f.name, f.class
      FROM faces f
      WHERE f.name IS NOT NULL AND f.class IS NOT NULL
      GROUP BY f.name, f.class
    ),
    courses_count AS (
      SELECT f.name, f.class, COUNT(DISTINCT f.course) AS courses_count
      FROM faces f
      WHERE f.name IS NOT NULL AND f.class IS NOT NULL
      GROUP BY f.name, f.class
    ),
    total_sessions AS (
      SELECT f.name, f.class, COUNT(DISTINCT s.id) AS total_sessions
      FROM faces f
      JOIN sessions s ON s.class_name = f.class AND s.course_name = f.course
      GROUP BY f.name, f.class
    ),
    attendance_count AS (
      SELECT f.name, f.class, COUNT(DISTINCT a.session_id) AS attendance_count
      FROM attendance a
      JOIN faces f ON f.id = a.face_id
      GROUP BY f.name, f.class
    )
    SELECT so.name,
           so.class,
           COALESCE(cc.courses_count, 0) AS courses_count,
           COALESCE(ts.total_sessions, 0) AS total_sessions,
           COALESCE(ac.attendance_count, 0) AS attendance_count,
           CASE WHEN COALESCE(ts.total_sessions, 0) = 0
                THEN 0
                ELSE ROUND(CAST(COALESCE(ac.attendance_count, 0) AS FLOAT) / ts.total_sessions * 100, 2)
           END AS attendance_rate
    FROM student_overview so
    LEFT JOIN courses_count cc ON cc.name = so.name AND cc.class = so.class
    LEFT JOIN total_sessions ts ON ts.name = so.name AND ts.class = so.class
    LEFT JOIN attendance_count ac ON ac.name = so.name AND ac.class = so.class
    ORDER BY attendance_rate DESC, so.name ASC;
  `;

  db.all(query, [], (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json({ students: rows });
  });
});

// Get student details: courses and attendance for a given student (by name + class)
router.get('/stats/student-details', (req, res) => {
  const { name, class: className } = req.query;
  if (!name || !className) {
    res.status(400).json({ error: 'name and class are required' });
    return;
  }

  const detailsQuery = `
    SELECT
      f.course,
      COUNT(DISTINCT a.session_id) AS attendance_count,
      (
        SELECT COUNT(DISTINCT s.id)
        FROM sessions s
        WHERE s.class_name = f.class AND s.course_name = f.course
      ) AS total_sessions,
      CASE WHEN (
        SELECT COUNT(DISTINCT s2.id) FROM sessions s2 WHERE s2.class_name = f.class AND s2.course_name = f.course
      ) = 0 THEN 0
      ELSE ROUND(
        CAST(COUNT(DISTINCT a.session_id) AS FLOAT) /
        (
          SELECT COUNT(DISTINCT s3.id) FROM sessions s3 WHERE s3.class_name = f.class AND s3.course_name = f.course
        ) * 100, 2
      ) END AS attendance_rate
    FROM faces f
    LEFT JOIN attendance a ON a.face_id = f.id
    WHERE f.name = ? AND f.class = ?
    GROUP BY f.course
    ORDER BY attendance_rate DESC;
  `;

  db.all(detailsQuery, [name, className], (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }

    // Aggregate totals
    const totals = rows.reduce((acc, r) => {
      acc.courses += 1;
      acc.total_sessions += (r.total_sessions || 0);
      acc.attendance_count += (r.attendance_count || 0);
      return acc;
    }, { courses: 0, total_sessions: 0, attendance_count: 0 });
    const avg_rate = rows.length ? Number((rows.reduce((s, r) => s + (r.attendance_rate || 0), 0) / rows.length).toFixed(2)) : 0;

    res.json({ name, class: className, details: rows, totals: { ...totals, avg_attendance_rate: avg_rate } });
  });
});

module.exports = router;
