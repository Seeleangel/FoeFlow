import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {parseCaseFile,parseRecipes,type CaseResult,type Recipe} from './replay';
import {caseMetrics,groupedMetrics} from './metrics';
import {deriveView} from './derived';

export async function main(args: string[]) {
  const opts: Record<string,string> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith('--') || !args[i + 1]) throw Error('invalid_arguments');
    opts[a.slice(2)] = args[++i];
  }
  for (const key of ['cases','run','out']) if (!opts[key]) throw Error(key + '_required');
  const cases = parseCaseFile(await readFile(resolve(opts.cases),'utf8'));
  const recipes: Record<string,Recipe> = opts.recipe ? parseRecipes(JSON.parse(await readFile(resolve(opts.recipe),'utf8'))) : {};
  const files = await readdir(resolve(opts.run));
  const trialFiles = files.filter(f => /-[0-9]+\.json$/.test(f) && f !== 'summary.json' && f !== 'assertions.json');
  const outDir = resolve(opts.out);
  await mkdir(outDir,{recursive:true});
  const rows: any[] = [];
  const results: any[] = [];
  for (const file of trialFiles) {
    const raw = JSON.parse(await readFile(join(resolve(opts.run),file),'utf8')) as CaseResult;
    const c = cases.find(item => item.id === raw.id);
    if (!c) throw Error('case_not_found:' + raw.id);
    const r = {...raw, derived: deriveView(raw)};
    const m = caseMetrics(c,r,recipes[c.id]);
    rows.push(m);
    results.push({...r,metrics:m});
    await writeFile(join(outDir,file), JSON.stringify({...r,metrics:m},null,1));
  }
  const grouped = groupedMetrics(rows);
  const summary = {runDir: resolve(opts.run), rescoredAt: new Date().toISOString(), cases: [...new Set(rows.map(row => row.id))].length, trials: rows.length, ...grouped, rows};
  await writeFile(join(outDir,'summary.json'), JSON.stringify(summary,null,1));
  const assertions = rows.flatMap(row => row.assertions.map((a: any) => ({case: row.id, trial: row.trial, status: row.status, check: a})));
  await writeFile(join(outDir,'assertions.json'), JSON.stringify(assertions,null,1));
  const pass = rows.filter(row => row.status === 'PASS').map(row => row.id).sort();
  const fail = rows.filter(row => row.status === 'FAIL').map(row => row.id).sort();
  const review = rows.filter(row => row.status === 'NEEDS_REVIEW').map(row => row.id).sort();
  console.log(JSON.stringify({trials: rows.length, counts: grouped.counts, pass, fail, review},null,1));
}