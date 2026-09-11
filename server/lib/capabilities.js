import { spawn } from 'node:child_process';

const isWindows = process.platform === 'win32';

function which(cmd) {
  return new Promise((resolve) => {
    const finder = isWindows ? 'where.exe' : 'which';
    const child = spawn(finder, [cmd]);
    let out = '';
    child.stdout?.on('data', (d) => (out += d.toString()));
    child.on('error', () => resolve(null));
    child.on('close', (code) => {
      if (code === 0 && out.trim()) {
        resolve(out.trim().split(/\r?\n/)[0]);
      } else {
        resolve(null);
      }
    });
  });
}

let cache = null;
let cacheAt = 0;
const CACHE_MS = 15_000;

/**
 * Probes the local machine for the tooling the QA Workbench needs:
 * - `claude` CLI (spawns the planner/generator/healer agents)
 * - `git` (publish/commit workflow)
 * - Playwright, available via `npx playwright` (browser automation + MCP server)
 *
 * Result is cached briefly so repeated route hits don't re-shell out every time.
 */
export async function checkCapabilities() {
  const now = Date.now();
  if (cache && now - cacheAt < CACHE_MS) return cache;

  const [claudePath, gitPath, npxPath] = await Promise.all([
    which('claude'),
    which('git'),
    which('npx'),
  ]);

  const result = {
    claude: Boolean(claudePath),
    git: Boolean(gitPath),
    npx: Boolean(npxPath),
    paths: { claude: claudePath, git: gitPath, npx: npxPath },
  };
  result.ready = result.claude && result.git && result.npx;

  cache = result;
  cacheAt = now;
  return result;
}

export function missingToolsMessage(caps) {
  const missing = [];
  if (!caps.claude) missing.push('Claude Code CLI (`claude`)');
  if (!caps.git) missing.push('Git (`git`)');
  if (!caps.npx) missing.push('Node/npx (for Playwright)');
  return `QA Workbench tooling is unavailable on this machine: ${missing.join(', ')}. ` +
    'This API only runs where a local Claude CLI, Playwright, and Git are actually installed (the dev/workbench environment).';
}

/** Express middleware: gates a route behind local tooling availability. */
export function requireCapabilities() {
  return async (req, res, next) => {
    const caps = await checkCapabilities();
    if (!caps.ready) {
      return res.status(501).json({
        ok: false,
        error: 'capability_unavailable',
        message: missingToolsMessage(caps),
        capabilities: caps,
      });
    }
    next();
  };
}
