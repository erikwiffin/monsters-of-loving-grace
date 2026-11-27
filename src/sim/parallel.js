// Runs many games across worker threads (Node only; the browser never loads
// this). Each job is plain data: { seed, config, policies, maxRounds,
// maxCommands, hoardLimit, includeCommands }, where `policies` is a seating (registry.js).
// Results come back in job order, so the thread count never changes them.

import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { runGame } from './runner.js';

function play(job) {
  // Commands only when a job asks for them (exact comparisons): they are large.
  const { summary } = runGame({ ...job, includeCommands: !!job.includeCommands });
  // Trim what batch tools never read, to keep messages small.
  delete summary.suspicionHistory;
  return summary;
}

if (!isMainThread && parentPort) {
  parentPort.on('message', ({ id, jobs }) => {
    try {
      parentPort.postMessage({ id, results: jobs.map(play) });
    } catch (e) {
      parentPort.postMessage({ id, error: e.stack || e.message });
    }
  });
}

/** Plays every job; resolves to their summaries, in order. */
export async function runGames(jobs, { threads = availableParallelism(), chunk = 8 } = {}) {
  if (!jobs.length) return [];
  if (threads <= 1) return jobs.map(play);
  const results = new Array(jobs.length);
  const batches = [];
  for (let i = 0; i < jobs.length; i += chunk) batches.push({ id: i, jobs: jobs.slice(i, i + chunk) });
  const pool = Array.from({ length: Math.min(threads, batches.length) }, () => new Worker(new URL(import.meta.url)));
  let next = 0;
  try {
    await Promise.all(pool.map((w) => new Promise((resolve, reject) => {
      const feed = () => {
        if (next >= batches.length) { resolve(); return; }
        w.postMessage(batches[next++]);
      };
      w.on('message', (m) => {
        if (m.error) { reject(new Error(m.error)); return; }
        m.results.forEach((r, k) => { results[m.id + k] = r; });
        feed();
      });
      w.on('error', reject);
      feed();
    })));
  } finally {
    await Promise.all(pool.map((w) => w.terminate()));
  }
  return results;
}
