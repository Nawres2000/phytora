// Integration tests: need `npm i` (supertest + mongodb-memory-server, which downloads a mongod binary on first run).
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret';
process.env.FRONTEND_URL = 'http://localhost:3000';
process.env.SKIP_MX_CHECK = '1';
process.env.ADMIN_EMAILS = 'boss@example.com';

const { default: app } = await import('../src/app.js');
const { default: User } = await import('../src/models/User.js');
const { default: Scan } = await import('../src/models/Scan.js');
const bcrypt = (await import('bcryptjs')).default;

let mongod;
const PASSWORD = 'Str0ng!Passw0rd';

before(async () => { mongod = await MongoMemoryServer.create(); await mongoose.connect(mongod.getUri()); });
after(async () => { await mongoose.disconnect(); await mongod.stop(); });

async function login(email, extra = {}) {
  await User.create({ name: 'Test', email, password: await bcrypt.hash(PASSWORD, 4), emailVerified: true, ...extra });
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/signin').send({ email, password: PASSWORD });
  assert.equal(res.status, 200, res.text);
  return agent;
}

test('signup enforces the password policy and requires email confirmation before signin', async () => {
  const weak = await request(app).post('/api/auth/signup').send({ name: 'Ann', email: 'ann@example.com', password: 'password' });
  assert.equal(weak.status, 400);
  const ok = await request(app).post('/api/auth/signup').send({ name: 'Ann', email: 'ann@example.com', password: PASSWORD });
  assert.equal(ok.status, 201);
  const early = await request(app).post('/api/auth/signin').send({ email: 'ann@example.com', password: PASSWORD });
  assert.equal(early.status, 403);
  assert.equal(early.body.needsVerification, true);
});

test('protected routes reject anonymous visitors', async () => {
  for (const path of ['/api/auth/me', '/api/scans', '/api/scans/stats', '/api/catalog', '/api/admin/stats']) {
    assert.equal((await request(app).get(path)).status, 401, path);
  }
});

test('a user cannot read, rate or delete another user’s scans', async () => {
  const a = await login('a@example.com'), b = await login('b@example.com');
  const owner = await User.findOne({ email: 'a@example.com' });
  const scan = await Scan.create({ user: owner._id, classId: 'Tomato___Late_blight', plant: 'Tomate', disease: 'Mildiou', isHealthy: false, confidence: 0.9 });

  assert.equal((await a.get('/api/scans')).body.scans.length, 1);
  assert.equal((await b.get('/api/scans')).body.scans.length, 0);
  assert.equal((await b.patch(`/api/scans/${scan._id}/feedback`).send({ correct: true })).status, 404);
  assert.equal((await b.delete(`/api/scans/${scan._id}`)).status, 404);
  assert.equal((await a.patch(`/api/scans/${scan._id}/feedback`).send({ correct: false, actualClass: 'Tomato___Early_blight' })).status, 200);
  assert.equal((await a.patch(`/api/scans/${scan._id}/feedback`).send({ correct: false, actualClass: 'not-a-class' })).status, 400);
});

test('admin routes are admin-only', async () => {
  const user = await login('plain@example.com');
  const boss = await login('boss@example.com', { role: 'admin' });
  assert.equal((await user.get('/api/admin/stats')).status, 403);
  assert.equal((await user.get('/api/admin/users')).status, 403);
  const stats = await boss.get('/api/admin/stats');
  assert.equal(stats.status, 200);
  assert.ok(stats.body.total >= 3);
});

test('a disabled account loses access immediately', async () => {
  const agent = await login('gone@example.com');
  await User.updateOne({ email: 'gone@example.com' }, { disabled: true });
  assert.equal((await agent.get('/api/auth/me')).status, 401);
});
