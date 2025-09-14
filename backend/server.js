const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./database');
const facesRoutes = require('./routes/faces');
const attendanceRoutes = require('./routes/attendance');
const studentsRoutes = require('./routes/students');
const coursesRoutes = require('./routes/courses');
const courseStudentsRoutes = require('./routes/courseStudents');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api/faces', facesRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/students', studentsRoutes);
app.use('/api/courses', coursesRoutes);
app.use('/api/course-students', courseStudentsRoutes);

// Admin route (DB maintenance)
const adminRoutes = require('./routes/admin');
app.use('/api/admin', adminRoutes);

// Force /index.html to redirect to /data.html (default landing)
app.get('/index.html', (req, res) => {
  res.redirect(302, '/data.html');
});

// Serve static files from frontend with UTF-8 charset and dev no-cache for text assets
const frontendDir = path.join(__dirname, '..', 'frontend');
app.use(express.static(frontendDir, {
  index: false,
  setHeaders: (res, filePath) => {
    const lower = filePath.toLowerCase();
    const isText = (
      lower.endsWith('.html') || lower.endsWith('.htm') ||
      lower.endsWith('.js') || lower.endsWith('.mjs') ||
      lower.endsWith('.css') || lower.endsWith('.json') ||
      lower.endsWith('.svg')
    );
    if (lower.endsWith('.html') || lower.endsWith('.htm')) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
    } else if (lower.endsWith('.js') || lower.endsWith('.mjs')) {
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    } else if (lower.endsWith('.css')) {
      res.setHeader('Content-Type', 'text/css; charset=utf-8');
    } else if (lower.endsWith('.json')) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
    } else if (lower.endsWith('.svg')) {
      res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
    }
    // Avoid stale cache when iterating during development
    if (isText) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}));

// Serve uploads (student photos)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Serve face-api.js models from the weights directory
app.use('/weights', express.static(path.join(__dirname, '..', '..', 'weights')));

// Default landing -> data.html with UTF-8
app.get('/', (req, res) => {
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.sendFile(path.join(frontendDir, 'data.html'));
});

// /index.html redirect is handled before static middleware

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = app;
