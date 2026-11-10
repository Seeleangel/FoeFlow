import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:net';
import { ImapFlow } from 'imapflow';
import { fetchInbox163 } from '../imap.mjs';

test('real IMAP client identifies after login, examines the inbox and fetches paged envelopes and keeps read flags', async (t) => {
  const commands = [];
  const sockets = new Set();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.write('* OK Fixture ready\r\n');
    let input = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      input += chunk;
      while (input.includes('\r\n')) {
        const end = input.indexOf('\r\n');
        const [tag, ...words] = input.slice(0, end).split(' ');
        input = input.slice(end + 2);
        const cmd = words.join(' ');
        commands.push(cmd);
        const ok = (lines = '') => socket.write(lines + tag + ' OK completed\r\n');
        if (cmd === 'CAPABILITY') ok('* CAPABILITY IMAP4rev1 ID\r\n');
        else if (cmd.startsWith('ID ')) ok('* ID ("name" "Coremail fixture" "vendor" "fixture")\r\n');
        else if (cmd.startsWith('LOGIN ')) ok();
        else if (cmd.startsWith('LIST ')) ok('* LIST (\\Noselect) "/" ""\r\n');
        else if (cmd.startsWith('EXAMINE ')) ok('* FLAGS (\\Seen)\r\n* 32 EXISTS\r\n* OK [UIDVALIDITY 9] UIDs valid\r\n');
        else if (cmd === 'UID SEARCH UNSEEN') ok('* SEARCH 44\r\n');
        else if (cmd.startsWith('UID FETCH 44 ') || cmd.startsWith('FETCH 3:32 ')) {
          ok('* 32 FETCH (UID 44 FLAGS () INTERNALDATE "10-Nov-2026 10:00:00 +0800" ENVELOPE ("Tue, 10 Nov 2026 10:00:00 +0800" "=?UTF-8?B?5oqV56i/?=" (("Author" NIL "author" "example.test")) NIL NIL NIL NIL NIL NIL NIL))\r\n' +
             (cmd.startsWith('FETCH') ? '* 31 FETCH (UID 43 FLAGS (\\Seen) ENVELOPE (NIL "Already read" NIL NIL NIL NIL NIL NIL NIL NIL))\r\n' : ''));
        } else if (cmd.startsWith('FETCH 1:2 ')) {
          ok('* 2 FETCH (UID 12 FLAGS (\\Seen) ENVELOPE (NIL "Older message" NIL NIL NIL NIL NIL NIL NIL NIL))\r\n');
        } else socket.write(tag + ' BAD unexpected command\r\n');
      }
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    for (const socket of sockets) socket.destroy();
    server.close();
  });
  const fetchPage = (page) => fetchInbox163({ email: 'fixture@163.com', authCode: 'fixture-only' }, page, (options) => {
    assert.equal(options.host, 'imap.163.com');
    assert.equal(options.secure, true);
    assert.equal(options.tls.rejectUnauthorized, true);
    return new ImapFlow({ ...options, host: '127.0.0.1', port: server.address().port, secure: false, doSTARTTLS: false });
  });
  const latest = await fetchPage(1);
  assert.equal(latest.total, 32);
  assert.equal(latest.pageSize, 30);
  assert.deepEqual(latest.messages.map(({ uid, subject, isRead }) => [uid, subject, isRead]), [
    [44, '投稿', false], [43, 'Already read', true],
  ]);
  assert.equal(latest.messages[0].sender, 'Author <author@example.test>');
  assert.equal(latest.messages[0].date, '2026-11-10T02:00:00.000Z');
  const older = await fetchPage(2);
  assert.equal(older.page, 2);
  assert.deepEqual(older.messages.map(({ uid, isRead }) => [uid, isRead]), [[12, true]]);
  const legacy = await fetchPage(null);
  assert.equal(legacy.total, 1);
  assert.equal(legacy.messages[0].uid, 44);
  const loginIndex = commands.findIndex((cmd) => cmd.startsWith('LOGIN '));
  const examineIndex = commands.findIndex((cmd) => cmd.startsWith('EXAMINE '));
  assert.ok(commands.slice(loginIndex + 1, examineIndex).some((cmd) => cmd.startsWith('ID ')));
  assert.ok(commands.some((cmd) => cmd.startsWith('FETCH 3:32 ') && /ENVELOPE/.test(cmd) && /FLAGS/.test(cmd)));
  assert.ok(!commands.some((cmd) => /BODY|SELECT|STORE|EXPUNGE|SMTP/.test(cmd)));
});
