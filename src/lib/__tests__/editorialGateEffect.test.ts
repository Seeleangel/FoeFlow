import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { DIAGNOSTIC_GATE_EFFECTS, createEditorialSession, currentInputKey, gateEffectOf, hashText, type EditorialSession } from '../editorialTypes';
import { applyControlEvent, assertConfirmable } from '../editorialState';
import { canHandoff, runEditorialController, type EditorialModelPort } from '../editorialController';
import { deriveGaps } from '../editorialGaps';
import { validateAcceptance } from '../editorialAcceptance';
import { classifyFailure, failureFromError } from '../editorialFailure';
import { uiReady } from './editorialUiFixture';

const noSources = { search: vi.fn(async () => []), read: vi.fn(async () => undefined) };

describe('diagnostic gateEffect', () => {
  it('classifies block vs info and defaults unknown codes to info', () => {
    expect(gateEffectOf({ owner: 'facts:claims:x', code: 'invalid_claim', message: '', refs: [] })).toBe('info');
    expect(gateEffectOf({ owner: 'facts:claims:x', code: 'claim_identity_changed', message: '', refs: [] })).toBe('info');
    expect(gateEffectOf({ owner: 'task:patch', code: 'task_patch_rejected', message: '', refs: [] })).toBe('info');
    expect(gateEffectOf({ owner: 'facts:capacity', code: 'context_capacity', message: '', refs: [] })).toBe('block');
    expect(gateEffectOf({ owner: 'compatibility', code: 'legacy_requires_validation', message: '', refs: [] })).toBe('block');
    expect(gateEffectOf({ owner: 'x', code: 'future_unknown_code', message: '', refs: [] })).toBe('info');
    expect(gateEffectOf({ owner: 'x', code: 'invalid_claim', message: '', refs: [], gateEffect: 'block' })).toBe('block');
  });

  it('lets an info-only diagnostic reach delivery confirmation', () => {
    const session = uiReady();
    session.diagnostics = [{ owner: 'facts:claims:x', code: 'invalid_claim', message: 'ignored candidate', refs: [] }];
    expect(canHandoff(session).blockers).toEqual([]);
    expect(() => assertConfirmable(session)).not.toThrow();
    const confirmed = applyControlEvent(session, {
      type: 'editor_confirmed', sessionId: session.sessionId, runId: session.activeRunId!, expectedRevision: session.revision,
      confirmation: { inputKey: currentInputKey(session), htmlHash: session.layout!.htmlHash, actor: 'editor', confirmedAt: '2026-11-13T10:00:00+08:00' },
    });
    expect(confirmed.phase).toBe('confirmed');
  });

  it('runs a normal write/review to a draft with an info-only diagnostic', async () => {
    const session = createEditorialSession('info-run');
    const text = '写一篇通知。';
    session.evidence = [{ id: 'basis', revision: 1, text, contentHash: hashText(text), kind: 'editor_message', provenance: { messageId: 'm1' }, context: { scenario: 'real' } }];
    session.diagnostics = [{ owner: 'facts:claims:x', code: 'invalid_claim', message: 'ignored candidate', refs: [] }];
    const refs = [{ evidenceId: 'basis', revision: 1, start: 0, end: text.length, quote: text }];
    const plan = { factPatch: {}, taskPatch: { baseRevision: 0, refs, objective: '通知', intents: ['inform'], criteria: [{ id: 'body', origin: 'user', refs, severity: 'blocking', verification: 'deterministic', rule: { kind: 'length', min: 1, unit: 'visible_characters' } }] } };
    let decisions = 0;
    const model: EditorialModelPort = async ({ stage }) => {
      if (stage === 'preflight') return JSON.stringify(plan);
      if (stage === 'decide') return JSON.stringify(++decisions === 1 ? { tool: 'write', instructions: 'Write' } : { tool: 'review' });
      if (stage === 'write') return JSON.stringify({ title: '通知', bodyMarkdown: 'Body' });
      if (stage === 'review') return '{"blocking":[],"notes":[]}';
      throw new Error('fixture_error:' + stage);
    };
    const outcome = await runEditorialController({ session, model, sources: noSources, signal: new AbortController().signal });
    expect(outcome.type).toBe('draft');
    expect(outcome.session.agentDiagnostics?.some(diagnostic => diagnostic.code === 'invalid_claim')).toBe(true);
  });

  it('blocks delivery on a block diagnostic and exposes the internal failure card', async () => {
    const session = uiReady();
    session.diagnostics = [{ owner: 'facts:capacity', code: 'context_capacity', message: 'too large', refs: [] }];
    expect(canHandoff(session).blockers).toContain('diagnostic:context_capacity');
    expect(() => assertConfirmable(session)).toThrow('confirmation_blocked');
  });

  it('attaches a stage/code/traceId retry card when a block diagnostic stops the run', async () => {
    const session = createEditorialSession('block-run');
    const text = 'x'.repeat(120001);
    session.evidence = [{ id: 'basis', revision: 1, text, contentHash: hashText(text), kind: 'editor_message', provenance: { messageId: 'm1' }, context: { scenario: 'real' } }];
    const model = vi.fn(async () => '');
    const outcome = await runEditorialController({ session, model, sources: noSources, signal: new AbortController().signal });
    expect(model).not.toHaveBeenCalled();
    expect(outcome.type).toBe('incomplete');
    expect(outcome.session.lastRun?.stop).toMatchObject({ class: 'internal', stage: 'preflight', code: 'context_capacity', actions: ['retry', 'report'] });
    expect(outcome.session.lastRun?.stop?.traceId).toMatch(/^trace-/);
  });
});

