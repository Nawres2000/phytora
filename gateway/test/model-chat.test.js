// Gateway <-> model API and chatbot tests. Fake FastAPI and fake LLM servers run on random local ports.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import mongoose from 'mongoose';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret';
process.env.FRONTEND_URL = 'http://localhost:3000';
process.env.SKIP_MX_CHECK = '1';
process.env.GROQ_API_KEY = 'test';

const { default: app } = await import('../src/app.js');
const { default: User } = await import('../src/models/User.js');
const { default: Scan } = await import('../src/models/Scan.js');
const { default: Conversation } = await import('../src/models/Conversation.js');
const { retrieve, tokens } = await import('../src/utils/knowledge.js');
const bcrypt = (await import('bcryptjs')).default;

const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
let mongod, modelServer, llmServer, lastLlmBody, llmMode = 'ok';

function listen(handler) {
  return new Promise((resolve) => { const s = http.createServer(handler).listen(0, '127.0.0.1', () => resolve(s)); });
}

before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  modelServer = await listen((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url.startsWith('/health')) return res.end(JSON.stringify({ status: 'ok', model_loaded: true, explain_available: true, model_version: 'v-test', engine: 'onnxruntime', variant: 'fp32', gpu: { available: false } }));
    if (req.url.startsWith('/model/metadata')) return res.end(JSON.stringify({ architecture: 'mobilenet_v3_small', num_classes: 38 }));
    if (req.url.startsWith('/predict')) {
      req.resume();
      return req.on('end', () => res.end(JSON.stringify({
        class_id: 'Tomato___Late_blight', confidence: 0.91, uncertain: false,
        top_k: [{ class_id: 'Tomato___Late_blight', score: 0.91 }, { class_id: 'Tomato___Early_blight', score: 0.06 }],
        severity: { percent: 12.5, level: 'modérée', leaf_coverage: 0.4 }, heatmap: req.url.includes('explain=true') ? 'data:image/jpeg;base64,AA' : null,
        latency: { preprocess_ms: 1, inference_ms: 4, explain_ms: 0, total_ms: 6 }, latency_ms: 6, model_version: 'v-test', engine: 'onnxruntime', variant: 'fp32', mock: false,
      })));
    }
    res.statusCode = 404; res.end('{}');
  });
  llmServer = await listen((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      lastLlmBody = JSON.parse(body);
      if (llmMode === 'fail') { res.statusCode = 500; return res.end('{}'); }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      for (const t of ['Le mildiou ', 'se traite ', 'par prévention [1].']) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`);
      res.end('data: [DONE]\n\n');
    });
  });
  process.env.MODEL_API_URL = `http://127.0.0.1:${modelServer.address().port}`;
  process.env.CHAT_API_URL = `http://127.0.0.1:${llmServer.address().port}/v1/chat/completions`;
});
after(async () => { modelServer.close(); llmServer.close(); await mongoose.disconnect(); await mongod.stop(); });

async function login(email) {
  await User.create({ name: 'Test', email, password: await bcrypt.hash('Str0ng!Passw0rd', 4), emailVerified: true });
  const agent = request.agent(app);
  assert.equal((await agent.post('/api/auth/signin').send({ email, password: 'Str0ng!Passw0rd' })).status, 200);
  return agent;
}

function parseSSE(text) {
  return text.trim().split('\n\n').map((block) => {
    const [ev, data] = block.split('\n');
    return { event: ev.replace('event: ', ''), data: JSON.parse(data.replace('data: ', '')) };
  });
}

test('model status and metadata are proxied', async () => {
  const a = await login('m1@example.com');
  const s = (await a.get('/api/model/status')).body;
  assert.equal(s.online, true);
  assert.equal(s.classification, true);
  assert.equal(s.model_version, 'v-test');
  assert.equal((await a.get('/api/model/metadata')).body.num_classes, 38);
});

test('predict translates to French, keeps severity/latency and saves the scan', async () => {
  const a = await login('m2@example.com');
  const r = await a.post('/api/predict').attach('file', PNG, 'leaf.png');
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.disease.plant_species, 'Tomate');
  assert.equal(r.body.severity.percent, 12.5);
  assert.equal(r.body.latency.inference_ms, 4);
  assert.ok(r.body.heatmap);
  const scan = await Scan.findById(r.body.scanId);
  assert.equal(scan.severity.level, 'modérée');
  assert.equal(scan.inferenceMs, 4);
});

