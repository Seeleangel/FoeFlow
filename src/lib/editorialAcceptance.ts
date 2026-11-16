import { taskContractValid } from './editorialContract';
import { renderPublicDocument } from './editorialRender';
import { getAllThemes } from './themeLoader';
import { artifactContentHash, gateEffectOf, hashText, type EditorialSession, type GateReport, type GateCheck, type LayoutStamp, type RequiredSource, type FactClaim } from './editorialTypes';
import { currentInputKey, sameInputKey } from './editorialTypes';
import { publicArtifactBlocks, validatePublicArtifact, projectPublicArtifact } from './editorialDocument';
import { resolveFacts, permissionAllows, validRefs, selectorsEquivalent } from './editorialFacts';
export function visibleBlockText(text: string): string { return text.replace(/^#{1,6}\s+|^>\s+|^(?:[-*]|\d+\.)\s+/g, '').replace(/\*\*(.*?)\*\*|\*(.*?)\*|`(.*?)`/g, '$1$2$3'); }
const normalized = (text: string) => visibleBlockText(text).normalize('NFKC').replace(/\s+/g, '');
export function sourceRequirementSatisfied(s: EditorialSession, source: RequiredSource): boolean {
  return s.readReceipts.some(receipt => (!receipt.sourceRequirementId || receipt.sourceRequirementId === source.id) && !!receipt.contextHash && receipt.evidenceIds.length > 0 && receipt.evidenceIds.every(id => {
    const e = s.evidence.find(e => e.id === id);
    return !!e && (e.kind === 'library' || e.kind === 'import' || e.kind === 'legacy_draft') && e.provenance.documentId === receipt.documentId && (!source.selector.documentId || source.selector.documentId === receipt.documentId) &&
      // A title-only source needs an explicit resolved requirement ID from the source port, not a guessed title.
      (!!source.selector.documentId || receipt.sourceRequirementId === source.id) && receipt.contentHash === e.contentHash && e.contentHash === hashText(e.text) && receipt.range[0] >= 0 && receipt.range[1] <= e.text.length && receipt.range[1] > receipt.range[0] && (source.depth !== 'full_document' || e.provenance.complete !== false && receipt.range[0] === 0 && receipt.range[1] === e.text.length);
  }));
}
export function sourceWaiver(s: EditorialSession, sourceId: string): string | undefined {
  const waiver = s.task.sourceWaivers.find(w => w.sourceRequirementId === sourceId && w.actor === 'editor' && validRefs(s, w.refs) && w.refs.every(ref => s.evidence.find(e => e.id === ref.evidenceId)?.kind === 'editor_message'));
  return waiver?.reason;
}
/** A denied/deferred material may pass only when the candidate does not actually use it. */
function permissionSubjectStatus(s: EditorialSession, criterionId: string, subjectId: string, use: { channel: string; purpose: string; identity: 'named' | 'anonymous' | 'not_applicable' }): { status: GateCheck['status']; detail: string } {
  const inUse = !!s.candidate?.assets.some(asset => asset.assetId === subjectId && asset.state === 'included');
  const gap = s.gaps.find(item => item.requirementId === criterionId && item.selector?.scopeId === subjectId);
  const decisionKind = (s.gapDecisions ?? []).find(decision => decision.gapId === gap?.id && (decision.kind === 'defer' || decision.kind === 'deny'))?.kind;
  const denied = s.permissions.some(permission => permission.subjectId === subjectId && permission.state === 'denied');
  if (denied) return inUse
    ? { status: 'fail', detail: '编辑拒绝授权，但正文仍在使用该素材。' }
    : { status: 'pass', detail: '编辑拒绝授权；正文未使用该素材' };
  if (decisionKind) return inUse
    ? { status: 'fail', detail: '编辑已选择不使用该素材，但正文仍在使用。' }
    : { status: 'pass', detail: '编辑选择按现有信息继续；正文未使用该素材' };
  return permissionAllows(s, subjectId, use) ? { status: 'pass', detail: '授权已确认。' } : { status: 'fail', detail: '缺少必要授权。' };
}

/** The final renderer must preserve every block's visible text; position checks use actual p elements. */
function renderedBlocks(s: EditorialSession, layout: LayoutStamp): { first?: string; valid: boolean } {
  if (!s.candidate || layout.contentHash !== s.candidate.contentHash || layout.htmlHash !== hashText(layout.html) || typeof DOMParser === 'undefined') return { valid: false };
  const root = new DOMParser().parseFromString(layout.html, 'text/html');
  const rendered = [...root.querySelectorAll('[data-editorial-block]')];
  const blocks = publicArtifactBlocks(s.candidate);
  const unsafe = root.querySelector('script,style,img,iframe,form,input,button,object,embed,link,base') || [...root.body.querySelectorAll<HTMLElement>('*')].some(node => node.hidden || node.style.display === 'none' || node.style.visibility === 'hidden' || node.style.opacity === '0' || [...node.attributes].some(attr => /^on/i.test(attr.name)));
  const article = root.querySelector('article');
  const theme = getAllThemes().find(theme => theme.name === layout.themeId);
  let canonical = false;
  try { const expected = theme && renderPublicDocument(projectPublicArtifact(s.candidate), theme); canonical = !!expected && expected.html === layout.html && expected.themeVersion === layout.themeVersion; } catch { /* fail closed */ }
  const valid = canonical && !unsafe && !!article && article.children.length === blocks.length + 1 && rendered.length === blocks.length && rendered.every((node, i) => node.getAttribute('data-editorial-block') === blocks[i].id && normalized(node.textContent ?? '') === normalized(blocks[i].text)) && normalized(root.body.textContent ?? '') === normalized(s.candidate.title + blocks.map(b => visibleBlockText(b.text)).join(''));
  const firstBlock = blocks.find(b => b.kind === 'paragraph');
  const first = root.querySelector('article p');
  return { valid, first: first && firstBlock && first.getAttribute('data-editorial-block') === firstBlock.id ? first.textContent ?? '' : undefined };
}
export function validateAcceptance(s: EditorialSession, layout?: LayoutStamp): GateReport {
  const checks: GateCheck[] = []; const inputKey = currentInputKey(s); const result = resolveFacts(s); const blockers = new Set<string>();
  const add = (id: string, status: GateCheck['status'], detail: string, blocking = true, verifier = 'deterministic') => { checks.push({ criterionId: id, status, detail, verifier }); if (blocking && status !== 'pass') blockers.add(id); };
  add('task_plan', taskContractValid(s) ? 'pass' : 'unknown', 'Structured objective and intent coverage required.');
  add('candidate', s.candidate && s.candidate.contentHash === artifactContentHash(s.candidate.title, s.candidate.bodyMarkdown, s.candidate.assets) ? 'pass' : 'unknown', 'Current content revision required.');
  for (const diagnostic of [...s.diagnostics, ...result.diagnostics].filter(diagnostic => gateEffectOf(diagnostic) === 'block')) add('diagnostic:' + diagnostic.code, 'unknown', diagnostic.message);
  // Artifact/review/layout failures are re-derived here and always block the current candidate.
  for (const diagnostic of validatePublicArtifact(s)) add('diagnostic:' + diagnostic.code, 'unknown', diagnostic.message);
  for (const gap of result.conflicts) add(gap.id, 'fail', gap.reason, gap.blocking);
  const rendered = layout ? renderedBlocks(s, layout) : undefined;
  if (rendered) add('layout_integrity', rendered.valid ? 'pass' : 'fail', 'Final visible HTML and block order must match public content.');
  const body = (s.candidate ? publicArtifactBlocks(s.candidate) : []).map(b => visibleBlockText(b.text)).join('\n') ?? '';
  const first = layout ? rendered?.first : s.candidate?.blocks.find(b => b.kind === 'paragraph')?.text;
  const claim = (id: string): FactClaim | undefined => result.claims.find(c => c.id === id);
  const sourceStatus = (id: string): { status: GateCheck['status']; detail: string } => {
    const source = s.task.requiredSources.find(source => source.id === id); if (!source) return { status: 'unknown', detail: 'Unresolved source requirement.' };
    const waiver = sourceWaiver(s, id); return waiver ? { status: 'pass', detail: 'Editor waived source: ' + waiver } : { status: sourceRequirementSatisfied(s, source) ? 'pass' : 'fail', detail: 'Required source needs a current consumed read receipt.' };
  };
  for (const source of s.task.requiredSources) { const status = sourceStatus(source.id); add('source:' + source.id, status.status, status.detail); }
  for (const criterion of s.task.criteria) {
    let status: GateCheck['status'] = 'unknown', detail = 'Cannot deterministically verify this criterion.', verifier = criterion.verification, semanticReviewed = false, unverifiableFacts = false;
    const rule = criterion.rule;
    if (criterion.verification === 'deterministic' && rule.kind !== 'semantic' || rule.kind === 'permission' || rule.kind === 'source_read') {
      switch (rule.kind) {
        case 'include_facts': {
          // A criterion may name claims the extraction never produced, or (as live models often do)
          // reference requirement ids instead of claim ids. Neither is evidence that the body is wrong:
          // requirement ids are already enforced by the requirement checks below, so only ids that
          // resolve to neither a claim nor a requirement leave the check unknown.
          const named = rule.factIds.map(claim), facts = named.filter((c): c is FactClaim => !!c);
          const requirementIds = rule.factIds.filter(id => !claim(id) && s.task.requirements.some(requirement => requirement.id === id));
          const unresolved = rule.factIds.filter(id => !claim(id) && !s.task.requirements.some(requirement => requirement.id === id));
          const text = rule.location === 'first_body_paragraph' ? first : body;
          unverifiableFacts = unresolved.length > 0;
          status = unresolved.length || facts.some(c => c.epistemic !== 'supported' || c.visibility !== 'public') ? 'unknown'
            : !facts.length ? 'pass'
            : text !== undefined && facts.every(c => normalized(text).includes(normalized(c.value)) || rule.location === 'body' && normalized(s.candidate?.title ?? '').includes(normalized(c.value))) ? 'pass' : 'fail';
          const notes: string[] = [];
          if (requirementIds.length) notes.push(`${requirementIds.length} id(s) point at task requirements; those are enforced as requirement checks.`);
          if (unresolved.length) notes.push(`${unresolved.length} id(s) resolve to no claim or requirement: ${unresolved.join(', ')}`);
          detail = 'Facts must occur in the required body location.' + (notes.length ? ' ' + notes.join(' ') : ''); break;
        }
        case 'exclude_claims': { const facts = rule.factIds.map(claim); status = facts.some(c => !c) ? 'unknown' : facts.some(c => normalized(body + (s.candidate?.title ?? '')).includes(normalized(c!.value))) ? 'fail' : 'pass'; break; }
        case 'length': { const n = [...normalized(body)].length; status = n >= (rule.min ?? 0) && n <= (rule.max ?? Infinity) ? 'pass' : 'fail'; detail = `Visible body characters (excluding whitespace): ${n}`; break; }
        case 'preserve_blocks': status = rule.blockHashes.every(hash => s.candidate?.blocks.some(b => hashText(b.text) === hash)) ? 'pass' : 'fail'; break;
        case 'permission': {
          let permissionStatus: GateCheck['status'] = rule.subjectIds.length ? 'pass' : 'fail';
          let permissionDetail = rule.subjectIds.length ? '' : '缺少必要授权。';
          for (const subjectId of rule.subjectIds) {
            const result = permissionSubjectStatus(s, criterion.id, subjectId, { channel: rule.channel ?? 'public', purpose: rule.use, identity: rule.identity ?? 'not_applicable' });
            if (result.status !== 'pass') { permissionStatus = result.status; permissionDetail = result.detail; break; }
            permissionDetail = permissionDetail || result.detail;
          }
          status = permissionStatus; detail = permissionDetail; break;
        }
        case 'source_read': { const source = sourceStatus(rule.sourceRequirementId); status = source.status; detail = source.detail; break; }
      }
    } else {
      const human = s.humanVerifications.find(v => v.actor === 'editor' && v.criterionId === criterion.id && sameInputKey(v.inputKey, inputKey));
      if (human) { status = human.status; verifier = 'human'; detail = 'Editor verified this exact input revision.'; }
      else if (criterion.verification !== 'human' && s.review && sameInputKey(s.review.inputKey, inputKey)) {
        const check = s.review.criterionChecks?.find(check => check.criterionId === criterion.id);
        if (check) { status = check.status; verifier = 'semantic'; detail = check.detail; semanticReviewed = true; }
      }
    }
    // A human-verification criterion is answered by the editor during handoff review, not by the agent.
    // Blocking the draft on it would ask the editor to confirm before receiving the draft, so it is
    // recorded as a pending handoff check instead of a delivery blocker.
    const humanPending = verifier === 'human' && status === 'unknown';
    // A semantic criterion the reviewer could not decide ("unknown") is likewise an editor handoff note, not
    // proof that the draft is wrong. Only an explicit review "fail" may keep a publishable draft from delivery.
    const semanticPending = verifier === 'semantic' && semanticReviewed && status === 'unknown';
    // A fact id the extraction never registered cannot be checked mechanically, and it is not evidence
    // that the body is wrong: the live model may name the same fact differently. Surface it as a
    // handoff note instead of a delivery blocker, so a correct draft is not trapped in a repair loop.
    const factsPending = unverifiableFacts && status === 'unknown';
    const pending = humanPending || semanticPending || factsPending;
    add(criterion.id, status, humanPending ? '待编辑人工确认：' + (detail || criterion.id) : semanticPending ? '待人工确认（语义判据无法机械核验）：' + (detail || criterion.id) : factsPending ? '待人工确认（事实条目未登记，无法机械核验）：' + (detail || criterion.id) : detail, criterion.severity === 'blocking' && !pending, verifier);
  }
  // Requirements are independently enforced; unrecognised detail cannot close another selector.
  for (const requirement of s.task.requirements) {
    const omitted = s.task.permittedOmissions.some(o => o.requirementId === requirement.id && validRefs(s, o.refs));
    const supplied = result.claims.some(c => c.epistemic === 'supported' && c.visibility === 'public' && selectorsEquivalent(s, c.selector, requirement.selector));
    // Step 2: an explicit defer decision passes the gate but stays visible in the check detail.
    const gap = s.gaps.find(item => item.requirementId === requirement.id);
    const deferred = !!gap && (s.gapDecisions ?? []).some(decision => decision.gapId === gap.id && decision.kind === 'defer');
    const soft = requirement.askable === false;
    // A confirmation choice answers with the selected option, not a claim grounded in the
    // editor message; it closes the requirement for the gate with a visible detail.
    const confirmedChoice = !!gap && (s.answers ?? []).some(answer => answer.gapId === gap.id && answer.method === 'confirmation' && answer.choice === 'supply');
    // G3: a requirement without a dependency is treated as a constraint, not a dead-end blocker.
    const missingDependency = !requirement.whyNeeded || !requirement.whyNeeded.trim();
    add('requirement:' + requirement.id, missingDependency || omitted || supplied || deferred || soft || confirmedChoice ? 'pass' : 'unknown',
      missingDependency ? '该要求缺少依赖，已按约束处理：' + requirement.reason : confirmedChoice ? '编辑已按默认选项回答：' + requirement.reason : soft ? '软校验：与输出约束重合，按约束处理：' + requirement.reason : deferred ? '编辑已选择按现有信息继续：' + requirement.reason : requirement.reason,
      requirement.necessity === 'blocking');
  }
  return { inputKey, checks, blockers: [...blockers] };
}
