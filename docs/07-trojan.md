# 07 — Trojan specification (as implemented)

Trojan disguises proxy traffic as HTTPS: the client proves knowledge of a password
by sending its SHA-224 hash, followed by a SOCKS5-like target request. A passive
observer without the password sees TLS to a normal-looking HTTPS server.

> Scope: `servers/trojan-ws.ts` — Trojan handshake over plain WebSocket, TCP
> `CONNECT` only. No UDP, no fallback web server, no TLS in-process.

## Request (client → server, first binary WS frame)

```
password_hash : 56 bytes ASCII hex  (SHA224(password), lowercase)
CRLF          : 2 bytes             (0x0D 0x0A)
CMD           : 1 byte              (0x01 TCP CONNECT — only supported)
ATYP          : 1 byte              (0x01 IPv4 | 0x03 domain | 0x04 IPv6)  ※ SOCKS numbering
ADDR          : variable            (see below)
PORT          : 2 bytes big-endian
CRLF          : 2 bytes             (0x0D 0x0A — consumed if present)
payload       : rest                (first application bytes)
```

Wire:

```
hex(SHA224(pass)) || CRLF || CMD || ATYP || ADDR || PORT16 || CRLF || payload
```

Minimum: `56+2 = 58` bytes before SOCKS parsing starts; shorter → `Trojan header
is incomplete` and close.

※ Trojan reuses **SOCKS5 atyp values** (`0x01/0x03/0x04`), unlike VLESS
(`0x01/0x02/0x03`). Mixing them up is the most common interop bug.

## Address encoding

| `ATYP` | Layout |
|--------|--------|
| `0x01` IPv4 | 4 bytes |
| `0x03` domain | 1-byte len + len bytes |
| `0x04` IPv6 | 16 bytes |
| other | `Unsupported address type: <n>` + close |

## Verification steps (in order)

1. `data.length >= 58`, else incomplete.
2. `timingSafeEqual(receivedHash, sha224(password))`, else `Invalid Trojan password`.
3. `data[56]==0x0D && data[57]==0x0A`, else `Missing CRLF after password`.
4. `CMD == 0x01`, else `Only TCP CONNECT is supported`.
5. Parse `ATYP/ADDR/PORT` with bounds checks (`Invalid IPv4/domain/IPv6`,
   `Missing destination port`).
6. Optionally consume trailing `CRLF`.
7. `net.createConnection(host, port)`; on success relay initial `payload`.

There is **no success reply** (unlike VLESS). The first bytes the client receives
are the target's response. Any failure → log (`[TROJAN] ...`) + close.

## Worked example

Password `my-secret-password` → SHA224
`866bd66ce80404beda1284ea558299900a4ec71a9b1882d6be4e582f`.
Target `127.0.0.1:9001` (`0x2329`), payload `"Hi"`:

```
38 36 36 62 ... 38 32 66   # 56 ASCII hex chars
0D 0A                       # CRLF
01                          # CMD CONNECT
01 7F 00 00 01              # ATYP IPv4 + 127.0.0.1
23 29                       # port 9001
0D 0A                       # CRLF
48 69                       # "Hi"
```

Builder: `buildTrojanHeader("my-secret-password", "127.0.0.1", 9001, "Hi")`.

## Behavior notes

- **Hash:** `crypto.createHash("sha224").update(password).digest("hex")` (56 chars).
  Compared with `timingSafeEqual` on UTF-8 buffers (length-checked).
- **Relay:** identical to VLESS after connect — client frames → `remote.write`,
  `remote` data → `ws.send`; `end`/`close`/`error` on either side → cleanup
  (idempotent via `closed` flag).
- **Text frames ignored**; messages after close ignored.
- **WS limits:** `maxPayload: 16 MB`; exact `websocket.path` match or destroy.
- **Startup log** prints `Password SHA224` (handy for debugging, **do not expose**
  in production logs — anyone with the hash can impersonate the client).

## Client URL (this repo)

```
trojan://<url-encoded-password>@<server.host>:<port>?type=ws&host=<server.host>&path=<url-encoded-path>&security=none#<url-encoded-name>
```

`security=none` reflects the in-process plain WS. Behind a TLS edge, clients use
`security=tls`.

## Diagram

See [04-architecture](./04-architecture.md#trojan-ws-flow-detail). Key difference
from VLESS: no 2-byte reply — silence means either “connecting” or “failed”.
