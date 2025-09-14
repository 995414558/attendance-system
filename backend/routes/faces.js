const express = require('express');
const db = require('../database');
const router = express.Router();

// Get all faces
router.get('/', (req, res) => {
  db.all('SELECT * FROM faces', [], (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json({ faces: rows });
  });
});

// Get face by ID
router.get('/:id', (req, res) => {
  const { id } = req.params;
  db.get('SELECT * FROM faces WHERE id = ?', [id], (err, row) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json({ face: row });
  });
});

// Create new face
router.post('/', (req, res) => {
  const { label, descriptors, class: className, name, course } = req.body;
  db.run(
    'INSERT INTO faces (label, descriptors, class, name, course) VALUES (?, ?, ?, ?, ?)',
    [label, JSON.stringify(descriptors), className, name, course],
    function(err) {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      res.json({ id: this.lastID });
    }
  );
});

// Update face
router.put('/:id', (req, res) => {
  const { id } = req.params;
  const { label, descriptors, class: className, name, course } = req.body;
  db.run(
    'UPDATE faces SET label = ?, descriptors = ?, class = ?, name = ?, course = ? WHERE id = ?',
    [label, JSON.stringify(descriptors), className, name, course, id],
    function(err) {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      res.json({ changes: this.changes });
    }
  );
});

// Delete face
router.delete('/:id', (req, res) => {
  const { id } = req.params;
  db.run('DELETE FROM faces WHERE id = ?', [id], function(err) {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json({ changes: this.changes });
  });
});

module.exports = router;