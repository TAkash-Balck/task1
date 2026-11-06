const express = require('express');
const db = require('../db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

const STATUSES = ['todo', 'in_progress', 'done'];
const PRIORITIES = ['low', 'medium', 'high'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// Validates a body. When `partial` is true (PATCH), only provided fields are checked.
function validateTask(body, partial) {
  const errors = [];
  const data = {};

  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { errors: ['Request body must be a JSON object'], data };
  }

  if (!partial || body.title !== undefined) {
    if (typeof body.title !== 'string' || body.title.trim().length === 0) {
      errors.push('title is required and must be a non-empty string');
    } else if (body.title.trim().length > 200) {
      errors.push('title must be at most 200 characters');
    } else {
      data.title = body.title.trim();
    }
  }

  if (body.description !== undefined) {
    if (typeof body.description !== 'string') {
      errors.push('description must be a string');
    } else if (body.description.length > 2000) {
      errors.push('description must be at most 2000 characters');
    } else {
      data.description = body.description.trim();
    }
  }

  if (body.status !== undefined) {
    if (!STATUSES.includes(body.status)) {
      errors.push(`status must be one of: ${STATUSES.join(', ')}`);
    } else {
      data.status = body.status;
    }
  }

  if (body.priority !== undefined) {
    if (!PRIORITIES.includes(body.priority)) {
      errors.push(`priority must be one of: ${PRIORITIES.join(', ')}`);
    } else {
      data.priority = body.priority;
    }
  }

  if (body.due_date !== undefined) {
    if (body.due_date === null) {
      data.due_date = null;
    } else if (!isValidDate(body.due_date)) {
      errors.push('due_date must be a valid date in YYYY-MM-DD format, or null');
    } else {
      data.due_date = body.due_date;
    }
  }

  if (partial && errors.length === 0 && Object.keys(data).length === 0) {
    errors.push('Provide at least one field to update: title, description, status, priority, due_date');
  }

  return { errors, data };
}

function parseId(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'Task id must be a positive integer' });
    return null;
  }
  return id;
}

function findOwnedTask(id, userId) {
  return db.prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ?').get(id, userId);
}

// GET /api/tasks?status=&priority=
router.get('/', (req, res) => {
  const { status, priority } = req.query;
  const where = ['user_id = ?'];
  const params = [req.user.id];

  if (status !== undefined) {
    if (!STATUSES.includes(status)) {
      return res.status(400).json({ error: `status filter must be one of: ${STATUSES.join(', ')}` });
    }
    where.push('status = ?');
    params.push(status);
  }
  if (priority !== undefined) {
    if (!PRIORITIES.includes(priority)) {
      return res.status(400).json({ error: `priority filter must be one of: ${PRIORITIES.join(', ')}` });
    }
    where.push('priority = ?');
    params.push(priority);
  }

  const tasks = db
    .prepare(`SELECT * FROM tasks WHERE ${where.join(' AND ')} ORDER BY id DESC`)
    .all(...params);
  res.status(200).json({ count: tasks.length, tasks });
});

// GET /api/tasks/:id
router.get('/:id', (req, res) => {
  const id = parseId(req, res);
  if (id === null) return;
  const task = findOwnedTask(id, req.user.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  res.status(200).json(task);
});

// POST /api/tasks
router.post('/', (req, res) => {
  const { errors, data } = validateTask(req.body, false);
  if (errors.length) return res.status(400).json({ error: 'Validation failed', details: errors });

  const task = {
    title: data.title,
    description: data.description ?? '',
    status: data.status ?? 'todo',
    priority: data.priority ?? 'medium',
    due_date: data.due_date ?? null,
  };

  const result = db
    .prepare(
      `INSERT INTO tasks (user_id, title, description, status, priority, due_date)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(req.user.id, task.title, task.description, task.status, task.priority, task.due_date);

  res.status(201).json(findOwnedTask(result.lastInsertRowid, req.user.id));
});

// PUT /api/tasks/:id  (full replace: title required)
router.put('/:id', (req, res) => {
  const id = parseId(req, res);
  if (id === null) return;
  if (!findOwnedTask(id, req.user.id)) return res.status(404).json({ error: 'Task not found' });

  const { errors, data } = validateTask(req.body, false);
  if (errors.length) return res.status(400).json({ error: 'Validation failed', details: errors });

  db.prepare(
    `UPDATE tasks
       SET title = ?, description = ?, status = ?, priority = ?, due_date = ?, updated_at = datetime('now')
     WHERE id = ? AND user_id = ?`
  ).run(
    data.title,
    data.description ?? '',
    data.status ?? 'todo',
    data.priority ?? 'medium',
    data.due_date ?? null,
    id,
    req.user.id
  );

  res.status(200).json(findOwnedTask(id, req.user.id));
});

// PATCH /api/tasks/:id  (partial update)
router.patch('/:id', (req, res) => {
  const id = parseId(req, res);
  if (id === null) return;
  const existing = findOwnedTask(id, req.user.id);
  if (!existing) return res.status(404).json({ error: 'Task not found' });

  const { errors, data } = validateTask(req.body, true);
  if (errors.length) return res.status(400).json({ error: 'Validation failed', details: errors });

  const merged = { ...existing, ...data };
  db.prepare(
    `UPDATE tasks
       SET title = ?, description = ?, status = ?, priority = ?, due_date = ?, updated_at = datetime('now')
     WHERE id = ? AND user_id = ?`
  ).run(merged.title, merged.description, merged.status, merged.priority, merged.due_date, id, req.user.id);

  res.status(200).json(findOwnedTask(id, req.user.id));
});

// DELETE /api/tasks/:id
router.delete('/:id', (req, res) => {
  const id = parseId(req, res);
  if (id === null) return;
  const result = db.prepare('DELETE FROM tasks WHERE id = ? AND user_id = ?').run(id, req.user.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Task not found' });
  res.status(200).json({ message: 'Task deleted successfully' });
});

module.exports = router;
