import type {CaseResult} from './replay';
import {currentInputKey} from '../../src/lib/editorialState';
import {hashText} from '../../src/lib/editorialTypes';

/** Deterministic, model-free view of a trial used by benchmark assertions. */
function visible(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s+/gm, '')
    .replace(/^(?:[-*]|\d+\.)\s+/gm, '')
    .replace(/\*\*|__|`/g, '');
}
function compact(text: string): string {
  return visible(text)
    .normalize('NFKC')
    .replace(/[\s\u00a0]+/g, '')
    .replace(/[：]/g, ':')
    .replace(/(上午|下午|晚上|中午|早上)/g, '')
    // Function words and punctuation vary with paraphrase ("活动地点为知行楼 103 室"
    // vs the claim value "地点知行楼 103 室"); they carry no fact content.
    .replace(/[，。、；：""''（）()「」《》【】〔〕·,.;:!?！？\-—]/g, '')
    .replace(/[为是于在的了与和及]/g, '');
}
interface TraceEntry { type?: string; stage?: string }

export interface DerivedView {
  terminalKind: string;
  delivered: boolean;
  titleCompact: string;
  bodyCompact: string;
  firstParagraphCompact: string;
  bodyHasAllFacts: boolean;
  firstParagraphHasAllFacts: boolean;
  reviewAligned: boolean;
  layoutAligned: boolean;
  sourceTitles: string[];
  stages: string[];
  gatesLocked: boolean;
  claimCount: number;
  followupsApplied: boolean;
}

export function deriveView(r: CaseResult): DerivedView {
  const session = r.outcome && 'session' in r.outcome ? (r.outcome as { session: unknown }).session as any : undefined;
  const candidate = session?.candidate;
  const blocks: { kind: string; text: string }[] = candidate?.blocks ?? [];
  const body = blocks.map(block => visible(block.text)).join('\n');
  const firstParagraph = blocks.find(block => block.kind === 'paragraph')?.text ?? '';
  const facts: string[] = (session?.claims ?? [])
    .filter((claim: any) => claim.epistemic === 'supported' && claim.visibility === 'public' && typeof claim.value === 'string')
    .map((claim: any) => claim.value);
  // Extraction files editorial instructions as claims too ('可发的标题和短稿', '只报集体成绩',
  // '本次素材不包含经授权的姓名名单'). Those are constraints, not public content facts:
  // grading them as literal body text punishes a correct draft. Skip meta predicates.
  const metaClaim = (claim: any): boolean => /标题|交付|口径|授权|名单|要求|注意|素材|来源|任务|指令|约束|规范|暂拟|字数|结构/.test(String(claim?.selector?.predicate ?? ''));
  const contentFacts = (session?.claims ?? [])
    .filter((claim: any) => !metaClaim(claim))
    .filter((claim: any) => claim.epistemic === 'supported' && claim.visibility === 'public' && typeof claim.value === 'string')
    .map((claim: any) => claim.value as string);
  // "没有真实活动信息" / "不自带纸张" are statements about absence, not literal body text.
  // Then grade quantitative/dated facts only: they are the machine-verifiable core
  // (times, places, quotas, deadlines). Qualitative wording ("对象是初学者" vs
  // "面向初学者") is paraphrase, which belongs to G1 judging, not a literal G0 check.
  const compactFacts = [...new Set(contentFacts
    .map(compact)
    .filter(value => value && !/没有|未定|暂无|不含|不自带|不需|无须|不包含|不涉及|不得|禁止/.test(value))
    .filter(value => /[0-9]/.test(value)))];
  // Live extraction often repeats the same fact as a compound sentence (directive-fact-*).
  // A fact that contains two or more other public facts is a restatement: grade its parts,
  // otherwise wording/word order makes a fully grounded draft look like it invented facts.
  const atomicFacts = compactFacts.filter(fact => compactFacts.filter(other => other !== fact && fact.includes(other)).length < 2);
  const bodyText = compact(body);
  const firstText = compact(firstParagraph);
  const contains = (value: string) => bodyText.includes(compact(value));
  const containsFirst = (value: string) => firstText.includes(compact(value));
  // A factual sentence can be split by labels in the draft ("时间：2026 年 12 月 8 日 19:00
  // 地点：知行楼 205 室") while the claim keeps it as one sentence. Quantitative facts are
  // identified by their digit runs, so grade those tokens instead of the whole sentence:
  // 302 vs 405 still fails, while label insertion/word order no longer does.
  const factDigitRuns = (value: string): string[] => compact(value).match(/\d+/g) ?? [];
  const coveredByDigits = (value: string, text: string): boolean => {
    const runs = factDigitRuns(value);
    return runs.length > 0 && runs.every(run => text.includes(run));
  };
  const review = session?.review;
  const layout = session?.layout;
  const trace = (r.trace ?? []) as TraceEntry[];
  const stages = [...new Set(trace.filter(entry => entry.type === 'model_request' && typeof entry.stage === 'string').map(entry => entry.stage as string))];
  const outputs = (r.outputs ?? []) as { allowed?: boolean }[];
  const followups = (r.execution?.requiredSteps ?? []).filter(step => step.startsWith('followup:'));
  return {
    terminalKind: r.outcome?.type ?? 'none',
    delivered: r.outcome?.type === 'draft',
    titleCompact: compact(candidate?.title ?? ''),
    bodyCompact: bodyText,
    firstParagraphCompact: firstText,
    bodyHasAllFacts: atomicFacts.every(fact => contains(fact) || coveredByDigits(fact, bodyText)),
    firstParagraphHasAllFacts: atomicFacts.every(fact => containsFirst(fact) || coveredByDigits(fact, firstText)),
    reviewAligned: !!review && !!session && review.inputKey !== undefined && (() => { const key = currentInputKey(session); const stored = review.inputKey as typeof key; return stored.contentHash === key.contentHash && stored.evidenceRevision === key.evidenceRevision && stored.taskRevision === key.taskRevision && stored.policyRevision === key.policyRevision && (stored.notesHash === undefined || stored.notesHash === key.notesHash); })(),
    layoutAligned: !!layout && !!candidate && layout.contentHash === candidate.contentHash && layout.htmlHash === hashText(layout.html),
    sourceTitles: [...new Set((session?.evidence ?? []).filter((entry: any) => entry.kind === 'library').map((entry: any) => String(entry.provenance?.documentTitle ?? entry.provenance?.title ?? '')).filter(Boolean))] as string[],
    stages,
    gatesLocked: outputs.length > 0 && outputs.every(output => output.allowed === false),
    claimCount: compactFacts.length,
    followupsApplied: followups.every(step => (r.execution?.completedSteps ?? []).includes(step)),
  };
}
