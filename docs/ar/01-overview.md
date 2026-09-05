# 01 — نظرة عامة

**proxy-suite** يشغّل خادم بروكسي واحدًا في كل عملية، يُختار عبر ملف إعداد JSON:

```
bun run src/index.ts --config <file> [--url]
```

## ماذا يفعل

- يقبل اتصالات WebSocket على مسار `websocket.path` واحد.
- يوثّق أول إطار WS ثنائي (binary) كبروتوكول **VLESS** أو **Trojan**.
- يفتح اتصال TCP خامًا (`node:net`) نحو `host:port` المطلوب.
- يمرّر البايتات باتجاهين: `WS <-> TCP`.
- يوفّر `GET /health` → `{"status":"ok","server":...,"type":...}`؛ وأي مسار آخر → `404`.
- يطبع رابط عميل جاهزًا للاستيراد مع `--url` (لا يبدأ الخادم في هذا الوضع).

## ماذا لا يفعل

- لا يوجد إنهاء TLS (يقدّم `ws://` عاديًا؛ أنهِ TLS في Nginx/Caddy/Traefik للحصول على `wss://`).
- لا يوجد ترحيل UDP (بروتوكول VLESS `0x02` مرفوض صراحة؛ وTrojan يدعم `CONNECT 0x01` فقط).
- لا يوجد تعدد إرسال (multiplexing) ولا قواعد توجيه ولا إحصاءات ولا واجهة إدارة.
- لا يوجد خادما VMess / Shadowsocks (موثقان في [08](./08-vmess.md) و[09](./09-shadowsocks.md) للمرجع فقط).

## بنية المستودع

```
proxy-suite/
├── src/index.ts            # سطر الأوامر: --config/--url/--help والتحقق وتوليد الروابط
├── servers/
│   ├── vless-ws-V2.ts      # خادم VLESS-WS النشط (يستخدمه src/index.ts)
│   ├── vless-ws.ts         # خادم VLESS-WS القديم V1 (للمرجع، مشمول في الفحص)
│   └── trojan-ws.ts        # خادم Trojan-WS
├── configs/
│   ├── server-01.json      # مثال vless-ws ‏(0.0.0.0:8080، /vless-ws)
│   └── trojan-01.json      # مثال trojan-ws ‏(0.0.0.0:8081، /trojan-ws)
├── tests/
│   ├── helpers.ts          # منافذ حرة، خادم صدى، بانو الهيدرات، مساعدات WS
│   ├── config.test.ts      # التحقق + توليد الروابط (18 اختبارًا)
│   ├── vless.test.ts       # وحدة + تكامل VLESS ‏(17 اختبارًا)
│   └── trojan.test.ts      # وحدة + تكامل Trojan ‏(14 اختبارًا)
├── docs/                   # التوثيق الإنجليزي
├── docs/ar/                # هذه النسخة العربية
├── package.json            # السكربتات: start/dev/build‎(tsc)‎/test‎(bun test)‎
└── tsconfig.json           # صارم + noUncheckedIndexedAccess ويشمل src/servers/tests
```

## حقائق تنفيذية أساسية

| المجال | VLESS-WS ‏(V2) | Trojan-WS |
|--------|----------------|-----------|
| نقطة الدخول | `startVlessWebSocket(config)` | `startTrojanWebSocket(config)` |
| القيمة المرجعة | `{ httpServer, wss, close }` ‏(ينتظر `listen`) | نفس الشيء |
| مكتبة WS | `ws` مع `noServer: true` و`maxPayload: 16 MB` | نفس الشيء |
| التوثيق | بايتات UUID مع `timingSafeEqual` | `SHA224(password)` بنظام hex مع `timingSafeEqual` |
| سقف الهيدر | `MAX_HEADER_SIZE = 4096` | ضمني (يحلل أول إطار) |
| الاتصال TCP | `net.createConnection` مع **مهلة 10 ثوانٍ** | بدون مهلة (يعتمد على النظام) |
| إشارة النجاح | رد WS من بايتين `[version, 0x00]` | لا يوجد (يبدأ التمرير فورًا) |
| إشارة الخطأ | رد WS من بايتين `[version, code]` ثم إغلاق | إغلاق بدون رد |
| الهيدر المجزأ | يُجمّع عبر الإطارات حتى يكتمل | يتوقع الهيدر كاملًا في الإطار الأول |
| السجلات | `[CONNECT] host:port` و`[TCP] ...` و`[VLESS] ...` | `[TROJAN] host:port` و`[TCP] ...` و`[WS] ...` |

الملف V1 ‏(`servers/vless-ws.ts`) يختلف في نقطة مهمة: يحاول تحليل أول مقطع فورًا
ويغلق عند `VLESS header is incomplete`، فالهيدر المجزأ عبر إطارات WS يفشل. أما V2
فيعيد `null` للبيانات الناقصة وينتظر — لهذا يستورد `src/index.ts` النسخة V2.
