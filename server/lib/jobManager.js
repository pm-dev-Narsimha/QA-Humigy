import { randomUUID } from 'node:crypto';

const STALE_MS = 30 * 60 * 1000; // 30 minutes safety valve

/**
 * One workbench job at a time, process-wide. `current` holds the active job's
 * bookkeeping: its label (for the 409 message), event buffer, tracked child
 * processes (for cancel + stale cleanup), and a startedAt timestamp used by
 * the stale-lock sweep.
 */
let current = null;

function isStale(job) {
  return Date.now() - job.startedAt > STALE_MS;
}

/** Clears the lock if the previous job is stale, so it doesn't stick forever. */
function sweepStale() {
  if (current && isStale(current)) {
    for (const child of current.children) {
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
    }
    current = null;
  }
}

/**
 * Tries to start a job under `label`. Returns { ok: true, job } on success,
 * or { ok: false, status: 409, message } if another job is already running.
 */
export function startJob(label) {
  sweepStale();

  if (current) {
    return {
      ok: false,
      status: 409,
      message: `Another job is already running: ${current.label}. Try again once it finishes, or cancel it.`,
    };
  }

  const job = {
    id: randomUUID(),
    label,
    startedAt: Date.now(),
    events: [],
    seq: 0,
    children: new Set(),
    done: false,
    result: null,
  };
  current = job;
  return { ok: true, job };
}

/** Appends an event to the running job's buffer (if it's still the active job). */
export function pushEvent(jobId, type, text) {
  if (!current || current.id !== jobId) return;
  current.seq += 1;
  current.events.push({ seq: current.seq, type, text });
}

/** Marks the job done and releases the lock, keeping the final events readable briefly. */
export function finishJob(jobId, result) {
  if (!current || current.id !== jobId) return;
  current.done = true;
  current.result = result ?? null;
  // Keep the finished job visible for one more poll cycle, then release the lock.
  const finished = current;
  setTimeout(() => {
    if (current === finished) current = null;
  }, 5_000);
}

export function trackChild(jobId, child) {
  if (!current || current.id !== jobId) return;
  current.children.add(child);
  child.on('exit', () => current?.children.delete(child));
}

export function getJob(jobId) {
  if (current && current.id === jobId) return current;
  return null;
}

export function getCurrentJob() {
  return current;
}

/** Kills every tracked child process for the active job and releases the lock. */
export function cancelCurrentJob() {
  if (!current) {
    return { ok: true, message: 'Nothing is currently running.' };
  }
  const label = current.label;
  for (const child of current.children) {
    try { child.kill('SIGKILL'); } catch { /* already gone */ }
  }
  current = null;
  return { ok: true, message: `Cancelled job: ${label}.` };
}
