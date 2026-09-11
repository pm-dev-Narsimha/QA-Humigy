import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLANNER_SERVER = path.resolve(__dirname, '..', 'mcp', 'planner-server.js');

/**
 * Writes a throwaway --mcp-config file for one job: the real Playwright MCP
 * server (`npx playwright mcp`) for live browser control, plus our own
 * stdio server exposing the structured save tool (e.g. planner_save_plan).
 * Returns the config file path; caller is responsible for no cleanup needed
 * since it lives under the OS tmp dir.
 */
export async function writeMcpConfig({ browser = 'chromium', headless = false } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'qa-mcp-'));
  const configPath = path.join(dir, 'mcp-config.json');

  const config = {
    mcpServers: {
      playwright: {
        command: 'npx',
        args: [
          '--yes',
          'playwright',
          'mcp',
          `--browser=${browser}`,
          ...(headless ? ['--headless'] : []),
        ],
      },
      'qa-planner': {
        command: process.execPath,
        args: [PLANNER_SERVER],
      },
    },
  };

  await writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');
  return configPath;
}
