import net from "node:net";
import { WebSocket } from "ws";

export const TEST_UUID = "00000000-0000-4000-8000-000000000001";
export const TEST_PASSWORD = "my-secret-password";
// SHA224("my-secret-password") — verified against server logs
export const TEST_PASSWORD_SHA224 =
  "866bd66ce80404beda1284ea558299900a4ec71a9b1882d6be4e582f";

export function uuidToBuffer(uuid: string): Buffer {
  return Buffer.from(uuid.replaceAll("-", ""), "hex");
}

export async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (addr && typeof addr === "object") {
        const port = addr.port;
        srv.close(() => resolve(port));
      } else {
        srv.close(() => reject(new Error("Could not get free port")));
      }
    });
  });
}

export interface EchoServer {
  port: number;
  close: () => Promise<void>;
}

export async function startEchoServer(): Promise<EchoServer> {
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("data", (data) => {
      socket.write(data);
    });
  });

  const port = await getFreePort();

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });

  return {
    port,
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of sockets) {
          try {
            s.destroy();
          } catch {
            // ignore
          }
        }
        sockets.clear();
        server.close(() => resolve());
      }),
  };
}

export interface VlessHeaderOptions {
  version?: number;
  uuid?: string;
  addons?: Buffer;
  command?: number;
  addressType?: number;
}

/** Build a VLESS header (V2 address types: 0x01 IPv4, 0x02 domain, 0x03 IPv6). */
export function buildVlessHeader(
  host: string,
  port: number,
  payload: Buffer | string = Buffer.alloc(0),
  opts: VlessHeaderOptions = {}
): Buffer {
  const version = opts.version ?? 0x00;
  const uuidBuf = uuidToBuffer(opts.uuid ?? TEST_UUID);
  const addons = opts.addons ?? Buffer.alloc(0);
  const command = opts.command ?? 0x01;
  const payloadBuf = Buffer.isBuffer(payload)
    ? payload
    : Buffer.from(payload);

  const portBuf = Buffer.alloc(2);
  portBuf.writeUInt16BE(port);

  let addrPart: Buffer;
  const forcedAtyp = opts.addressType;

  if (forcedAtyp !== undefined) {
    // Caller forces atyp byte but provides raw host bytes accordingly.
    // For unsupported atyp tests, host is ignored.
    addrPart = Buffer.concat([
      Buffer.from([forcedAtyp]),
      Buffer.from(host, "utf8"),
    ]);
  } else if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const octets = host.split(".").map(Number);
    addrPart = Buffer.from([0x01, ...octets]);
  } else if (host.includes(":")) {
    // IPv6 — expand :: shorthand
    const groups = expandIPv6(host);
    const buf = Buffer.alloc(16);
    groups.forEach((g, i) => {
      buf.writeUInt16BE(parseInt(g, 16), i * 2);
    });
    addrPart = Buffer.concat([Buffer.from([0x03]), buf]);
  } else {
    const domainBuf = Buffer.from(host, "utf8");
    addrPart = Buffer.concat([
      Buffer.from([0x02, domainBuf.length]),
      domainBuf,
    ]);
  }

  return Buffer.concat([
    Buffer.from([version]),
    uuidBuf,
    Buffer.from([addons.length]),
    addons,
    Buffer.from([command]),
    portBuf,
    addrPart,
    payloadBuf,
  ]);
}

function expandIPv6(ip: string): string[] {
  // Expand :: to full 8 groups
  const [head = "", tail = ""] = ip.split("::");
  const headParts = head ? head.split(":") : [];
  const tailParts = tail ? tail.split(":") : [];
  const missing = 8 - headParts.length - tailParts.length;
  const zeros = new Array(Math.max(0, missing)).fill("0");
  return [...headParts, ...zeros, ...tailParts];
}

/** Build a Trojan handshake (SHA224(password) + CRLF + SOCKS5 + CRLF + payload). */
export function buildTrojanHeader(
  password: string,
  host: string,
  port: number,
  payload: Buffer | string = Buffer.alloc(0),
  opts: { command?: number; addressType?: number } = {}
): Buffer {
  const crypto = require("node:crypto") as typeof import("node:crypto");
  const hash = crypto
    .createHash("sha224")
    .update(password)
    .digest("hex");
  const payloadBuf = Buffer.isBuffer(payload)
    ? payload
    : Buffer.from(payload);
  const portBuf = Buffer.alloc(2);
  portBuf.writeUInt16BE(port);

  const command = opts.command ?? 0x01;

  let addrPart: Buffer;
  if (opts.addressType !== undefined) {
    addrPart = Buffer.concat([
      Buffer.from([opts.addressType]),
      Buffer.from(host, "utf8"),
    ]);
  } else if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const octets = host.split(".").map(Number);
    addrPart = Buffer.from([0x01, ...octets]);
  } else if (host.includes(":")) {
    const groups = expandIPv6(host);
    const buf = Buffer.alloc(16);
    groups.forEach((g, i) => {
      buf.writeUInt16BE(parseInt(g, 16), i * 2);
    });
    addrPart = Buffer.from([0x04, ...buf]);
  } else {
    const domainBuf = Buffer.from(host, "utf8");
    addrPart = Buffer.concat([
      Buffer.from([0x03, domainBuf.length]),
      domainBuf,
    ]);
  }

  return Buffer.concat([
    Buffer.from(hash, "ascii"),
    Buffer.from([0x0d, 0x0a, command]),
    addrPart,
    portBuf,
    Buffer.from([0x0d, 0x0a]),
    payloadBuf,
  ]);
}

