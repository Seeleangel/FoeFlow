import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:net';
import { ImapFlow } from 'imapflow';
import { downloadAttachment163, fetchInbox163, openMessage163 } from '../imap.mjs';

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

test('opening reads BODY.PEEK before setting Seen; downloading returns the original attachment without changing flags', async (t) => {
  const commands = [];
  const sockets = new Set();
  let seen = false;
  let rejectStore = false;
  let failBody = false;
  const html = '<p>Body fixture</p>';
  const file = Buffer.from([0xff, 0xfe, 0x41, 0x00]); // Must not be converted to UTF-8.
  const mime1 = 'Content-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: 7bit\r\n\r\n';
  const mime2 = 'Content-Type: text/plain; charset=utf-16le\r\nContent-Transfer-Encoding: base64\r\nContent-Disposition: attachment; filename="report.txt"\r\n\r\n';
  const structure = '(("TEXT" "HTML" ("CHARSET" "UTF-8") NIL NIL "7BIT" 19 1 NIL NIL NIL NIL)' +
    '("TEXT" "PLAIN" ("CHARSET" "UTF-16LE" "NAME" "report.txt") NIL NIL "BASE64" 8 1 NIL ("ATTACHMENT" ("FILENAME" "report.txt")) NIL NIL) "MIXED" NIL NIL NIL NIL)';
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
        const command = words.join(' ');
        commands.push(command);
        const ok = (lines = '', code = '') => socket.write(lines + tag + ' OK ' + code + ' completed\r\n');
        const no = () => socket.write(tag + ' NO rejected\r\n');
        if (command === 'CAPABILITY') ok('* CAPABILITY IMAP4rev1 ID\r\n');
        else if (command.startsWith('ID ')) ok('* ID ("name" "Coremail fixture" "vendor" "fixture")\r\n');
        else if (command.startsWith('LOGIN ')) ok();
        else if (command.startsWith('LIST ')) ok('* LIST (\\Noselect) "/" ""\r\n');
        else if (/^(SELECT|EXAMINE) /.test(command)) ok('* FLAGS (\\Seen)\r\n* 1 EXISTS\r\n* OK [UIDVALIDITY 9] UIDs valid\r\n', command.startsWith('SELECT') ? '[READ-WRITE]' : '[READ-ONLY]');
        else if (command.startsWith('UID FETCH 44 ') && command.includes('BODYSTRUCTURE')) {
          ok(`* 1 FETCH (UID 44 FLAGS (${seen ? '\\Seen' : ''}) ENVELOPE (NIL "Fixture subject" NIL NIL NIL NIL NIL NIL NIL NIL) BODYSTRUCTURE ${structure})\r\n`);
        } else if (command.startsWith('UID FETCH 44 ') && /BODY\.PEEK\[[12]\]/.test(command)) {
          const part = command.includes('[1]') ? 1 : 2;
          if (part === 1 && failBody) { no(); continue; }
          const mime = part === 1 ? mime1 : mime2;
          const data = part === 1 ? html : file.toString('base64');
          ok(`* 1 FETCH (UID 44 RFC822.SIZE 100 BODY[${part}.MIME] {${mime.length}}\r\n${mime} BODY[${part}]<0> {${data.length}}\r\n${data})\r\n`);
        } else if (command.startsWith('UID STORE 44 ')) {
          if (rejectStore) no();
          else { seen = true; ok(); }
        } else socket.write(tag + ' BAD unexpected command\r\n');
      }
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { for (const socket of sockets) socket.destroy(); server.close(); });
  const config = { email: 'fixture@163.com', authCode: 'fixture-only' };
  const ref = { uid: 44, uidValidity: '9' };
  const client = (options) => new ImapFlow({ ...options, host: '127.0.0.1', port: server.address().port, secure: false, doSTARTTLS: false });
  await assert.rejects(openMessage163(config, { ...ref, uidValidity: '8' }, () => true, client), { message: 'stale_message' });
  const withdrawn = await openMessage163(config, ref, () => false, client);
  assert.equal(withdrawn.isRead, false);
  assert.ok(!commands.some((command) => command.includes('STORE')));
  failBody = true;
  await assert.rejects(openMessage163(config, ref, () => true, client));
  failBody = false;
  assert.ok(!commands.some((command) => command.includes('STORE')));
  const detail = await openMessage163(config, ref, () => true, client);
  assert.deepEqual(detail.body, { format: 'html', content: html, truncated: false });
  assert.equal(detail.isRead, true);
  assert.equal(detail.attachments[0].name, 'report.txt');
  assert.ok(commands.findIndex((command) => command.includes('BODY.PEEK[1]')) < commands.findIndex((command) => command.includes('STORE')));
  assert.equal(commands.filter((command) => command.includes('BODY.PEEK[2]')).length, 0);

  const beforeDownload = commands.length;
  const attachment = await downloadAttachment163(config, { ...ref, part: '2' }, client);
  assert.deepEqual(attachment.bytes, file);
  assert.ok(commands.slice(beforeDownload).some((command) => command.startsWith('EXAMINE ')));
  assert.ok(!commands.slice(beforeDownload).some((command) => command.includes('STORE')));
  await assert.rejects(downloadAttachment163(config, { ...ref, part: '1' }, client), { message: 'attachment_missing' });

  seen = false;
  rejectStore = true;
  const unconfirmed = await openMessage163(config, ref, () => true, client);
  assert.equal(unconfirmed.isRead, false);
  assert.equal(unconfirmed.body.content, html);
});
