import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { createMailServer } from '../../mail-server/server.mjs';
import { issueInvite, openStore } from '../../mail-server/store.mjs';

const { FOEFLOW_FIXTURE_PATH, FOEFLOW_FIXTURE_ORIGIN, FOEFLOW_FIXTURE_PORT, FOEFLOW_FIXTURE_DB } = process.env;
if (!FOEFLOW_FIXTURE_PATH || !FOEFLOW_FIXTURE_DB || !FOEFLOW_FIXTURE_ORIGIN || !FOEFLOW_FIXTURE_PORT) throw new Error('Local fixture configuration is required');
const db = openStore(FOEFLOW_FIXTURE_DB);
writeFileSync(FOEFLOW_FIXTURE_PATH, JSON.stringify([issueInvite(db), issueInvite(db)]), { mode: 0o600 });
db.close();
createMailServer({
  dbPath: FOEFLOW_FIXTURE_DB, key: randomBytes(32), origin: FOEFLOW_FIXTURE_ORIGIN,
  fetchMail: async ({ email }) => ({
    total: 1,
    messages: [{ uid: 55, subject: email.startsWith('first') ? '校园讲座投稿（测试）' : '读书分享投稿（测试）', sender: '测试投稿人', date: '2026-11-10T02:00:00.000Z' }],
  }),
}).listen(Number(FOEFLOW_FIXTURE_PORT), '127.0.0.1');
