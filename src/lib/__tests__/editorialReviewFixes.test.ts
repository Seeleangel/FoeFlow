import { seedTestTask } from './editorialTestFixtures';
import { applyControlEvent } from '../editorialState';
import { projectPublicArtifact } from '../editorialDocument';
import { requireConfirmedOutput } from '../editorialOutput';
import { currentInputKey } from '../editorialState';
import { describe, it, expect } from 'vitest';
import { createEditorialSession, hashText, type EvidenceRef, type PermissionUse } from '../editorialTypes';
import { applyFactPatch, applyEditorFactPatch, permissionAllows } from '../editorialFacts';
import { parseDraftArtifact, buildWriterContext } from '../editorialDocument';
import { makePublicDocument, renderPublicDocument } from '../editorialOutput';
import { getDefaultTheme } from '../themeLoader';
import { validateAcceptance } from '../editorialAcceptance';
import { normalizeLegacySession } from '../editorialCompatibility';
import { applyToolEvents, startEditorialRun } from '../editorialState';
import { deriveGaps } from '../editorialGaps';
const use: PermissionUse = { channel: 'public', purpose: 'publication', identity: 'not_applicable' };
const setup = () => {
  const s = createEditorialSession('s'), text = 'Alpha. Beta. Gamma. A verified quotation. INTERNAL-STATE.';
  s.evidence = [{ id: 'e', revision: 1, text, contentHash: hashText(text), kind: 'editor_message', provenance: { messageId: 'm' }, context: { scenario: 'real' } }];
  const ref = (quote: string): EvidenceRef => ({ evidenceId: 'e', revision: 1, start: text.indexOf(quote), end: text.indexOf(quote) + quote.length, quote });
  s.scopes = ['Alpha','Beta','Gamma'].map(id => ({ id, kind: 'person', label: id, anchors: [ref(id)], qualifiers: [], identity: 'aligned' }));
  s.claims = [{ id: 'q', selector: { scopeId: 'Beta', predicate: 'quotation' }, value: 'A verified quotation', refs: [ref('A verified quotation')], statusBasis: [], epistemic: 'supported', visibility: 'public' }];
  return { s, ref };
};
describe('phase A independent-review blockers', () => {
  it('B1 model cannot declassify private/editor-only values or erase supported status; editor has a separate grounded port', () => {
    const { s, ref } = setup(); s.claims[0].visibility = 'private'; s.claims[0].statusBasis = [ref('A verified quotation')];
    for (const visibility of ['public','editor_only'] as const) expect(applyFactPatch(s, { claims: [{ ...s.claims[0], visibility, statusBasis: [] }] }).claims[0].visibility).toBe('private');
    s.claims[0].visibility = 'editor_only'; expect(applyFactPatch(s, { claims: [{ ...s.claims[0], visibility: 'public' }] }).claims[0].visibility).toBe('editor_only');
    expect(applyFactPatch(s, { claims: [{ ...s.claims[0], epistemic: 'unknown', statusBasis: [] }] }).claims[0].epistemic).toBe('supported');
    const text = 'Editor authorizes publication of A verified quotation'; s.evidence.push({ ...s.evidence[0], id: 'new', text, contentHash: hashText(text), provenance: { messageId: 'm2' } });
    const basis: EvidenceRef = { evidenceId: 'new', revision: 1, start: 0, end: text.length, quote: text };
    expect(applyEditorFactPatch(s, { claims: [{ ...s.claims[0], visibility: 'public', statusBasis: [basis] }] }).claims[0].visibility).toBe('public');
  });
  it('B2 denial identity/use/history cannot be rewritten by a model even with an old allowed record', () => {
    const { s, ref } = setup(); const denied = { id: 'deny', subjectId: 'Beta', uses: [use], state: 'denied' as const, refs: [ref('Beta')] }; s.permissions = [{ ...denied, id: 'allow', state: 'allowed' }, denied];
    for (const mutation of [{ uses: [] }, { uses: [{ ...use, purpose: 'other' }] }, { subjectId: 'Alpha' }, { state: 'allowed' }]) {
      const next = applyFactPatch(s, { permissions: [{ ...denied, ...mutation }] }); expect(permissionAllows(next, 'Beta', use)).toBe(false); expect(next.permissions.find(p => p.id === 'deny')).toEqual(denied);
    }
  });
  it('B3 validates caption notes and denied quotations on the whole public projection', () => {
    const { s, ref } = setup(); s.permissions = [{ id: 'asset', subjectId: 'Alpha', state: 'allowed', uses: [{ ...use, purpose: 'illustration' }], refs: [ref('Alpha')] }, { id: 'quote-deny', subjectId: 'q', state: 'denied', uses: [use], refs: [ref('A verified quotation')] }];
    const draft = (caption: string) => parseDraftArtifact(JSON.stringify({ title: 'Title', bodyMarkdown: 'Body\n{{asset:slot}}', assets: [{ assetId: 'Alpha', slotId: 'slot', use: 'illustration', state: 'included', publicCaption: caption }], editorialNotes: [{ id: 'n', kind: 'process', text: 'INTERNAL-STATE', relatedIds: [] }] }), { id: 'd', revision: 1 }).artifact!;
    s.candidate = draft('INTERNAL-STATE'); expect(makePublicDocument(s).blockers.some(d => d.code === 'workflow_note_span')).toBe(true);
    s.candidate = draft('A verified quotation'); expect(makePublicDocument(s).blockers.some(d => d.code === 'claim_permission')).toBe(true);
  });
  it('B3 rejects comments, attributes and CSS payloads even with correct text and recomputed hashes', () => {
    const { s } = setup(); s.candidate = parseDraftArtifact('{"title":"Title","bodyMarkdown":"Body"}', { id: 'd', revision: 1 }).artifact!;
    const layout = renderPublicDocument(makePublicDocument(s).document!, getDefaultTheme());
    for (const html of [layout.html.replace('<article ', '<article title="INTERNAL-STATE" '), layout.html + '<!--PRIVATE-SPAN-->', layout.html.replace('<article ', '<article data-note="PRIVATE-SPAN" ')]) expect(validateAcceptance(s, { ...layout, html, htmlHash: hashText(html) }).blockers).toContain('layout_integrity');
  });
  it('B4 transitive aliases inherit denial, satisfy requirements, and exclude every conflicting alias from writer input', () => {
    const { s, ref } = setup(); s.alignments = [{ leftId: 'Alpha', rightId: 'Beta', refs: [ref('Alpha'),ref('Beta')] }, { leftId: 'Beta', rightId: 'Gamma', refs: [ref('Beta'),ref('Gamma')] }];
    s.permissions = [{ id: 'deny', subjectId: 'Alpha', uses: [use], state: 'denied', refs: [ref('Alpha')] }];
    expect(permissionAllows(s, 'Gamma', use)).toBe(false); expect(buildWriterContext(s).claims).toEqual([]);
    s.candidate = parseDraftArtifact('{"title":"Title","bodyMarkdown":"A verified quotation"}', { id: 'd', revision: 1 }).artifact!; expect(makePublicDocument(s).blockers.some(d => d.code === 'claim_permission')).toBe(true);
    s.permissions[0].state = 'allowed'; s.task.requirements = [{ id: 'req', selector: { scopeId: 'Gamma', predicate: 'quotation' }, label: 'quote', reason: 'needed', whyNeeded: 'needed', refs: [ref('Gamma')], necessity: 'blocking', resolution: 'supply_fact' }];
    expect(deriveGaps(s).find(g => g.requirementId === 'req')?.state).toBe('resolved');
    s.claims.push({ ...s.claims[0], id: 'q2', selector: { scopeId: 'Gamma', predicate: 'quotation' }, value: 'INTERNAL-STATE', refs: [ref('INTERNAL-STATE')] }); expect(buildWriterContext(s).claims).toEqual([]);
  });
});

