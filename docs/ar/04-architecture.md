# 04 — البنية المعمارية

## المكونات

```mermaid
flowchart LR
    subgraph ClientSide[Client]
        C[V2Ray / v2rayNG / Nekoray / Streisand]
    end
    subgraph Edge[TLS edge - not in repo]
        RP[Nginx / Caddy<br/>:443 wss -> plain ws]
    end
    subgraph Proxy[proxy-suite - one process per config]
        CLI[src/index.ts<br/>validate + --url / start]
        HTTP[node:http<br/>/health + upgrade router]
        WSS[ws WebSocketServer<br/>noServer, 16 MB maxPayload]
        AUTH[VLESS parse / Trojan parse<br/>timingSafeEqual]
        DIAL[net.createConnection<br/>VLESS 10 s timeout]
    end
    subgraph Target[Destination]
        T[TCP host:port<br/>echo / web / ssh ...]
    end
    C -->|wss path| RP -->|ws path| HTTP --> WSS --> AUTH --> DIAL --> T
    T -->|bytes| DIAL -->|ws frames| WSS --> C
```

## دورة حياة الطلب (مشتركة)

```mermaid
sequenceDiagram
    participant C as Client
    participant H as node:http
    participant W as ws Server
    participant A as Auth / Parse
    participant T as TCP target
    C->>H: GET /path + Upgrade: websocket
    alt pathname != websocket.path
        H->>C: destroy socket (no response)
    else pathname ok
        H->>W: handleUpgrade -> connection
        C->>W: first binary frame (handshake + optional payload)
        W->>A: parse + verify secret
        alt invalid
            A->>W: VLESS: [version, code] then close<br/>Trojan: close
            W->>C: error reply (VLESS only) + close
        else valid
            W->>T: net.createConnection(host, port)
            alt dial fails
                T-->>W: ECONNREFUSED / timeout
                W->>C: VLESS: [version, 0x01] then close<br/>Trojan: close
            else dial ok
                W->>C: VLESS: [version, 0x00]
                par relay
                    C->>W: binary frames
                    W->>T: socket.write
                and
                    T->>W: data
                    W->>C: ws.send
                end
            end
        end
    end
```

## تدفق VLESS-WS (تفصيلي)

```mermaid
sequenceDiagram
    participant C as Client
    participant S as VLESS-WS V2
    participant T as TCP
    C->>S: WS open /vless-ws
    C->>S: [ver|uuid16|addonsLen|addons|cmd|port|atyp|addr|payload]
    Note over S: buffer until complete;<br/>cap 4096 B; timingSafeEqual UUID
    alt UUID bad
        S->>C: [ver, 0x03] + close
    else cmd != 0x01
        S->>C: [ver, 0x02] + close
    else ok
        S->>T: connect(host, port) 10 s timeout
        alt fail
            S->>C: [ver, 0x01] + close
        else ok
            S->>C: [ver, 0x00]
            S->>T: write(initial payload if any)
            loop relay
                C->>S: ws frame
                S->>T: write
                T->>S: data
                S->>C: ws.send
            end
        end
    end
```

## تدفق Trojan-WS (تفصيلي)

```mermaid
sequenceDiagram
    participant C as Client
    participant S as Trojan-WS
    participant T as TCP
    C->>S: WS open /trojan-ws
    C->>S: [SHA224(pass) 56B|CRLF|0x01|atyp|addr|port|CRLF|payload]
    Note over S: timingSafeEqual(hash);<br/>CMD must be 0x01
    alt hash / CRLF / SOCKS bad
        S->>C: close (no reply)
    else ok
        S->>T: connect(host, port)
        alt fail
            S->>C: close
        else ok
            S->>T: write(initial payload if any)
            loop relay
                C->>S: ws frame
                S->>T: write
                T->>S: data
                S->>C: ws.send
            end
        end
    end
```

## الإغلاق والتنظيف

دوال `start*` تُرجع `{ httpServer, wss, close }`. وتقوم `close()` بما يلي:

1. `ws.terminate()` لكل عميل متتبَّع، و`destroy()` لكل مقبس TCP متتبَّع.
2. `wss.close()‎`.
3. `httpServer.closeAllConnections?.()‎` (حيث توفرت).
4. انتظار `httpServer.close()`.

تعتمد الاختبارات على هذا الترتيب: إغلاق عملاء WS أولًا، ثم البروكسي، ثم خادم
الصدى (انظر `closeWs` و`startEchoServer` في `tests/helpers.ts`).
