// Lightweight performance timing utility for structured stage timings
// Usage:
// const { createTimer } = require('../utils/perf');
// const timer = createTimer('audio.process');
// timer.mark('cache lookup');
// timer.end('respond');
// const timings = timer.getSummary();

'use strict';

function hrtimeMs() {
  try {
    // High-resolution time for Node
    return Number(process.hrtime.bigint() / 1000000n);
  } catch (_) {
    return Date.now();
  }
}

function createTimer(name, options = {}) {
  const startedAtMs = hrtimeMs();
  let lastMarkMs = startedAtMs;
  const marks = [];
  const enabled = process.env.PERF_LOGS === '1' || options.enabled === true;
  const prefix = `[PERF] ${name}`;

  function mark(label, extras) {
    const nowMs = hrtimeMs();
    const deltaMs = nowMs - lastMarkMs;
    const totalMs = nowMs - startedAtMs;
    const entry = { label, deltaMs, totalMs, ...(extras || {}) };
    marks.push(entry);
    if (enabled) {
      // eslint-disable-next-line no-console
      console.log(`${prefix} - ${label}: +${deltaMs}ms (total ${totalMs}ms)`);
    }
    lastMarkMs = nowMs;
    return entry;
  }

  function end(label = 'end', extras) {
    return mark(label, extras);
  }

  function getSummary() {
    return {
      name,
      startedAtMs,
      marks
    };
  }

  return { mark, end, getSummary };
}

module.exports = { createTimer };


