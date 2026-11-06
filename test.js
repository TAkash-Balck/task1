// End-to-end smoke test. Run with: npm test
// Uses a throwaway SQLite file so your real data.db is never touched.
const os = require('os');
const path = require('path');
const fs = require('fs');
const assert = require('assert');

const tmpDb = path.join(os.tmpdir(), `task-api-test-${Date.now()}.db`);
process.env.DB_PATH = tmpDb;
process.env.JWT_SECRET = 'test-secret';

const app = require('./src/app');

let passed = 0;
async function check(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (e) {
    console.error(`  FAIL ${name}\n       ${e.message}`);
    process.exitCode = 1;
  }
}

(async () => {
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;

  async function call(method, url, { body, token, raw } = {}) {
    const headers = {};
    if (body !== undefined || raw !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(base + url, {
      method,
      headers,
      body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined,
    });
    let json = null;
    try { json = await res.json(); } catch (_) {}
    return { status: res.status, json };
  }

  console.log('Auth');
  await check('register rejects bad input (400)', async () => {
    const r = await call('POST', '/api/auth/register', { body: { username: 'a', email: 'nope', password: '123' } });
    assert.strictEqual(r.status, 400);
    assert.strictEqual(r.json.details.length, 3);
  });
  await check('register succeeds (201) and hides password', async () => {
    const r = await call('POST', '/api/auth/register', { body: { username: 'alice', email: 'alice@example.com', password: 'password123' } });
    assert.strictEqual(r.status, 201);
    assert.ok(!JSON.stringify(r.json).includes('password'));
  });
  await check('duplicate register rejected (409)', async () => {
    const r = await call('POST', '/api/auth/register', { body: { username: 'alice', email: 'alice@example.com', password: 'password123' } });
    assert.strictEqual(r.status, 409);
  });
  await check('password is stored hashed, not plain text', async () => {
    const Database = require('better-sqlite3');
    const row = new Database(tmpDb, { readonly: true }).prepare('SELECT password_hash FROM users').get();
    assert.notStrictEqual(row.password_hash, 'password123');
    assert.ok(row.password_hash.startsWith('$2'));
  });
  await check('login with wrong password (401)', async () => {
    const r = await call('POST', '/api/auth/login', { body: { email: 'alice@example.com', password: 'wrongpass1' } });
    assert.strictEqual(r.status, 401);
  });
  await check('login with missing fields (400)', async () => {
    const r = await call('POST', '/api/auth/login', { body: { email: 'alice@example.com' } });
    assert.strictEqual(r.status, 400);
  });

  const login = await call('POST', '/api/auth/login', { body: { email: 'alice@example.com', password: 'password123' } });
  await check('login succeeds (200) and returns token', async () => {
    assert.strictEqual(login.status, 200);
    assert.ok(login.json.token);
  });
  const token = login.json.token;

  await call('POST', '/api/auth/register', { body: { username: 'bob', email: 'bob@example.com', password: 'password123' } });
  const bobLogin = await call('POST', '/api/auth/login', { body: { email: 'bob@example.com', password: 'password123' } });
  const bobToken = bobLogin.json.token;

  console.log('Protected routes');
  await check('no token -> 401', async () => {
    assert.strictEqual((await call('GET', '/api/tasks')).status, 401);
    assert.strictEqual((await call('POST', '/api/tasks', { body: { title: 'x' } })).status, 401);
  });
  await check('garbage token -> 401', async () => {
    assert.strictEqual((await call('GET', '/api/tasks', { token: 'abc.def.ghi' })).status, 401);
  });

  console.log('Tasks CRUD');
  let taskId;
  await check('create task (201)', async () => {
    const r = await call('POST', '/api/tasks', { token, body: { title: 'Write README', priority: 'high', due_date: '2026-12-01' } });
    assert.strictEqual(r.status, 201);
    assert.strictEqual(r.json.status, 'todo');
    assert.strictEqual(r.json.priority, 'high');
    taskId = r.json.id;
  });
  await check('create rejects empty title (400)', async () => {
    const r = await call('POST', '/api/tasks', { token, body: { title: '   ' } });
    assert.strictEqual(r.status, 400);
  });
  await check('create rejects bad status/priority/date (400)', async () => {
    const r = await call('POST', '/api/tasks', { token, body: { title: 'x', status: 'nope', priority: 'urgent', due_date: '2026-13-45' } });
    assert.strictEqual(r.status, 400);
    assert.strictEqual(r.json.details.length, 3);
  });
  await check('malformed JSON -> 400', async () => {
    const r = await call('POST', '/api/tasks', { token, raw: '{bad json' });
    assert.strictEqual(r.status, 400);
  });
  await check('list tasks (200)', async () => {
    const r = await call('GET', '/api/tasks', { token });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.count, 1);
  });
  await check('filter by status', async () => {
    const r = await call('GET', '/api/tasks?status=done', { token });
    assert.strictEqual(r.json.count, 0);
    assert.strictEqual((await call('GET', '/api/tasks?status=bogus', { token })).status, 400);
  });
  await check('get one task (200)', async () => {
    const r = await call('GET', `/api/tasks/${taskId}`, { token });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.title, 'Write README');
  });
  await check('get missing task (404)', async () => {
    assert.strictEqual((await call('GET', '/api/tasks/9999', { token })).status, 404);
  });
  await check('invalid id (400)', async () => {
    assert.strictEqual((await call('GET', '/api/tasks/abc', { token })).status, 400);
  });
  await check('PUT replaces task (200)', async () => {
    const r = await call('PUT', `/api/tasks/${taskId}`, { token, body: { title: 'Write full README', status: 'in_progress' } });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.title, 'Write full README');
    assert.strictEqual(r.json.priority, 'medium');
  });
  await check('PATCH updates only given fields (200)', async () => {
    const r = await call('PATCH', `/api/tasks/${taskId}`, { token, body: { status: 'done' } });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.status, 'done');
    assert.strictEqual(r.json.title, 'Write full README');
  });
  await check('PATCH with empty body (400)', async () => {
    assert.strictEqual((await call('PATCH', `/api/tasks/${taskId}`, { token, body: {} })).status, 400);
  });

  console.log('Ownership');
  await check("another user cannot see/modify/delete alice's task (404)", async () => {
    assert.strictEqual((await call('GET', `/api/tasks/${taskId}`, { token: bobToken })).status, 404);
    assert.strictEqual((await call('PATCH', `/api/tasks/${taskId}`, { token: bobToken, body: { title: 'hacked' } })).status, 404);
    assert.strictEqual((await call('DELETE', `/api/tasks/${taskId}`, { token: bobToken })).status, 404);
    assert.strictEqual((await call('GET', '/api/tasks', { token: bobToken })).json.count, 0);
  });

  console.log('Delete');
  await check('delete task (200) then 404', async () => {
    assert.strictEqual((await call('DELETE', `/api/tasks/${taskId}`, { token })).status, 200);
    assert.strictEqual((await call('GET', `/api/tasks/${taskId}`, { token })).status, 404);
    assert.strictEqual((await call('DELETE', `/api/tasks/${taskId}`, { token })).status, 404);
  });

  server.close();
  for (const f of [tmpDb, tmpDb + '-wal', tmpDb + '-shm']) fs.rmSync(f, { force: true });
  console.log(`\n${passed} checks passed${process.exitCode ? ', some FAILED' : ''}`);
})();
