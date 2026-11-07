import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDispatchMessage, sendIonosMail } from '../functions/_utils/ionos-smtp.js';
import { renderDispatchEmail } from '../functions/_utils/dispatch-email.js';

const messageId = 'cc48138f-6a77-4209-bec7-52b69033439d';
const data = { customerName: 'Alex', watchName: 'OMEGA Seamaster', orderNumber: 'SW-1001', trackingNumber: 'AB123456789GB', trackingUrl: 'https://www.royalmail.com/track-your-item#/tracking-results/AB123456789GB', year: 2026 };
const email = renderDispatchEmail(data);
const input = { password: 'private-test-password', to: 'alex@example.com', email, messageId };

function server({ rejectAuth = false, loseAcceptance = false, quitFails = false } = {}) {
  const commands = [];
  let mail = '';
  let controller;
  let stage = 0;
  let closed = false;
  const encoder = new TextEncoder();
  function reply(value) {
    // Exercise both partial CRLF and multiple SMTP lines in one read.
    const middle = Math.floor(value.length / 2);
    controller.enqueue(encoder.encode(value.slice(0, middle)));
    controller.enqueue(encoder.encode(value.slice(middle)));
  }
  const readable = new ReadableStream({ start(value) { controller = value; reply('220 ionos.example ESMTP\r\n'); } });
  const writable = new WritableStream({ write(value) {
    const command = new TextDecoder().decode(value);
    commands.push(command);
    const expected = [
      ['EHLO staplefordwatches.co.uk\r\n', '250-ionos.example\r\n250-AUTH LOGIN PLAIN\r\n250 SIZE 12000000\r\n'],
      ['AUTH LOGIN\r\n', '334 VXNlcm5hbWU6\r\n'],
      [`${Buffer.from('ben@staplefordwatches.co.uk').toString('base64')}\r\n`, '334 UGFzc3dvcmQ6\r\n'],
      [`${Buffer.from(input.password).toString('base64')}\r\n`, rejectAuth ? '535 Authentication rejected\r\n' : '235 Authenticated\r\n'],
      ['MAIL FROM:<ben@staplefordwatches.co.uk>\r\n', '250 Sender accepted\r\n'],
      ['RCPT TO:<alex@example.com>\r\n', '250 Recipient accepted\r\n'],
      ['DATA\r\n', '354 End with a dot\r\n'],
    ];
    if (stage < expected.length) {
      assert.equal(command, expected[stage][0]);
      reply(expected[stage][1]);
    } else if (stage === expected.length) {
      mail = command;
      assert(command.endsWith('\r\n.\r\n'));
      if (loseAcceptance) controller.error(new Error('Connection lost'));
      else reply('250 Queued for delivery\r\n');
    } else {
      assert.equal(command, 'QUIT\r\n');
      if (quitFails) throw new Error('QUIT connection lost');
    }
    stage += 1;
  } });
  return {
    connect(address, options) {
      assert.deepEqual(address, { hostname: 'smtp.ionos.co.uk', port: 465 });
      assert.deepEqual(options, { secureTransport: 'on' });
      return { opened: Promise.resolve(), readable, writable, close() { if (!closed) { closed = true; try { controller.close(); } catch {} } return Promise.resolve(); } };
    },
    commands,
    get mail() { return mail; },
  };
}

test('IONOS submission uses TLS, authenticates and submits the approved multipart email', async () => {
  const smtp = server();
  assert.deepEqual(await sendIonosMail(input, smtp.connect), { accepted: true, messageId });
  assert(smtp.mail.includes('From: Stapleford Watches <ben@staplefordwatches.co.uk>'));
  assert(smtp.mail.includes('Reply-To: Ben <ben@staplefordwatches.co.uk>'));
  assert(smtp.mail.includes('Content-Type: text/plain; charset=UTF-8'));
  assert(smtp.mail.includes('Content-Type: text/html; charset=UTF-8'));
  const parts = [...smtp.mail.matchAll(/Content-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+)\r\n--/g)];
  assert.equal(parts.length, 2);
  const decoded = parts.map(part => Buffer.from(part[1].replace(/\s/g, ''), 'base64').toString('utf8'));
  assert.equal(decoded[0], email.text);
  assert.equal(decoded[1], email.html);
  assert(decoded[1].includes('stapleford-watches-logo-navy@2x.png'));
  assert(!decoded[0].includes('signature'));
});

test('authentication failure occurs before DATA and is safe to retry after correcting the password', async () => {
  const smtp = server({ rejectAuth: true });
  await assert.rejects(sendIonosMail(input, smtp.connect), error => error.name === 'MailSubmissionError' && error.uncertain === false && !error.message.includes(input.password));
  assert(!smtp.commands.includes('DATA\r\n'));
});

test('a lost SMTP acceptance reply is uncertain and cannot be automatically retried', async () => {
  const smtp = server({ loseAcceptance: true });
  await assert.rejects(sendIonosMail(input, smtp.connect), error => error.name === 'MailSubmissionError' && error.uncertain === true);
  assert(smtp.mail.includes('MIME-Version: 1.0'));
});

test('a QUIT failure does not change a confirmed acceptance into a send failure', async () => {
  const smtp = server({ quitFails: true });
  assert.equal((await sendIonosMail(input, smtp.connect)).accepted, true);
});

test('MIME preserves Unicode subjects and respects encoded-word and SMTP line limits', () => {
  const subject = `Your watch – ${'時計 😀 '.repeat(30)}`;
  const message = buildDispatchMessage({ to: input.to, email: { ...email, subject }, messageId });
  const encoded = message.match(/Subject: ([\s\S]*?)\r\nDate:/)[1];
  const words = [...encoded.matchAll(/=\?UTF-8\?B\?([^?]+)\?=/g)];
  assert.equal(words.map(word => Buffer.from(word[1], 'base64').toString('utf8')).join(''), subject);
  assert(words.every(word => word[0].length <= 75));
  assert(message.split('\r\n').every(line => Buffer.byteLength(line) <= 998));
  assert.throws(() => buildDispatchMessage({ to: 'alex@example.com\r\nBcc: other@example.com', email, messageId }));
});
