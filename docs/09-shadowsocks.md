# 09 — Shadowsocks specification (reference)

> **Not implemented** in proxy-suite. Documented for completeness; use a dedicated
> Shadowsocks server (e.g. shadowsocks-rust) if you need it.

## Idea

Pre-shared-key authenticated encryption per TCP stream / UDP packet. No identity
layer beyond the key — anyone with the key can use the server. Simple, fast,
single-hop friendly.

## TCP stream (AEAD ciphers, e.g. `aes-256-gcm`, `chacha20-ietf-poly1305`)

```
salt            : key-len bytes (random per connection, sent in clear)
sealed[target]  : AEAD(key=salt-derived subkey, nonce=0) {
                    atyp : 1 B (0x01 IPv4 | 0x03 domain | 0x04 IPv6 — SOCKS numbering)
                    addr : variable
                    port : 2 B
                  }
sealed[chunks]* : AEAD with incrementing nonce {
                    len  : 2 B
                    data : ≤0x3FFF bytes
                  }
```

Subkey derivation: `HKDF-SHA1(masterKey, salt, "ss-subkey")`.
Decryption fails closed on any tampering (no fallback page, unlike Trojan+HTTPS).

## Common methods

| Method | Key len | Notes |
|--------|---------|-------|
| `aes-256-gcm` | 32 B | widely supported |
| `aes-128-gcm` | 16 B | faster, fine for most |
| `chacha20-ietf-poly1305` | 32 B | no AES-NI? use this |
| `2022-blake3-*` | 16/32 B | newer, separate UDP key |

Avoid legacy stream ciphers (`rc4`, `bf-cfb`, `aes-*-cfb`) — no integrity.

## URL shape (SIP002)

```
ss://<base64(method:password)>@<host>:<port>?plugin=<...>#<name>
```

## Shadowsocks vs this repo

|  | Shadowsocks | VLESS/Trojan-WS here |
|--|----------------|----------------------|
| Identity | shared key | UUID / password-hash |
| Fingerprint | AEAD blob (detectable by entropy tests) | WS+TLS blends with web |
| CDN-friendly | no | yes (WS path routing) |
| UDP | yes | no |

Use Shadowsocks for low-end devices / simple setups; use this repo when you want
CDN camouflage and standard reverse-proxy operations.
