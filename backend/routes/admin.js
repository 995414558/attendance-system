const express = require('express');
const db = require('../database');
const router = express.Router();

// Admin health check
router.get('/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString(), uptime: process.uptime() });
});

// Clear database tables (password-protected)
// Body: { password: '88888888' }
// Deletes data from attendance, session_attendees, course_students, faces, courses, students, sessions
router.post('/clear', (req, res) => {
  const body = req.body || {};
  const password = body.password;
  if (password !== '88888888') {
    return res.status(403).json({ error: 'Invalid password' });
  }

  const tables = [
    'attendance',
    'session_attendees',
    'course_students',
    'faces',
    'courses',
    'students',
    'sessions'
  ];

  db.serialize(() => {
    // Ensure FKs on and begin transaction
    db.run('PRAGMA foreign_keys = ON');
    db.run('BEGIN IMMEDIATE TRANSACTION', (errBegin) => {
      if (errBegin) {
        return res.status(500).json({ error: errBegin.message });
      }

      const deleteNext = (i) => {
        if (i >= tables.length) {
          // Commit and VACUUM
          db.run('COMMIT', (errCommit) => {
            if (errCommit) {
              return db.run('ROLLBACK', () => res.status(500).json({ error: errCommit.message }));
            }
            db.run('VACUUM', (vacErr) => {
              if (vacErr) {
                return res.json({ ok: true, tables, vacuum: 'failed: ' + vacErr.message });
              }
              return res.json({ ok: true, tables, vacuum: 'ok' });
            });
          });
          return;
        }
        const sql = `DELETE FROM ${tables[i]}`;
        db.run(sql, function(errDel) {
          if (errDel) {
            return db.run('ROLLBACK', () => res.status(500).json({ error: errDel.message, table: tables[i] }));
          }
          deleteNext(i + 1);
        });
      };

      deleteNext(0);
    });
  });
});

module.exports = router;