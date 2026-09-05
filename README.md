# proxy-suite

Minimal VLESS-over-WebSocket and Trojan-over-WebSocket proxy servers, written in TypeScript and run with [Bun](https://bun.com).

- **Transports:** plain WebSocket (`ws`, no TLS — put behind Nginx/Caddy for `wss`)
- **Protocols:** `vless-ws` (V2 implementation in `servers/vless-ws-V2.ts`), `trojan-ws`
- **Runtime:** Bun 1.4+, Node-compatible (`node:http`, `node:net`)
- **Tests:** 49 tests with `bun test` · **Typecheck:** `tsc --noEmit`

Full documentation lives in [`docs/`](./docs/00-index.md). Start with [Quickstart](./docs/02-quickstart.md).

```bash
bun install
bun run src/index.ts --config configs/server-01.json --url   # print client URL
bun run src/index.ts --config configs/server-01.json         # start server
bun test              # run tests
npx tsc --noEmit      # typecheck (also `bun run build`)
```

Example client URLs produced by `--url`:

```
vless://00000000-0000-4000-8000-000000000001@192.168.1.250:8080?encryption=none&security=none&type=ws&host=192.168.1.250&path=%2Fvless-ws#server-01
trojan://my-secret-password@192.168.1.250:8081?type=ws&host=192.168.1.250&path=%2Ftrojan-ws&security=none#trojan-01
```
