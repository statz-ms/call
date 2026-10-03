import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';

const html = fs.readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
const source = html.match(/const source = `([\s\S]*?registerProcessor\('squadcall-pcm-processor'[\s\S]*?)`;/)[1];
function processor() {
  let Processor;
  vm.runInNewContext(source, {
    ArrayBuffer, Float32Array,
    AudioWorkletProcessor: class { constructor() { this.port = {}; } },
    registerProcessor: (_, value) => { Processor = value; },
  });
  return new Processor();
}
test('PCM preserves a silent stereo channel and emits silence after the packet ends', () => {
  const p = processor();
  p.port.onmessage({ data: new Float32Array([0.8, 0, 0.25, -0.5]).buffer });
  const left = new Float32Array(4), right = new Float32Array(4);
  p.process([], [[left, right]]);
  assert.equal(right[0], 0);
  assert.equal(left[1], 0.25);
  assert.equal(right[1], -0.5);
  assert.equal(left[2], 0);
  assert.equal(right[2], 0);
});
test('resume after a suspension discards old packets instead of building up delay', () => {
  const p = processor();
  for (let i = 0; i < 100; i++) p.port.onmessage({ data: new Float32Array([i, i]).buffer });
  assert.ok(p.queue.length <= 12);
  const left = new Float32Array(1), right = new Float32Array(1);
  p.process([], [[left, right]]);
  assert.equal(left[0], 88);
});
