import { describe, it, expect } from 'vitest';
import { createEditorialSession, EditorialSessionSchema, ToolEventSchema, ToolActionSchema, RunBudgetSchema, DEFAULT_RUN_BUDGET, hashText } from '../editorialTypes';
describe('v2 runtime contracts', () => {
  it('validates the complete state, not just the version tag', () => {
    const s = createEditorialSession('s');
    expect(EditorialSessionSchema.parse(s)).toEqual(s);
    expect(() => EditorialSessionSchema.parse({ ...s, claims: [{ id: 'fake' }] })).toThrow();
    expect(() => EditorialSessionSchema.parse({ ...s, phase: 'published' })).toThrow();
  });
  it('tools cannot confirm and malformed events cannot cross the boundary', () => {
    expect(() => ToolEventSchema.parse({ sessionId: 's', runId: 'r', expectedRevision: 0, type: 'editor_confirmed' })).toThrow();
    expect(() => ToolEventSchema.parse({ sessionId: 's', runId: 'r', expectedRevision: 0, type: 'candidate_updated', artifact: {} })).toThrow();
  });
  it('validates budgets and the action protocol, not only session state', () => {
    expect(RunBudgetSchema.parse(DEFAULT_RUN_BUDGET).writes).toBe(3);
    expect(() => RunBudgetSchema.parse({ ...DEFAULT_RUN_BUDGET, modelCalls: -1 })).toThrow();
    expect(ToolActionSchema.parse({ tool: 'read', documentId: 'd', sourceRequirementId: 's' }).tool).toBe('read');
    expect(() => ToolActionSchema.parse({ tool: 'confirm' })).toThrow();
  });
  it('hashes with portable SHA-256', () => {
    expect(hashText('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
