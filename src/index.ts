import { readFile } from "node:fs/promises";

import { startVlessWebSocket } from "../servers/vless-ws-V2";
import { startTrojanWebSocket } from "../servers/trojan-ws";

interface ServerConfig {
  name: string;
  type: string;

  server?: {
    host: string;
  };

  listen: {
    host: string;
    port: number;
  };

  websocket?: {
    path: string;
  };

  vless?: {
    uuid: string;
  };

  trojan?: {
    password: string;
  };
}

export type { ServerConfig };

function getArg(
  name: string
): string | undefined {
  const index =
    process.argv.indexOf(name);

  if (index === -1) {
    return undefined;
  }

  return process.argv[index + 1];
}

function hasFlag(
  name: string
): boolean {
  return process.argv.includes(name);
}

function printHelp(): void {
  console.log(`
Proxy Suite

Usage:

  bun run src/index.ts --config <file>
  bun run src/index.ts --config <file> --url

Options:

  --config <file>
      Server configuration file.

  --url
      Generate client URL.

  --help
      Show this help.

Supported server types:

  vless-ws
  trojan-ws

Examples:

  bun run src/index.ts --config configs/vless-01.json

  bun run src/index.ts \\
    --config configs/vless-01.json \\
    --url

  bun run src/index.ts \\
    --config configs/trojan-01.json \\
    --url
`);
}

async function loadConfig(
  file: string
): Promise<ServerConfig> {
  const content =
    await readFile(
      file,
      "utf8"
    );

  return JSON.parse(
    content
  ) as ServerConfig;
}

export { loadConfig };

export function isValidUUID(
  uuid: string
): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    uuid
  );
}

function requirePublicHost(
  config: ServerConfig
): string {
  if (!config.server?.host) {
    throw new Error(
      "Config requires server.host"
    );
  }

  return config.server.host;
}

function requireWebSocket(
  config: ServerConfig
): {
  path: string;
} {
  if (!config.websocket) {
    throw new Error(
      `${config.type} requires websocket configuration`
    );
  }

  if (!config.websocket.path) {
    throw new Error(
      "websocket.path is required"
    );
  }

  return config.websocket;
}

/*
 * ----------------------------------------------------------
 * VLESS URL
 * ----------------------------------------------------------
 */

export function generateVlessURL(
  config: ServerConfig
): string {
  const host =
    requirePublicHost(config);

  const websocket =
    requireWebSocket(config);

  if (!config.vless) {
    throw new Error(
      "Config requires vless configuration"
    );
  }

  if (
    !isValidUUID(
      config.vless.uuid
    )
  ) {
    throw new Error(
      "Invalid VLESS UUID"
    );
  }

  const params =
    new URLSearchParams();

  params.set(
    "encryption",
    "none"
  );

  params.set(
    "security",
    "none"
  );

  params.set(
    "type",
    "ws"
  );

  params.set(
    "host",
    host
  );

  params.set(
    "path",
    websocket.path
  );

  return (
    `vless://${config.vless.uuid}` +
    `@${host}:${config.listen.port}` +
    `?${params.toString()}` +
    `#${encodeURIComponent(config.name)}`
  );
}

/*
 * ----------------------------------------------------------
 * Trojan URL
 * ----------------------------------------------------------
 */

export function generateTrojanURL(
  config: ServerConfig
): string {
  const host =
    requirePublicHost(config);

  const websocket =
    requireWebSocket(config);

  if (!config.trojan) {
    throw new Error(
      "Config requires trojan configuration"
    );
  }

  if (
    !config.trojan.password
  ) {
    throw new Error(
      "Trojan password is required"
    );
  }

  const params =
    new URLSearchParams();

  params.set(
    "type",
    "ws"
  );

  params.set(
    "host",
    host
  );

  params.set(
    "path",
    websocket.path
  );

  /*
   * Standalone server is currently
   * plain WebSocket, not TLS.
   */
  params.set(
    "security",
    "none"
  );

  return (
    `trojan://${encodeURIComponent(config.trojan.password)}` +
    `@${host}:${config.listen.port}` +
    `?${params.toString()}` +
    `#${encodeURIComponent(config.name)}`
  );
}

/*
 * ----------------------------------------------------------
 * Generate URL
 * ----------------------------------------------------------
 */

