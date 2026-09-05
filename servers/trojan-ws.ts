import { createServer, type Server } from "node:http";
import net from "node:net";
import crypto from "node:crypto";
import {
  WebSocketServer,
  WebSocket,
} from "ws";

export interface TrojanConfig {
  name: string;

  type: "trojan-ws";

  server: {
    host: string;
  };

  listen: {
    host: string;
    port: number;
  };

  websocket: {
    path: string;
  };

  trojan: {
    password: string;
  };
}

interface TrojanRequest {
  host: string;
  port: number;
  payload: Buffer;
}

const WS_OPEN = WebSocket.OPEN;

export function sha224(input: string): string {
  return crypto
    .createHash("sha224")
    .update(input)
    .digest("hex");
}

function safeEqual(
  a: string,
  b: string
): boolean {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);

  if (aBuffer.length !== bBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(
    aBuffer,
    bBuffer
  );
}

/**
 * Trojan protocol:
 *
 * SHA224(password)
 * CRLF
 * SOCKS5 request
 * CRLF
 * payload
 */
export function parseTrojanRequest(
  data: Buffer,
  passwordHash: string
): TrojanRequest {
  /*
   * SHA-224 = 56 ASCII characters
   * CRLF     = 2 bytes
   */
  if (data.length < 58) {
    throw new Error(
      "Trojan header is incomplete"
    );
  }

  const receivedHash = data
    .subarray(0, 56)
    .toString("ascii");

  if (
    !safeEqual(
      receivedHash,
      passwordHash
    )
  ) {
    throw new Error(
      "Invalid Trojan password"
    );
  }

  if (
    data[56] !== 0x0d ||
    data[57] !== 0x0a
  ) {
    throw new Error(
      "Missing CRLF after password"
    );
  }

  let offset = 58;

  /*
   * SOCKS5 request:
   *
   * CMD
   * ATYP
   * DST.ADDR
   * DST.PORT
   */

  if (offset + 4 > data.length) {
    throw new Error(
      "Invalid SOCKS request"
    );
  }

  const command = data[offset++];

  if (command === undefined) {
    throw new Error(
      "Invalid SOCKS request"
    );
  }

  if (command !== 0x01) {
    throw new Error(
      "Only TCP CONNECT is supported"
    );
  }

  const addressType = data[offset++];

  if (addressType === undefined) {
    throw new Error(
      "Invalid SOCKS request"
    );
  }

  let host: string;

  switch (addressType) {
    /*
     * IPv4
     */
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

    /*
     * Domain
     */
    case 0x03: {
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

    /*
     * IPv6
     */
    case 0x04: {
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

  if (
    offset + 2 > data.length
  ) {
    throw new Error(
      "Missing destination port"
    );
  }

  const port =
    data.readUInt16BE(offset);

  offset += 2;

  /*
   * Trojan uses CRLF after the SOCKS
   * request before application data.
   */
  if (
    offset + 2 <= data.length &&
    data[offset] === 0x0d &&
    data[offset + 1] === 0x0a
  ) {
    offset += 2;
  }

  return {
    host,
    port,
    payload: data.subarray(offset),
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
          port,
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

export async function startTrojanWebSocket(
  config: TrojanConfig
): Promise<{
  httpServer: Server;
  wss: WebSocketServer;
  close: () => Promise<void>;
}> {
  const passwordHash =
    sha224(
      config.trojan.password
    );

  const httpServer =
    createServer(
      (request, response) => {
        const url = new URL(
          request.url ?? "/",
          `http://${request.headers.host ?? "localhost"}`
        );

        if (
          url.pathname ===
          "/health"
        ) {
          response.writeHead(
            200,
            {
              "content-type":
                "application/json",
            }
          );

          response.end(
            JSON.stringify({
              status: "ok",
              server: config.name,
              type: config.type,
            })
          );

          return;
        }

        response.writeHead(
          404
        );

        response.end(
          "Not Found"
        );
      }
    );

  const wss =
    new WebSocketServer({
      noServer: true,
      maxPayload:
        16 * 1024 * 1024,
    });

  /*
   * HTTP -> WebSocket upgrade
   */
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

  /*
   * WebSocket connection
   */
  const clients = new Set<WebSocket>();
  const remotes = new Set<net.Socket>();

  wss.on(
    "connection",
    (ws) => {
      clients.add(ws as WebSocket);
      let initialized = false;

      let headerBuffer =
        Buffer.alloc(0);

      let remote:
        | net.Socket
        | null = null;

      let closed = false;

      const cleanup = () => {
        if (closed) {
          return;
        }

        closed = true;

        if (remote) {
          remotes.delete(remote);
          remote.destroy();
          remote = null;
        }

        if (
          ws.readyState ===
          WS_OPEN
        ) {
          ws.close();
        }

        clients.delete(ws as WebSocket);
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

          if (closed) {
            return;
          }

          const chunk =
            Buffer.isBuffer(
              message
            )
              ? message
              : Buffer.from(
                  message as ArrayBuffer
                );

          try {
            /*
             * First WebSocket frame
             */
            if (!initialized) {
              headerBuffer =
                Buffer.concat([
                  headerBuffer,
                  chunk,
                ]);

              const request =
                parseTrojanRequest(
                  headerBuffer,
                  passwordHash
                );

              initialized = true;

              console.log(
                `[TROJAN] ${request.host}:${request.port}`
              );

              remote =
                await connectTCP(
                  request.host,
                  request.port
                );

              remotes.add(remote);

              /*
               * First application data
               */
              if (
                request.payload
                  .length > 0
              ) {
                remote.write(
                  request.payload
                );
              }

              /*
               * Remote -> WebSocket
               */
              remote.on(
                "data",
                (data) => {
                  if (
                    ws.readyState ===
                    WS_OPEN
                  ) {
                    ws.send(data);
                  }
                }
              );

              remote.on(
                "end",
                () => {
                  cleanup();
                }
              );

              remote.on(
                "close",
                () => {
                  cleanup();
                }
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

            /*
             * WebSocket -> Remote
             */
            if (
              remote &&
              !remote.destroyed
            ) {
              remote.write(
                chunk
              );
            }
          } catch (error) {
            console.error(
              "[TROJAN]",
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
        (error) => {
          console.error(
            `[WS] ${error.message}`
          );

          cleanup();
        }
      );
    }
  );

  httpServer.on(
    "error",
    (error) => {
      console.error(
        `[HTTP] ${error.message}`
      );
    }
  );

  await new Promise<void>(
    (resolve, reject) => {
      const onError = (
        error: Error
      ) => {
        reject(error);
      };

      httpServer.once(
        "error",
        onError
      );

      httpServer.listen(
        config.listen.port,
        config.listen.host,
        () => {
          console.log(
            `[TROJAN] ${config.name}`
          );

          console.log(
            `[TROJAN] Listen: ${config.listen.host}:${config.listen.port}`
          );

          console.log(
            `[TROJAN] Path: ${config.websocket.path}`
          );

          console.log(
            `[TROJAN] Password SHA224: ${passwordHash}`
          );

          console.log("");

          httpServer.removeListener(
            "error",
            onError
          );

          resolve();
        }
      );
    }
  );

  const close =
    async (): Promise<void> => {
      for (const client of clients) {
        try {
          client.terminate();
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