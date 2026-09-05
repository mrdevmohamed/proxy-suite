# 03 — الإعدادات

ملف JSON واحد يختار خادمًا واحدًا. الحقول:

```jsonc
{
  "name": "server-01",        // مطلوب، يُستخدم في السجلات والصحة ومقطع الرابط
  "type": "vless-ws",         // مطلوب: "vless-ws" | "trojan-ws"

  "server": {                 // مطلوب لأمر --url؛ العنوان العام للعملاء
    "host": "192.168.1.250"
  },

  "listen": {                 // مطلوب
    "host": "0.0.0.0",        // مطلوب، عنوان الربط
    "port": 8080              // مطلوب، عدد صحيح 1..65535
  },

  "websocket": {              // مطلوب لكلا النوعين
    "path": "/vless-ws"       // مطلوب، مطابقة تامة لمسار الترقية
  },

  "vless": {                  // مطلوب عندما type = vless-ws
    "uuid": "00000000-0000-4000-8000-000000000001"  // مطلوب بصيغة RFC-4122
  },

  "trojan": {                 // مطلوب عندما type = trojan-ws
    "password": "my-secret-password"               // مطلوب، غير فارغ
  }
}
```

## التحقق (`validateConfig` في `src/index.ts`)

- `name` و`type` و`listen` و`listen.host` مطلوبة.
- `listen.port` يجب أن يكون عددًا صحيحًا بين `1..65535` (الحدّان `1` و`65535` مقبولان).
- `vless-ws`: يتطلب `websocket` و`vless` وUUID صالحًا
  (`/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`).
- `trojan-ws`: يتطلب `websocket` و`trojan` وكلمة مرور غير فارغة.
- أي نوع آخر → `Unsupported server type: <type>`.

توليد الروابط يتطلب أيضًا `server.host ‏(Config requires server.host)`
و`websocket.path ‏(websocket.path is required)`.

## أمثلة

الملفان `configs/server-01.json ‏(VLESS على :8080 بالمسار /vless-ws)` و
`configs/trojan-01.json ‏(Trojan على :8081 بالمسار /trojan-ws)` هما المثالان
المعتمدان. انسخ أحدهما لكل نسخة وغيّر `name` و`listen.port` و`websocket.path`
والسر (`vless.uuid` / `trojan.password`).

## نصائح تشغيلية

- استخدم `websocket.path` مميزًا لكل نسخة (مثل `/vless-ws` و`/trojan-ws`).
  معالج الترقية يجري **مطابقة تامة للمسار**؛ وأي مسار آخر يُدمَّر مقبسه
  (بدون رد HTTP).
- يجب أن يكون `server.host` اسم المضيف/IP العام خلف البروكسي العكسي، وليس
  بالضرورة عنوان الربط.
- ولّد UUID عشوائيًا لكل خادم VLESS ‏(`bun -e 'console.log(crypto.randomUUID())'`).
- ولّد كلمة مرور Trojan طويلة عشوائية (32+ حرفًا) ودوّرها كأي سر.
