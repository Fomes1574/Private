// Somente leitura. Usa a autenticação existente do gh, sem ler/imprimir
// tokens, baixar logs, reexecutar jobs ou alterar cobrança/permissões.
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export function diagnose(run, jobs, annotations) {
  const allocated = jobs.filter((j) => j.runner_id > 0);
  const summaries = annotations.map((a) => ({ title: a.title ?? '', message: a.message ?? '' }));
  return {
    run: run.html_url, commit: run.head_sha, status: run.status, conclusion: run.conclusion,
    jobs: jobs.length, allocated: allocated.length,
    stepsStarted: jobs.reduce((n, j) => n + (j.steps ?? []).filter((s) => s.started_at).length, 0),
    failedBeforeRunner: run.conclusion === 'failure' && jobs.length > 0 && allocated.length === 0 && jobs.every((j) => !(j.steps ?? []).length),
    billingAnnotation: summaries.find((a) => /billing|payment|spending|budget|quota|minutes/i.test(`${a.title} ${a.message}`)) ?? null,
    annotations: summaries,
    // Estimativa de execução deste run; a fatura/allowance oficial é da conta.
    estimatedRoundedMinutes: allocated.reduce((n, j) => n + (j.completed_at && j.started_at ? Math.max(0, Math.ceil((Date.parse(j.completed_at) - Date.parse(j.started_at)) / 60_000)) : 0), 0),
  };
}

export function main(args) {
  const [repo, id] = args;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo ?? '') || !/^\d+$/.test(id ?? '') || args.length !== 2) throw new Error('uso: node scripts/diagnosticar-actions.mjs OWNER/REPO RUN_ID (gh autenticado)');
  const get = (path) => JSON.parse(execFileSync('gh', ['api', '-H', 'Accept: application/vnd.github+json', path], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024 }));
  const pages = (path, key = null) => {
    const all = [];
    for (let page = 1; page <= 100; page++) {
      const r = get(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`), items = key ? r[key] : r;
      if (!Array.isArray(items)) throw new Error('resposta inesperada da API');
      all.push(...items); if (items.length < 100) return all;
    }
    throw new Error('resposta grande: não apresento diagnóstico incompleto');
  };
  const run = get(`repos/${repo}/actions/runs/${id}`);
  const jobs = pages(`repos/${repo}/actions/runs/${id}/jobs`, 'jobs');
  const checks = pages(`repos/${repo}/check-suites/${run.check_suite_id}/check-runs`, 'check_runs');
  const annotations = checks.flatMap((c) => pages(`repos/${repo}/check-runs/${c.id}/annotations`));
  return diagnose(run, jobs, annotations);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(main(process.argv.slice(2)), null, 2)); }
  catch (e) { console.error(e.code === 'ENOENT' ? 'Instale GitHub CLI (gh) e autentique a conta com acesso ao repositório.' : 'Não foi possível ler o diagnóstico. Confira os argumentos, gh auth status e acesso a Actions/Checks. Nenhuma alteração foi feita.'); process.exitCode = 1; }
}