describe('step 4 failure taxonomy', () => {
  it('keeps the design 7.1 classes/actions and exposes the HTTP status', () => {
    const cases: Record<string, { class: string; actions: string[] }> = {
      model_unavailable: { class: 'external', actions: ['retry'] },
      source_unavailable: { class: 'external', actions: ['supply', 'waive'] },
      confirmation_blocked: { class: 'input', actions: ['retry'] },
      artifact_invalid: { class: 'internal', actions: ['retry', 'report'] },
      internal_invariant: { class: 'internal', actions: ['retry', 'report'] },
    };
    for (const [code, expected] of Object.entries(cases)) {
      const failure = classifyFailure(code, 'write');
      expect(failure).toMatchObject({ class: expected.class, actions: expected.actions });
      expect(failure.headline).toMatch(/[\u4e00-\u9fff]/);
      expect(failure.detail.length).toBeGreaterThan(0);
    }
    const http = failureFromError(new Error('HTTP 502'), 'preflight');
    expect(http).toMatchObject({ class: 'external', code: 'model_unavailable', fields: { status: 502 } });
    expect(http.headline).toContain('502');
    expect(http.detail).not.toMatch(/\bat .*\(.*:\d+\)/);
  });

  it('records a structured external deadline stop', async () => {
    const session = createEditorialSession('deadline-stop');
    const text = '写一篇通知。';
    session.evidence = [{ id: 'basis', revision: 1, text, contentHash: hashText(text), kind: 'editor_message', provenance: { messageId: 'm1' }, context: { scenario: 'real' } }];
    let clock = 0;
    const model: EditorialModelPort = async () => { clock = 10_000; return '{"factPatch":{}}'; };
    const outcome = await runEditorialController({ session, model, sources: noSources, signal: new AbortController().signal, budget: { maxElapsedMs: 50 }, now: () => clock });
    expect(outcome.session.lastRun?.stop?.code).toBe('deadline_exceeded');
    expect(outcome.session.lastRun?.stop).toMatchObject({ class: 'external', code: 'deadline_exceeded', retryable: true, actions: ['retry'] });
    expect(outcome.session.lastRun?.stop?.traceId).toMatch(/^trace-/);
  });
});

