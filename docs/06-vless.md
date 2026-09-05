# 06 — VLESS specification (as implemented)

VLESS is a stateless, lightweight proxy protocol: the client sends identity +
target in one header, the server verifies and connects. No handshake beyond that.

> Scope: this documents the **subset implemented in `servers/vless-ws-V2.ts`**
> (TCP-only VLESS over WebSocket). Full upstream VLESS also defines UDP and
> XTLS/Vision flows — those are noted but rejected here.

## Request header (client → server, first binary WS frame)

```
version      : 1 byte   (echoed back in reply, typically 0x00)
uuid         : 16 bytes (RFC-4122 UUID, binary form)
addons_len   : 1 byte   (N — length of `addons`, usually 0x00)
addons       : N bytes  (ignored, skipped)
command      : 1 byte   (0x01 TCP — only supported value here)
port         : 2 bytes  (big-endian destination port)
address_type : 1 byte   (0x01 IPv4 | 0x02 domain | 0x03 IPv6)
address      : variable (see below)
payload      : rest     (first application bytes, may be empty)
```

Wire:

```
ver || uuid16 || addons_len || addons || cmd || port16 || atyp || addr || payload
```

Minimum header length: `1+16+1+1+2+1 = 22` bytes. Shorter → `null` (wait for more
frames in V2; V1 throws `VLESS header is incomplete`).

## Address encoding (`atyp`)

| `atyp` | Layout | Example |
|--------|--------|---------|
| `0x01` IPv4 | 4 bytes `a.b.c.d` | `127,0,0,1` |
| `0x02` domain | 1-byte `len` + `len` bytes UTF-8 | `0x0B "example.com"` |
| `0x03` IPv6 | 16 bytes, 8× big-endian groups | `::1` → `0:0:0:0:0:0:0:1` |

Any other `atyp` → error `0x01` (GENERAL). Truncated address → `0x01`.

## Command handling

| `cmd` | Meaning | This server |
|-------|---------|-------------|
| `0x01` | TCP | ✅ connect + relay |
| `0x02` | UDP | ❌ rejected `0x02` UNSUPPORTED_COMMAND (reserved) |
| other | — | ❌ rejected `0x02` UNSUPPORTED_COMMAND |

## Response (server → client)

Always 2 bytes:

```
[ version, code ]
```

| Code | Constant | When |
|------|----------|------|
| `0x00` | `SUCCESS` | TCP dial succeeded; payload relay starts |
| `0x01` | `GENERAL` | bad addons/addr/port, dial failure/timeout |
| `0x02` | `UNSUPPORTED_COMMAND` | bad/UDP command |
| `0x03` | `INVALID_UUID` | UUID mismatch (`timingSafeEqual`) |

V2 sends the error reply when at least the version byte was received, then closes.
(V1 `sendResponse` only sends `[version, 0x00]` on success and closes silently on error.)

## Worked example (IPv4)

UUID `00000000-0000-4000-8000-000000000001` → `00…00 40 00 80 00 00…01` (16 B).
Target `127.0.0.1:8080` (`8080 = 0x1F90`), payload `"Hi"`:

```
00 | 00000000 00004000 80000000 000001 | 00 | 01 | 1F90 | 01 7F000001 | 4869
ver| uuid16                           | AL | cmd| port | atyp addr    | payload
```

Test builder: `buildVlessHeader("127.0.0.1", 8080, "Hi")` in `tests/helpers.ts`.

## Behavior notes (V2)

- **Buffering:** frames accumulate in `headerChunks` until `parseVless` succeeds or
  errors; `headerSize > 4096` (`MAX_HEADER_SIZE`) closes immediately.
- **UUID check:** `crypto.timingSafeEqual` over 16 bytes (length-checked first).
- **Dial:** `net.createConnection({host, port})`, **10 s timeout**; on failure send
  `[version, 0x01]` and close. Timeout timer is cleared on both connect and error.
- **Relay:** initial `payload` written at once; later client frames → `remote.write`;
  `remote` data → `ws.send`. `remote` close/error → cleanup (destroy + `ws.close`).
- **Text frames ignored** (`isBinary === false` → return).
- **WS limits:** `maxPayload: 16 MB`; upgrade path must exactly equal
  `websocket.path` or the socket is destroyed.

## Client URL (this repo)

```
vless://<uuid>@<server.host>:<port>?encryption=none&security=none&type=ws&host=<server.host>&path=<url-encoded-path>#<url-encoded-name>
```

`encryption` is always `none` (VLESS has no built-in encryption). With a TLS edge,
clients switch to `security=tls` and port 443.

## Diagram

See [04-architecture](./04-architecture.md#vless-ws-flow-detail) for the sequence
diagram. Error paths all end in `ws.close()` after the 2-byte reply.
