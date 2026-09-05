import { createServer, type Server } from "node:http";
import net from "node:net";
import crypto from "node:crypto";

import {
  WebSocketServer,
  WebSocket
} from "ws";

export interface ServerConfig {
  name: string;

  type: string;

  listen: {
    host: string;
    port: number;
  };

  websocket: {
    path: string;
  };

  vless: {
    uuid: string;
  };
}

interface VlessRequest {
  version: Buffer;
  command: number;
  host: string;
  port: number;
  payload: Buffer;
}

export const TCP_COMMAND = 0x01;

export function uuidToBuffer(uuid: string): Buffer {
  return Buffer.from(
    uuid.replaceAll("-", ""),
    "hex"
  );
}

export function isValidUUID(uuid: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    uuid
  );
}

function safeEqual(
  a: Buffer,
  b: Buffer
): boolean {
  if (a.length !== b.length) {
    return false;
  }

  return crypto.timingSafeEqual(a, b);
}

export function parseVless(
  data: Buffer,
  expectedUUID: Buffer
): VlessRequest {
  if (data.length < 22) {
    throw new Error(
      "VLESS header is incomplete"
    );
  }

  const version = data.subarray(0, 1);

  const uuid = data.subarray(1, 17);

  if (!safeEqual(uuid, expectedUUID)) {
    throw new Error("Invalid UUID");
  }

  const addonsLength = data[17];

  if (addonsLength === undefined) {
    throw new Error(
      "Invalid addons length"
    );
  }

  let offset = 18;

  if (
    offset + addonsLength >= data.length
  ) {
    throw new Error(
      "Invalid addons length"
    );
  }

  offset += addonsLength;

  const command = data[offset++];

  if (command === undefined) {
    throw new Error(
      "Missing command"
    );
  }

  if (command !== TCP_COMMAND) {
    throw new Error(
      "Only VLESS TCP is supported"
    );
  }

  if (offset + 2 > data.length) {
    throw new Error(
      "Missing destination port"
    );
  }

  const port = data.readUInt16BE(offset);

  offset += 2;

  const addressType = data[offset++];

  if (addressType === undefined) {
    throw new Error(
      "Missing address type"
    );
  }

  let host: string;

  switch (addressType) {
    case 0x01: {
      if (
        offset + 4 > data.length
      ) {
        throw new Error(
          "Invalid IPv4 address"
        );
      }

      host = Array.from(
        data.subarray(
          offset,
          offset + 4
        )
      ).join(".");

      offset += 4;

      break;
    }

    case 0x02: {
      if (
        offset >= data.length
      ) {
        throw new Error(
          "Missing domain length"
        );
      }

      const length = data[offset++];

      if (length === undefined) {
        throw new Error(
          "Missing domain length"
        );
      }

      if (
        offset + length > data.length
      ) {
        throw new Error(
          "Invalid domain"
        );
      }

      host = data
        .subarray(
          offset,
          offset + length
        )
        .toString("utf8");

      offset += length;

      break;
    }

    case 0x03: {
      if (
        offset + 16 > data.length
      ) {
        throw new Error(
          "Invalid IPv6 address"
        );
      }

      const groups: string[] = [];

      for (
        let i = 0;
        i < 16;
        i += 2
      ) {
        groups.push(
          data
            .readUInt16BE(offset + i)
            .toString(16)
        );
      }

      host = groups.join(":");

      offset += 16;

      break;
    }

    default:
      throw new Error(
        `Unsupported address type: ${addressType}`
      );
  }

  return {
    version,
    command,
    host,
    port,
    payload: data.subarray(offset)
  };
}

function connectTCP(
  host: string,
  port: number
): Promise<net.Socket> {
  return new Promise(
    (resolve, reject) => {
      const socket =
        net.createConnection({
          host,
          port
        });

      const onError = (
        error: Error
      ) => {
        socket.destroy();
        reject(error);
      };

      socket.once(
        "error",
        onError
      );

      socket.once(
        "connect",
        () => {
          socket.removeListener(
            "error",
            onError
          );

          resolve(socket);
        }
      );
    }
  );
}

function sendResponse(
  ws: WebSocket,
  version: Buffer
): void {
  if (
    ws.readyState !== WebSocket.OPEN
  ) {
    return;
  }

  ws.send(
    Buffer.from([
      version[0] ?? 0x00,
      0x00
    ])
  );
}

