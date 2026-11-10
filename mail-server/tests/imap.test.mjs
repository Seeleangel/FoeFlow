import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:net';
import { ImapFlow } from 'imapflow';
import { fetchUnread163 } from '../imap.mjs';

test('real IMAP client identifies after login, examines the inbox and only fetches unread envelopes', async (t) => {
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
        else if (cmd.startsWith('EXAMINE ')) ok('* FLAGS (\\Seen)\r\n* 4 EXISTS\r\n* OK [UIDVALIDITY 9] UIDs valid\r\n');
        else if (cmd === 'UID SEARCH UNSEEN') ok('* SEARCH 44\r\n');
        else if (cmd.startsWith('UID FETCH 44 ')) {
          ok('* 4 FETCH (UID 44 INTERNALDATE "10-Nov-2026 10:00:00 +0800" ENVELOPE ("Tue, 10 Nov 2026 10:00:00 +0800" "=?UTF-8?B?5oqV56i/?=" (("Author" NIL "author" "example.test")) NIL NIL NIL NIL NIL NIL NIL))\r\n');
        } else socket.write(tag + ' BAD unexpected command\r\n');
      }
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    for (const socket of sockets) socket.destroy();
    server.close();
  });
  const result = await fetchUnread163({ email: 'fixture@163.com', authCode: 'fixture-only' }, (options) => {
    assert.equal(options.host, 'imap.163.com');
    assert.equal(options.secure, true);
    assert.equal(options.tls.rejectUnauthorized, true);
    return new ImapFlow({ ...options, host: '127.0.0.1', port: server.address().port, secure: false, doSTARTTLS: false });
  });
  assert.deepEqual(result, {
    total: 1,
    messages: [{ uid: 44, subject: '投稿', sender: 'Author <author@example.test>', date: '2026-11-10T02:00:00.000Z' }],
  });
  const loginIndex = commands.findIndex((cmd) => cmd.startsWith('LOGIN '));
  const examineIndex = commands.findIndex((cmd) => cmd.startsWith('EXAMINE '));
  assert.ok(commands.slice(loginIndex + 1, examineIndex).some((cmd) => cmd.startsWith('ID ')));
  assert.ok(commands.some((cmd) => cmd.startsWith('UID FETCH 44 ') && /ENVELOPE/.test(cmd)));
  assert.ok(!commands.some((cmd) => /BODY|SELECT|STORE|EXPUNGE|SMTP/.test(cmd)));
});
