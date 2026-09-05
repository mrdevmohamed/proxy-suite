# 01 — Overview

**proxy-suite** runs one proxy server per process, selected by a JSON config file:

```
bun run src/index.ts --config <file> [--url]
```

## What it does

- Accepts WebSocket connections on a single `websocket.path`.
- Authenticates the first binary WS frame as **VLESS** or **Trojan**.
- Opens a raw TCP connection (`node:net`) to the requested `host:port`.
- Relays bytes bidirectionally: `WS <-> TCP`.
- Exposes `GET /health` → `{"status":"ok","server":...,"type":...}`; everything else → `404`.
- Prints a ready-to-import client URL with `--url` (no server started in that mode).

## What it does not do

- No TLS termination (serve plain `ws://`; terminate TLS in Nginx/Caddy/Traefik for `wss://`).
- No UDP relay (VLESS `0x02` is explicitly rejected; Trojan only supports `CONNECT 0x01`).
- No multiplexing, routing rules, statistics, or management API.
- No VMess / Shadowsocks servers (documented in [08](./08-vmess.md) and [09](./09-shadowsocks.md) for reference only).

## Repository layout

```
proxy-suite/
├── src/index.ts            # CLI: --config/--url/--help, validation, URL generation
├── servers/
│   ├── vless-ws-V2.ts      # Active VLESS-WS server (used by src/index.ts)
│   ├── vless-ws.ts         # Legacy V1 VLESS-WS (kept for reference, typechecked)
│   └── trojan-ws.ts        # Trojan-WS server
├── configs/
│   ├── server-01.json      # vless-ws example (0.0.0.0:8080, /vless-ws)
│   └── trojan-01.json      # trojan-ws example (0.0.0.0:8081, /trojan-ws)
├── tests/
│   ├── helpers.ts          # free ports, echo server, header builders, WS waiters
│   ├── config.test.ts      # validation + URL generation (18 tests)
│   ├── vless.test.ts       # VLESS unit + integration (17 tests)
│   └── trojan.test.ts      # Trojan unit + integration (14 tests)
├── docs/                   # you are here
├── package.json            # scripts: start/dev/build(test→tsc)/test(bun test)
└── tsconfig.json           # strict + noUncheckedIndexedAccess, includes src/servers/tests
```

## Key implementation facts

| Area | VLESS-WS (V2) | Trojan-WS |
|------|---------------|-----------|
| Entry | `startVlessWebSocket(config)` | `startTrojanWebSocket(config)` |
| Returns | `{ httpServer, wss, close }` (awaited `listen`) | same |
| WS library | `ws` with `noServer: true`, `maxPayload: 16 MB` | same |
| Auth | UUID bytes `timingSafeEqual` | `SHA224(password)` hex `timingSafeEqual` |
| Header cap | `MAX_HEADER_SIZE = 4096` | implicit (parses first frame) |
| TCP dial | `net.createConnection` with **10 s timeout** | no timeout (relies on OS) |
| Success signal | 2-byte WS reply `[version, 0x00]` | none (starts relaying immediately) |
| Error signal | 2-byte WS reply `[version, code]` then close | close, no reply |
| Split header | buffered across frames until complete | expects full header in first frame(s) |
| Logging | `[CONNECT] host:port`, `[TCP] ...`, `[VLESS] ...` | `[TROJAN] host:port`, `[TCP] ...`, `[WS] ...` |

V1 (`servers/vless-ws.ts`) differs in one important way: it tries to parse the
first chunk immediately and closes on `VLESS header is incomplete`, so a header
split across WS frames fails. V2 returns `null` for incomplete data and waits —
this is why `src/index.ts` imports V2.
