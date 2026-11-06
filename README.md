# Task Manager API

A CRUD REST API with user authentication, built with **Node.js, Express and SQLite**.
Passwords are hashed with **bcrypt**, and all task endpoints are protected with **JWT** bearer tokens.
Each user can only see and modify their own tasks.

## Features

- Full CRUD on a `tasks` resource
- User registration and login (bcrypt password hashing, JWT auth)
- Protected routes (`401` without a valid token)
- Input validation on every write endpoint with clear error messages
- Proper HTTP status codes
- Per-user data isolation (other users' tasks return `404`)
- Automated end-to-end test suite (`npm test`)

## Setup

Requires Node.js 18 or newer.

```bash
git clone <your-repo-url>
cd task-api
npm install
cp .env.example .env     # then set JWT_SECRET to a long random string
npm start
```

The server runs on `http://localhost:3000` by default. The SQLite database file (`data.db`) is created automatically on first run.

| Variable     | Default                   | Description                       |
|--------------|---------------------------|-----------------------------------|
| `PORT`       | `3000`                    | Port to listen on                 |
| `JWT_SECRET` | dev-only fallback         | Secret used to sign JWTs. **Set this.** |
| `DB_PATH`    | `./data.db`               | Location of the SQLite file       |

Run the tests with:

```bash
npm test
```

## Data model

**users**: `id`, `username` (unique), `email` (unique), `password_hash`, `created_at`

**tasks**: `id`, `user_id`, `title`, `description`, `status`, `priority`, `due_date`, `created_at`, `updated_at`

| Field         | Type    | Rules                                                     |
|---------------|---------|-----------------------------------------------------------|
| `title`       | string  | required, 1-200 characters                                |
| `description` | string  | optional, up to 2000 characters, default `""`             |
| `status`      | string  | `todo` (default), `in_progress`, `done`                   |
| `priority`    | string  | `low`, `medium` (default), `high`                         |
| `due_date`    | string  | optional, `YYYY-MM-DD`, or `null`                         |

## Authentication

Register, log in, then send the returned token on every `/api/tasks` request:

```
Authorization: Bearer <token>
```

Tokens expire after 1 hour.

## Status codes

| Code | Meaning                                                 |
|------|---------------------------------------------------------|
| 200  | Success                                                 |
| 201  | Resource created                                        |
| 400  | Invalid input, malformed JSON, or invalid id            |
| 401  | Missing, invalid or expired token; wrong login          |
| 404  | Resource (or route) not found                           |
| 409  | Username or email already registered                    |
| 500  | Unexpected server error                                 |

Errors always have this shape:

```json
{ "error": "Validation failed", "details": ["title is required and must be a non-empty string"] }
```

(`details` is present on validation errors only.)

---

## Endpoints

### Auth

#### `POST /api/auth/register`

Create an account.

Request body:

```json
{ "username": "alice", "email": "alice@example.com", "password": "password123" }
```

Rules: `username` 3-30 chars, valid `email`, `password` at least 8 chars.

**201 Created**

```json
{
  "message": "User registered successfully",
  "user": { "id": 1, "username": "alice", "email": "alice@example.com" }
}
```

Errors: `400` validation failed, `409` username/email already in use.

#### `POST /api/auth/login`

Request body:

```json
{ "email": "alice@example.com", "password": "password123" }
```

**200 OK**

```json
{
  "message": "Login successful",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": { "id": 1, "username": "alice", "email": "alice@example.com" }
}
```

Errors: `400` missing fields, `401` invalid email or password.

---

### Tasks (all require `Authorization: Bearer <token>`)

#### `POST /api/tasks`

Create a task.

Request body:

```json
{
  "title": "Write README",
  "description": "Document every endpoint",
  "priority": "high",
  "due_date": "2026-12-01"
}
```

**201 Created**

```json
{
  "id": 1,
  "user_id": 1,
  "title": "Write README",
  "description": "Document every endpoint",
  "status": "todo",
  "priority": "high",
  "due_date": "2026-12-01",
  "created_at": "2026-11-06 06:30:00",
  "updated_at": "2026-11-06 06:30:00"
}
```

Errors: `400` validation failed, `401` unauthenticated.

#### `GET /api/tasks`

List the current user's tasks, newest first. Optional query filters: `?status=todo|in_progress|done` and `?priority=low|medium|high`.

**200 OK**

```json
{
  "count": 1,
  "tasks": [
    {
      "id": 1,
      "user_id": 1,
      "title": "Write README",
      "description": "Document every endpoint",
      "status": "todo",
      "priority": "high",
      "due_date": "2026-12-01",
      "created_at": "2026-11-06 06:30:00",
      "updated_at": "2026-11-06 06:30:00"
    }
  ]
}
```

Errors: `400` invalid filter value, `401` unauthenticated.

#### `GET /api/tasks/:id`

**200 OK**: returns a single task object (same shape as above).
Errors: `400` id is not a positive integer, `401`, `404` task not found.

#### `PUT /api/tasks/:id`

Replace a task. `title` is required; omitted optional fields reset to their defaults.

Request body:

```json
{ "title": "Write full README", "status": "in_progress" }
```

**200 OK**: returns the updated task.
Errors: `400`, `401`, `404`.

#### `PATCH /api/tasks/:id`

Partially update a task. Send only the fields you want to change (at least one).

Request body:

```json
{ "status": "done" }
```

**200 OK**: returns the updated task.
Errors: `400` (including an empty body), `401`, `404`.

#### `DELETE /api/tasks/:id`

**200 OK**

```json
{ "message": "Task deleted successfully" }
```

Errors: `400`, `401`, `404`.

---

## Example session (curl)

```bash
# 1. Register
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"alice","email":"alice@example.com","password":"password123"}'

# 2. Log in and copy the token
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@example.com","password":"password123"}'

# 3. Create a task
curl -X POST http://localhost:3000/api/tasks \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"title":"Write README","priority":"high"}'

# 4. List tasks
curl http://localhost:3000/api/tasks -H "Authorization: Bearer <token>"

# 5. Mark it done
curl -X PATCH http://localhost:3000/api/tasks/1 \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"status":"done"}'

# 6. Delete it
curl -X DELETE http://localhost:3000/api/tasks/1 -H "Authorization: Bearer <token>"
```

## Project structure

```
task-api/
├── server.js              # entry point
├── test.js                # end-to-end test suite
├── src/
│   ├── app.js             # Express app, routing, error handling
│   ├── db.js              # SQLite connection and schema
│   ├── middleware/auth.js # JWT verification
│   └── routes/
│       ├── auth.js        # register / login
│       └── tasks.js       # task CRUD + validation
├── .env.example
└── package.json
```

## Security notes

- Passwords are hashed with bcrypt (10 salt rounds); plain text is never stored or returned.
- Login returns the same error for an unknown email and a wrong password.
- All SQL uses parameterized queries.
- Every task query is scoped to the authenticated user's `user_id`.
- Set a strong `JWT_SECRET` in production.
