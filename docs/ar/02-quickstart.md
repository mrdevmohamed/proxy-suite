# 02 — البدء السريع

## المتطلبات

- Bun 1.4+ ‏(`bun --version`)
- لا اعتماديات أخرى (`ws` تُثبّت عبر `bun install`)

## التثبيت والتحقق

```bash
bun install
bun test                  # ‏49 اختبارًا في ~0.2 ثانية
npx tsc --noEmit          # فحص الأنواع (نفسه `bun run build`)
```

## تشغيل خادم

```bash
# ‏VLESS على 0.0.0.0:8080 بالمسار /vless-ws
bun run src/index.ts --config configs/server-01.json

# ‏Trojan على 0.0.0.0:8081 بالمسار /trojan-ws
bun run src/index.ts --config configs/trojan-01.json

# وضع المراقبة
bun run --watch src/index.ts --config configs/server-01.json
```

خرج بدء التشغيل المتوقع (VLESS):

```
========================================
              PROXY SUITE
========================================
Server : server-01
Type   : vless-ws
Listen : 0.0.0.0:8080
Path   : /vless-ws
========================================

Listening on 0.0.0.0:8080
WebSocket path: /vless-ws
```

## طباعة رابط العميل (بدون بدء الخادم)

```bash
bun run src/index.ts --config configs/server-01.json --url
bun run src/index.ts --config configs/trojan-01.json --url
```

شكل رابط VLESS:

```
vless://<uuid>@<server.host>:<listen.port>?encryption=none&security=none&type=ws&host=<server.host>&path=%2Fvless-ws#<name>
```

شكل رابط Trojan:

```
trojan://<password-مشفّرة>@<server.host>:<listen.port>?type=ws&host=<server.host>&path=%2Ftrojan-ws&security=none#<name>
```

ملاحظات:

- `server.host` هو العنوان **العام** الذي يتصل به العملاء؛ و`listen` هو الربط المحلي.
- `security=none` لأن هذا المشروع يقدّم WS عاديًا. وخلف بروكسي عكسي TLS
  يستخدم العملاء `security=tls` مع المنفذ 443 — بينما البروكسي نفسه يرى WS عاديًا.
- `--help` / `-h` يطبع الاستخدام.

## فحص الصحة

```bash
curl http://127.0.0.1:8080/health
# {"status":"ok","server":"server-01","type":"vless-ws"}
curl -i http://127.0.0.1:8080/nope   # ‏404 Not Found
```

## اختبار دخاني للبروكسي (صدى ذهاب وعودة)

```bash
# 1. شغّل هدف TCP صدى
bun -e 'import net from "node:net"; net.createServer(s=>s.on("data",d=>s.write(d))).listen(9001,"127.0.0.1",()=>console.log("echo :9001"))' &
# 2. شغّل البروكسي (عدّل الإعداد ليستمع على 127.0.0.1 للاختبار المحلي)
# 3. اتصل بعميل VLESS/Trojan إلى 127.0.0.1:<proxy-port><path> واطلب 127.0.0.1:9001
#    ثم أرسل بايتات وتوقع عودتها نفسها.
```

النسخة المؤتمتة من هذا موجودة في `tests/vless.test.ts` و`tests/trojan.test.ts`
(خادم صدى + عميل `ws` + بانو الهيدرات في `tests/helpers.ts`).
