import { describe, test, expect, afterEach } from "bun:test";
import { WebSocket } from "ws";
import {
  parseTrojanRequest,
  sha224,
  startTrojanWebSocket,
} from "../servers/trojan-ws";
import {
  buildTrojanHeader,
  closeWs,
  collectMessages,
  getFreePort,
  rawUpgradeHead,
  startEchoServer,
  TEST_PASSWORD,
  TEST_PASSWORD_SHA224,
  waitForCloseOrError,
  waitForOpen,
  withTimeout,
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
  ws.on("error", () => {});
  wsClients.push(ws);
  return ws;
}

async function startTestServer(opts: {
  path?: string;
  password?: string;
}): Promise<{ port: number; close: () => Promise<void> }> {
  const port = await getFreePort();
  const handle = await startTrojanWebSocket({
    name: "test-trojan",
    type: "trojan-ws",
    server: { host: "127.0.0.1" },
    listen: { host: "127.0.0.1", port },
    websocket: { path: opts.path ?? "/trojan-ws" },
    trojan: { password: opts.password ?? TEST_PASSWORD },
  });
  proxyClosers.push(handle.close);
  return { port, close: handle.close };
}

describe("trojan pure helpers", () => {
  test("sha224 matches known vector", () => {
    expect(sha224(TEST_PASSWORD)).toBe(TEST_PASSWORD_SHA224);
    expect(sha224(TEST_PASSWORD)).toHaveLength(56);
    // Different passwords differ
    expect(sha224("other")).not.toBe(TEST_PASSWORD_SHA224);
  });

  test("parseTrojanRequest parses IPv4", () => {
    const data = buildTrojanHeader(
      TEST_PASSWORD,
      "127.0.0.1",
      8080,
      "hello"
    );
    const req = parseTrojanRequest(data, TEST_PASSWORD_SHA224);
    expect(req.host).toBe("127.0.0.1");
    expect(req.port).toBe(8080);
    expect(req.payload.toString()).toBe("hello");
  });

  test("parseTrojanRequest parses domain", () => {
    const data = buildTrojanHeader(
      TEST_PASSWORD,
      "example.com",
      443,
      "data"
    );
    const req = parseTrojanRequest(data, TEST_PASSWORD_SHA224);
    expect(req.host).toBe("example.com");
    expect(req.port).toBe(443);
    expect(req.payload.toString()).toBe("data");
  });

  test("parseTrojanRequest parses IPv6", () => {
    const data = buildTrojanHeader(TEST_PASSWORD, "::1", 80, "x");
    const req = parseTrojanRequest(data, TEST_PASSWORD_SHA224);
    expect(req.port).toBe(80);
    expect(req.host).toContain(":");
    expect(req.payload.toString()).toBe("x");
  });

  test("parseTrojanRequest throws on short buffer", () => {
    expect(() =>
      parseTrojanRequest(Buffer.alloc(10), TEST_PASSWORD_SHA224)
    ).toThrow("incomplete");
  });

  test("parseTrojanRequest throws on wrong password", () => {
    const data = buildTrojanHeader("wrong-password", "127.0.0.1", 80, "");
    expect(() => parseTrojanRequest(data, TEST_PASSWORD_SHA224)).toThrow(
      "Invalid Trojan password"
    );
  });

  test("parseTrojanRequest throws on missing CRLF", () => {
    const data = buildTrojanHeader(TEST_PASSWORD, "127.0.0.1", 80, "");
    data[56] = 0x00;
    expect(() => parseTrojanRequest(data, TEST_PASSWORD_SHA224)).toThrow(
      "Missing CRLF"
    );
  });

  test("parseTrojanRequest throws on non-TCP command", () => {
    const data = buildTrojanHeader(TEST_PASSWORD, "127.0.0.1", 80, "", {
      command: 0x03,
    });
    expect(() => parseTrojanRequest(data, TEST_PASSWORD_SHA224)).toThrow(
      "Only TCP CONNECT"
    );
  });

  test("parseTrojanRequest throws on unsupported atyp", () => {
    const data = buildTrojanHeader(TEST_PASSWORD, "x", 80, "", {
      addressType: 0x02,
    });
    expect(() => parseTrojanRequest(data, TEST_PASSWORD_SHA224)).toThrow(
      "Unsupported address type"
    );
  });
});

describe("trojan-ws server integration", () => {
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
    expect(body.server).toBe("test-trojan");
    expect(body.type).toBe("trojan-ws");

    const missing = await fetch(`http://127.0.0.1:${port}/nope`);
    expect(missing.status).toBe(404);
  });

  test("wrong WebSocket path does not upgrade", async () => {
    const { port } = await startTestServer({ path: "/trojan-ws" });
    const result = await rawUpgradeHead(port, "/wrong-path");
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

    const ws = trackWs(new WebSocket(`ws://127.0.0.1:${port}/trojan-ws`));
    await withTimeout(waitForOpen(ws), 3000, "ws open");

    const handshake = buildTrojanHeader(
      TEST_PASSWORD,
      "127.0.0.1",
      echo.port,
      "hello-trojan"
    );
    const echoPromise = collectMessages(ws, 1, 4000);
    ws.send(handshake);

    const [echoMsg] = await withTimeout(echoPromise, 4500, "trojan echo");
    expect(echoMsg?.toString()).toBe("hello-trojan");

    // Bidirectional: frames after handshake forward to TCP
    const second = collectMessages(ws, 1, 3000);
    ws.send(Buffer.from("second-trojan"));
    const [secondMsg] = await withTimeout(second, 3500, "second echo");
    expect(secondMsg?.toString()).toBe("second-trojan");
  });

  test("valid domain proxy echoes payload", async () => {
    const echo = await startEchoServer();
    echoClosers.push(echo.close);
    const { port } = await startTestServer({});
    const ws = trackWs(new WebSocket(`ws://127.0.0.1:${port}/trojan-ws`));
    await withTimeout(waitForOpen(ws), 3000, "ws open");

    const handshake = buildTrojanHeader(
      TEST_PASSWORD,
      "localhost",
      echo.port,
      "domain-trojan"
    );
    const echoPromise = collectMessages(ws, 1, 4000);
    ws.send(handshake);
    const [echoMsg] = await withTimeout(echoPromise, 4500, "domain echo");
    expect(echoMsg?.toString()).toBe("domain-trojan");
  });

  test("invalid password closes connection without echo", async () => {
    const echo = await startEchoServer();
    echoClosers.push(echo.close);
    const { port } = await startTestServer({});
    const ws = trackWs(new WebSocket(`ws://127.0.0.1:${port}/trojan-ws`));
    await withTimeout(waitForOpen(ws), 3000, "ws open");

    const bad = buildTrojanHeader(
      "wrong-password",
      "127.0.0.1",
      echo.port,
      "should-not-echo"
    );
    ws.send(bad);

    // Server logs [TROJAN] error and closes. Client should close without receiving the payload.
    const result = await waitForCloseOrError(ws, 3000);
    expect(result.closed).toBe(true);
  });
});
