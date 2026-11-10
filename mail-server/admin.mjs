import { issueInvite, openStore } from './store.mjs';

if (process.argv[2] !== 'invite' || !process.env.FOEFLOW_MAIL_DB) {
  console.error('Usage: FOEFLOW_MAIL_DB=/path/to/mail.sqlite node admin.mjs invite');
  process.exit(1);
}
process.umask(0o077);
const db = openStore(process.env.FOEFLOW_MAIL_DB);
try { console.log(issueInvite(db)); } finally { db.close(); }