describe('phase A independent-review majors', () => {
  it('M1 preserves the actual confirmed effective legacy HTML and real stored title shape', () => {
    const s = normalizeLegacySession({ id: 'old', state: { generatedTitle: 'Title', generatedText: '# Title\nBody', generatedHtml: '<p>Fallback</p>', layoutHtml: '<p>Confirmed layout</p>', editorial: { status: 'confirmed' } } });
    expect(s.legacy?.html).toBe('<p>Confirmed layout</p>'); expect(s.legacy?.confirmed).toBe(true);
    expect(normalizeLegacySession({ id: 'draft', paramsJson: { title: 'Stored title' }, contentText: 'Body', contentHtml: '<p>Body</p>' }).legacy?.title).toBe('Stored title');
    expect(normalizeLegacySession({ state: { generatedText: 'Body', layoutHtml: '<p>Body</p>', editorial: { status: 'pending' } } }).legacy?.confirmed).toBe(false);
  });
  it('M2 distinguishes evidence-backed additive values from exclusive conflicts and retains unrelated conflicts as advisory', () => {
    const { s, ref } = setup(); const selector = { scopeId: 'Beta', predicate: 'quotation', cardinality: 'set' as const, cardinalityRefs: [ref('Beta')] };
    s.claims = [{ ...s.claims[0], selector }, { ...s.claims[0], id: 'q2', selector, value: 'INTERNAL-STATE', refs: [ref('INTERNAL-STATE')] }];
    s.task.targetScopes = ['Beta']; expect(deriveGaps(s).filter(g => g.kind === 'conflict')).toEqual([]);
    s.claims = s.claims.map(c => ({ ...c, selector: { scopeId: 'Beta', predicate: 'time' } })); expect(deriveGaps(s).some(g => g.kind === 'conflict' && g.blocking)).toBe(true);
    s.task.targetScopes = ['Alpha']; expect(deriveGaps(s).find(g => g.kind === 'conflict')?.blocking).toBe(false);
  });
  it('M3 diagnostics follow the failed entity until it is repaired and survive the atomic event path', () => {
    const { s } = setup(); const invalid = { ...s.claims[0], id: 'bad', refs: [{ ...s.claims[0].refs[0], quote: 'wrong' }] };
    const rejected = applyFactPatch(s, { claims: [invalid] }); expect(rejected.diagnostics.length).toBeGreaterThan(0);
    expect(applyFactPatch(rejected, { claims: [{ ...s.claims[0], id: 'unrelated' }] }).diagnostics.length).toBeGreaterThan(0);
    const repaired = applyFactPatch(rejected, { claims: [{ ...s.claims[0], id: 'bad' }] }); expect(repaired.diagnostics).toEqual([]);
    const active = startEditorialRun(s, 'r'); const applied = applyToolEvents(active, [{ sessionId: 's', runId: 'r', expectedRevision: active.revision, type: 'facts_resolved', scopes: rejected.scopes, claims: rejected.claims, permissions: rejected.permissions, diagnostics: rejected.diagnostics }]); expect(applied.diagnostics).toEqual([]);expect(applied.agentDiagnostics).toEqual(rejected.diagnostics.map(diagnostic=>({...diagnostic,gateEffect:'info'})));
  });
  it('M4 body-only rewrites retain a note ledger and cannot erase a known note leak', () => {
    const { s } = setup(); const active = startEditorialRun(s, 'r'); active.candidate = parseDraftArtifact(JSON.stringify({ title: 'Title', bodyMarkdown: 'Body', editorialNotes: [{ id: 'n', kind: 'process', text: 'INTERNAL-STATE', relatedIds: [] }] }), { id: 'd', revision: 1 }).artifact!;
    const artifact = parseDraftArtifact('{"title":"Title","bodyMarkdown":"INTERNAL-STATE"}', { id: 'd', revision: 2 }).artifact!;
    const next = applyToolEvents(active, [{ sessionId: 's', runId: 'r', expectedRevision: active.revision, type: 'candidate_updated', artifact }]); expect(next.candidate?.editorialNotes).toHaveLength(1); expect(makePublicDocument(next).blockers.some(d => d.code === 'workflow_note_span')).toBe(true);
  });
  it('M5 positive-revision vacuous plans fail both restoration gate and task event acceptance', () => {
    const s = startEditorialRun(createEditorialSession('s'), 'r'); s.task = { ...s.task, revision: 1, objective: 'Inform', intents: ['inform'] }; expect(validateAcceptance(s).blockers).toContain('task_plan');
    expect(() => applyToolEvents(s, [{ sessionId: 's', runId: 'r', expectedRevision: s.revision, type: 'task_revised', task: { ...s.task, revision: 2 } }])).toThrow('invalid_task_contract');
  });
});

