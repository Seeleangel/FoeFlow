import { artifactContentHash, hashText, type EditorialSession, type GateReport, type GateCheck, type LayoutStamp, type RequiredSource, type FactClaim } from './editorialTypes';
import { currentInputKey, sameInputKey } from './editorialTypes';
import { publicArtifactBlocks, validatePublicArtifact } from './editorialDocument';
import { resolveFacts, permissionAllows, validRefs, sameSelector } from './editorialFacts';
export function visibleBlockText(text: string): string { return text.replace(/^#{1,6}\s+|^>\s+|^(?:[-*]|\d+\.)\s+/g, '').replace(/\*\*(.*?)\*\*|\*(.*?)\*|`(.*?)`/g, '$1$2$3'); }
const normalized = (text: string) => visibleBlockText(text).normalize('NFKC').replace(/\s+/g, '');
export function sourceRequirementSatisfied(s: EditorialSession, source: RequiredSource): boolean {
  return s.readReceipts.some(receipt => (!receipt.sourceRequirementId || receipt.sourceRequirementId === source.id) && !!receipt.contextHash && receipt.evidenceIds.length > 0 && receipt.evidenceIds.every(id => {
    const e = s.evidence.find(e => e.id === id);
    return !!e && (e.kind === 'library' || e.kind === 'import') && e.provenance.documentId === receipt.documentId && (!source.selector.documentId || source.selector.documentId === receipt.documentId) &&
      // A title-only source needs an explicit resolved requirement ID from the source port, not a guessed title.
      (!!source.selector.documentId || receipt.sourceRequirementId === source.id) && receipt.contentHash === e.contentHash && e.contentHash === hashText(e.text) && receipt.range[0] >= 0 && receipt.range[1] <= e.text.length && receipt.range[1] > receipt.range[0] && (source.depth !== 'full_document' || receipt.range[0] === 0 && receipt.range[1] === e.text.length);
  }));
}
export function sourceWaiver(s: EditorialSession, sourceId: string): string | undefined {
  const waiver = s.task.sourceWaivers.find(w => w.sourceRequirementId === sourceId && w.actor === 'editor' && validRefs(s, w.refs) && w.refs.every(ref => s.evidence.find(e => e.id === ref.evidenceId)?.kind === 'editor_message'));
  return waiver?.reason;
}
/** The final renderer must preserve every block's visible text; position checks use actual p elements. */
function renderedBlocks(s: EditorialSession, layout: LayoutStamp): { first?: string; valid: boolean } {
  if (!s.candidate || layout.contentHash !== s.candidate.contentHash || layout.htmlHash !== hashText(layout.html) || typeof DOMParser === 'undefined') return { valid: false };
  const root = new DOMParser().parseFromString(layout.html, 'text/html');
  const rendered = [...root.querySelectorAll('[data-editorial-block]')];
  const blocks = publicArtifactBlocks(s.candidate);
  const unsafe = root.querySelector('script,style,img,iframe,form,input,button,object,embed,link,base') || [...root.body.querySelectorAll<HTMLElement>('*')].some(node => node.hidden || node.style.display === 'none' || node.style.visibility === 'hidden' || node.style.opacity === '0' || [...node.attributes].some(attr => /^on/i.test(attr.name)));
  const article = root.querySelector('article');
  const valid = !unsafe && !!article && article.children.length === blocks.length + 1 && rendered.length === blocks.length && rendered.every((node, i) => node.getAttribute('data-editorial-block') === blocks[i].id && normalized(node.textContent ?? '') === normalized(blocks[i].text)) && normalized(root.body.textContent ?? '') === normalized(s.candidate.title + blocks.map(b => b.text).join(''));
  const firstBlock = blocks.find(b => b.kind === 'paragraph');
  const first = root.querySelector('article p');
  return { valid, first: first && firstBlock && first.getAttribute('data-editorial-block') === firstBlock.id ? first.textContent ?? '' : undefined };
}
export function validateAcceptance(s: EditorialSession, layout?: LayoutStamp): GateReport {
  const checks: GateCheck[] = []; const inputKey = currentInputKey(s); const result = resolveFacts(s); const blockers = new Set<string>();
  const add = (id: string, status: GateCheck['status'], detail: string, blocking = true, verifier = 'deterministic') => { checks.push({ criterionId: id, status, detail, verifier }); if (blocking && status !== 'pass') blockers.add(id); };
  add('task_plan', s.task.objective.trim() && s.task.intents.length && s.task.revision > 0 ? 'pass' : 'unknown', 'Structured objective and intent coverage required.');
  add('candidate', s.candidate && s.candidate.contentHash === artifactContentHash(s.candidate.title, s.candidate.bodyMarkdown, s.candidate.assets) ? 'pass' : 'unknown', 'Current content revision required.');
  for (const diagnostic of [...s.diagnostics, ...result.diagnostics, ...validatePublicArtifact(s)]) add('diagnostic:' + diagnostic.code, 'unknown', diagnostic.message);
  for (const gap of result.conflicts) add(gap.id, 'fail', gap.reason);
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
    let status: GateCheck['status'] = 'unknown', detail = 'Cannot deterministically verify this criterion.', verifier = criterion.verification;
    const rule = criterion.rule;
    if (criterion.verification === 'deterministic' && rule.kind !== 'semantic' || rule.kind === 'permission' || rule.kind === 'source_read') {
      switch (rule.kind) {
        case 'include_facts': {
          const facts = rule.factIds.map(claim), text = rule.location === 'first_body_paragraph' ? first : body;
          status = !facts.length || facts.some(c => !c || c.epistemic !== 'supported' || c.visibility !== 'public') ? 'unknown' : text !== undefined && facts.every(c => normalized(text).includes(normalized(c!.value))) ? 'pass' : 'fail'; detail = 'Facts must occur in the required body location.'; break;
        }
        case 'exclude_claims': { const facts = rule.factIds.map(claim); status = facts.some(c => !c) ? 'unknown' : facts.some(c => normalized(body + (s.candidate?.title ?? '')).includes(normalized(c!.value))) ? 'fail' : 'pass'; break; }
        case 'length': { const n = [...normalized(body)].length; status = n >= (rule.min ?? 0) && n <= (rule.max ?? Infinity) ? 'pass' : 'fail'; detail = `Visible body characters (excluding whitespace): ${n}`; break; }
        case 'preserve_blocks': status = rule.blockHashes.every(hash => s.candidate?.blocks.some(b => hashText(b.text) === hash)) ? 'pass' : 'fail'; break;
        case 'permission': status = rule.subjectIds.length && rule.subjectIds.every(subjectId => permissionAllows(s, subjectId, { channel: rule.channel ?? 'public', purpose: rule.use, identity: rule.identity ?? 'not_applicable' })) ? 'pass' : 'fail'; break;
        case 'source_read': { const source = sourceStatus(rule.sourceRequirementId); status = source.status; detail = source.detail; break; }
      }
    } else {
      const human = s.humanVerifications.find(v => v.actor === 'editor' && v.criterionId === criterion.id && sameInputKey(v.inputKey, inputKey));
      if (human) { status = human.status; verifier = 'human'; detail = 'Editor verified this exact input revision.'; }
      else if (criterion.verification !== 'human' && s.review && sameInputKey(s.review.inputKey, inputKey)) {
        const check = s.review.criterionChecks?.find(check => check.criterionId === criterion.id);
        if (check) { status = check.status; verifier = 'semantic'; detail = check.detail; }
      }
    }
    add(criterion.id, status, detail, criterion.severity === 'blocking', verifier);
  }
  // Requirements are independently enforced; unrecognised detail cannot close another selector.
  for (const requirement of s.task.requirements) {
    const omitted = s.task.permittedOmissions.some(o => o.requirementId === requirement.id && validRefs(s, o.refs));
    const supplied = result.claims.some(c => c.epistemic === 'supported' && c.visibility === 'public' && sameSelector(c.selector, requirement.selector));
    add('requirement:' + requirement.id, omitted || supplied ? 'pass' : 'unknown', requirement.reason, requirement.necessity === 'blocking');
  }
  return { inputKey, checks, blockers: [...blockers] };
}
