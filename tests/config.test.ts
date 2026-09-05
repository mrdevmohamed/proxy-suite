import { describe, test, expect } from "bun:test";
import { readFile } from "node:fs/promises";
import {
  generateClientURL,
  generateTrojanURL,
  generateVlessURL,
  isValidUUID,
  loadConfig,
  validateConfig,
  type ServerConfig,
} from "../src/index";

function baseVlessConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    name: "test-vless",
    type: "vless-ws",
    server: { host: "example.com" },
    listen: { host: "127.0.0.1", port: 18080 },
    websocket: { path: "/vless-ws" },
    vless: { uuid: "00000000-0000-4000-8000-000000000001" },
    ...overrides,
  };
}

function baseTrojanConfig(
  overrides: Partial<ServerConfig> = {}
): ServerConfig {
  return {
    name: "test-trojan",
    type: "trojan-ws",
    server: { host: "example.com" },
    listen: { host: "127.0.0.1", port: 18081 },
    websocket: { path: "/trojan-ws" },
    trojan: { password: "secret" },
    ...overrides,
  };
}

describe("isValidUUID", () => {
  test("accepts valid UUIDs", () => {
    expect(isValidUUID("00000000-0000-4000-8000-000000000001")).toBe(true);
    expect(isValidUUID("123e4567-e89b-12d3-a456-426614174000")).toBe(true);
    expect(isValidUUID("AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE")).toBe(true);
  });

  test("rejects invalid UUIDs", () => {
    expect(isValidUUID("")).toBe(false);
    expect(isValidUUID("not-a-uuid")).toBe(false);
    expect(isValidUUID("00000000-0000-4000-8000-00000000000")).toBe(false);
    expect(isValidUUID("00000000000040008000000000000001")).toBe(false);
    expect(isValidUUID("zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz")).toBe(false);
  });
});

describe("validateConfig", () => {
  test("accepts a valid vless-ws config", () => {
    expect(() => validateConfig(baseVlessConfig())).not.toThrow();
  });

  test("accepts a valid trojan-ws config", () => {
    expect(() => validateConfig(baseTrojanConfig())).not.toThrow();
  });

  test("rejects missing name/type/listen", () => {
    expect(() =>
      validateConfig({ ...baseVlessConfig(), name: "" })
    ).toThrow("name is required");
    expect(() =>
      validateConfig({ ...baseVlessConfig(), type: "" })
    ).toThrow("type is required");
    expect(() =>
      validateConfig({ ...baseVlessConfig(), listen: undefined as never })
    ).toThrow("listen is required");
    expect(() =>
      validateConfig({
        ...baseVlessConfig(),
        listen: { host: "", port: 8080 },
      })
    ).toThrow("listen.host is required");
  });

  test("rejects bad ports", () => {
    for (const port of [0, -1, 65536, 1.5, NaN]) {
      expect(() =>
        validateConfig({
          ...baseVlessConfig(),
          listen: { host: "127.0.0.1", port },
        })
      ).toThrow("listen.port must be between 1 and 65535");
    }
    // Boundaries are OK
    expect(() =>
      validateConfig({
        ...baseVlessConfig(),
        listen: { host: "127.0.0.1", port: 1 },
      })
    ).not.toThrow();
    expect(() =>
      validateConfig({
        ...baseVlessConfig(),
        listen: { host: "127.0.0.1", port: 65535 },
      })
    ).not.toThrow();
  });

  test("rejects unsupported server type", () => {
    expect(() =>
      validateConfig({ ...baseVlessConfig(), type: "ss-ws" })
    ).toThrow("Unsupported server type");
  });

  test("vless-ws requires websocket/vless/uuid", () => {
    expect(() =>
      validateConfig({ ...baseVlessConfig(), websocket: undefined })
    ).toThrow("vless-ws requires websocket");
    expect(() =>
      validateConfig({ ...baseVlessConfig(), vless: undefined })
    ).toThrow("vless-ws requires vless");
    expect(() =>
      validateConfig({
        ...baseVlessConfig(),
        vless: { uuid: "bad" },
      })
    ).toThrow("Invalid VLESS UUID");
  });

  test("trojan-ws requires websocket/trojan/password", () => {
    expect(() =>
      validateConfig({ ...baseTrojanConfig(), websocket: undefined })
    ).toThrow("trojan-ws requires websocket");
    expect(() =>
      validateConfig({ ...baseTrojanConfig(), trojan: undefined })
    ).toThrow("trojan-ws requires trojan");
    expect(() =>
      validateConfig({
        ...baseTrojanConfig(),
        trojan: { password: "" },
      })
    ).toThrow("Trojan password is required");
  });
});

