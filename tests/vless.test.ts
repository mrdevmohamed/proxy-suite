import { describe, test, expect, afterEach } from "bun:test";
import { WebSocket } from "ws";
import {
  ERROR_CODES,
  isValidUUID,
  parseVless,
  startVlessWebSocket,
  uuidToBuffer,
} from "../servers/vless-ws-V2";
import {
  buildVlessHeader,
  closeWs,
  collectMessages,
  getFreePort,
  rawUpgradeHead,
  startEchoServer,
  TEST_UUID,
  uuidToBuffer as testUuidToBuffer,
  waitForCloseOrError,
  waitForOpen,
  withTimeout,
  type EchoServer,
} from "./helpers";

const proxyClosers: Array<() => Promise<void>> = [];
const echoClosers: Array<() => Promise<void>> = [];
const wsClients: WebSocket[] = [];

afterEach(async () => {
  for (const ws of wsClients.splice(0)) {
    try {
      await closeWs(ws);
    } catch {
      // ignore
    }
  }
  while (proxyClosers.length) {
    const close = proxyClosers.pop();
    if (close) {
      try {
        await withTimeout(close(), 3000, "proxy close");
      } catch {
        // ignore
      }
    }
  }
  while (echoClosers.length) {
    const close = echoClosers.pop();
    if (close) {
      try {
        await withTimeout(close(), 3000, "echo close");
      } catch {
        // ignore
      }
    }
  }
});

function trackWs(ws: WebSocket): WebSocket {
  // Permanent no-op error listener prevents Node's "unhandled error" throw
  // when rejection happens between specific waiters.
  ws.on("error", () => {});
  wsClients.push(ws);
  return ws;
}

async function startTestServer(opts: {
  path?: string;
  uuid?: string;
}): Promise<{ port: number; close: () => Promise<void> }> {
  const port = await getFreePort();
  const handle = await startVlessWebSocket({
    name: "test-vless",
    type: "vless-ws",
    listen: { host: "127.0.0.1", port },
    websocket: { path: opts.path ?? "/vless-ws" },
    vless: { uuid: opts.uuid ?? TEST_UUID },
  });
  proxyClosers.push(handle.close);
  return { port, close: handle.close };
}

