# 07 — مواصفة Trojan (كما هي منفذة)

يخفي Trojan حركة البروكسي كأنها HTTPS: يثبت العميل معرفته بكلمة المرور بإرسال
بصمتها SHA-224، متبوعة بطلب وجهة شبيه بـSOCKS5. والمراقب السلبي بدون كلمة المرور
يرى TLS نحو خادم HTTPS عادي المظهر.

> النطاق: `servers/trojan-ws.ts` — مصافحة Trojan فوق WebSocket عادي، وأمر TCP
> ‏CONNECT فقط. لا UDP ولا خادم ويب بديل ولا TLS داخل العملية.

## الطلب (عميل ← خادم، أول إطار WS ثنائي)

```
password_hash : ‏56 بايت ASCII hex ‏(SHA224(password) بأحرف صغيرة)
CRLF          : بايتان            (‏0x0D 0x0A)
CMD           : بايت واحد          (‏0x01 للـTCP CONNECT — الوحيد المدعوم)
ATYP          : بايت واحد          (‏0x01 للـIPv4 | ‏0x03 للنطاق | ‏0x04 للـIPv6) ※ بترقيم SOCKS
ADDR          : متغير             (انظر أدناه)
PORT          : بايتان big-endian
CRLF          : بايتان            (‏0x0D 0x0A — يُستهلك إن وُجد)
payload       : الباقي            (أول بايتات التطبيق)
```

على السلك:

```
hex(SHA224(pass)) || CRLF || CMD || ATYP || ADDR || PORT16 || CRLF || payload
```

الأدنى: `56+2 = 58` بايتًا قبل بدء تحليل SOCKS؛ والأقصر → `Trojan header
is incomplete` مع إغلاق.

※ يعيد Trojan استخدام **قيم atyp الخاصة بـSOCKS5** (`0x01/0x03/0x04`) خلافًا لـVLESS
(`0x01/0x02/0x03`). وخلطهما هو أشهر أخطاء التوافق.

## ترميز العنوان

| `ATYP` | البنية |
|--------|--------|
| `0x01` ‏IPv4 | ‏4 بايتات |
| `0x03` نطاق | بايت طول + بايتات النطاق |
| `0x04` ‏IPv6 | ‏16 بايتًا |
| غيره | `Unsupported address type: <n>` مع إغلاق |

## خطوات التحقق (بالترتيب)

1. `data.length >= 58` وإلا غير مكتمل.
2. `timingSafeEqual(receivedHash, sha224(password))` وإلا `Invalid Trojan password`.
3. `data[56]==0x0D && data[57]==0x0A` وإلا `Missing CRLF after password`.
4. `CMD == 0x01` وإلا `Only TCP CONNECT is supported`.
5. تحليل `ATYP/ADDR/PORT` مع فحوص الحدود (`Invalid IPv4/domain/IPv6` و
   `Missing destination port`).
6. استهلاك `CRLF` اللاحق اختياريًا.
7. `net.createConnection(host, port)`؛ وعند النجاح تُمرَّر الحمولة الأولية.

**لا يوجد رد نجاح** (خلاف VLESS). فأول بايتات يستلمها العميل هي رد الوجهة. وأي
فشل ← سجل (`[TROJAN] ...`) + إغلاق.

## مثال عملي

كلمة المرور `my-secret-password` ← SHA224
`866bd66ce80404beda1284ea558299900a4ec71a9b1882d6be4e582f`.
الوجهة `127.0.0.1:9001` ‏(`0x2329`) والحمولة `"Hi"`:

```
38 36 36 62 ... 38 32 66   # ‏56 حرف hex بصيغة ASCII
0D 0A                       # ‏CRLF
01                          # ‏CMD CONNECT
01 7F 00 00 01              # ‏ATYP للـIPv4 ‏+ 127.0.0.1
23 29                       # المنفذ 9001
0D 0A                       # ‏CRLF
48 69                       # "Hi"
```

الباني: `buildTrojanHeader("my-secret-password", "127.0.0.1", 9001, "Hi")`.

## ملاحظات سلوكية

- **البصمة:** `crypto.createHash("sha224").update(password).digest("hex")` ‏(56 حرفًا).
  وتُقارن مع `timingSafeEqual` على مخازن UTF-8 (مع فحص الطول).
- **التمرير:** مطابق لـVLESS بعد الاتصال — إطارات العميل ← `remote.write`
  وبيانات `remote` ← `ws.send`؛ و`end`/`close`/`error` في أي جهة ← تنظيف
  (مُحصّن بعلم `closed` ضد التكرار).
- **الإطارات النصية تُتجاهل**؛ والرسائل بعد الإغلاق تُتجاهل.
- **حدود WS:** ‏`maxPayload: 16 MB`؛ ومطابقة `websocket.path` تامة وإلا تدمير.
- **سجل بدء التشغيل** يطبع `Password SHA224` (مفيد للتنقيح، **لا تعرضه**
  في سجلات الإنتاج — فمن يملك البصمة ينتحل العميل).

## رابط العميل (هذا المشروع)

```
trojan://<password-مشفرة>@<server.host>:<port>?type=ws&host=<server.host>&path=<path-مشفر>&security=none#<name-مشفر>
```

الحقل `security=none` يعكس WS العادي داخل العملية. وخلف حافة TLS يستخدم العملاء
`security=tls`.

## المخطط

انظر [04-البنية](./04-architecture.md). والفرق الجوهري عن VLESS: لا رد من بايتين —
فالصمت يعني إما «جارٍ الاتصال» أو «فشل».
