import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import manifest from './fixtures/editorial-phaseB-manifest.json';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { replayCases, replay } from './editorialReplayFixtures';
import { canHandoff } from '../editorialController';
import { legacyEditorialResult } from '../editorialAgent';
import { requireConfirmedOutput } from '../editorialOutput';
import { validateAcceptance } from '../editorialAcceptance';
import { sameInputKey, currentInputKey } from '../editorialTypes';
const results: Record<string,unknown>[] = [];
const sha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
beforeAll(() => { expect(sha('src/lib/__tests__/fixtures/editorial-v04-operators.json')).toBe(manifest.operatorsSha256); expect(sha('src/lib/__tests__/fixtures/editorial-phaseB-supplement-v1.json')).toBe(manifest.supplementSha256); });
afterAll(() => writeFileSync('.git/phaseB-runtime-replays.json', JSON.stringify({ manifest, codeSha256: sha('src/lib/editorialController.ts'), promptsSha256: sha('src/lib/editorialPrompts.ts'), lockfileSha256: sha('package-lock.json'), results },null,2)));
describe('unchanged v0.4 R07-R15 operator queues + separate preflight/extract fixtures', () => {
  for (const c of replayCases.filter(c => /^R(?:0[7-9]|1[0-5])$/.test(c.id))) it(c.id + ' deterministic port replay', async () => {
    const record: Record<string,unknown> = { id: c.id, status: 'FAIL' }; results.push(record);
    const result = await replay(c), { outcome, stages, checkpoints } = result; const session = outcome.session;
    Object.assign(record, { type: outcome.type, reason: outcome.type === 'incomplete' || outcome.type === 'failed' ? outcome.reason : undefined, decisions: stages.filter(s => s === 'decide').length, writes: stages.filter(s => s === 'write').length, modelCalls: stages.length, remaining: result.remaining });
    expect(stages.filter(s => s === 'decide').length).toBeLessThan(12); expect(stages.filter(s => s === 'write').length).toBeLessThanOrEqual(3); expect(stages.length).toBeLessThanOrEqual(24); expect(session.committed?.confirmation).toBeUndefined(); expect(() => requireConfirmedOutput(session)).toThrow();
    if (['R08','R09','R10','R15'].includes(c.id)) {
      expect(outcome.type).toBe('question'); expect(stages).not.toContain('write'); const adapted = legacyEditorialResult(outcome); if (adapted.type !== 'question') throw new Error('Expected question');
      if (c.id === 'R08') { expect(adapted.text).toContain('图B'); expect(adapted.text).toContain('授权'); expect(adapted.text).toContain('图A'); expect(session.permissions.find(p => p.subjectId === 'imageB')?.state).toBe('denied'); }
      if (c.id === 'R09') { expect(adapted.text).toContain('全阶段结项队伍总数'); expect(adapted.text).toContain('参与学生总数'); expect(result.searches.filter(q => q === '全阶段结项核验表 参与学生总数')).toHaveLength(1); expect(session.evidence.some(e => e.text.includes('82支'))).toBe(true); }
      if (c.id === 'R10') { for (let i=1;i<=3;i++) { expect(adapted.text).toContain('第'+i+'位'); } for (const label of ['经历','原话','授权','anonymous']) expect(adapted.text).toContain(label); expect(session.gaps.filter(g => g.blocking && g.state !== 'resolved')).toHaveLength(9); }
      if (c.id === 'R15') { expect(adapted.text).toContain('报名方式'); expect(adapted.text).toContain('截止时间'); expect(session.gaps.filter(g => g.state === 'asked').map(g => g.selector.predicate)).toEqual(['registration_channel','registration_deadline']); expect(session.claims.filter(c => c.id === 'time' || c.id === 'place').every(c => c.epistemic === 'supported')).toBe(true); }
    } else {
      expect(outcome.type).toBe('draft'); expect(canHandoff(session).blockers).toEqual([]); expect(session.phase).toBe('pending_confirmation'); expect(sameInputKey(session.review!.inputKey, currentInputKey(session))).toBe(true); expect(session.layout?.contentHash).toBe(session.candidate?.contentHash);
      if (c.id === 'R07' || c.id === 'R12') { expect(session.candidate?.bodyMarkdown).toContain('19人结项'); expect(session.candidate?.bodyMarkdown).toContain('19人入选'); expect(session.candidate?.bodyMarkdown).toContain('计划'); expect(session.candidate?.bodyMarkdown).not.toContain('38'); expect(session.gaps.some(g => g.kind === 'conflict' && g.blocking)).toBe(false); }
      if (c.id === 'R11') { expect(checkpoints.some(s => s.candidate?.bodyMarkdown.includes('图B含未授权'))).toBe(true); expect(session.candidate?.bodyMarkdown).not.toContain('图B'); expect(session.candidate?.bodyMarkdown).not.toContain('图C'); expect(session.layout?.html).not.toContain('图B'); const adapted = legacyEditorialResult(outcome); if (adapted.type !== 'draft') throw new Error('Expected draft'); expect(adapted.handoff.notes.some(n => n.includes('图B') && n.includes('授权'))).toBe(true); expect(adapted.handoff.notes.some(n => n.includes('图C') && n.includes('未收到'))).toBe(true); }
      if (c.id === 'R13') { expect(result.reads).not.toHaveLength(0); expect(session.readReceipts.some(r => r.sourceRequirementId === 'required:0')).toBe(true); }
      if (c.id === 'R14') { expect(checkpoints.some(s => s.candidate?.bodyMarkdown.includes('**时间：') && validateAcceptance(s).checks.some(check => check.criterionId === 'required-facts' && check.status === 'fail'))).toBe(true); const p = new DOMParser().parseFromString(session.layout!.html,'text/html').querySelector('article p')!; expect(p.textContent).toContain('2025年6月20日9:00'); expect(p.textContent).toContain('普陀校区体育馆'); }
    }
    record.status = 'PASS';
  });
});
