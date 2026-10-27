// Publicação só da branch acordada e do MESMO commit aprovado pelo CI.
// A verificação roda antes de disponibilizar qualquer chave de produção.
import { pathToFileURL } from 'node:url';

export function assertValidated(runs, sha, { android = false } = {}) {
  for (const path of ['.github/workflows/ci.yml', ...(android ? ['.github/workflows/android.yml'] : [])]) {
    const matching = runs.filter((r) => r.path === path && r.head_sha === sha && r.head_branch === 'ccr-de59a90b-gr4vug' && ['push', 'workflow_dispatch'].includes(r.event)).sort((a, b) => b.id - a.id);
    const latest = matching[0];
    if (!latest || latest.status !== 'completed' || latest.conclusion !== 'success') throw new Error(`Publicação bloqueada: ${path} precisa passar neste commit.`);
  }
}

export async function main(env = process.env) {
  if (env.GITHUB_REF !== 'refs/heads/ccr-de59a90b-gr4vug') throw new Error('Publicação permitida somente na branch ccr-de59a90b-gr4vug.');
  if (!/^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? '') || env.GITHUB_REPOSITORY !== 'Fomes1574/Private') throw new Error('Origem da publicação inválida.');
  const response = await fetch(`https://api.github.com/repos/${env.GITHUB_REPOSITORY}/actions/runs?head_sha=${env.GITHUB_SHA}&per_page=100`, {
    headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${env.GH_TOKEN}`, 'x-github-api-version': '2022-11-28' }, signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Não foi possível conferir o CI (HTTP ${response.status}).`);
  const { workflow_runs: runs } = await response.json();
  assertValidated(runs, env.GITHUB_SHA, { android: env.REQUIRE_ANDROID === '1' });
  console.log(`CI aprovado para ${env.GITHUB_SHA}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
