import { randomBytes } from 'node:crypto';
import { createMailServer } from '../../mail-server/server.mjs';

const { FOEFLOW_FIXTURE_ORIGIN, FOEFLOW_FIXTURE_PORT, FOEFLOW_FIXTURE_DB } = process.env;
if (!FOEFLOW_FIXTURE_DB || !FOEFLOW_FIXTURE_ORIGIN || !FOEFLOW_FIXTURE_PORT) throw new Error('Local fixture configuration is required');

const seen = new Set();
const attachments = [
  { part: '2', name: '投稿资料.txt', type: 'text/plain', size: 12 },
  { part: '3', name: '稿件插图.png', type: 'image/png', size: 68 },
];

createMailServer({
  dbPath: FOEFLOW_FIXTURE_DB, key: randomBytes(32), origin: FOEFLOW_FIXTURE_ORIGIN,
  fetchMail: async ({ email }, page) => {
    const first = email.startsWith('first');
    const count = first ? 31 : 1;
    page = Math.min(page ?? 1, Math.ceil(count / 30));
    const end = count - (page - 1) * 30;
    return {
      total: count, page, pageSize: 30, uidValidity: '19',
      messages: Array.from({ length: Math.min(30, end) }, (_, index) => {
        const uid = end - index;
        return {
          uid, subject: !first ? '读书分享投稿（测试）' : uid === 31 ? '校园讲座投稿（测试）' : uid === 30 ? '已归档投稿（测试）' : '历史投稿 ' + uid,
          sender: '测试投稿人', date: '2026-11-10T02:00:00.000Z', isRead: (first && uid !== 31) || seen.has(email + ':' + uid),
        };
      }),
    };
  },
  openMail: async ({ email }, { uid }, canMark) => {
    if (canMark()) seen.add(email + ':' + uid);
    return {
      uid, subject: '校园讲座投稿（测试）', sender: '测试投稿人', date: null, isRead: seen.has(email + ':' + uid),
      body: {
        format: 'html', truncated: false,
        content: '<p>这是测试邮件正文。</p><img src="https://tracker.invalid/pixel" onerror="window.mailScriptRan=1"><script>window.mailScriptRan=1</script><a href="javascript:window.mailScriptRan=1">无效链接</a>',
      },
      attachments,
    };
  },
  fetchAttachment: async (_config, { part }) => part === '3'
    ? { name: '稿件插图.png', bytes: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l5sAAAAASUVORK5CYII=', 'base64') }
    : { name: '投稿资料.txt', bytes: Buffer.from('fixture data') },
}).listen(Number(FOEFLOW_FIXTURE_PORT), '127.0.0.1');
