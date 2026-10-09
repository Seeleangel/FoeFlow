import { describe, it, expect } from 'vitest';
import type { AuditIssue } from '../../src/types';

describe('AuditIssue type usage', () => {
  it('should accept a valid audit issue object', () => {
    const issue: AuditIssue = {
      dimension: 'text',
      severity: 'high',
      message: '错别字',
      suggestion: '改为正确写法',
    };
    expect(issue.message).toBe('错别字');
    expect(issue.severity).toBe('high');
  });
});
