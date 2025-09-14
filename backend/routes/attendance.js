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
      sa.course_name,
      st.photo_path
    FROM session_attendees sa
    LEFT JOIN students st ON st.student_number = sa.student_number
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
    WITH courses_all AS (
      SELECT DISTINCT course_name AS course FROM course_students
      UNION
      SELECT DISTINCT course_name AS course FROM sessions
    ),
    course_sessions AS (
      SELECT ca.course,
             COALESCE((SELECT COUNT(DISTINCT s.id) FROM sessions s WHERE s.course_name = ca.course), 0) AS total_sessions
      FROM courses_all ca
    ),
    students_in_course AS (
      SELECT DISTINCT cs.course_name AS course, cs.student_number, s.class_name
      FROM course_students cs
      JOIN students s ON s.student_number = cs.student_number
    ),
    per_student AS (
      SELECT sic.course,
             sic.student_number,
             COALESCE(COUNT(DISTINCT sess.id), 0) AS total_for_student,
             COALESCE(COUNT(DISTINCT sa.session_id), 0) AS attended
      FROM students_in_course sic
      LEFT JOIN sessions sess
        ON sess.course_name = sic.course
       AND sess.class_name = sic.class_name
      LEFT JOIN session_attendees sa
        ON sa.session_id = sess.id
       AND sa.student_number = sic.student_number
       AND sa.course_name = sic.course
      GROUP BY sic.course, sic.student_number
    )
    SELECT
      cs.course,
      COUNT(DISTINCT ps.student_number) AS total_students,
      cs.total_sessions,
      COALESCE(SUM(ps.attended), 0) AS total_attendance,
      ROUND(
        AVG(
          CASE WHEN COALESCE(ps.total_for_student, 0) = 0
               THEN 0
               ELSE CAST(ps.attended AS FLOAT) / ps.total_for_student
          END
        ) * 100, 2
      ) AS attendance_rate
    FROM course_sessions cs
    LEFT JOIN per_student ps ON ps.course = cs.course
    GROUP BY cs.course
    ORDER BY attendance_rate DESC
  `;

  console.log('[stats/by-course] executing SQL:\n' + query);
  console.time('[stats/by-course]');
  db.all(query, [], (err, rows) => {
    console.timeEnd('[stats/by-course]');
    if (err) {
      console.error('[stats/by-course] error:', err.message);
      res.status(500).json({ error: err.message });
      return;
    }
    console.log('[stats/by-course] rows:', rows ? rows.length : 0);
    res.json({ stats: rows });
  });
});

// Get statistics by class (students + session_attendees based)
router.get('/stats/by-class', (req, res) => {
  const query = `
    WITH class_sessions AS (
      SELECT class_name AS class, COUNT(DISTINCT id) AS total_sessions
      FROM sessions
      GROUP BY class_name
    ),
    students_in_class AS (
      SELECT class_name AS class, student_number
      FROM students
      WHERE class_name IS NOT NULL
    ),
    per_student AS (
      SELECT sic.class,
             sic.student_number,
             COUNT(DISTINCT sa.session_id) AS attended
      FROM students_in_class sic
      LEFT JOIN sessions s ON s.class_name = sic.class
      LEFT JOIN session_attendees sa
        ON sa.session_id = s.id
       AND sa.student_number = sic.student_number
       AND sa.course_name = s.course_name
      GROUP BY sic.class, sic.student_number
    )
    SELECT
      cs.class,
      COUNT(DISTINCT ps.student_number) AS total_students,
      cs.total_sessions,
      COALESCE(SUM(ps.attended), 0) AS total_attendance,
      ROUND(
        AVG(CASE WHEN cs.total_sessions = 0 THEN 0 ELSE CAST(ps.attended AS FLOAT) / cs.total_sessions END) * 100,
        2
      ) AS attendance_rate
    FROM class_sessions cs
    LEFT JOIN per_student ps ON ps.class = cs.class
    GROUP BY cs.class
    ORDER BY attendance_rate DESC
  `;

  console.log('[stats/by-class] executing SQL:\n' + query);
  console.time('[stats/by-class]');
  db.all(query, [], (err, rows) => {
    console.timeEnd('[stats/by-class]');
    if (err) {
      console.error('[stats/by-class] error:', err.message);
      res.status(500).json({ error: err.message });
      return;
    }
    console.log('[stats/by-class] rows:', rows ? rows.length : 0);
    res.json({ stats: rows });
  });
});

// Get overall statistics (students + course_students + session_attendees)
router.get('/stats/overall', (req, res) => {
  const queries = {
    total_students: 'SELECT COUNT(*) as count FROM students',
    total_sessions: 'SELECT COUNT(DISTINCT id) as count FROM sessions',
    total_attendance: 'SELECT COUNT(*) as count FROM (SELECT DISTINCT session_id, student_number, course_name FROM session_attendees)',
    avg_attendance_rate: `
      /* Attended-course denominator:
         For each student, consider only the courses (sa.course_name)
         where the student actually has attendance within their class.
         Denominator = total sessions in their class for those courses. */
      WITH student_overview AS (
        SELECT student_number, class_name AS class
        FROM students
        WHERE class_name IS NOT NULL
      ),
      attended_courses AS (
        SELECT so.student_number, sa.course_name
        FROM student_overview so
        JOIN session_attendees sa ON sa.student_number = so.student_number
        JOIN sessions sess ON sess.id = sa.session_id
        WHERE sess.class_name = so.class
        GROUP BY so.student_number, sa.course_name
      ),
      total_sessions AS (
        SELECT so.student_number, COUNT(DISTINCT sess.id) AS total_sessions
        FROM student_overview so
        LEFT JOIN attended_courses ac ON ac.student_number = so.student_number
        LEFT JOIN sessions sess
          ON sess.class_name = so.class
         AND sess.course_name = ac.course_name
        GROUP BY so.student_number
      ),
      attendance_count AS (
        SELECT so.student_number, COUNT(DISTINCT sa.session_id) AS attendance_count
        FROM student_overview so
        JOIN session_attendees sa ON sa.student_number = so.student_number
        JOIN sessions sess ON sess.id = sa.session_id
        WHERE sess.class_name = so.class
        GROUP BY so.student_number
      )
      SELECT ROUND(
        AVG(
          CASE WHEN COALESCE(ts.total_sessions, 0) = 0
               THEN 0
               ELSE CAST(COALESCE(ac.attendance_count, 0) AS FLOAT) / ts.total_sessions
          END
        ) * 100, 2
      ) AS rate
      FROM student_overview so
      LEFT JOIN total_sessions ts ON ts.student_number = so.student_number
      LEFT JOIN attendance_count ac ON ac.student_number = so.student_number
    `
  };

  const results = {};

  console.log('[stats/overall] executing keys:', Object.keys(queries));
  const executeQueries = (keys) => {
    if (keys.length === 0) {
      console.log('[stats/overall] final results:', results);
      res.json({ stats: results });
      return;
    }
  
    const key = keys[0];
    const sql = queries[key];
    console.log(`[stats/overall] SQL for ${key}:\n${sql}`);
    console.time(`[stats/overall] ${key}`);
    db.get(sql, [], (err, row) => {
      console.timeEnd(`[stats/overall] ${key}`);
      if (err) {
        console.error('[stats/overall] error for', key, err.message);
        res.status(500).json({ error: err.message, key });
        return;
      }
      results[key] = row ? (row.count ?? row.rate ?? 0) : 0;
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

  // Verify session exists and get course_name
  db.get('SELECT id, course_name FROM sessions WHERE id = ?', [session_id], (errSession, sessionRow) => {
    if (errSession) return res.status(500).json({ error: errSession.message });
    if (!sessionRow) return res.status(404).json({ error: 'Session not found' });

    const sessionCourse = sessionRow.course_name;

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

        // Insert or ignore session attendee (de-dup per session_id + student_number + course_name)
        db.run(
          'INSERT OR IGNORE INTO session_attendees (session_id, student_number, course_name, first_seen) VALUES (?, ?, ?, ?)',
          [session_id, sn, sessionCourse, cnNow()],
          function (errInsAtt) {
            if (errInsAtt) return res.status(500).json({ error: errInsAtt.message });
            const inserted = this.changes > 0;
            if (!inserted) {
              // Duplicate within session+course, do not insert legacy attendance again
              return res.json({ ok: true, duplicate: true, student_number: sn, course_name: sessionCourse });
            }
            // First time seen in this session+course -> insert one legacy attendance row for summary compatibility
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

// Get detailed statistics for a specific course (mapping + session_attendees)
router.get('/stats/course-details/:course', (req, res) => {
  const { course } = req.params;

  const detailsQuery = `
    WITH enrolled AS (
      SELECT DISTINCT cs.student_number
      FROM course_students cs
      JOIN courses c ON c.course_code = cs.course_code
      WHERE c.course_name = ?
    ),
    student_info AS (
      SELECT s.student_number, s.name, s.class_name
      FROM students s
      JOIN enrolled e ON e.student_number = s.student_number
    ),
    per_student AS (
      SELECT si.student_number,
             COALESCE(COUNT(DISTINCT sa.session_id), 0) AS attendance_count,
             COALESCE(COUNT(DISTINCT sess.id), 0) AS total_sessions
      FROM student_info si
      LEFT JOIN sessions sess
        ON sess.course_name = ?
       AND sess.class_name = si.class_name
      LEFT JOIN session_attendees sa
        ON sa.session_id = sess.id
       AND sa.student_number = si.student_number
       AND sa.course_name = ?
      GROUP BY si.student_number
    )
    SELECT
      si.name,
      si.class_name AS class,
      COALESCE(ps.attendance_count, 0) AS attendance_count,
      COALESCE(ps.total_sessions, 0) AS total_sessions,
      CASE WHEN COALESCE(ps.total_sessions, 0) = 0
           THEN 0
           ELSE ROUND(CAST(ps.attendance_count AS FLOAT) / ps.total_sessions * 100, 2)
      END AS attendance_rate
    FROM student_info si
    LEFT JOIN per_student ps ON ps.student_number = si.student_number
    ORDER BY attendance_rate DESC
  `;

  console.log('[stats/course-details] course=', course);
  console.log('[stats/course-details] SQL:\n' + detailsQuery);
  console.time('[stats/course-details]');
  db.all(detailsQuery, [course, course, course], (err, rows) => {
    console.timeEnd('[stats/course-details]');
    if (err) {
      console.error('[stats/course-details] error:', err.message);
      res.status(500).json({ error: err.message });
      return;
    }
    console.log('[stats/course-details] rows:', rows ? rows.length : 0);
    res.json({ details: rows });
  });
});

// Get detailed statistics for a specific class (mapping + session_attendees)
router.get('/stats/class-details/:class', (req, res) => {
  const { class: className } = req.params;

  const query = `
    WITH students_in_class AS (
      SELECT s.student_number, s.name, s.class_name AS class
      FROM students s
      WHERE s.class_name = ?
    ),
    student_courses AS (
      SELECT cs.student_number, cs.course_code
      FROM course_students cs
    ),
    total_sessions AS (
      SELECT sic.student_number,
             COUNT(DISTINCT sess.id) AS total_sessions
      FROM students_in_class sic
      LEFT JOIN student_courses sc ON sc.student_number = sic.student_number
      LEFT JOIN courses c ON c.course_code = sc.course_code
      LEFT JOIN sessions sess
        ON sess.class_name = sic.class
       AND sess.course_name = c.course_name
      GROUP BY sic.student_number
    ),
    attendance_count AS (
      SELECT sic.student_number,
             COUNT(DISTINCT sa.session_id) AS attendance_count
      FROM students_in_class sic
      LEFT JOIN sessions sess ON sess.class_name = sic.class
      LEFT JOIN session_attendees sa
        ON sa.session_id = sess.id
       AND sa.student_number = sic.student_number
       AND sa.course_name = sess.course_name
      GROUP BY sic.student_number
    )
    SELECT sic.name,
           sic.class,
           COALESCE(ac.attendance_count, 0) AS attendance_count,
           COALESCE(ts.total_sessions, 0) AS total_sessions,
           CASE WHEN COALESCE(ts.total_sessions, 0) = 0
                THEN 0
                ELSE ROUND(CAST(COALESCE(ac.attendance_count, 0) AS FLOAT) / ts.total_sessions * 100, 2)
           END AS attendance_rate
    FROM students_in_class sic
    LEFT JOIN total_sessions ts ON ts.student_number = sic.student_number
    LEFT JOIN attendance_count ac ON ac.student_number = sic.student_number
    ORDER BY attendance_rate DESC
  `;

  console.log('[stats/class-details] class=', className);
  console.log('[stats/class-details] SQL:\n' + query);
  console.time('[stats/class-details]');
  db.all(query, [className], (err, rows) => {
    console.timeEnd('[stats/class-details]');
    if (err) {
      console.error('[stats/class-details] error:', err.message);
      res.status(500).json({ error: err.message });
      return;
    }
    console.log('[stats/class-details] rows:', rows ? rows.length : 0);
    res.json({ details: rows });
  });
});

// Get students overview statistics (students + course_students + session_attendees)
router.get('/stats/students', (req, res) => {
  const query = `
    /* Attended-course denominator per student within their class */
    WITH student_overview AS (
      SELECT student_number, name, class_name AS class
      FROM students
      WHERE name IS NOT NULL AND class_name IS NOT NULL
    ),
    attended_courses AS (
      SELECT so.student_number, sa.course_name
      FROM student_overview so
      JOIN session_attendees sa ON sa.student_number = so.student_number
      JOIN sessions sess ON sess.id = sa.session_id
      WHERE sess.class_name = so.class
      GROUP BY so.student_number, sa.course_name
    ),
    courses_count AS (
      SELECT student_number, COUNT(DISTINCT course_name) AS courses_count
      FROM attended_courses
      GROUP BY student_number
    ),
    total_sessions AS (
      SELECT so.student_number, COUNT(DISTINCT sess.id) AS total_sessions
      FROM student_overview so
      LEFT JOIN attended_courses ac ON ac.student_number = so.student_number
      LEFT JOIN sessions sess
        ON sess.class_name = so.class
       AND sess.course_name = ac.course_name
      GROUP BY so.student_number
    ),
    attendance_count AS (
      SELECT so.student_number, COUNT(DISTINCT sa.session_id) AS attendance_count
      FROM student_overview so
      JOIN session_attendees sa ON sa.student_number = so.student_number
      JOIN sessions sess ON sess.id = sa.session_id
      WHERE sess.class_name = so.class
      GROUP BY so.student_number
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
    LEFT JOIN courses_count cc ON cc.student_number = so.student_number
    LEFT JOIN total_sessions ts ON ts.student_number = so.student_number
    LEFT JOIN attendance_count ac ON ac.student_number = so.student_number
    ORDER BY attendance_rate DESC, so.name ASC;
  `;
  
  console.log('[stats/students] executing SQL:\n' + query);
  console.time('[stats/students]');
  db.all(query, [], (err, rows) => {
    console.timeEnd('[stats/students]');
    if (err) {
      console.error('[stats/students] error:', err.message);
      res.status(500).json({ error: err.message });
      return;
    }
    console.log('[stats/students] rows:', rows ? rows.length : 0);
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
    /* Student details with attended-course denominator within the student's class */
    WITH target_student AS (
      SELECT student_number, class_name AS class
      FROM students
      WHERE name = ? AND class_name = ?
      LIMIT 1
    ),
    attended_courses AS (
      SELECT DISTINCT sa.course_name AS course
      FROM session_attendees sa
      JOIN sessions sess ON sess.id = sa.session_id
      JOIN target_student ts ON ts.student_number = sa.student_number
      WHERE sess.class_name = ts.class
    ),
    per_course AS (
      SELECT ac.course,
             COUNT(DISTINCT sa.session_id) AS attendance_count,
             COUNT(DISTINCT sess.id) AS total_sessions
      FROM attended_courses ac
      JOIN target_student ts
      LEFT JOIN sessions sess
        ON sess.class_name = ts.class
       AND sess.course_name = ac.course
      LEFT JOIN session_attendees sa
        ON sa.session_id = sess.id
       AND sa.student_number = ts.student_number
      GROUP BY ac.course
    )
    SELECT
      pc.course,
      COALESCE(pc.attendance_count, 0) AS attendance_count,
      COALESCE(pc.total_sessions, 0) AS total_sessions,
      CASE WHEN COALESCE(pc.total_sessions, 0) = 0
           THEN 0
           ELSE ROUND(CAST(pc.attendance_count AS FLOAT) / pc.total_sessions * 100, 2)
      END AS attendance_rate
    FROM per_course pc
    ORDER BY attendance_rate DESC;
  `;

  console.log('[stats/student-details] name=', name, 'class=', className);
  console.log('[stats/student-details] SQL:\n' + detailsQuery);
  console.time('[stats/student-details]');
  db.all(detailsQuery, [name, className], (err, rows) => {
    console.timeEnd('[stats/student-details]');
    if (err) {
      console.error('[stats/student-details] error:', err.message);
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
  
    console.log('[stats/student-details] rows:', rows ? rows.length : 0, 'totals:', totals, 'avg_rate:', avg_rate);
    res.json({ name, class: className, details: rows, totals: { ...totals, avg_attendance_rate: avg_rate } });
  });
});

module.exports = router;
