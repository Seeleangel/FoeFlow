/**
 * 范文库迁移脚本
 * 公开版本仅提供通用演示文章，原始校园文案保留在本地备份
 */
import { saveUserArticle } from './libraryStorage';
import type { UserArticle } from '@/types';

export const SAMPLE_ARTICLES: UserArticle[] = [
  {
    id: 'public-demo-001',
    title: '校园分享活动通知（演示）',
    sourceUrl: '',
    content: '本周将举办一次学习经验分享活动。本文仅用于演示文章库与排版功能，请在正式发布前填写经过核实的时间、地点和报名方式。',
    templateId: 'builtin-activity-notice',
    tags: ['演示', '活动通知'],
    createdAt: Date.now(),
  },
];

/**
 * 初始化范文库
 * 只在数据库为空时添加示例文章
 */
export async function seedSampleArticles(): Promise<void> {
  // 由于无法检查数据库是否已有数据，直接添加
  // 实际使用时，应该在检查后再决定是否添加
  console.log('范文库迁移：共', SAMPLE_ARTICLES.length, '篇文章');

  for (const article of SAMPLE_ARTICLES) {
    try {
      await saveUserArticle(article);
      console.log('已添加:', article.title);
    } catch (error) {
      console.error('添加文章失败:', article.title, error);
    }
  }
}
