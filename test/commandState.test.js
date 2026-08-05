const test = require('node:test');
const assert = require('node:assert/strict');
const { canTransition, isTerminal } = require('../src/services/commandState');
test('command lifecycle only allows forward transitions', () => {
  assert.equal(canTransition('pending', 'sent'), true);
  assert.equal(canTransition('pending', 'failed'), true);
  assert.equal(canTransition('sent', 'confirmed'), true);
  assert.equal(canTransition('sent', 'timeout'), true);
  assert.equal(canTransition('confirmed', 'sent'), false);
  assert.equal(canTransition('confirmed', 'timeout'), false);
  assert.equal(canTransition('failed', 'sent'), false);
});
test('terminal states are immutable', () => {
  assert.equal(isTerminal('confirmed'), true); assert.equal(isTerminal('failed'), true); assert.equal(isTerminal('timeout'), true); assert.equal(isTerminal('sent'), false);
});
