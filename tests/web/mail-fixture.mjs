import { randomBytes } from 'node:crypto';
import { createMailServer } from '../../mail-server/server.mjs';

const { FOEFLOW_FIXTURE_ORIGIN, FOEFLOW_FIXTURE_PORT, FOEFLOW_FIXTURE_DB } = process.env;
if (!FOEFLOW_FIXTURE_DB || !FOEFLOW_FIXTURE_ORIGIN || !FOEFLOW_FIXTURE_PORT) throw new Error('Local fixture configuration is required');

createMailServer({
  dbPath: FOEFLOW_FIXTURE_DB, key: randomBytes(32), origin: FOEFLOW_FIXTURE_ORIGIN,
  fetchMail: async ({ email }, page) => {
    const first = email.startsWith('first');
    const count = first ? 31 : 1;
    page = Math.min(page ?? 1, Math.ceil(count / 30));
    const end = count - (page - 1) * 30;
    return {
      total: count, page, pageSize: 30,
      messages: Array.from({ length: Math.min(30, end) }, (_, index) => {
        const uid = end - index;
        return {
          uid, subject: !first ? '读书分享投稿（测试）' : uid === 31 ? '校园讲座投稿（测试）' : uid === 30 ? '已归档投稿（测试）' : '历史投稿 ' + uid,
          sender: '测试投稿人', date: '2026-11-10T02:00:00.000Z', isRead: first && uid !== 31,
        };
      }),
    };
  },
}).listen(Number(FOEFLOW_FIXTURE_PORT), '127.0.0.1');
