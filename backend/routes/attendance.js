const express = require('express');
const db = require('../database');
const router = express.Router();

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

// Get statistics by course
router.get('/stats/by-course', (req, res) => {
  const query = `
    SELECT
      s.course_name as course,
      COUNT(DISTINCT f.id) as total_students,
      COUNT(DISTINCT s.id) as total_sessions,
      COUNT(DISTINCT a.id) as total_attendance,
      ROUND(CAST(COUNT(DISTINCT a.id) AS FLOAT) / NULLIF(COUNT(DISTINCT s.id), 0) * 100, 2) as attendance_rate
    FROM sessions s
    LEFT JOIN faces f ON f.class = s.class_name AND f.course = s.course_name
    LEFT JOIN attendance a ON a.session_id = s.id
    GROUP BY s.course_name
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
    SELECT
      s.class_name as class,
      COUNT(DISTINCT f.id) as total_students,
      COUNT(DISTINCT s.id) as total_sessions,
      COUNT(DISTINCT a.id) as total_attendance,
      ROUND(CAST(COUNT(DISTINCT a.id) AS FLOAT) / NULLIF(COUNT(DISTINCT s.id), 0) * 100, 2) as attendance_rate
    FROM sessions s
    LEFT JOIN faces f ON f.class = s.class_name AND f.course = s.course_name
    LEFT JOIN attendance a ON a.session_id = s.id
    GROUP BY s.class_name
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

// Record attendance with enrollment validation (students-courses mapping)
router.post('/', (req, res) => {
  const { face_id, session_id } = req.body;
  if (!face_id || !session_id) {
    return res.status(400).json({ error: 'face_id and session_id are required' });
  }

  // Resolve face and session
  db.get('SELECT id, name, class, course FROM faces WHERE id = ?', [face_id], (err, faceRow) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    if (!faceRow) {
      return res.status(404).json({ error: 'Face not found' });
    }

    db.get('SELECT id, class_name, course_name FROM sessions WHERE id = ?', [session_id], (err2, sessionRow) => {
      if (err2) {
        res.status(500).json({ error: err2.message });
        return;
      }
      if (!sessionRow) {
        return res.status(404).json({ error: 'Session not found' });
      }

      // Enrollment validation using course_students mapping by course_name and student name
      db.get(
        'SELECT 1 FROM course_students WHERE course_name = ? AND name = ? LIMIT 1',
        [sessionRow.course_name, faceRow.name],
        (err3, mapRow) => {
          if (err3) {
            res.status(500).json({ error: err3.message });
            return;
          }

          if (!mapRow) {
            // Legacy fallback: allow if legacy faces.course matches session.course_name
            if (faceRow.course !== sessionRow.course_name) {
              return res.status(400).json({
                error: 'Student is not enrolled in this course',
                details: { student_name: faceRow.name, course_name: sessionRow.course_name }
              });
            }
          }

          // Passed validation, insert attendance
          db.run(
            'INSERT INTO attendance (face_id, session_id) VALUES (?, ?)',
            [face_id, session_id],
            function (err4) {
              if (err4) {
                res.status(500).json({ error: err4.message });
                return;
              }
              res.json({ id: this.lastID });
            }
          );
        }
      );
    });
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

  // Check for duplicate sessions within 40 minutes
  const checkQuery = `
    SELECT id, start_time
    FROM sessions
    WHERE class_name = ? AND course_name = ?
      AND start_time >= datetime(?, '-40 minutes')
      AND start_time <= datetime(?, '+40 minutes')
    ORDER BY start_time DESC
    LIMIT 1
  `;

  db.get(checkQuery, [class_name, course_name, start_time, start_time], (err, row) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }

    if (row) {
      // Found a duplicate session within 40 minutes
      res.json({
        duplicate: true,
        existing_session: row,
        message: '在40分钟内发现相同的考勤会话，是否要覆盖上一次记录？'
      });
      return;
    }

    // No duplicate found, create new session
    db.run(
      'INSERT INTO sessions (id, class_name, course_name, start_time, status) VALUES (?, ?, ?, ?, ?)',
      [sessionId, class_name, course_name, start_time, 'active'],
      function(err) {
        if (err) {
          res.status(500).json({ error: err.message });
          return;
        }
        res.json({ id: sessionId, duplicate: false });
      }
    );
  });
});

router.put('/sessions/:id/end', (req, res) => {
   const { id } = req.params;
   const { end_time } = req.body;

   // Update session with end time and change status to completed
   db.run(
     'UPDATE sessions SET end_time = ?, status = ? WHERE id = ?',
     [end_time, 'completed', id],
     function(err) {
       if (err) {
         res.status(500).json({ error: err.message });
         return;
       }

       // Generate final session ID with time range
       const finalSessionId = `${id.split('(')[0]}(${id.split('(')[1].split(')')[0]} - ${end_time})`;

       // Update the session ID to include end time
       db.run(
         'UPDATE sessions SET id = ? WHERE id = ?',
         [finalSessionId, id],
         function(err2) {
           if (err2) {
             res.status(500).json({ error: err2.message });
             return;
           }
           res.json({ final_session_id: finalSessionId });
         }
       );
     }
   );
 });

// Override duplicate session
router.post('/sessions/override', (req, res) => {
  const { existing_session_id, new_session_data } = req.body;
  const { class_name, course_name, start_time } = new_session_data;
  const newSessionId = `${class_name}-${course_name}(${start_time})`;

  // Delete existing session and its attendance records
  db.run('DELETE FROM attendance WHERE session_id = ?', [existing_session_id], function(err) {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }

    // Delete the existing session
    db.run('DELETE FROM sessions WHERE id = ?', [existing_session_id], function(err) {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }

      // Create new session
      db.run(
        'INSERT INTO sessions (id, class_name, course_name, start_time, status) VALUES (?, ?, ?, ?, ?)',
        [newSessionId, class_name, course_name, start_time, 'active'],
        function(err) {
          if (err) {
            res.status(500).json({ error: err.message });
            return;
          }
          res.json({
            id: newSessionId,
            message: '已覆盖上一次考勤会话，原有记录已被清除'
          });
        }
      );
    });
  });
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

  // First get total sessions for this class
  const totalSessionsQuery = `
    SELECT COUNT(DISTINCT id) as total_sessions
    FROM sessions
    WHERE class_name = ?
  `;

  db.get(totalSessionsQuery, [className], (err, totalResult) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }

    const totalSessions = totalResult.total_sessions;

    // Then get attendance details for each student
    const detailsQuery = `
      SELECT
        f.name,
        f.course,
        COUNT(DISTINCT a.session_id) as attendance_count,
        ROUND(CAST(COUNT(DISTINCT a.session_id) AS FLOAT) / NULLIF(?, 0) * 100, 2) as attendance_rate
      FROM faces f
      LEFT JOIN attendance a ON f.id = a.face_id
      LEFT JOIN sessions s ON a.session_id = s.id AND s.class_name = ?
      WHERE f.class = ?
      GROUP BY f.id
      ORDER BY attendance_rate DESC
    `;

    db.all(detailsQuery, [totalSessions, className, className], (err, rows) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      res.json({ details: rows, total_sessions: totalSessions });
    });
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
