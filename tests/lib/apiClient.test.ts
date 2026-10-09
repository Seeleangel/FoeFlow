import { describe, it, expect } from 'vitest';
import { buildAuditPrompt, buildGenerationPrompt, buildCoCreationPrompt } from '../../src/lib/apiClient';

describe('buildAuditPrompt', () => {
  it('should include rule descriptions instead of bare keys', async () => {
    const prompt = await buildAuditPrompt('这是一篇测试推文', ['typo', 'sensitive_words']);
    expect(prompt).toContain('错别字检查');
    expect(prompt).toContain('敏感词审查');
    expect(prompt).not.toContain('typo, sensitive_words');
    expect(prompt).toContain('这是一篇测试推文');
    expect(prompt).toContain('纯 JSON 数组');
  });
});

describe('buildGenerationPrompt', () => {
  it('should include template name and params', () => {
    const prompt = buildGenerationPrompt(
      '活动通知模板',
      { intro: '简短引入', body: '分点说明' },
      { title: '春季读书会', time: '3 月 15 日' }
    );
    expect(prompt).toContain('活动通知模板');
    expect(prompt).toContain('春季读书会');
    expect(prompt).toContain('此处配图');
  });
});

describe('buildCoCreationPrompt', () => {
  it('should include template name and structure', async () => {
    const prompt = await buildCoCreationPrompt('活动通知', { title: 'string' });
    expect(prompt).toContain('活动通知');
    expect(prompt).toContain('title');
    expect(prompt).toContain('collectedInfo');
    expect(prompt).toContain('严禁直接生成文章');
    expect(prompt).toContain('markdown 代码块标记');
    expect(prompt).toContain('后续管线处理');
  });
});
