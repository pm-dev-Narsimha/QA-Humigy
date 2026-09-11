#!/usr/bin/env node
// Stdio MCP server exposing a single tool, `planner_save_plan`, to the spawned
// Claude planner agent. The model must never hand-write "#### N.N" headings or
// write the plan file directly — this tool is the only way a plan gets saved,
// and it does the markdown rendering itself.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLANS_DIR = path.resolve(__dirname, '..', '..', 'plans');

const testSchema = z.object({
  name: z.string().min(1),
  file: z.string().min(1),
  steps: z.array(z.string().min(1)).min(1),
});

const suiteSchema = z.object({
  name: z.string().min(1),
  seedFile: z.string().optional(),
  tests: z.array(testSchema).min(1),
});

const planSchema = {
  name: z.string().min(1),
  fileName: z.string().min(1),
  overview: z.string().min(1),
  suites: z.array(suiteSchema).min(1),
};

/** Only a bare filename, no traversal, always saved under plans/. */
function safeFileName(fileName) {
  const base = path.basename(fileName);
  const withExt = base.endsWith('.md') ? base : `${base}.md`;
  if (withExt.includes('..')) {
    throw new Error(`Invalid fileName: ${fileName}`);
  }
  return withExt;
}

function renderPlanMarkdown({ name, overview, suites }) {
  const lines = [];
  lines.push(`# ${name}`, '');
  lines.push(overview.trim(), '');

  suites.forEach((suite, suiteIdx) => {
    const suiteNum = suiteIdx + 1;
    lines.push(`### ${suiteNum}. ${suite.name}`);
    if (suite.seedFile) lines.push(`Seed file: \`${suite.seedFile}\``);
    lines.push('');

    suite.tests.forEach((test, testIdx) => {
      const testNum = testIdx + 1;
      lines.push(`#### ${suiteNum}.${testNum} ${test.name}`);
      lines.push(`File: \`${test.file}\``, '');
      lines.push('Steps:');
      test.steps.forEach((step, i) => lines.push(`${i + 1}. ${step}`));
      lines.push('');
    });
  });

  return lines.join('\n').trimEnd() + '\n';
}

const server = new McpServer({ name: 'qa-planner', version: '0.1.0' });

server.tool(
  'planner_save_plan',
  'Save a structured QA test plan. Renders the markdown itself (including all #### N.N headings) ' +
    'from the given suites/tests/steps. This is the ONLY way to persist a plan — never write the ' +
    'plan file directly. Pass the FULL merged suite list every time: there is no append mode, so ' +
    'omitting an existing suite deletes it from the saved plan.',
  planSchema,
  async (args) => {
    const fileName = safeFileName(args.fileName);
    const markdown = renderPlanMarkdown(args);
    await mkdir(PLANS_DIR, { recursive: true });
    const fullPath = path.join(PLANS_DIR, fileName);
    await writeFile(fullPath, markdown, 'utf8');

    const suiteCount = args.suites.length;
    const testCount = args.suites.reduce((n, s) => n + s.tests.length, 0);

    return {
      content: [
        {
          type: 'text',
          text: `Saved plan "${args.name}" to plans/${fileName} (${suiteCount} suite(s), ${testCount} test(s)).`,
        },
      ],
    };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
