import assert from 'node:assert/strict';
import test from 'node:test';
import { proxyAgentRequest } from '../server/ai-proxy.js';

function createResponseRecorder() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    set(name, value) {
      this.headers[name] = value;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

function createRequest(overrides = {}) {
  return {
    path: '/agents/recommendations',
    url: '/agents/recommendations?course_id=course-1',
    method: 'GET',
    body: undefined,
    requestId: 'request-123',
    get: (name) => name.toLowerCase() === 'authorization' ? 'Bearer local-test-token' : undefined,
    ...overrides,
  };
}

test('AI proxy forwards authenticated requests, query parameters, and correlation ID', async () => {
  const res = createResponseRecorder();
  await proxyAgentRequest(createRequest(), res, {
    serviceUrl: 'http://127.0.0.1:8100',
    fetchImpl: async (url, options) => {
      assert.equal(url.href, 'http://127.0.0.1:8100/api/v1/agents/recommendations?course_id=course-1');
      assert.equal(options.headers.Authorization, 'Bearer local-test-token');
      assert.equal(options.headers['X-Request-ID'], 'request-123');
      return new Response(JSON.stringify({ task_type: 'recommendations', data: {}, agent_steps: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['X-Request-ID'], 'request-123');
  assert.equal(res.body.task_type, 'recommendations');
});

test('AI proxy accepts Render private host:port service addresses', async () => {
  const res = createResponseRecorder();
  await proxyAgentRequest(createRequest(), res, {
    serviceUrl: 'learnplus-ai.internal:10000',
    fetchImpl: async (url) => {
      assert.equal(url.href, 'http://learnplus-ai.internal:10000/api/v1/agents/recommendations?course_id=course-1');
      return new Response(JSON.stringify({ task_type: 'recommendations', data: {}, agent_steps: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });

  assert.equal(res.statusCode, 200);
});

test('AI proxy reports a safe correlated error when the service connection is refused', async () => {
  const res = createResponseRecorder();
  const logs = [];
  const error = new TypeError('fetch failed', { cause: Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' }) });

  await proxyAgentRequest(createRequest(), res, {
    serviceUrl: 'http://127.0.0.1:8100',
    fetchImpl: async () => { throw error; },
    logger: { error: (entry) => logs.push(entry) },
  });

  assert.equal(res.statusCode, 503);
  assert.equal(res.body.request_id, 'request-123');
  assert.equal(logs.length, 1);
  const diagnostic = JSON.parse(logs[0]);
  assert.equal(diagnostic.error_type, 'TypeError');
  assert.equal(diagnostic.error_code, 'ECONNREFUSED');
  assert.equal(diagnostic.service_origin, 'http://127.0.0.1:8100');
  assert.equal(logs[0].includes('local-test-token'), false);
});

test('AI proxy rejects non-JSON upstream responses instead of forwarding malformed data', async () => {
  const res = createResponseRecorder();
  const logs = [];
  await proxyAgentRequest(createRequest(), res, {
    serviceUrl: 'http://127.0.0.1:8100',
    fetchImpl: async () => new Response('<html>bad gateway</html>', {
      status: 502,
      headers: { 'content-type': 'text/html' },
    }),
    logger: { error: (entry) => logs.push(entry) },
  });

  assert.equal(res.statusCode, 502);
  assert.match(res.body.detail, /invalid response/);
  assert.equal(res.body.request_id, 'request-123');
  assert.equal(JSON.parse(logs[0]).event, 'ai_agent_upstream_invalid_content_type');
});

test('AI proxy rejects malformed JSON agent payloads with a structured error', async () => {
  const res = createResponseRecorder();
  await proxyAgentRequest(createRequest(), res, {
    serviceUrl: 'http://127.0.0.1:8100',
    fetchImpl: async () => new Response('not json', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
    logger: { error: () => {} },
  });

  assert.equal(res.statusCode, 502);
  assert.equal(res.body.request_id, 'request-123');
});