describe('gateEffect registry guard', () => {
  it('requires every diagnostic code literal in src/lib to be registered', () => {
    const found = new Set<string>();
    for (const file of readdirSync('src/lib').filter(name => name.endsWith('.ts'))) {
      const text = readFileSync('src/lib/' + file, 'utf8');
      for (const match of text.matchAll(/code:\s*'([a-z0-9_]+)'/g)) found.add(match[1]);
      for (const match of text.matchAll(/report\('([a-z0-9_]+)'/g)) found.add(match[1]);
      for (const match of text.matchAll(/diagnose\('([a-z0-9_]+)'/g)) found.add(match[1]);
    }
    const nonDiagnostic = new Set(['deadline_exceeded', 'run_cancelled', 'confirmation_without_pending', 'already_confirmed']);
    expect([...found].filter(code => !code.endsWith('_') && !DIAGNOSTIC_GATE_EFFECTS[code] && !nonDiagnostic.has(code))).toEqual([]);
  });

  it('treats a legacy requirement without whyNeeded as a soft constraint rather than a blocker', () => {
    const session = createEditorialSession('missing-dependency');
    const text = '写一篇通知。';
    session.evidence = [{ id: 'basis', revision: 1, text, contentHash: hashText(text), kind: 'editor_message', provenance: { messageId: 'm1' }, context: { scenario: 'real' } }];
    const refs = [{ evidenceId: 'basis', revision: 1, start: 0, end: text.length, quote: text }];
    session.task = {
      schemaVersion: 2, revision: 1, objective: '通知', intents: ['inform'], targetScopes: [],
      requirements: [{ id: 'capacity', selector: { scopeId: 'event', predicate: 'capacity' }, label: '名额', reason: '读者需要', refs, necessity: 'blocking', resolution: 'supply_fact' }],
      requiredSources: [], criteria: [], permittedOmissions: [], sourceWaivers: [], coverage: { status: 'validated', refs },
    };
    const gate = validateAcceptance(session);
    const check = gate.checks.find(item => item.criterionId === 'requirement:capacity');
    expect(check?.status).toBe('pass');
    expect(check?.detail).toContain('缺少依赖');
    expect(gate.blockers).not.toContain('requirement:capacity');
  });
});

describe('G3 on legacy requirements', () => {
  function fixture(whyNeeded?: string): EditorialSession {
    const session = createEditorialSession('g3');
    const text = '写一篇通知。';
    session.evidence = [{ id: 'basis', revision: 1, text, contentHash: hashText(text), kind: 'editor_message', provenance: { messageId: 'm1' }, context: { scenario: 'real' } }];
    const refs = [{ evidenceId: 'basis', revision: 1, start: 0, end: text.length, quote: text }];
    session.task = {
      schemaVersion: 2, revision: 1, objective: '通知', intents: ['inform'], targetScopes: [],
      requirements: [{ id: 'capacity', selector: { scopeId: 'event', predicate: 'capacity' }, label: '名额', reason: '读者需要', ...(whyNeeded ? { whyNeeded } : {}), refs, necessity: 'blocking', resolution: 'supply_fact' }],
      requiredSources: [], criteria: [], permittedOmissions: [], sourceWaivers: [], coverage: { status: 'validated', refs },
    };
    return session;
  }

  it('does not fall back to reason when whyNeeded is absent', () => {
    const gaps = deriveGaps(fixture());
    expect(gaps.some(gap => gap.requirementId === 'capacity' && gap.gapClass === 'fact')).toBe(false);
    expect(gaps.some(gap => gap.requirementId === 'requirement_without_dependency' && gap.gapClass === 'internal')).toBe(true);
  });

  it('still asks a real fact gap when whyNeeded is present', () => {
    const gaps = deriveGaps(fixture('读者需要知道名额上限'));
    expect(gaps.find(gap => gap.requirementId === 'capacity')).toMatchObject({ gapClass: 'fact', askable: true, whyNeeded: '读者需要知道名额上限' });
  });
});
