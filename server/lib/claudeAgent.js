import { spawn } from 'node:child_process';
import readline from 'node:readline';

/**
 * Turns one line of Claude's `stream-json` output into a short human-readable
 * string for the job event buffer. Tolerant of shape drift across CLI
 * versions - unknown event types are still surfaced, just less prettily.
 */
function describeStreamEvent(evt) {
  switch (evt.type) {
    case 'system':
      return evt.subtype ? `[system] ${evt.subtype}` : null;
    case 'assistant': {
      const blocks = evt.message?.content ?? [];
      return blocks
        .map((b) => {
          if (b.type === 'text') return b.text;
          if (b.type === 'tool_use') return `→ tool: ${b.name} ${JSON.stringify(b.input ?? {}).slice(0, 300)}`;
          return null;
        })
        .filter(Boolean)
        .join('\n');
    }
    case 'user': {
      // tool_result messages fed back to the model
      const blocks = evt.message?.content ?? [];
      return blocks
        .map((b) => {
          if (b.type !== 'tool_result') return null;
          const text = Array.isArray(b.content)
            ? b.content.map((c) => c.text ?? '').join(' ')
            : String(b.content ?? '');
          return `← tool result: ${text.slice(0, 300)}`;
        })
        .filter(Boolean)
        .join('\n');
    }
    case 'result':
      return `[done] ${evt.subtype ?? ''} ${evt.result ? String(evt.result).slice(0, 500) : ''}`.trim();
    default:
      return `[${evt.type}] ${JSON.stringify(evt).slice(0, 300)}`;
  }
}

/**
 * Spawns the Claude Code CLI headlessly in stream-json mode, restricted to
 * exactly the MCP tools passed in `allowedTools`. Any tool not in that list
 * (raw Write/Edit/Bash included) is simply not permitted - this is what
 * enforces "the tool is the only permitted way to save/write", not a prompt
 * instruction alone.
 *
 * `onEvent(text)` is called for each readable line of output as it streams.
 * Resolves with { exitCode, lastResultText } once the process exits.
 */
export function runClaudeAgent({ prompt, mcpConfigPath, allowedTools, cwd, onEvent, systemPrompt }) {
  const args = [
    '-p', prompt,
    '--output-format', 'stream-json',
    '--input-format', 'text',
    '--verbose',
    '--mcp-config', mcpConfigPath,
    '--allowedTools', allowedTools.join(','),
  ];
  if (systemPrompt) {
    args.push('--append-system-prompt', systemPrompt);
  }

  const child = spawn('claude', args, {
    cwd,
    env: process.env,
    windowsHide: true,
  });

  const rl = readline.createInterface({ input: child.stdout });
  let lastResultText = '';

  rl.on('line', (line) => {
    if (!line.trim()) return;
    let evt;
    try {
      evt = JSON.parse(line);
    } catch {
      onEvent?.(line);
      return;
    }
    if (evt.type === 'result') {
      lastResultText = evt.result ?? lastResultText;
    }
    const text = describeStreamEvent(evt);
    if (text) onEvent?.(text);
  });

  let stderrBuf = '';
  child.stderr?.on('data', (d) => {
    stderrBuf += d.toString();
    onEvent?.(`[stderr] ${d.toString().trim()}`);
  });

  const exitPromise = new Promise((resolve, reject) => {
    child.on('error', (err) => reject(err));
    child.on('close', (exitCode) => {
      resolve({ exitCode, lastResultText, stderr: stderrBuf });
    });
  });

  return { child, exitPromise };
}
