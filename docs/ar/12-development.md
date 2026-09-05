# 12 — التطوير

## السكربتات

| الأمر | ماذا يفعل |
|-------|------------|
| `bun install` | تثبيت `ws` والأنواع |
| `bun run src/index.ts --config <file> [--url]` | بدء الخادم / طباعة رابط العميل |
| `bun run --watch src/index.ts --config <file>` | تطوير مع إعادة التشغيل |
| `bun test` ‏(`bun run test`) | ‏49 اختبارًا |
| `npx tsc --noEmit` ‏(`bun run build`) | فحص الأنواع فقط (`noEmit: true`) |

## بنية الاختبارات (49 اختبارًا)

- `tests/helpers.ts` — منتقٍ للمنافذ الحرة، خادم صدى مع تتبع المقابس،
  بانيا `buildVlessHeader` / `buildTrojanHeader` ‏(IPv4/نطاق/IPv6 وأوامر وأنواع
  مخصصة)، و`waitForOpen` و`collectMessages` و`waitForCloseOrError` و`closeWs`
  و`rawUpgradeHead` (تأكيد ترقية HTTP خام بدون مراوغات عميل WS).
- `tests/config.test.ts` — حدود التحقق (`1`/`65535` مقبولان؛ و`0`/`65536`/
  الكسور مرفوضة)، وصيغة الروابط + رحلات الترميز ذهابًا وعودة، وإعدادات القرص.
- `tests/vless.test.ts` — حالات `parseVless` الوحدوية + التكامل (الصحة/404
  والمسار الخاطئ بلا 101 وصدى IPv4/النطاق والتخزين عبر إطارين و`INVALID_UUID`
  والهدف المتعذر ← `GENERAL`).
- `tests/trojan.test.ts` — متجه `sha224` + حالات `parseTrojanRequest` +
  التكامل (الصحة/404 والمسار الخاطئ وصدى IPv4/النطاق وكلمة المرور السيئة تغلق).

النظافة الاختبارية المهمة هنا:

- كل اختبار يستخدم `getFreePort()` (آمن للتوازي عبر الملفات).
- يثبّت `trackWs()` مستمع `error` دائمًا لا-عمل لمنع رمي Node لـ«خطأ غير معالَج»
  بين المنتظرين المحددين.
- `afterEach`: إغلاق عملاء WS ← إغلاق البروكسي (مهلة ≤3 ثوانٍ) ← إغلاق الصدى.

## ملاحظات TypeScript

الخيار `noUncheckedIndexedAccess` مفعّل: فكل `buf[i]` من نوع `number | undefined`.
اتبع النمط المعتمد — حراسة صريحة `=== undefined` ترمي (أو تعيد `errorCode: GENERAL`
في `parseVless`) ولا تستخدم `!` عارية.

دوال `start*` تحل `{ httpServer, wss, close }` (وليست `void`) ليتسنى إغلاق نظيف
في الاختبارات. ويتجاهل `src/index.ts` القيمة المرجعة — وهو آمن. ويحرس
`src/index.ts` الدالة `main()` خلف `if (import.meta.main)` لتستورد الاختبارات
`validateConfig` / `generate*URL` بدون آثار جانبية.

## إضافة بروتوكول جديد (قائمة)

1. أنشئ `servers/<proto>-ws.ts` يصدّر `start<Proto>WebSocket(config)` بنفس عقد
   `{ httpServer, wss, close }` مع تتبع `clients`/`remotes`.
2. صدّر مساعدي `parse*` / البصمات الخالصة لاختبارات الوحدة.
3. وسّع `ServerConfig` و`validateConfig` و`generateClientURL` في `src/index.ts`.
4. أضف مثال `configs/<proto>-01.json`.
5. أضف `tests/<proto>.test.ts` والبانين في `tests/helpers.ts`.
6. وثّق في `docs/` (المواصفة + المخطط) واربط من `00-index.md` (والمرآة العربية).
7. البوابة الخضراء: `bun test` + ‏`npx tsc --noEmit`.
