import { createServer, type Server } from "node:http";
import net from "node:net";
import crypto from "node:crypto";

import { WebSocketServer, WebSocket } from "ws";

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

const TCP_COMMAND = 0x01;
const UDP_COMMAND = 0x02; // Reserved for future UDP support (not implemented)

// Maximum allowed size for the initial VLESS header before we reject the connection
export const MAX_HEADER_SIZE = 4096;

// Error codes as defined by the VLESS protocol
export const ERROR_CODES = {
  SUCCESS: 0x00,
  GENERAL: 0x01,
  UNSUPPORTED_COMMAND: 0x02,
  INVALID_UUID: 0x03,
};

/**
 * Converts a string UUID (e.g., "123e4567-e89b-12d3-a456-426614174000")
 * to its 16-byte binary representation.
 */
export function uuidToBuffer(uuid: string): Buffer {
  return Buffer.from(uuid.replaceAll("-", ""), "hex");
}

/**
 * Validates that the given string is a proper UUID v4 format.
 */
export function isValidUUID(uuid: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid);
}

/**
 * Timing-safe comparison of two Buffers to prevent timing attacks.
 */
function safeEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

/**
 * Parses a VLESS header from the given data buffer.
 * Returns either a valid VlessRequest or an error code.
 * If the header is incomplete, the function returns null (not enough data).
 */
export function parseVless(
  data: Buffer,
  expectedUUID: Buffer
): { request?: VlessRequest; errorCode?: number } | null {
  // Minimum VLESS header length: 1 (version) + 16 (UUID) + 1 (addons length) + 1 (command) + 2 (port) + 1 (address type) = 22
  if (data.length < 22) {
    return null; // Incomplete header
  }

  const version = data.subarray(0, 1);
  const uuid = data.subarray(1, 17);

  if (!safeEqual(uuid, expectedUUID)) {
    return { errorCode: ERROR_CODES.INVALID_UUID };
  }

  const addonsLength = data[17];

  if (addonsLength === undefined) {
    return { errorCode: ERROR_CODES.GENERAL };
  }

  let offset = 18;

  if (offset + addonsLength >= data.length) {
    return { errorCode: ERROR_CODES.GENERAL };
  }

  // Store addons (currently ignored, but we read them to advance offset)
  // const addons = data.subarray(offset, offset + addonsLength);
  offset += addonsLength;

  const command = data[offset++];

  if (command === undefined) {
    return { errorCode: ERROR_CODES.GENERAL };
  }

  // Only TCP is supported in this implementation
  if (command !== TCP_COMMAND && command !== UDP_COMMAND) {
    return { errorCode: ERROR_CODES.UNSUPPORTED_COMMAND };
  }

  // UDP is not implemented yet
  if (command === UDP_COMMAND) {
    return { errorCode: ERROR_CODES.UNSUPPORTED_COMMAND };
  }

  if (offset + 2 > data.length) {
    return { errorCode: ERROR_CODES.GENERAL };
  }

  const port = data.readUInt16BE(offset);
  offset += 2;

  const addressType = data[offset++];

  if (addressType === undefined) {
    return { errorCode: ERROR_CODES.GENERAL };
  }

  let host: string;

  try {
    switch (addressType) {
      case 0x01: {
        // IPv4
        if (offset + 4 > data.length) {
          throw new Error("Invalid IPv4 address");
        }
        host = Array.from(data.subarray(offset, offset + 4)).join(".");
        offset += 4;
        break;
      }
      case 0x02: {
        // Domain
        if (offset >= data.length) {
          throw new Error("Missing domain length");
        }
        const length = data[offset++];
        if (length === undefined) {
          throw new Error("Missing domain length");
        }
        if (offset + length > data.length) {
          throw new Error("Invalid domain");
        }
        host = data.subarray(offset, offset + length).toString("utf8");
        offset += length;
        break;
      }
      case 0x03: {
        // IPv6
        if (offset + 16 > data.length) {
          throw new Error("Invalid IPv6 address");
        }
        const groups: string[] = [];
        for (let i = 0; i < 16; i += 2) {
          groups.push(data.readUInt16BE(offset + i).toString(16));
        }
        host = groups.join(":");
        offset += 16;
        break;
      }
      default:
        return { errorCode: ERROR_CODES.GENERAL };
    }
  } catch {
    return { errorCode: ERROR_CODES.GENERAL };
  }

  return {
    request: {
      version,
      command,
      host,
      port,
      payload: data.subarray(offset),
    },
  };
}

/**
 * Creates a TCP connection to the given host and port with a timeout.
 * Resolves with the socket on success, rejects on error or timeout.
 */
function connectTCP(host: string, port: number, timeoutMs = 10000): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });

    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error(`TCP connection timeout to ${host}:${port}`));
    }, timeoutMs);

    const onError = (error: Error) => {
      clearTimeout(timeout);
      socket.destroy();
      reject(error);
    };

    socket.once("error", onError);
    socket.once("connect", () => {
      clearTimeout(timeout);
      socket.removeListener("error", onError);
      resolve(socket);
    });
  });
}

