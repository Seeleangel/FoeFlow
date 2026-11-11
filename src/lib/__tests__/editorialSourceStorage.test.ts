import { beforeEach, describe, it, expect, vi } from 'vitest';
import { getDb } from '@/hooks/useDb';
import { readEditorialLibraryDocument } from '../libraryStorage';
import { searchEditorialLibraryDocuments } from '../articleSearch';
import { hashText } from '../editorialTypes';
vi.mock('@/hooks/useDb',() => ({ getDb: vi.fn() }));
const select = vi.fn();
beforeEach(() => { vi.clearAllMocks(); vi.mocked(getDb).mockResolvedValue({ select } as unknown as Awaited<ReturnType<typeof getDb>>); });
describe('real local source storage adapter boundaries', () => {
  it('reads complete user-article text by stable ID with a parameterized read-only query', async () => {
    const content = 'A'.repeat(1000); select.mockResolvedValueOnce([{ id: 'a',title: 'Article',content }]);
    expect(await readEditorialLibraryDocument('article:a')).toEqual({ documentId: 'article:a',title: 'Article',text: content,complete: true,kind: 'library' }); expect(select.mock.calls[0][0]).toContain('WHERE id = ?'); expect(select.mock.calls[0][1]).toEqual(['a']);
  });
  it('reads legacy public draft text without exposing params/HTML or generator-session records', async () => {
    select.mockResolvedValueOnce([{ id: 'd',params_json: '{"title":"Saved","privateMetadata":"EDITOR-ONLY"}',content_text: 'Public text' }]);
    const document = await readEditorialLibraryDocument('draft:d'); expect(document).toMatchObject({ title: 'Saved',text: 'Public text',kind: 'legacy_draft' }); expect(JSON.stringify(document)).not.toContain('EDITOR-ONLY'); expect(select.mock.calls[0][0]).toContain("mode != 'generator-session'");
  });
  it('discovery exposes IDs/version hashes and bounded snippets, not full-text fulfillment receipts', async () => {
    const content = 'Source '.repeat(200); select.mockResolvedValueOnce([{ id: 'a',title: 'Source',content }]).mockResolvedValueOnce([]);
    const result = await searchEditorialLibraryDocuments('Source'); expect(result).toHaveLength(1); expect(result[0]).toEqual({ documentId: 'article:a',title: 'Source',snippet: content.slice(0,720),contentHash: hashText(content) }); expect(result[0]).not.toHaveProperty('receipt'); expect(select.mock.calls[1][0]).toContain("mode != 'generator-session'");
  });
  it('unknown document selectors cannot trigger another storage/file/network target', async () => {
    expect(await readEditorialLibraryDocument('https://untrusted.invalid/document')).toBeUndefined(); expect(select).not.toHaveBeenCalled();
  });
});
