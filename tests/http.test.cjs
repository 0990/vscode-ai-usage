const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { EventEmitter } = require('node:events');
const vm = require('node:vm');
const { transformSync } = require('esbuild');

const { code } = transformSync(readFileSync(resolve(__dirname, '../src/utils/http.ts'), 'utf8'), {
  loader: 'ts', format: 'cjs', target: 'node18',
});

test('network deadline bounds requests that never connect, and clears timers after failure', async () => {
  const timers = new Map();
  const requests = [];
  const transport = {
    request() {
      const req = new EventEmitter();
      req.end = () => {};
      req.destroy = error => { req.emit('error', error); req.emit('close'); };
      requests.push(req);
      return req;
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module, exports: module.exports,
    require: name => name === 'node:url' ? require(name) : transport,
    Buffer,
    setTimeout(callback, delay) { const id = {}; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
  });
  const request = module.exports.httpRequest({ url: 'https://unreachable.test', timeout: 25 });
  const result = assert.rejects(request, /Request timed out after 25ms/);
  // Each failed attempt is followed by a retry delay, then another connection attempt.
  for (let step = 0; step < 5; step++) {
    const [id, timer] = timers.entries().next().value;
    assert.equal(timer.delay, step % 2 === 0 ? 25 : step === 1 ? 1000 : 2000);
    timers.delete(id);
    timer.callback();
    await new Promise(resolve => setImmediate(resolve));
  }
  await result;
  assert.equal(requests.length, 3);
  assert.equal(timers.size, 0);
});