describe("vless pure helpers (V2)", () => {
  test("isValidUUID accepts/rejects", () => {
    expect(isValidUUID(TEST_UUID)).toBe(true);
    expect(isValidUUID("bad")).toBe(false);
    expect(isValidUUID("")).toBe(false);
  });

  test("uuidToBuffer produces 16 bytes", () => {
    const buf = uuidToBuffer(TEST_UUID);
    expect(buf.length).toBe(16);
    expect(buf.equals(testUuidToBuffer(TEST_UUID))).toBe(true);
  });

  test("parseVless returns null for incomplete header", () => {
    const uuid = testUuidToBuffer(TEST_UUID);
    expect(parseVless(Buffer.alloc(0), uuid)).toBeNull();
    expect(parseVless(Buffer.alloc(21), uuid)).toBeNull();
  });

  test("parseVless rejects wrong UUID", () => {
    const expected = testUuidToBuffer(TEST_UUID);
    const header = buildVlessHeader(
      "127.0.0.1",
      80,
      "hi",
      { uuid: "11111111-1111-4111-8111-111111111111" }
    );
    const result = parseVless(header, expected);
    expect(result).not.toBeNull();
    expect(result?.errorCode).toBe(ERROR_CODES.INVALID_UUID);
  });

  test("parseVless parses IPv4", () => {
    const expected = testUuidToBuffer(TEST_UUID);
    const header = buildVlessHeader("127.0.0.1", 8080, "payload-data");
    const result = parseVless(header, expected);
    expect(result?.errorCode).toBeUndefined();
    expect(result?.request?.host).toBe("127.0.0.1");
    expect(result?.request?.port).toBe(8080);
    expect(result?.request?.payload.toString()).toBe("payload-data");
    expect(result?.request?.command).toBe(0x01);
  });

  test("parseVless parses domain", () => {
    const expected = testUuidToBuffer(TEST_UUID);
    const header = buildVlessHeader("example.com", 443, "abc");
    const result = parseVless(header, expected);
    expect(result?.request?.host).toBe("example.com");
    expect(result?.request?.port).toBe(443);
    expect(result?.request?.payload.toString()).toBe("abc");
  });

  test("parseVless parses IPv6", () => {
    const expected = testUuidToBuffer(TEST_UUID);
    const header = buildVlessHeader("::1", 80, "x");
    const result = parseVless(header, expected);
    expect(result?.request).toBeDefined();
    expect(result?.request?.port).toBe(80);
    // ::1 expands to 0:0:0:0:0:0:0:1
    expect(result?.request?.host).toBe("0:0:0:0:0:0:0:1");
  });

  test("parseVless rejects unsupported command and UDP", () => {
    const expected = testUuidToBuffer(TEST_UUID);
    const badCmd = buildVlessHeader("127.0.0.1", 80, "", { command: 0x03 });
    expect(parseVless(badCmd, expected)?.errorCode).toBe(
      ERROR_CODES.UNSUPPORTED_COMMAND
    );
    const udp = buildVlessHeader("127.0.0.1", 80, "", { command: 0x02 });
    expect(parseVless(udp, expected)?.errorCode).toBe(
      ERROR_CODES.UNSUPPORTED_COMMAND
    );
  });

  test("parseVless handles addons", () => {
    const expected = testUuidToBuffer(TEST_UUID);
    const header = buildVlessHeader("127.0.0.1", 80, "data", {
      addons: Buffer.from([0xaa, 0xbb]),
    });
    const result = parseVless(header, expected);
    expect(result?.request?.host).toBe("127.0.0.1");
    expect(result?.request?.payload.toString()).toBe("data");
  });

  test("startVlessWebSocket rejects invalid UUID", async () => {
    let threw = false;
    try {
      await startVlessWebSocket({
        name: "bad",
        type: "vless-ws",
        listen: { host: "127.0.0.1", port: await getFreePort() },
        websocket: { path: "/vless-ws" },
        vless: { uuid: "bad" },
      });
    } catch (e) {
      threw = true;
      expect((e as Error).message).toContain("Invalid VLESS UUID");
    }
    expect(threw).toBe(true);
  });
});