describe('review-fix integration controls', () => {
  it('B1/B2 full tool snapshots cannot bypass the candidate authority boundary', () => {
    const { s, ref } = setup(); const active = startEditorialRun(s, 'r'); active.claims[0].visibility = 'private'; active.claims[0].statusBasis = [ref('A verified quotation')];
    expect(() => applyToolEvents(active, [{ sessionId: 's', runId: 'r', expectedRevision: active.revision, type: 'facts_resolved', scopes: active.scopes, claims: [{ ...active.claims[0], visibility: 'public', statusBasis: [] }], permissions: [] }])).toThrow('unsafe_fact_snapshot');
    active.permissions = [{ id: 'deny', subjectId: 'Beta', uses: [use], state: 'denied', refs: [ref('Beta')] }];
    expect(() => applyToolEvents(active, [{ sessionId: 's', runId: 'r', expectedRevision: active.revision, type: 'facts_resolved', scopes: active.scopes, claims: active.claims, permissions: [] }])).toThrow('unsafe_fact_snapshot');
  });
  it('M3 replaces legacy validation lock only after a fresh grounded candidate and its review', () => {
    const s = startEditorialRun(normalizeLegacySession({ generatedText: '# Old\nOld body', generatedHtml: '<p>Old body</p>', editorial: { status: 'pending' } }), 'r'); seedTestTask(s);
    const artifact = parseDraftArtifact('{"title":"New","bodyMarkdown":"New public body"}', { id: 'new', revision: 1 }).artifact!;
    let next = applyToolEvents(s, [{ sessionId: s.sessionId, runId: 'r', expectedRevision: s.revision, type: 'candidate_updated', artifact }]); expect(next.diagnostics.some(d => d.owner === 'compatibility')).toBe(true);
    next = applyToolEvents(next, [{ sessionId: next.sessionId, runId: 'r', expectedRevision: next.revision, type: 'review_recorded', review: { inputKey: currentInputKey(next), issues: [], blocking: [], notes: [] } }]); expect(next.diagnostics).toEqual([]); expect(next.legacy?.text).toBe('# Old\nOld body');
  });
  it.each(['quotation', 'organizer', 'experience'])('M2 accepts multiple supported additive %s assertions without splitting identities', predicate => {
    const { s, ref } = setup(); const selector = { scopeId: 'Beta', predicate, cardinality: 'set' as const, cardinalityRefs: [ref('Beta')] };
    s.claims = [{ ...s.claims[0], selector }, { ...s.claims[0], id: 'other', selector, value: 'INTERNAL-STATE', refs: [ref('INTERNAL-STATE')] }]; s.task.targetScopes = ['Beta']; expect(deriveGaps(s).some(g => g.kind === 'conflict')).toBe(false);
  });
});

