import { connect as tlsConnect } from 'node:tls';
import { connect as netConnect, type Socket } from 'node:net';
import type { Mailer } from './core';

/**
 * Cliente SMTP mínimo (AUTH LOGIN, STARTTLS/SMTPS). Mantido pequeno para não
 * adicionar dependência; substituível por provedor transacional via adapter.
 */
export class SmtpMailer implements Mailer {
  readonly enabled = true;
  private readonly url: URL;
  constructor(url: string, private readonly from: string) {
    this.url = new URL(url);
  }
  async send(msg: { to: string; subject: string; text: string }): Promise<void> {
    const secure = this.url.protocol === 'smtps:';
    const port = Number(this.url.port || (secure ? 465 : 587));
    let socket: Socket = secure ? tlsConnect({ host: this.url.hostname, port, servername: this.url.hostname }) : netConnect({ host: this.url.hostname, port });
    const read = () =>
      new Promise<string>((res, rej) => {
        let buf = '';
        const onData = (d: Buffer) => {
          buf += d.toString();
          const lines = buf.split('\r\n').filter(Boolean);
          const last = lines[lines.length - 1];
          if (last && /^\d{3} /.test(last)) {
            socket.off('data', onData);
            res(buf);
          }
        };
        socket.on('data', onData);
        socket.once('error', rej);
      });
    const cmd = async (line: string, expect: number) => {
      socket.write(line + '\r\n');
      const r = await read();
      if (!r.startsWith(String(expect))) throw new Error(`SMTP inesperado (${line.split(' ')[0]}): ${r.slice(0, 3)}`);
      return r;
    };
    await read();
    await cmd(`EHLO ${this.url.hostname}`, 250);
    if (!secure) {
      await cmd('STARTTLS', 220);
      socket = tlsConnect({ socket, servername: this.url.hostname });
      await cmd(`EHLO ${this.url.hostname}`, 250);
    }
    if (this.url.username) {
      await cmd('AUTH LOGIN', 334);
      await cmd(Buffer.from(decodeURIComponent(this.url.username)).toString('base64'), 334);
      await cmd(Buffer.from(decodeURIComponent(this.url.password)).toString('base64'), 235);
    }
    await cmd(`MAIL FROM:<${this.from}>`, 250);
    await cmd(`RCPT TO:<${msg.to}>`, 250);
    await cmd('DATA', 354);
    const body = [
      `From: ${this.from}`, `To: ${msg.to}`, `Subject: =?UTF-8?B?${Buffer.from(msg.subject).toString('base64')}?=`,
      'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '',
      Buffer.from(msg.text).toString('base64').replace(/(.{76})/g, '$1\r\n'),
    ].join('\r\n');
    await cmd(`${body}\r\n.`, 250);
    socket.write('QUIT\r\n');
    socket.end();
  }
}
