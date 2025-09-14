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

// Serve static files from frontend
app.use(express.static('../frontend'));

// Serve uploads (student photos)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Serve face-api.js models from the weights directory
app.use('/weights', express.static('../../weights'));

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/../frontend/index.html');
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = app;