test('live prediction saves nothing and rejects non-images', async () => {
  const a = await login('m3@example.com');
  const before = await Scan.countDocuments();
  const r = await a.post('/api/predict/live').attach('file', PNG, 'frame.png');
  assert.equal(r.status, 200);
  assert.equal(r.body.heatmap, null);
  assert.equal(await Scan.countDocuments(), before);
  assert.equal((await a.post('/api/predict/live').attach('file', Buffer.from('hello'), 'x.txt')).status, 400);
});

test('retrieval finds the right disease sheet', () => {
  assert.ok(tokens('Mes tomates ont des taches').includes('tomate'));
  assert.equal(retrieve('mildiou de la tomate taches brunes')[0].id.startsWith('Tomato___'), true);
  assert.equal(retrieve('n’importe quoi', { prefer: 'Apple___Apple_scab' })[0].id, 'Apple___Apple_scab');
  assert.equal(retrieve('Comment traiter la moisissure des feuilles de tomate ?')[0].id, 'Tomato___Leaf_Mold');
  assert.equal(retrieve('poudre blanche sur ma courgette')[0].id, 'Squash___Powdery_mildew');
  assert.equal(retrieve('rouille du maïs')[0].id, 'Corn_(maize)___Common_rust_');
  assert.equal(retrieve('mais je ne sais pas').length, 0);
});

test('chat streams tokens, grounds on the catalog and the scan, and stores the conversation', async () => {
  const a = await login('c1@example.com');
  const owner = await User.findOne({ email: 'c1@example.com' });
  const scan = await Scan.create({ user: owner._id, classId: 'Tomato___Late_blight', plant: 'Tomate', disease: 'Mildiou', isHealthy: false, confidence: 0.9, severity: { percent: 20, level: 'élevée' } });
  const r = await a.post('/api/chat').send({ message: 'Comment traiter le mildiou ?', scanId: scan._id });
  assert.equal(r.status, 200);
  assert.match(r.headers['content-type'], /text\/event-stream/);
  const events = parseSSE(r.text);
  assert.equal(events[0].event, 'meta');
  assert.equal(events[0].data.sources[0].classId, 'Tomato___Late_blight');
  assert.equal(events.filter((e) => e.event === 'token').map((e) => e.data.text).join(''), 'Le mildiou se traite par prévention [1].');
  assert.equal(events.at(-1).event, 'done');
  assert.match(lastLlmBody.messages[0].content, /REFERENCE SHEETS/);
  assert.match(lastLlmBody.messages[0].content, /severity 20%/);
  assert.equal(lastLlmBody.stream, true);

  const id = events[0].data.conversationId;
  const conv = (await a.get(`/api/chat/conversations/${id}`)).body.conversation;
  assert.equal(conv.messages.length, 2);
  assert.equal((await a.patch(`/api/chat/conversations/${id}/messages/1`).send({ rating: 1 })).status, 200);
  assert.equal((await a.patch(`/api/chat/conversations/${id}/messages/0`).send({ rating: 1 })).status, 404); // user message
  assert.equal((await a.get('/api/chat/conversations')).body.conversations.length, 1);

  // follow-up in the same conversation sends the history
  await a.post('/api/chat').send({ message: 'Et pour prévenir ?', conversationId: id });
  assert.equal(lastLlmBody.messages.filter((m) => m.role !== 'system').length, 3);
});

test('conversations are private and a foreign scan is never attached', async () => {
  const a = await login('c2@example.com'), b = await login('c3@example.com');
  const owner = await User.findOne({ email: 'c2@example.com' });
  const scan = await Scan.create({ user: owner._id, classId: 'Apple___healthy', plant: 'Pomme', disease: 'Saine', isHealthy: true, confidence: 0.99 });
  const events = parseSSE((await b.post('/api/chat').send({ message: 'Bonjour', scanId: scan._id })).text);
  const conv = await Conversation.findById(events[0].data.conversationId);
  assert.equal(conv.scan, undefined);
  assert.equal((await a.get(`/api/chat/conversations/${conv._id}`)).status, 404);
  assert.equal((await a.delete(`/api/chat/conversations/${conv._id}`)).status, 404);
  assert.equal((await b.delete(`/api/chat/conversations/${conv._id}`)).status, 200);
});

test('chat reports an error event when the LLM fails', async () => {
  const a = await login('c4@example.com');
  llmMode = 'fail';
  const events = parseSSE((await a.post('/api/chat').send({ message: 'Bonjour' })).text);
  llmMode = 'ok';
  assert.equal(events.at(-1).event, 'error');
  assert.equal((await a.post('/api/chat').send({ message: '   ' })).status, 400);
});
