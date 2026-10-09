import { describe, it, expect } from 'vitest';
import { exportToDocx } from '../../src/lib/wordExport';

describe('exportToDocx', () => {
  it('should return a Blob', async () => {
    const blob = await exportToDocx('测试标题', ['正文']);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toContain('wordprocessingml'); // docx MIME type
  });

  it('should handle headings and image placeholders', async () => {
    const blob = await exportToDocx('标题', ['# 大标题', '## 小标题', '【此处配图：图 1】', '正文']);
    expect(blob.size).toBeGreaterThan(0);
  });
});
