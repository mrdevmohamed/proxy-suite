# 12 — Development

## Scripts

| Command | What it does |
|---------|--------------|
| `bun install` | install `ws` + types |
| `bun run src/index.ts --config <file> [--url]` | start server / print client URL |
| `bun run --watch src/index.ts --config <file>` | dev with restart |
| `bun test` (`bun run test`) | 49 tests |
| `npx tsc --noEmit` (`bun run build`) | typecheck only (`noEmit: true`) |

## Test layout (49 tests)

- `tests/helpers.ts` — free-port picker, echo server with socket tracking,
  `buildVlessHeader` / `buildTrojanHeader` (IPv4/domain/IPv6, custom cmd/atyp),
  `waitForOpen`, `collectMessages`, `waitForCloseOrError`, `closeWs`,
  `rawUpgradeHead` (raw HTTP Upgrade assertion without WS-client quirks).
- `tests/config.test.ts` — validation boundaries (`1`/`65535` ok; `0`/`65536`/
  fractions rejected), URL format + encoding round-trips, on-disk configs.
- `tests/vless.test.ts` — `parseVless` unit cases + integration (health/404,
  wrong-path no-101, IPv4/domain echo, split-frame buffering, `INVALID_UUID`,
  unreachable → `GENERAL`).
- `tests/trojan.test.ts` — `sha224` vector + `parseTrojanRequest` cases +
  integration (health/404, wrong-path, IPv4/domain echo, bad password closes).

Test hygiene that matters here:

- Every test uses `getFreePort()` (parallel-safe across files).
- `trackWs()` installs a permanent no-op `error` listener so Node never throws
  “unhandled error” between specific waiters.
- `afterEach`: `closeWs` clients → proxy `close()` (≤3 s timeout) → echo `close()`.

## TypeScript notes

`noUncheckedIndexedAccess` is on: every `buf[i]` is `number | undefined`.
Follow the established pattern — explicit `=== undefined` guard that throws
(or returns `errorCode: GENERAL` in `parseVless`), never a bare `!`.

`start*` functions resolve `{ httpServer, wss, close }` (not `void`) so tests can
shut down cleanly. `src/index.ts` ignores the return value — safe. `src/index.ts`
gates `main()` behind `if (import.meta.main)` so tests can import
`validateConfig` / `generate*URL` without side effects.

## Adding a new protocol (checklist)

1. Create `servers/<proto>-ws.ts` exporting `start<Proto>WebSocket(config)` with
   the same `{ httpServer, wss, close }` contract + tracked `clients`/`remotes`.
2. Export pure `parse*` / hash helpers for unit tests.
3. Extend `ServerConfig` + `validateConfig` + `generateClientURL` in `src/index.ts`.
4. Add `configs/<proto>-01.json` example.
5. Add `tests/<proto>.test.ts` + builders in `tests/helpers.ts`.
6. Document in `docs/` (spec + diagram) and link from `00-index.md`.
7. Green gate: `bun test` + `npx tsc --noEmit`.
