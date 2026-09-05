# 03 — Configuration

One JSON file selects one server. Fields:

```jsonc
{
  "name": "server-01",        // required, used in logs/health/URL fragment
  "type": "vless-ws",         // required: "vless-ws" | "trojan-ws"

  "server": {                 // required for --url; public address clients use
    "host": "192.168.1.250"
  },

  "listen": {                 // required
    "host": "0.0.0.0",        // required, bind address
    "port": 8080              // required, integer 1..65535
  },

  "websocket": {              // required for both types
    "path": "/vless-ws"       // required, exact match on upgrade URL pathname
  },

  "vless": {                  // required when type = vless-ws
    "uuid": "00000000-0000-4000-8000-000000000001"  // required, RFC-4122 form
  },

  "trojan": {                 // required when type = trojan-ws
    "password": "my-secret-password"               // required, non-empty
  }
}
```

## Validation (`validateConfig` in `src/index.ts`)

- `name`, `type`, `listen`, `listen.host` required.
- `listen.port` must be an integer in `1..65535` (boundaries `1` and `65535` pass).
- `vless-ws`: requires `websocket`, `vless`, and a valid UUID
  (`/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`).
- `trojan-ws`: requires `websocket`, `trojan`, and a non-empty `password`.
- Anything else → `Unsupported server type: <type>`.

URL generation additionally requires `server.host` (`Config requires server.host`)
and `websocket.path` (`websocket.path is required`).

## Examples

`configs/server-01.json` (VLESS, `:8080`, `/vless-ws`) and
`configs/trojan-01.json` (Trojan, `:8081`, `/trojan-ws`) are the canonical examples.
Copy one per instance and change `name`, `listen.port`, `websocket.path`, and the
secret (`vless.uuid` / `trojan.password`).

## Operational tips

- Use a distinct `websocket.path` per instance (e.g. `/vless-ws`, `/trojan-ws`).
  The upgrade handler does an **exact pathname match**; anything else gets its
  socket destroyed (no HTTP response).
- `server.host` should be the public hostname/IP behind your reverse proxy, not
  necessarily the bind address.
- Generate a random UUID per VLESS server: `bun -e 'console.log(crypto.randomUUID())'`.
- Generate a long random Trojan password (32+ chars) and rotate it like any secret.