describe('review trust-boundary end-to-end negative and positive controls', () => {
  it('B2 explicit new editor evidence permits regrant, but subject/use history stays immutable', () => {
    const { s,ref } = setup(), denied = { id: 'deny', subjectId: 'Beta', uses: [use], state: 'denied' as const, refs: [ref('Beta')] }; s.permissions = [{ ...denied,id: 'allow',state: 'allowed' },denied];
    const text = 'Editor now grants Beta publication permission'; const basis = { evidenceId: 'grant',revision: 1,start: 0,end: text.length,quote: text }; s.evidence.push({ ...s.evidence[0],id: 'grant',text,contentHash: hashText(text) });
    const granted = applyEditorFactPatch(s,{ permissions: [{ ...denied,state: 'allowed',refs: [basis] }] }); expect(permissionAllows(granted,'Beta',use)).toBe(true);
    expect(applyEditorFactPatch(s,{ permissions: [{ ...denied,subjectId: 'Alpha',refs: [basis] }] }).permissions.find(p => p.id === 'deny')?.subjectId).toBe('Beta');
  });
  it('B4 cross-source transitive aliases inherit both allow and deny independent of alignment order', () => {
    const { s,ref } = setup(); const text = 'Beta identity from another source'; s.evidence.push({ ...s.evidence[0],id: 'other',kind: 'library',text,contentHash: hashText(text),provenance: { documentId: 'other-document' } });
    const beta = { evidenceId: 'other',revision: 1,start: 0,end: 4,quote: 'Beta' }; s.scopes.find(scope => scope.id === 'Beta')!.anchors = [beta]; s.alignments = [{ leftId: 'Alpha',rightId: 'Beta',refs: [ref('Alpha'),beta] },{ leftId: 'Beta',rightId: 'Gamma',refs: [beta,ref('Gamma')] }];
    s.permissions = [{ id: 'allow',subjectId: 'Alpha',uses: [use],state: 'allowed',refs: [ref('Alpha')] }]; expect(permissionAllows(s,'Gamma',use)).toBe(true);
    s.permissions.push({ id: 'deny',subjectId: 'Beta',uses: [use],state: 'denied',refs: [beta] }); expect(permissionAllows(s,'Gamma',use)).toBe(false); s.alignments.reverse(); s.scopes.reverse(); expect(permissionAllows(s,'Gamma',use)).toBe(false);
  });
  it('B3 a forged clean gate cannot confirm or unlock a note-bearing caption or hidden HTML payload', () => {
    const { s,ref } = setup(); let active = startEditorialRun(s,'r'); seedTestTask(active); active.permissions = [{ id: 'asset',subjectId: 'Alpha',uses: [{ ...use,purpose: 'illustration' }],state: 'allowed',refs: [ref('Alpha')] }];
    active.candidate = parseDraftArtifact(JSON.stringify({ title: 'Title',bodyMarkdown: 'Body\n{{asset:slot}}',assets: [{ assetId: 'Alpha',slotId: 'slot',use: 'illustration',state: 'included',publicCaption: 'INTERNAL-STATE' }],editorialNotes: [{ id: 'note',kind: 'process',text: 'INTERNAL-STATE',relatedIds: [] }] }),{ id: 'candidate',revision: 1 }).artifact!;
    const assertLocked = () => { const key = currentInputKey(active); active.review = { inputKey: key,issues: [],blocking: [],notes: [] }; active.gate = { inputKey: key,checks: [{ criterionId: 'fake',status: 'pass',verifier: 'model',detail: '' }],blockers: [] }; expect(() => applyControlEvent(active,{ sessionId: active.sessionId,runId: active.activeRunId!,expectedRevision: active.revision,type: 'editor_confirmed',confirmation: { inputKey: key,htmlHash: active.layout!.htmlHash,actor: 'editor',confirmedAt: 'now' } })).toThrow('confirmation_blocked'); expect(() => requireConfirmedOutput(active)).toThrow(); };
    active.layout = renderPublicDocument(projectPublicArtifact(active.candidate),getDefaultTheme()); assertLocked();
    active = { ...active,candidate: parseDraftArtifact('{"title":"Title","bodyMarkdown":"Body"}',{ id: 'candidate',revision: 2 }).artifact! }; active.layout = renderPublicDocument(makePublicDocument(active).document!,getDefaultTheme()); active.layout.html += '<!--INTERNAL-STATE-->'; active.layout.htmlHash = hashText(active.layout.html); assertLocked();
  });
});

