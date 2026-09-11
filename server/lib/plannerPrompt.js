/**
 * Builds the prompt for the Planner agent. The model does the exploring and
 * writing; this just encodes the non-negotiable rules from the spec so they
 * don't have to be re-typed (and can't drift) per request.
 */
export function buildPlannerPrompt({ url, context, seedFile, existingPlan, name, fileName }) {
  const parts = [];

  parts.push(
    'You are the Planner agent of a QA automation workbench. Your job is to explore a real, ' +
      'running web application with a live browser (via the connected Playwright MCP tools) and ' +
      'produce a structured test plan by calling the `planner_save_plan` tool. Do not stop at ' +
      'guessing what the app probably does - drive the browser and observe the real behavior.',
  );

  parts.push(`Target application URL: ${url}`);
  if (seedFile) {
    parts.push(`Seed/login credentials file (read it for how to log in): ${seedFile}`);
  }
  if (context) {
    parts.push(`Additional context / pasted notes from the user:\n${context}`);
  }

  parts.push(
    [
      'Required exploration process:',
      '1. Read every input given (this prompt, any pasted context, any uploaded documents) and extract',
      '   every feature, flow, field, and business rule mentioned.',
      '2. Use the Playwright MCP browser tools to open a real browser, log in using the seed file if',
      '   provided, and navigate every section, tab, page, and modal - including opening every "More',
      '   options" menu whose rows expand into further pickers, recursively, until there is nothing left',
      '   to expand.',
      '3. For every interactive element, never stop at "is it visible". Describe what actually happens',
      '   on screen or in the data after the action. A toggle must exercise BOTH states and assert the',
      '   different outcome each produces, not just that it visually flips. A multi-option setting (e.g.',
      '   Effort: low/medium/high, or Model: A/B) gets one test case PER value, not a sample of two.',
      '4. Tag every test\'s priority in its name, exactly one of:',
      '   [Critical] = blocking flows, [High] = core features, [Medium] = edge cases, [Low] = cosmetic.',
      '5. When you are done exploring, call `planner_save_plan` exactly once with the full structured',
      '   payload ({ name, fileName, overview, suites: [{ name, seedFile, tests: [{ name, file, steps }] }] }).',
      '   Do NOT hand-write "#### N.N" headings or any markdown yourself - the tool renders the plan file.',
      '   Do not use Write/Edit/Bash to save anything; planner_save_plan is the only permitted way.',
    ].join('\n'),
  );

  parts.push(`Suggested plan name: ${name}`);
  parts.push(`Suggested plan fileName: ${fileName}`);

  if (existingPlan) {
    parts.push(
      [
        'INCREMENTAL MODE: an existing plan is supplied below as a baseline.',
        '- Preserve every unrelated suite and test VERBATIM.',
        '- Only add or modify what has actually changed in the live application.',
        '- Continue numbering from where the existing plan left off.',
        '- The save tool has no append mode: pass the ENTIRE merged suite list (old + new/changed) to',
        '  planner_save_plan every time. Omitting an existing suite deletes it from the saved plan.',
        '',
        'Existing plan (baseline) content:',
        '```markdown',
        existingPlan,
        '```',
      ].join('\n'),
    );
  }

  return parts.join('\n\n');
}