export function waitForOpen(
  ws: WebSocket,
  timeoutMs = 3000
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("WebSocket open timeout"));
    }, timeoutMs);
    const onOpen = () => {
      cleanup();
      resolve();
    };
    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };
    const cleanup = () => {
      clearTimeout(timer);
      ws.removeListener("open", onOpen);
      ws.removeListener("error", onError);
    };
    ws.once("open", onOpen);
    ws.once("error", onError);
  });
}

/** Collect raw WS messages until `count` received or timeout. */
export function collectMessages(
  ws: WebSocket,
  count: number,
  timeoutMs = 3000
): Promise<Buffer[]> {
  return new Promise((resolve, reject) => {
    const messages: Buffer[] = [];
    const timer = setTimeout(() => {
      cleanup();
      reject(
        new Error(
          `Timed out waiting for ${count} messages (got ${messages.length})`
        )
      );
    }, timeoutMs);

    const onMessage = (data: Buffer | ArrayBuffer | Buffer[]) => {
      const buf = Buffer.isBuffer(data)
        ? data
        : Buffer.from(data as ArrayBuffer);
      messages.push(buf);
      if (messages.length >= count) {
        cleanup();
        resolve(messages);
      }
    };
    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };
    const onClose = () => {
      cleanup();
      if (messages.length >= count) {
        resolve(messages);
      } else {
        reject(
          new Error(
            `Connection closed after ${messages.length}/${count} messages`
          )
        );
      }
    };
    const cleanup = () => {
      clearTimeout(timer);
      ws.removeListener("message", onMessage);
      ws.removeListener("error", onError);
      ws.removeListener("close", onClose);
    };

    ws.on("message", onMessage);
    ws.once("error", onError);
    ws.once("close", onClose);
  });
}

/** Wait for WS close/error within timeout. Resolves true if closed/errored. */
export function waitForCloseOrError(
  ws: WebSocket,
  timeoutMs = 3000
): Promise<{ closed: boolean; error?: Error }> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve({ closed: false });
    }, timeoutMs);
    const onClose = () => {
      cleanup();
      resolve({ closed: true });
    };
    const onError = (err: Error) => {
      cleanup();
      resolve({ closed: true, error: err });
    };
    const cleanup = () => {
      clearTimeout(timer);
      ws.removeListener("close", onClose);
      ws.removeListener("error", onError);
    };
    ws.once("close", onClose);
    ws.once("error", onError);
  });
}

export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label = "operation"
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms
    );
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

/** Terminate a WS client and wait until it is closed. */
export async function closeWs(
  ws: WebSocket,
  timeoutMs = 2000
): Promise<void> {
  if (
    ws.readyState === WebSocket.CLOSED ||
    ws.readyState === WebSocket.CLOSING
  ) {
    return;
  }
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      try {
        ws.terminate();
      } catch {
        // ignore
      }
      resolve();
    }, timeoutMs);
    ws.once("close", () => {
      clearTimeout(timer);
      resolve();
    });
    try {
      ws.close();
      // Force-terminate shortly after graceful close to avoid hanging
      setTimeout(() => {
        if (
          ws.readyState !== WebSocket.CLOSED &&
          ws.readyState !== WebSocket.CLOSING
        ) {
          try {
            ws.terminate();
          } catch {
            // ignore
          }
        }
      }, 500);
    } catch {
      clearTimeout(timer);
      resolve();
    }
  });
}

/**
 * Send a raw HTTP Upgrade request and return the raw response head.
 * Used to verify wrong-path upgrades are rejected without relying on
 * WS client error-event behavior (which differs across runtimes).
 */
export async function rawUpgradeHead(
  port: number,
  path: string,
  timeoutMs = 3000
): Promise<{ head: string; closedWithoutResponse: boolean }> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("raw upgrade timed out"));
    }, timeoutMs);

    let buffer = Buffer.alloc(0);
    const cleanup = (result: {
      head: string;
      closedWithoutResponse: boolean;
    }) => {
      clearTimeout(timer);
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };

    socket.once("error", (err) => {
      clearTimeout(timer);
      // ECONNRESET with no data means server destroyed the socket (expected for wrong path)
      if (buffer.length === 0) {
        resolve({ head: "", closedWithoutResponse: true });
      } else {
        reject(err);
      }
    });

    socket.on("data", (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      const headEnd = buffer.indexOf("\r\n\r\n");
      if (headEnd !== -1) {
        const head = buffer.subarray(0, headEnd).toString("latin1");
        cleanup({ head, closedWithoutResponse: false });
      }
    });

    socket.once("close", () => {
      if (buffer.length === 0) {
        clearTimeout(timer);
        resolve({ head: "", closedWithoutResponse: true });
      }
    });

    socket.on("connect", () => {
      const key = "dGhlIHNhbXBsZSBub25jZQ==";
      socket.write(
        `GET ${path} HTTP/1.1\r\n` +
          `Host: 127.0.0.1:${port}\r\n` +
          `Upgrade: websocket\r\n` +
          `Connection: Upgrade\r\n` +
          `Sec-WebSocket-Key: ${key}\r\n` +
          `Sec-WebSocket-Version: 13\r\n\r\n`
      );
    });
  });
}