it('M5 generic first-task snapshots cannot forge a source waiver, material-origin user task or vacuous rule', () => {
  const { s } = setup(); const active = startEditorialRun(s,'r'); seedTestTask(active); const task = structuredClone(active.task), refs = task.coverage!.refs;
  const fresh = startEditorialRun({ ...active,task: createEditorialSession('new').task },'r');
  const event = { sessionId: fresh.sessionId,runId: 'r',expectedRevision: fresh.revision,type: 'task_revised' as const };
  expect(() => applyToolEvents(fresh,[{ ...event,task: { ...task,criteria: [{ ...task.criteria[0],rule: { kind: 'length',unit: 'visible_characters' } }] } }])).toThrow('invalid_task_contract');
  expect(() => applyToolEvents(fresh,[{ ...event,task: { ...task,requiredSources: [{ id: 'source',selector: { documentId: 'doc' },purpose: 'read',refs,depth: 'full_document',state: 'pending' }],sourceWaivers: [{ sourceRequirementId: 'source',actor: 'editor',refs,reason: 'forged by snapshot' }] } }])).toThrow('invalid_task_contract');
  fresh.evidence.find(e => e.id === refs[0].evidenceId)!.kind = 'library'; expect(() => applyToolEvents(fresh,[{ ...event,task }])).toThrow('invalid_task_contract');
});