export async function startVlessWebSocket(
  config: ServerConfig
): Promise<{
  httpServer: Server;
  wss: WebSocketServer;
  close: () => Promise<void>;
}> {
  if (
    !isValidUUID(
      config.vless.uuid
    )
  ) {
    throw new Error(
      "Invalid VLESS UUID"
    );
  }

  const expectedUUID =
    uuidToBuffer(
      config.vless.uuid
    );

  const httpServer =
    createServer(
      (req, res) => {
        const url = new URL(
          req.url ?? "/",
          `http://${req.headers.host ?? "localhost"}`
        );

        if (
          url.pathname === "/health"
        ) {
          res.writeHead(200, {
            "content-type":
              "application/json"
          });

          res.end(
            JSON.stringify({
              status: "ok",
              server: config.name,
              type: config.type
            })
          );

          return;
        }

        res.writeHead(404);
        res.end("Not Found");
      }
    );

  const wss =
    new WebSocketServer({
      noServer: true,
      maxPayload:
        16 * 1024 * 1024
    });

  httpServer.on(
    "upgrade",
    (
      request,
      socket,
      head
    ) => {
      const url =
        new URL(
          request.url ?? "/",
          `http://${request.headers.host ?? "localhost"}`
        );

      if (
        url.pathname !==
        config.websocket.path
      ) {
        socket.destroy();
        return;
      }

      wss.handleUpgrade(
        request,
        socket,
        head,
        (ws) => {
          wss.emit(
            "connection",
            ws,
            request
          );
        }
      );
    }
  );

  const clients = new Set<WebSocket>();
  const remotes = new Set<net.Socket>();

  wss.on(
    "connection",
    (ws) => {
      clients.add(ws);
      let initialized = false;
      let remote: net.Socket | null =
        null;

      let firstBuffer =
        Buffer.alloc(0);

      const cleanup = () => {
        if (remote) {
          remotes.delete(remote);
          remote.destroy();
          remote = null;
        }

        clients.delete(ws);

        if (
          ws.readyState ===
          WebSocket.OPEN
        ) {
          ws.close();
        }
      };

      ws.on(
        "message",
        async (
          message,
          isBinary
        ) => {
          if (!isBinary) {
            return;
          }

          const chunk =
            Buffer.isBuffer(message)
              ? message
              : Buffer.from(
                  message as ArrayBuffer
                );

          try {
            if (!initialized) {
              firstBuffer =
                Buffer.concat([
                  firstBuffer,
                  chunk
                ]);

              const request =
                parseVless(
                  firstBuffer,
                  expectedUUID
                );

              initialized = true;

              console.log(
                `[CONNECT] ${request.host}:${request.port}`
              );

              remote =
                await connectTCP(
                  request.host,
                  request.port
                );

              remotes.add(remote);

              sendResponse(
                ws,
                request.version
              );

              if (
                request.payload.length
              ) {
                remote.write(
                  request.payload
                );
              }

              remote.on(
                "data",
                (data) => {
                  if (
                    ws.readyState ===
                    WebSocket.OPEN
                  ) {
                    ws.send(data);
                  }
                }
              );

              remote.on(
                "close",
                cleanup
              );

              remote.on(
                "error",
                (error) => {
                  console.error(
                    `[TCP] ${error.message}`
                  );

                  cleanup();
                }
              );

              return;
            }

            if (
              remote &&
              !remote.destroyed
            ) {
              remote.write(chunk);
            }
          } catch (error) {
            console.error(
              "[VLESS]",
              error instanceof Error
                ? error.message
                : error
            );

            cleanup();
          }
        }
      );

      ws.on(
        "close",
        cleanup
      );

      ws.on(
        "error",
        cleanup
      );
    }
  );

  await new Promise<void>(
    (resolve, reject) => {
      httpServer.once(
        "error",
        reject
      );

      httpServer.listen(
        config.listen.port,
        config.listen.host,
        () => {
          console.log(
            `Listening on ${config.listen.host}:${config.listen.port}`
          );

          console.log(
            `WebSocket path: ${config.websocket.path}`
          );

          console.log("");

          httpServer.removeListener(
            "error",
            reject
          );

          resolve();
        }
      );
    }
  );

  const close =
    async (): Promise<void> => {
      for (const ws of clients) {
        try {
          ws.terminate();
        } catch {
          // ignore
        }
      }

      for (const sock of remotes) {
        try {
          sock.destroy();
        } catch {
          // ignore
        }
      }

      clients.clear();
      remotes.clear();

      wss.close();

      (
        httpServer as unknown as {
          closeAllConnections?: () => void;
        }
      ).closeAllConnections?.();

      await new Promise<void>(
        (resolve) => {
          httpServer.close(
            () => resolve()
          );
        }
      );
    };

  return {
    httpServer,
    wss,
    close,
  };
}