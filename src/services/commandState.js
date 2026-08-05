const TERMINAL = new Set(['confirmed', 'failed', 'timeout']);
function canTransition(from, to) {
  if (from === 'pending' && ['sent', 'failed', 'timeout'].includes(to)) return true;
  if (from === 'sent' && ['confirmed', 'failed', 'timeout'].includes(to)) return true;
  return false;
}
function isTerminal(status) { return TERMINAL.has(status); }
module.exports = { canTransition, isTerminal };
