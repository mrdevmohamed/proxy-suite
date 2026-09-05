# Documentation index

| Doc | Contents |
|-----|----------|
| [01-overview](./01-overview.md) | What proxy-suite is, features, non-goals, repo layout |
| [02-quickstart](./02-quickstart.md) | Install, run, `--url`, health checks, first proxy test |
| [03-configuration](./03-configuration.md) | Config file schema, validation rules, examples |
| [04-architecture](./04-architecture.md) | Components, request lifecycle, diagrams |
| [05-protocols-overview](./05-protocols-overview.md) | V2Ray protocol family comparison |
| [06-vless](./06-vless.md) | VLESS specification (as implemented) + byte layout + diagrams |
| [07-trojan](./07-trojan.md) | Trojan specification (as implemented) + byte layout + diagrams |
| [08-vmess](./08-vmess.md) | VMess specification (reference, not implemented) |
| [09-shadowsocks](./09-shadowsocks.md) | Shadowsocks specification (reference, not implemented) |
| [10-transports](./10-transports.md) | Transports: WS, TCP, H2, gRPC, mKCP, QUIC |
| [11-security](./11-security.md) | Threat model, hardening in this repo, operational checklist |
| [12-development](./12-development.md) | Scripts, tests, typecheck, adding a new protocol |

Conventions in these docs:

- `vless-ws` = VLESS over plain WebSocket (this repo, V2 server).
- `trojan-ws` = Trojan over plain WebSocket (this repo).
- Byte layouts use `||` for concatenation. Multi-byte integers are big-endian.
- `CRLF` = `0x0D 0x0A`.
