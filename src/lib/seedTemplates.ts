import { saveTemplate } from './libraryStorage';
import type { StyleTemplate } from '@/types';

export const BUILTIN_TEMPLATES: StyleTemplate[] = [
  {
    id: 'builtin-general',
    name: '通用推文',
    description: '适用于各类教育类公众号推文创作',
    sourceType: 'built-in',
    structureJson: {
      intro: '引入段落（场景、背景或情感铺垫）',
      body: '主体内容（事件、活动、观点或故事）',
      highlights: '亮点或细节补充',
      closing: '结尾（号召、互动、祝福或总结）',
    },
    formSchema: [],
    coCreationPrompt:
      '你正在帮助用户撰写一篇教育类公众号推文。请与用户进行多轮对话，了解推文主题、目标受众、核心信息、情感基调等必要信息，在信息足够后再生成完整文章。',
    sampleSnippets:
      '教育是一场温暖的修行，每一位师生都在书写属于自己的篇章...',
    createdAt: 1713052800000,
    updatedAt: 1713052800000,
  },
];

export async function seedBuiltinTemplates(): Promise<void> {
  console.log('[seedBuiltinTemplates] Starting, count:', BUILTIN_TEMPLATES.length);
  for (const template of BUILTIN_TEMPLATES) {
    console.log('[seedBuiltinTemplates] Saving template:', template.id, template.name);
    await saveTemplate(template);
    console.log('[seedBuiltinTemplates] Saved template:', template.id);
  }
  console.log('[seedBuiltinTemplates] Done');
}