export function generateClientURL(
  config: ServerConfig
): string {
  switch (config.type) {
    case "vless-ws":
      return generateVlessURL(
        config
      );

    case "trojan-ws":
      return generateTrojanURL(
        config
      );

    default:
      throw new Error(
        `URL generation is not supported for type: ${config.type}`
      );
  }
}

/*
 * ----------------------------------------------------------
 * Validation
 * ----------------------------------------------------------
 */

export function validateConfig(
  config: ServerConfig
): void {
  if (!config.name) {
    throw new Error(
      "Config: name is required"
    );
  }

  if (!config.type) {
    throw new Error(
      "Config: type is required"
    );
  }

  if (!config.listen) {
    throw new Error(
      "Config: listen is required"
    );
  }

  if (
    !config.listen.host
  ) {
    throw new Error(
      "Config: listen.host is required"
    );
  }

  if (
    !Number.isInteger(
      config.listen.port
    ) ||
    config.listen.port < 1 ||
    config.listen.port > 65535
  ) {
    throw new Error(
      "Config: listen.port must be between 1 and 65535"
    );
  }

  switch (config.type) {
    case "vless-ws": {
      if (!config.websocket) {
        throw new Error(
          "vless-ws requires websocket configuration"
        );
      }

      if (!config.vless) {
        throw new Error(
          "vless-ws requires vless configuration"
        );
      }

      if (
        !isValidUUID(
          config.vless.uuid
        )
      ) {
        throw new Error(
          "Invalid VLESS UUID"
        );
      }

      break;
    }

    case "trojan-ws": {
      if (!config.websocket) {
        throw new Error(
          "trojan-ws requires websocket configuration"
        );
      }

      if (!config.trojan) {
        throw new Error(
          "trojan-ws requires trojan configuration"
        );
      }

      if (
        !config.trojan.password
      ) {
        throw new Error(
          "Trojan password is required"
        );
      }

      break;
    }

    default:
      throw new Error(
        `Unsupported server type: ${config.type}`
      );
  }
}

/*
 * ----------------------------------------------------------
 * Main
 * ----------------------------------------------------------
 */

async function main(): Promise<void> {
  if (
    hasFlag("--help") ||
    hasFlag("-h")
  ) {
    printHelp();
    return;
  }

  const configFile =
    getArg("--config");

  if (!configFile) {
    console.error(
      "Error: --config is required."
    );

    console.error("");

    printHelp();

    process.exit(1);
  }

  const config =
    await loadConfig(
      configFile
    );

  validateConfig(config);

  /*
   * --------------------------------------------------------
   * Generate client URL
   * --------------------------------------------------------
   */

  if (hasFlag("--url")) {
    const url =
      generateClientURL(
        config
      );

    console.log("");

    console.log(
      "========================================"
    );

    console.log(
      "          CLIENT URL"
    );

    console.log(
      "========================================"
    );

    console.log(
      `Type   : ${config.type}`
    );

    console.log(
      `Server : ${config.name}`
    );

    console.log("");

    console.log(url);

    console.log("");

    return;
  }

  /*
   * --------------------------------------------------------
   * Server information
   * --------------------------------------------------------
   */

  console.log("");

  console.log(
    "========================================"
  );

  console.log(
    "              PROXY SUITE"
  );

  console.log(
    "========================================"
  );

  console.log(
    `Server : ${config.name}`
  );

  console.log(
    `Type   : ${config.type}`
  );

  console.log(
    `Listen : ${config.listen.host}:${config.listen.port}`
  );

  if (config.websocket) {
    console.log(
      `Path   : ${config.websocket.path}`
    );
  }

  console.log(
    "========================================"
  );

  console.log("");

  /*
   * --------------------------------------------------------
   * Start server
   * --------------------------------------------------------
   */

  switch (config.type) {
    case "vless-ws": {
      await startVlessWebSocket(
        config as Parameters<
          typeof startVlessWebSocket
        >[0]
      );

      break;
    }

    case "trojan-ws": {
      await startTrojanWebSocket(
        config as Parameters<
          typeof startTrojanWebSocket
        >[0]
      );

      break;
    }

    default:
      throw new Error(
        `Unsupported server type: ${config.type}`
      );
  }
}

if (import.meta.main) {
  main().catch(
    (error) => {
      console.error("");

      console.error(
        "Fatal:",
        error instanceof Error
          ? error.message
          : error
      );

      process.exit(1);
    }
  );
}