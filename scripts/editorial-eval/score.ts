import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve, relative } from 'node:path';
import { loadTrials, computeProcessMetrics, renderMarkdown } from './processMetrics';
import { renderHtml } from './scorecardHtml';

/**
 * CLI: turn a finished evaluation run directory into a scorecard.
 *
 *   npm run editorial:score -- --run /path/to/run --out /path/to/run
 *
 * Read-only on the run artifacts; writes scorecard.json / scorecard.md /
 * scorecard.html. No model call, no network.
 */

function option(argv: string[], name: string): string | undefined {
  const index = argv.indexOf('--' + name);
  if (index >= 0 && index + 1 < argv.length) return argv[index + 1];
  const prefixed = argv.find((item) => item.startsWith('--' + name + '='));
  return prefixed ? prefixed.slice(name.length + 3) : undefined;
}

export async function main(argv: string[]): Promise<Record<string, unknown>> {
  const runArg = option(argv, 'run');
  if (!runArg) throw new Error('missing_run');
  const runDir = resolve(runArg);
  const outDir = resolve(option(argv, 'out') ?? runDir);

  const loaded = await loadTrials(runDir);
  if (loaded.trials.length === 0) throw new Error('no_trials');
  const metrics = computeProcessMetrics(loaded.trials, relative(process.cwd(), runDir) || runDir);

  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, 'scorecard.json'), JSON.stringify(metrics, null, 2) + '\n');
  await writeFile(join(outDir, 'scorecard.md'), renderMarkdown(metrics));
  await writeFile(join(outDir, 'scorecard.html'), renderHtml(metrics));

  const summary = {
    status: 'ok',
    runDir,
    outDir,
    filesRead: loaded.filesRead,
    trials: metrics.coverage.trials,
    cases: metrics.coverage.cases,
    duplicatesRemoved: metrics.coverage.duplicatesRemoved,
    deliveredRate: metrics.task.deliveredRate,
    toolCalls: metrics.tools.calls,
    toolSuccessRate: metrics.tools.overall.successRate,
    rejectedRate: metrics.risk.rejectedRate,
    tokens: metrics.experience.tokens.total,
    wallClockP50Ms: metrics.experience.wallClockMs.p50,
    warnings: metrics.warnings,
  };
  console.log(JSON.stringify(summary, null, 2));
  return summary;
}