/**
 * Sends a VLESS response back to the client.
 * The response is always a two-byte buffer: [version, errorCode].
 */
function sendVlessResponse(
  ws: WebSocket,
  version: Buffer,
  errorCode: number = ERROR_CODES.SUCCESS
): void {
  if (ws.readyState !== WebSocket.OPEN) {
    return;
  }
  ws.send(Buffer.from([version[0] ?? 0x00, errorCode]));
}

/**
 * Starts the VLESS-over-WebSocket server.
 */
export async function startVlessWebSocket(config: ServerConfig): Promise<{
  httpServer: Server;
  wss: WebSocketServer;
  close: () => Promise<void>;
}> {
  if (!isValidUUID(config.vless.uuid)) {
    throw new Error("Invalid VLESS UUID");
  }

  const expectedUUID = uuidToBuffer(config.vless.uuid);

  // Create HTTP server for health checks and WebSocket upgrade handling
  const httpServer = createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    if (url.pathname === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          status: "ok",
          server: config.name,
          type: config.type,
        })
      );
      return;
    }

    res.writeHead(404);
    res.end("Not Found");
  });

  // Create WebSocket server without binding to a specific HTTP server
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 16 * 1024 * 1024, // 16MB max message size
  });

  // Handle HTTP upgrade requests to WebSocket
  httpServer.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

    if (url.pathname !== config.websocket.path) {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  });

  // Handle each WebSocket connection
  const clients = new Set<WebSocket>();
  const remotes = new Set<net.Socket>();

  wss.on("connection", (ws) => {
    clients.add(ws);
    let initialized = false;
    let remote: net.Socket | null = null;
    let headerChunks: Buffer[] = [];
    let headerSize = 0;
    let firstBuffer = Buffer.alloc(0);

    const cleanup = () => {
      if (remote) {
        remotes.delete(remote);
        remote.destroy();
        remote = null;
      }
      clients.delete(ws);
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    };

    ws.on("message", async (message, isBinary) => {
      if (!isBinary) {
        return; // Ignore text messages
      }

      const chunk = Buffer.isBuffer(message) ? message : Buffer.from(message as ArrayBuffer);

      try {
        if (!initialized) {
          // Accumulate data until we have a complete VLESS header
          headerChunks.push(chunk);
          headerSize += chunk.length;

          // Protect against memory exhaustion from malicious clients
          if (headerSize > MAX_HEADER_SIZE) {
            console.error("[VLESS] Header size exceeded limit");
            cleanup();
            return;
          }

          firstBuffer = Buffer.concat(headerChunks);

          const result = parseVless(firstBuffer, expectedUUID);

          if (result === null) {
            // Incomplete header, wait for more data
            return;
          }

          if (result.errorCode !== undefined) {
            // Send error response if possible (we have at least version byte)
            if (firstBuffer.length >= 1) {
              sendVlessResponse(ws, firstBuffer.subarray(0, 1), result.errorCode);
            }
            cleanup();
            return;
          }

          // Valid header received
          const request = result.request!;
          initialized = true;

          console.log(`[CONNECT] ${request.host}:${request.port}`);

          try {
            remote = await connectTCP(request.host, request.port);
            remotes.add(remote);
          } catch (error) {
            console.error("[TCP] Connection failed:", error);
            sendVlessResponse(ws, request.version, ERROR_CODES.GENERAL);
            cleanup();
            return;
          }

          // Send success response
          sendVlessResponse(ws, request.version);

          // Forward any payload data that came after the header
          if (request.payload.length) {
            remote.write(request.payload);
          }

          // Pipe data from remote TCP back to WebSocket
          remote.on("data", (data) => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(data);
            }
          });

          remote.on("close", cleanup);
          remote.on("error", (error) => {
            console.error(`[TCP] ${error.message}`);
            cleanup();
          });

          return;
        }

        // After initialization: forward data to the remote TCP socket
        if (remote && !remote.destroyed) {
          remote.write(chunk);
        }
      } catch (error) {
        console.error("[VLESS]", error instanceof Error ? error.message : error);
        cleanup();
      }
    });

    ws.on("close", cleanup);
    ws.on("error", cleanup);
  });

  // Start listening
  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(config.listen.port, config.listen.host, () => {
      console.log(`Listening on ${config.listen.host}:${config.listen.port}`);
      console.log(`WebSocket path: ${config.websocket.path}`);
      console.log("");
      httpServer.removeListener("error", reject);
      resolve();
    });
  });

  const close = async (): Promise<void> => {
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
    await new Promise<void>((resolve) => {
      httpServer.close(() => resolve());
    });
  };

  return { httpServer, wss, close };
}