import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diagnose, main } from '../../scripts/diagnosticar-actions.mjs';
test('billing antes de runner só é confirmado quando existe annotation', () => {
  const run = { conclusion: 'failure' }, jobs = [{ runner_id: 0, steps: [] }];
  assert.equal(diagnose(run, jobs, []).failedBeforeRunner, true);
  assert.equal(diagnose(run, jobs, []).billingAnnotation, null);
  assert.match(diagnose(run, jobs, [{ message: 'The job was not started because recent account payments have failed.' }]).billingAnnotation.message, /payments/);
});
test('build que iniciou não é confundido com bloqueio; arredonda cada job', () => {
  const report = diagnose({ conclusion: 'failure' }, [
    { runner_id: 1, started_at: '2026-10-25T00:00:00Z', completed_at: '2026-10-25T00:01:01Z', steps: [{ started_at: '2026-10-25T00:00:00Z' }] },
    { runner_id: 2, started_at: '2026-10-25T00:00:00Z', completed_at: '2026-10-25T00:00:01Z', steps: [] },
  ], []);
  assert.equal(report.failedBeforeRunner, false); assert.equal(report.estimatedRoundedMinutes, 3); assert.equal(report.stepsStarted, 1);
});
test('argumentos inválidos são recusados antes de invocar gh', () => {
  for (const args of [[], ['x/y', '../bad'], ['x/y?token=x', '123'], ['x/y', '1', 'extra']]) assert.throws(() => main(args), /uso:/);
});
