const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./attendance.db');

db.serialize(() => {
  // Ensure foreign key constraints are enforced
  db.run('PRAGMA foreign_keys = ON');

  // Create faces table (existing - kept for compatibility)
  db.run(`
    CREATE TABLE IF NOT EXISTS faces (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label TEXT NOT NULL,
      descriptors TEXT NOT NULL,
      class TEXT,
      name TEXT,
      course TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create attendance table (existing)
  db.run(`
    CREATE TABLE IF NOT EXISTS attendance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      face_id INTEGER,
      session_id TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (face_id) REFERENCES faces (id)
    )
  `);

  // Create sessions table for attendance sessions (existing)
  db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      class_name TEXT NOT NULL,
      course_name TEXT NOT NULL,
      start_time DATETIME,
      end_time DATETIME,
      status TEXT DEFAULT 'active'
    )
  `);

  // New: students table
  db.run(`
    CREATE TABLE IF NOT EXISTS students (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_number TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      gender TEXT,
      face_descriptors TEXT, -- JSON string of face-api descriptors
      photo_path TEXT,       -- stored relative path to uploaded photo
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Add class_name column if missing (SQLite allows ADD COLUMN; ignore error if it exists)
  db.run(`ALTER TABLE students ADD COLUMN class_name TEXT`, function (err) {
    if (err && !String(err.message).toLowerCase().includes('duplicate column')) {
      console.warn('ALTER TABLE students ADD COLUMN class_name failed:', err.message);
    }
  });

  // New: courses table
  db.run(`
    CREATE TABLE IF NOT EXISTS courses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_code TEXT NOT NULL UNIQUE,
      course_name TEXT NOT NULL,
      course_hours INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // New: course-students mapping table
  db.run(`
    CREATE TABLE IF NOT EXISTS course_students (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_number TEXT NOT NULL,
      name TEXT NOT NULL,
      course_name TEXT NOT NULL,
      course_code TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(student_number, course_code),
      FOREIGN KEY (student_number) REFERENCES students (student_number) ON DELETE CASCADE,
      FOREIGN KEY (course_code) REFERENCES courses (course_code) ON DELETE CASCADE
    )
  `);

  // New: session_attendees (unique per session_id + student_number + course_name)
  db.run(`
    CREATE TABLE IF NOT EXISTS session_attendees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      student_number TEXT NOT NULL,
      course_name TEXT NOT NULL,
      first_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(session_id, student_number, course_name),
      FOREIGN KEY (session_id) REFERENCES sessions (id) ON DELETE CASCADE,
      FOREIGN KEY (student_number) REFERENCES students (student_number) ON DELETE CASCADE
    )
  `);

  // Add course_name column to existing session_attendees if missing
  db.run(`ALTER TABLE session_attendees ADD COLUMN course_name TEXT`, function (err) {
    if (err && !String(err.message).toLowerCase().includes('duplicate column')) {
      console.warn('ALTER TABLE session_attendees ADD COLUMN course_name failed:', err.message);
    } else {
      // Migrate existing session_attendees records to populate course_name from sessions
      db.run(`
        UPDATE session_attendees
        SET course_name = (
          SELECT s.course_name
          FROM sessions s
          WHERE s.id = session_attendees.session_id
        )
        WHERE course_name IS NULL
      `, function(migErr) {
        if (migErr) {
          console.warn('Failed to migrate existing session_attendees course_name:', migErr.message);
        } else {
          console.log(`Migrated ${this.changes} session_attendees records with course_name`);
        }
      });
    }
  });

  // Drop old unique constraint and create new one (SQLite limitation workaround)
  db.run(`DROP INDEX IF EXISTS session_attendees_unique`, function() {
    db.run(`CREATE UNIQUE INDEX IF NOT EXISTS session_attendees_unique ON session_attendees(session_id, student_number, course_name)`);
  });

  // Helpful indexes
  db.run(`CREATE INDEX IF NOT EXISTS idx_attendance_session ON attendance(session_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_attendance_face ON attendance(face_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_course_students_student ON course_students(student_number)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_course_students_course ON course_students(course_code)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_session_attendees_session ON session_attendees(session_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_session_attendees_student ON session_attendees(student_number)`);
});

module.exports = db;