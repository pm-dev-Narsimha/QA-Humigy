import { Router } from 'express';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { requireCapabilities } from '../lib/capabilities.js';
import { startJob, pushEvent, finishJob, trackChild, getJob, cancelCurrentJob, getCurrentJob } from '../lib/jobManager.js';
import { writeMcpConfig } from '../lib/mcpConfig.js';
import { runClaudeAgent } from '../lib/claudeAgent.js';
import { buildPlannerPrompt } from '../lib/plannerPrompt.js';

const PROJECT_ROOT = path.resolve(import.meta.dirname, '..', '..');
const PLANS_DIR = path.join(PROJECT_ROOT, 'plans');

export const qaRouter = Router();

// Every /api/qa/* route requires local tooling (claude CLI, git, npx/Playwright).
qaRouter.use(requireCapabilities());

/**
 * POST /api/qa/generate-plan
 * Body: { url, context?, seedFile?, name?, fileName?, existingPlanFile? }
 * Starts the Planner agent as a background job and returns immediately.
 */
qaRouter.post('/generate-plan', async (req, res) => {
  const { url, context, seedFile, name, fileName, existingPlanFile } = req.body ?? {};

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ ok: false, error: 'bad_request', message: '"url" is required.' });
  }

  const lock = startJob('generating a test plan');
  if (!lock.ok) {
    return res.status(lock.status).json({ ok: false, error: 'job_in_progress', message: lock.message });
  }
  const { job } = lock;

  res.status(202).json({ ok: true, jobId: job.id });

  (async () => {
    try {
      let existingPlan = null;
      if (existingPlanFile) {
        try {
          existingPlan = await readFile(path.join(PLANS_DIR, path.basename(existingPlanFile)), 'utf8');
        } catch {
          pushEvent(job.id, 'warn', `Could not read existing plan file "${existingPlanFile}" - continuing without a baseline.`);
        }
      }

      const planName = name || `Test Plan - ${new URL(url).hostname}`;
      const planFileName = fileName || `${new URL(url).hostname.replace(/\W+/g, '-')}-plan.md`;

      const prompt = buildPlannerPrompt({ url, context, seedFile, existingPlan, name: planName, fileName: planFileName });
      const mcpConfigPath = await writeMcpConfig({ headless: false });

      pushEvent(job.id, 'info', `Starting planner agent for ${url}...`);

      const { child, exitPromise } = runClaudeAgent({
        prompt,
        mcpConfigPath,
        allowedTools: ['mcp__playwright__*', 'mcp__qa-planner__planner_save_plan'],
        cwd: PROJECT_ROOT,
        onEvent: (text) => pushEvent(job.id, 'log', text),
      });
      trackChild(job.id, child);

      const { exitCode, lastResultText, stderr } = await exitPromise;

      if (exitCode !== 0) {
        pushEvent(job.id, 'error', `Planner agent exited with code ${exitCode}. ${stderr ? stderr.slice(0, 500) : ''}`);
        finishJob(job.id, { ok: false, exitCode });
        return;
      }

      pushEvent(job.id, 'info', `Planner agent finished. ${lastResultText ? lastResultText.slice(0, 500) : ''}`);
      finishJob(job.id, { ok: true, planFileName });
    } catch (err) {
      pushEvent(job.id, 'error', `Planner job failed: ${err.message}`);
      finishJob(job.id, { ok: false, error: err.message });
    }
  })();
});

/**
 * GET /api/qa/job-events?since=<seq>
 * Poll for accumulated job output. Returns events with seq > since.
 */
qaRouter.get('/job-events', (req, res) => {
  const since = Number(req.query.since ?? 0) || 0;
  const job = getCurrentJob();
  if (!job) {
    return res.json({ ok: true, running: false, events: [], seq: since });
  }
  const events = job.events.filter((e) => e.seq > since);
  res.json({
    ok: true,
    running: !job.done,
    label: job.label,
    jobId: job.id,
    events,
    seq: job.seq,
    result: job.done ? job.result : null,
  });
});

/** POST /api/qa/cancel - kills tracked child processes and releases the lock. */
qaRouter.post('/cancel', (req, res) => {
  const result = cancelCurrentJob();
  res.json(result);
});

/** GET /api/qa/plans - list saved plan files. */
qaRouter.get('/plans', async (req, res) => {
  const { readdir } = await import('node:fs/promises');
  try {
    const files = (await readdir(PLANS_DIR)).filter((f) => f.endsWith('.md'));
    res.json({ ok: true, plans: files });
  } catch {
    res.json({ ok: true, plans: [] });
  }
});

/** GET /api/qa/plans/:fileName - read one saved plan's markdown. */
qaRouter.get('/plans/:fileName', async (req, res) => {
  try {
    const content = await readFile(path.join(PLANS_DIR, path.basename(req.params.fileName)), 'utf8');
    res.type('text/markdown').send(content);
  } catch {
    res.status(404).json({ ok: false, error: 'not_found', message: 'Plan file not found.' });
  }
});
