import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { handleRequest } from './index.js';

const allowedOrigin = 'https://ccubed12.github.io';
const env = { ALLOWED_ORIGIN: allowedOrigin };
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('answers the health check with the configured CORS origin', async () => {
  const response = await handleRequest(new Request('https://api.example/health', {
    headers: { Origin: allowedOrigin },
  }), env);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), allowedOrigin);
  assert.deepEqual(await response.json(), { status: 'ok' });
});

test('handles browser preflight requests without a response body', async () => {
  const response = await handleRequest(new Request('https://api.example/api/generate-path', {
    method: 'OPTIONS',
    headers: { Origin: allowedOrigin, 'Access-Control-Request-Method': 'POST' },
  }), env);

  assert.equal(response.status, 204);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), allowedOrigin);
  assert.equal(await response.text(), '');
});

test('rejects browser requests from unapproved origins', async () => {
  const response = await handleRequest(new Request('https://api.example/api/generate-path', {
    method: 'POST',
    headers: { Origin: 'https://attacker.example', 'Content-Type': 'application/json' },
    body: JSON.stringify({ skill: 'Python', level: 'Beginner' }),
  }), env);

  assert.equal(response.status, 403);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
});

test('validates the requested skill and level before searching', async () => {
  const response = await handleRequest(new Request('https://api.example/api/generate-path', {
    method: 'POST',
    headers: { Origin: allowedOrigin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ skill: 'Python', level: 'Expert' }),
  }), env);

  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /starting level/);
});

test('returns a learning path from YouTube results', async () => {
  const video = {
    videoRenderer: {
      videoId: 'abcdefghijk',
      title: { runs: [{ text: 'Python foundations and practical skills' }] },
      descriptionSnippet: { runs: [{ text: 'Learn variables, functions, loops, and data structures.' }] },
      lengthText: { simpleText: '5:30' },
    },
  };
  globalThis.fetch = async () => new Response(`var ytInitialData = ${JSON.stringify(video)};</script>`);
  const response = await handleRequest(new Request('https://api.example/api/generate-path', {
    method: 'POST',
    headers: { Origin: allowedOrigin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ skill: 'Python', level: 'Beginner', weeklyHours: 4 }),
  }), env);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), allowedOrigin);
  const result = await response.json();
  assert.equal(result.lessons.length, 1);
  assert.equal(result.lessons[0].minutes, 6);
  assert.equal(result.research.sources[0].videoId, 'abcdefghijk');
  assert.equal(result.research.sources[0].url, 'https://www.youtube.com/watch?v=abcdefghijk');
});