describe("vless-ws server integration (V2)", () => {
  test("health endpoint returns ok and 404 for unknown path", async () => {
    const { port } = await startTestServer({});
    const health = await fetch(`http://127.0.0.1:${port}/health`);
    expect(health.status).toBe(200);
    const body = (await health.json()) as {
      status: string;
      server: string;
      type: string;
    };
    expect(body.status).toBe("ok");
    expect(body.server).toBe("test-vless");

    const missing = await fetch(`http://127.0.0.1:${port}/nope`);
    expect(missing.status).toBe(404);
  });

  test("wrong WebSocket path does not upgrade", async () => {
    const { port } = await startTestServer({ path: "/vless-ws" });
    const result = await rawUpgradeHead(port, "/wrong-path");
    // Server destroys the socket: either no HTTP response or non-101 status
    if (!result.closedWithoutResponse) {
      expect(result.head).not.toContain("101");
    } else {
      expect(result.closedWithoutResponse).toBe(true);
    }
  });

  test("valid IPv4 proxy echoes payload", async () => {
    const echo = await startEchoServer();
    echoClosers.push(echo.close);
    const { port } = await startTestServer({});

    const ws = trackWs(new WebSocket(`ws://127.0.0.1:${port}/vless-ws`));
    await withTimeout(waitForOpen(ws), 3000, "ws open");

    const header = buildVlessHeader(
      "127.0.0.1",
      echo.port,
      "hello-vless"
    );
    const twoMessages = collectMessages(ws, 2, 4000);
    ws.send(header);

    const [handshake, echoMsg] = await withTimeout(
      twoMessages,
      4500,
      "handshake+echo"
    );
    expect(handshake?.length).toBe(2);
    expect(handshake?.[0]).toBe(0x00);
    expect(handshake?.[1]).toBe(ERROR_CODES.SUCCESS);
    expect(echoMsg?.toString()).toBe("hello-vless");

    // Bidirectional: post-handshake frames forward to TCP
    const nextEcho = collectMessages(ws, 1, 3000);
    ws.send(Buffer.from("second-payload"));
    const [second] = await withTimeout(nextEcho, 3500, "second echo");
    expect(second?.toString()).toBe("second-payload");
  });

  test("valid domain proxy echoes payload", async () => {
    const echo = await startEchoServer();
    echoClosers.push(echo.close);
    const { port } = await startTestServer({});
    const ws = trackWs(new WebSocket(`ws://127.0.0.1:${port}/vless-ws`));
    await withTimeout(waitForOpen(ws), 3000, "ws open");

    // Use localhost domain (resolves to 127.0.0.1)
    const header = buildVlessHeader("localhost", echo.port, "domain-hi");
    const msgs = collectMessages(ws, 2, 4000);
    ws.send(header);
    const [handshake, echoMsg] = await withTimeout(msgs, 4500, "echo");
    expect(handshake?.[1]).toBe(ERROR_CODES.SUCCESS);
    expect(echoMsg?.toString()).toBe("domain-hi");
  });

  test("split header across two frames still connects (V2 buffering)", async () => {
    const echo = await startEchoServer();
    echoClosers.push(echo.close);
    const { port } = await startTestServer({});
    const ws = trackWs(new WebSocket(`ws://127.0.0.1:${port}/vless-ws`));
    await withTimeout(waitForOpen(ws), 3000, "ws open");

    const full = buildVlessHeader("127.0.0.1", echo.port, "split-payload");
    const part1 = full.subarray(0, 10); // <22 bytes → incomplete
    const part2 = full.subarray(10);

    const msgs = collectMessages(ws, 2, 4000);
    ws.send(part1);
    await new Promise((r) => setTimeout(r, 100));
    ws.send(part2);

    const [handshake, echoMsg] = await withTimeout(msgs, 4500, "split echo");
    expect(handshake?.[1]).toBe(ERROR_CODES.SUCCESS);
    expect(echoMsg?.toString()).toBe("split-payload");
  });

  test("invalid UUID receives error and closes", async () => {
    const echo = await startEchoServer();
    echoClosers.push(echo.close);
    const { port } = await startTestServer({});
    const ws = trackWs(new WebSocket(`ws://127.0.0.1:${port}/vless-ws`));
    await withTimeout(waitForOpen(ws), 3000, "ws open");

    const bad = buildVlessHeader("127.0.0.1", echo.port, "nope", {
      uuid: "11111111-1111-4111-8111-111111111111",
    });
    const msgs = collectMessages(ws, 1, 3000);
    ws.send(bad);
    const [errResp] = await withTimeout(msgs, 3500, "error response");
    expect(errResp?.length).toBe(2);
    expect(errResp?.[1]).toBe(ERROR_CODES.INVALID_UUID);

    // Server should close after error
    const closeResult = await waitForCloseOrError(ws, 3000);
    expect(closeResult.closed).toBe(true);
  });

  test("unreachable TCP target receives GENERAL error", async () => {
    const closedPort = await getFreePort(); // nothing listening
    const { port } = await startTestServer({});
    const ws = trackWs(new WebSocket(`ws://127.0.0.1:${port}/vless-ws`));
    await withTimeout(waitForOpen(ws), 3000, "ws open");

    const header = buildVlessHeader("127.0.0.1", closedPort, "x");
    const msgs = collectMessages(ws, 1, 5000);
    ws.send(header);
    const [errResp] = await withTimeout(msgs, 6000, "tcp error response");
    expect(errResp?.length).toBe(2);
    expect(errResp?.[1]).toBe(ERROR_CODES.GENERAL);
  });
});
