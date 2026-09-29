import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { Socket } from "node:net";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

type Client = { socket: Socket; alive: boolean };

export class Hub {
  clients = new Set<Client>();

  handleUpgrade(req: IncomingMessage, socket: Socket): void {
    const key = req.headers["sec-websocket-key"];
    if (!key || Array.isArray(key)) {
      socket.destroy();
      return;
    }
    const accept = createHash("sha1").update(key + GUID).digest("base64");
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
        "Upgrade: websocket\r\n" +
        "Connection: Upgrade\r\n" +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    const client: Client = { socket, alive: true };
    this.clients.add(client);
    socket.on("data", (buf) => {
      const opcode = buf[0] & 0x0f;
      if (opcode === 0x8) {
        this.drop(client);
        return;
      }
      if (opcode === 0x9) {
        socket.write(frame(buf.subarray(2, 2 + (buf[1] & 0x7f)), 0x8a));
      }
    });
    socket.on("close", () => this.drop(client));
    socket.on("error", () => this.drop(client));
  }

  send(payload: unknown): void {
    const data = frame(Buffer.from(JSON.stringify(payload), "utf8"), 0x81);
    for (const client of this.clients) {
      try {
        client.socket.write(data);
      } catch {
        this.drop(client);
      }
    }
  }

  drop(client: Client): void {
    this.clients.delete(client);
    try {
      client.socket.destroy();
    } catch {
      // ignore
    }
  }
}

function frame(payload: Buffer, opcode: number): Buffer {
  const len = payload.length;
  let header: Buffer;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = opcode;
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = opcode;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = opcode;
    header[1] = 127;
    header.writeUInt32BE(0, 2);
    header.writeUInt32BE(len, 6);
  }
  return Buffer.concat([header, payload]);
}

