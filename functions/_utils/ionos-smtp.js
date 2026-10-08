const HOST = 'smtp.ionos.co.uk';
const FROM = 'ben@staplefordwatches.co.uk';
const encoder = new TextEncoder();

export class MailSubmissionError extends Error {
  constructor(message, uncertain = false) {
    super(message);
    this.name = 'MailSubmissionError';
    this.uncertain = uncertain;
  }
}

function base64(value) {
  const bytes = encoder.encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function lines(value) {
  return base64(value).match(/.{1,76}/g)?.join('\r\n') || '';
}

function subjectHeader(subject) {
  // Keep each encoded word comfortably below the RFC 2047 limit and never
  // split a Unicode code point between words.
  const chunks = [];
  let chunk = '';
  for (const char of subject) {
    if (encoder.encode(chunk + char).length > 42) {
      chunks.push(chunk);
      chunk = '';
    }
    chunk += char;
  }
  if (chunk) chunks.push(chunk);
  return chunks.map(value => `=?UTF-8?B?${base64(value)}?=`).join('\r\n ');
}

export function buildDispatchMessage({ to, email, messageId, now = new Date() }) {
  if (!/^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(to) || to.length > 254) {
    throw new MailSubmissionError('Invalid customer email address.');
  }
  if (!/^[a-f0-9-]+$/.test(messageId)) throw new MailSubmissionError('Invalid message identifier.');
  const boundary = `sw-${messageId}`;
  const headers = [
    `From: Stapleford Watches <${FROM}>`,
    `Reply-To: Ben <${FROM}>`,
    `To: ${to}`,
    `Subject: ${subjectHeader(email.subject)}`,
    `Date: ${now.toUTCString()}`,
    `Message-ID: <${messageId}@staplefordwatches.co.uk>`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
  ];
  const part = (type, value) => [
    `--${boundary}`, `Content-Type: ${type}; charset=UTF-8`,
    'Content-Transfer-Encoding: base64', '', lines(value), '',
  ];
  return [...headers, ...part('text/plain', email.text), ...part('text/html', email.html), `--${boundary}--`, ''].join('\r\n');
}

// IONOS Mail Basic/Business: implicit TLS on 465. Credentials only come from
// server secrets. connectSocket is injectable for protocol tests, never from HTTP input.
export async function sendIonosMail({ password, to, email, messageId }, connectSocket) {
  if (!password) throw new MailSubmissionError('The IONOS mailbox password has not been configured.');
  const message = buildDispatchMessage({ to, email, messageId });
  if (!connectSocket) ({ connect: connectSocket } = await import('cloudflare:sockets'));
  let socket;
  let reader;
  let writer;
  let timer;
  let submissionStarted = false;
  let accepted = false;
  try {
    socket = connectSocket({ hostname: HOST, port: 465 }, { secureTransport: 'on' });
    const timedOut = new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error('SMTP timeout'));
        Promise.resolve(socket.close()).catch(() => {});
      }, 25000);
    });
    const bounded = task => Promise.race([task, timedOut]);
    // Prevent an unhandled rejection if a socket operation throws synchronously.
    timedOut.catch(() => {});
    await bounded(socket.opened);
    reader = socket.readable.getReader();
    writer = socket.writable.getWriter();
    const decoder = new TextDecoder();
    let buffer = '';
    async function line() {
      for (;;) {
        const end = buffer.indexOf('\r\n');
        if (end >= 0) {
          const value = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          if (value.length > 2048) throw new Error('Oversized SMTP reply');
          return value;
        }
        const { value, done } = await bounded(reader.read());
        if (done) throw new Error('SMTP connection closed');
        buffer += decoder.decode(value, { stream: true });
        if (buffer.length > 20000) throw new Error('Oversized SMTP reply');
      }
    }
    async function reply(expected) {
      let code;
      for (let count = 0; count < 100; count += 1) {
        const value = await line();
        const match = /^(\d{3})([ -])/.exec(value);
        if (!match || (code && code !== match[1])) throw new Error('Malformed SMTP reply');
        code = match[1];
        if (match[2] === ' ') {
          if (Number(code) !== expected) {
            // Do not expose provider text, which may contain addresses or other data.
            throw new MailSubmissionError(`IONOS rejected the SMTP step (${code}).`, submissionStarted);
          }
          return;
        }
      }
      throw new Error('Too many SMTP reply lines');
    }
    async function command(value, expected) {
      await bounded(writer.write(encoder.encode(`${value}\r\n`)));
      await reply(expected);
    }
    await reply(220);
    await command('EHLO staplefordwatches.co.uk', 250);
    await command('AUTH LOGIN', 334);
    await command(base64(FROM), 334);
    await command(base64(password), 235);
    await command(`MAIL FROM:<${FROM}>`, 250);
    await command(`RCPT TO:<${to}>`, 250);
    await command('DATA', 354);
    // SMTP has no idempotency key. Once submitting DATA starts, any lost reply
    // is treated as uncertain and blocks retries until an operator checks it.
    submissionStarted = true;
    await bounded(writer.write(encoder.encode(`${message.replace(/^\./gm, '..')}\r\n.\r\n`)));
    await reply(250);
    accepted = true;
    // Acceptance is authoritative even if the subsequent QUIT/close fails.
    try { await bounded(writer.write(encoder.encode('QUIT\r\n'))); } catch {}
    return { messageId, accepted: true };
  } catch (error) {
    if (accepted) return { messageId, accepted: true };
    if (error instanceof MailSubmissionError) throw error;
    throw new MailSubmissionError('Could not complete the IONOS submission.', submissionStarted);
  } finally {
    clearTimeout(timer);
    try { reader?.releaseLock(); } catch {}
    try { writer?.releaseLock(); } catch {}
    try { await socket?.close(); } catch {}
  }
}
