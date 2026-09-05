# 02 — Quickstart

## Prerequisites

- Bun 1.4+ (`bun --version`)
- No other dependencies (`ws` is installed via `bun install`)

## Install & verify

```bash
bun install
bun test                  # 49 tests, ~0.2 s
npx tsc --noEmit          # typecheck (same as `bun run build`)
```

## Run a server

```bash
# VLESS on 0.0.0.0:8080, path /vless-ws
bun run src/index.ts --config configs/server-01.json

# Trojan on 0.0.0.0:8081, path /trojan-ws
bun run src/index.ts --config configs/trojan-01.json

# Watch mode
bun run --watch src/index.ts --config configs/server-01.json
```

Expected startup output (VLESS):

```
========================================
              PROXY SUITE
========================================
Server : server-01
Type   : vless-ws
Listen : 0.0.0.0:8080
Path   : /vless-ws
========================================

Listening on 0.0.0.0:8080
WebSocket path: /vless-ws
```

## Print a client URL (no server started)

```bash
bun run src/index.ts --config configs/server-01.json --url
bun run src/index.ts --config configs/trojan-01.json --url
```

VLESS URL shape:

```
vless://<uuid>@<server.host>:<listen.port>?encryption=none&security=none&type=ws&host=<server.host>&path=%2Fvless-ws#<name>
```

Trojan URL shape:

```
trojan://<url-encoded-password>@<server.host>:<listen.port>?type=ws&host=<server.host>&path=%2Ftrojan-ws&security=none#<name>
```

Notes:

- `server.host` is the **public** address clients dial; `listen` is the local bind.
- `security=none` because this repo serves plain WS. Behind a TLS reverse proxy,
  clients use `security=tls` + port 443 — the proxy itself still sees plain WS.
- `--help` / `-h` prints usage.

## Health check

```bash
curl http://127.0.0.1:8080/health
# {"status":"ok","server":"server-01","type":"vless-ws"}
curl -i http://127.0.0.1:8080/nope   # 404 Not Found
```

## Smoke-test the proxy (echo round-trip)

```bash
# 1. Start a TCP echo target
bun -e 'import net from "node:net"; net.createServer(s=>s.on("data",d=>s.write(d))).listen(9001,"127.0.0.1",()=>console.log("echo :9001"))' &
# 2. Start proxy (adjust config to listen on 127.0.0.1 for local test)
# 3. Connect a VLESS/Trojan client to 127.0.0.1:<proxy-port><path>, request 127.0.0.1:9001,
#    send bytes, expect the same bytes back.
```

The automated version of this is in `tests/vless.test.ts` and `tests/trojan.test.ts`
(echo server + `ws` client + header builders in `tests/helpers.ts`).
