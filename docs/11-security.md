# 11 — Security

## Threat model

- **Passive observer:** sees TLS SNI + timing/size (mitigate with CDN + padding at edge).
- **Active prober:** connects without secret (must learn nothing — see below).
- **Malicious client:** tries to exhaust memory/CPU or pivot to internal hosts.

Out of scope: endpoint compromise, global traffic correlation, TLS-edge breaches.

## What this repo already does

| Control | Where | Detail |
|---------|-------|--------|
| Timing-safe secrets | `safeEqual` (VLESS), `safeEqual` (Trojan) | `crypto.timingSafeEqual`, length-checked first |
| Header cap | VLESS V2 `MAX_HEADER_SIZE=4096` | closes before buffering more |
| WS frame cap | both servers | `maxPayload: 16 MB` |
| Dial timeout | VLESS V2 `connectTCP(..., 10000)` | timer cleared on connect **and** error |
| Exact path match | upgrade handlers | wrong path → `socket.destroy()`, no banner |
| No info leak | error paths | VLESS sends only `[ver, code]`; Trojan sends nothing |
| Forced cleanup | `close()` + per-conn `cleanup` | terminate WS, destroy TCP, `closeAllConnections?.()` |
| Strict TS | `tsconfig` | `strict` + `noUncheckedIndexedAccess`; all index accesses guarded |

## Known limitations (be honest in ops reviews)

- **No TLS in-process** — unencrypted WS on the LAN if the reverse proxy is remote.
- **Trojan dial has no timeout** (OS default); add one if you expose it directly.
- **Trojan logs the password hash** on startup (`Password SHA224: ...`) — the hash
  *is* the credential. Scrub or disable that log in production.
- **No rate limiting / fail2ban** — add at the edge (wrong UUID/password currently
  only logs + closes).
- **V1 legacy server** (`servers/vless-ws.ts`) closes split headers instead of
  buffering — do not route production traffic to it.
- **No UDP** — clients requesting UDP get an error/close; document this to users.

## Operational checklist

- [ ] TLS at edge (Caddy/Nginx), HSTS, redirect `:80 → :443`.
- [ ] Distinct, unguessable `websocket.path` per instance.
- [ ] Random UUID per VLESS server; 32+ char random Trojan passwords.
- [ ] Bind `listen` to `127.0.0.1` when behind a local reverse proxy.
- [ ] Restrict egress if clients must not reach internal subnets (the proxy dials
      any `host:port` the client requests, including `169.254.169.254`).
- [ ] Ship logs centrally; alert on bursts of `Invalid UUID/password`.
- [ ] `bun test` + `npx tsc --noEmit` green in CI before deploy.
