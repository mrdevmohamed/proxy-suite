# 08 — VMess specification (reference)

> **Not implemented** in proxy-suite. Included so operators understand the wider
> V2Ray ecosystem and can migrate legacy clients to VLESS.

## Idea

VMess (V2Ray's original protocol) adds **time-bound authenticated encryption**:
every session uses a fresh key derived from the user UUID + timestamp, so replays
outside a ±120 s window fail. Stronger than VLESS's static UUID, heavier than
VLESS's zero-crypto design.

## Request sketch (TCP + AEAD)

```
auth        : 16 bytes  (MD5-based, time-dependent — prevents replay)
header      : AEAD-sealed {
                version    : 1 B (0x01)
                IV         : 16 B
                key        : 16 B
                responseV  : 1 B
                option     : 1 B (bit 0: chunk stream, bit 2: global padding)
                paddingLen : 1-2 B (P)
                security   : 1 B (0:none 1:aes-128-gcm 2:chacha20-poly1305 3:none-sealed)
                reserved   : 1 B
                cmd        : 1 B (0x01 TCP | 0x02 UDP | 0x03 mux)
                port       : 2 B
                atyp+addr  : SOCKS-style (0x01/0x02/0x03 — VLESS numbering)
              }
body        : chunk stream, each chunk AEAD-sealed with incrementing nonce
```

Key derivation (simplified):

```
key = MD5(uuid_bytes || "c48619fe-8f02-49e0-b9e9-edf763e17e21")
auth = HMAC-MD5(key, timestamp_be64)  // validated within ±120 s + drift table
```

## Security types

| Value | Cipher | Notes |
|-------|--------|-------|
| `0` / `3` | none | testing only |
| `1` | AES-128-GCM | default, hardware-friendly |
| `2` | ChaCha20-Poly1305 | mobile / no-AES-NI |

## VMess vs VLESS

|  | VMess | VLESS |
|--|-------|-------|
| Identity | UUID + timestamp (replay-resistant) | static UUID |
| Encryption | per-session AEAD | none (delegate to TLS) |
| Overhead | higher (seal every chunk) | minimal |
| UDP | yes | spec yes, this repo no |
| Recommendation | legacy compat | new deployments |

## Client URL shape (for reference)

```
vmess://<base64-json>
# JSON: { v:"2", ps:"name", add:"host", port:443, id:"<uuid>",
#         aid:0, scy:"auto", net:"ws", type:"none", host:"host",
#         path:"/vmess", tls:"tls", sni:"host" }
```

Migration path: keep UUIDs, switch server type to `vless-ws`, change client
`encryption=none`, re-issue links via `--url`.