describe("generateClientURL", () => {
  test("generates a valid VLESS URL", () => {
    const url = generateClientURL(baseVlessConfig());
    expect(url.startsWith("vless://")).toBe(true);
    expect(url).toContain("00000000-0000-4000-8000-000000000001@");
    expect(url).toContain("example.com:18080");
    expect(url).toContain("encryption=none");
    expect(url).toContain("security=none");
    expect(url).toContain("type=ws");
    expect(url).toContain("host=example.com");
    expect(url).toContain("path=%2Fvless-ws");
    expect(url).toContain("#test-vless");

    // Must be parseable
    const parsed = new URL(url);
    expect(parsed.protocol).toBe("vless:");
  });

  test("generates a valid Trojan URL", () => {
    const url = generateClientURL(baseTrojanConfig());
    expect(url.startsWith("trojan://")).toBe(true);
    expect(url).toContain("example.com:18081");
    expect(url).toContain("type=ws");
    expect(url).toContain("security=none");
    expect(url).toContain("host=example.com");
    expect(url).toContain("path=%2Ftrojan-ws");
    expect(url).toContain("#test-trojan");
  });

  test("URL-encodes password and name", () => {
    const url = generateTrojanURL({
      ...baseTrojanConfig(),
      name: "my server 01",
      trojan: { password: "p@ss:word/with?chars" },
    });
    expect(url).toContain(encodeURIComponent("p@ss:word/with?chars"));
    expect(url).toContain(`#${encodeURIComponent("my server 01")}`);
    // Round-trips
    const parsed = new URL(url);
    expect(decodeURIComponent(parsed.username)).toBe(
      "p@ss:word/with?chars"
    );
    expect(decodeURIComponent(parsed.hash.slice(1))).toBe("my server 01");
  });

  test("throws for unsupported type", () => {
    expect(() =>
      generateClientURL({ ...baseVlessConfig(), type: "nope" })
    ).toThrow("URL generation is not supported");
  });

  test("throws when server.host is missing", () => {
    expect(() =>
      generateVlessURL({ ...baseVlessConfig(), server: undefined })
    ).toThrow("server.host");
    expect(() =>
      generateTrojanURL({ ...baseTrojanConfig(), server: undefined })
    ).toThrow("server.host");
  });

  test("throws on invalid UUID / missing password", () => {
    expect(() =>
      generateVlessURL({
        ...baseVlessConfig(),
        vless: { uuid: "bad" },
      })
    ).toThrow("Invalid VLESS UUID");
    expect(() =>
      generateTrojanURL({
        ...baseTrojanConfig(),
        trojan: { password: "" },
      })
    ).toThrow("Trojan password is required");
  });
});

describe("config files on disk", () => {
  test("configs/server-01.json is a valid vless config", async () => {
    const raw = await readFile("configs/server-01.json", "utf8");
    const config = JSON.parse(raw);
    expect(() => validateConfig(config)).not.toThrow();
    const url = generateClientURL(config);
    expect(url.startsWith("vless://")).toBe(true);
  });

  test("configs/trojan-01.json is a valid trojan config", async () => {
    const raw = await readFile("configs/trojan-01.json", "utf8");
    const config = JSON.parse(raw);
    expect(() => validateConfig(config)).not.toThrow();
    const url = generateClientURL(config);
    expect(url.startsWith("trojan://")).toBe(true);
  });

  test("loadConfig reads a file", async () => {
    const config = await loadConfig("configs/server-01.json");
    expect(config.name).toBe("server-01");
    expect(config.type).toBe("vless-ws");
  });
});
