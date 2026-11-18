# 🤖 بوت لعبة آخر حرف العربية (Telegram + Cloudflare)

بوت مجموعات تيليغرام: تسجيل بزر، ترتيب عشوائي، 15 ثانية للدور، 3 حيوات، إقصاء عند نفاد الحيوات، وفائز أخير، و10 نقاط للفائز تُضاف لرصيده الدائم. لكل مجموعة حالة منفصلة مخزنة في Durable Object (SQLite) مع Alarm يتابع انتهاء الوقت ولو لم تصل أي رسالة.

الإنتاج يستخدم [@EndToStartBot](https://t.me/EndToStartBot). لتحديث البوت الحالي، اتبع [خطوات تحديث الإنتاج](#8-تحديث-endtostartbot-في-الإنتاج). الأقسام 1 إلى 5 خاصة بالإعداد لأول مرة.

## 1) أنشئ البوت

1. افتح https://t.me/BotFather ثم `/newbot` وحدد اسمًا واسم مستخدم ينتهي بـ `bot`.
2. احتفظ بـ **Token** سرّيًا.
3. من BotFather استخدم `/setprivacy`، اختر البوت ثم **Disable** لكي يستقبل الكلمات العادية داخل المجموعات. إذا كان مضافًا مسبقًا للمجموعة، أخرجه وأعد إضافته.
4. أضفه إلى مجموعتك؛ يفضّل منحه حق إرسال الرسائل.

## 2) تجهيز الكمبيوتر

- أنشئ حساب Cloudflare مجاني: https://dash.cloudflare.com/sign-up
- ثبّت Node.js الإصدار LTS من https://nodejs.org/ (لا حاجة إلى VPS).
- فك ضغط هذا المشروع وافتح الطرفية داخل مجلد `arabic-last-letter-bot`.

## 3) تثبيت ونشر

```bash
npm install
npx wrangler login
npm run deploy
```

سيظهر رابط مثل `https://arabic-last-letter-game.YOUR-SUBDOMAIN.workers.dev`؛ احتفظ به. أول نشر ينشئ Durable Object بتخزين SQLite عن طريق migration في ملف `wrangler.toml`.

## 4) حفظ الأسرار (لا تضعهما في ملفات الكود أو GitHub)

```bash
npx wrangler secret put BOT_TOKEN
npx wrangler secret put WEBHOOK_SECRET
```

الأول: Token من BotFather. الثاني: اختر سرًا عشوائيًا يحتوي على حروف إنجليزية وأرقام و `_` أو `-` فقط (مثل قيمة من 32 خانة، لا تستعمل قيمة المثال). انسخ السر عند إنشائه لتستخدمه في خطوة الربط.

> تأكّد من أن الرابط أعلاه أصبح يعمل بعد نشر الكود. افتحه في المتصفح؛ المفترض أن يظهر `Arabic last-letter game bot is running ✅`.

## 5) تفعيل Telegram Webhook

شغّل في طرفية Bash على جهازك. استبدل القيم بين علامتي الاقتباس:

```bash
read -rsp 'BOT_TOKEN: ' BOT_TOKEN; echo
read -rsp 'WEBHOOK_SECRET: ' WEBHOOK_SECRET; echo
read -rp 'Worker URL (https://...workers.dev): ' WORKER_URL
curl -sS -X POST "https://api.telegram.org/bot${BOT_TOKEN}/setWebhook" \
  --data-urlencode "url=${WORKER_URL%/}/webhook" \
  --data-urlencode "secret_token=${WEBHOOK_SECRET}" \
  --data-urlencode 'allowed_updates=["message","callback_query"]'
unset BOT_TOKEN WEBHOOK_SECRET
```

إذا رأيت `"ok":true` تم طلب الربط بنجاح. لا تشارك Token أو رابط يحتوي عليه، وإذا انكشف استخدم BotFather لإلغائه وإنشاء Token جديد.

## 6) أوامر المجموعة

| الأمر | الوظيفة |
|---|---|
| `/start` | يفتح التسجيل 120 ثانية ويسجل صاحب الجولة تلقائيًا |
| `/mypoints` | يعرض رصيدك المحفوظ وعدد مرات فوزك |
| `/leaderboard` | يعرض أعلى 20 لاعبًا في المجموعة |
| `/help` | يعرض الأوامر وطريقة اللعب |

يمكن لجميع الأعضاء فتح التسجيل والانضمام واستخدام أوامر النقاط والمساعدة في أي مجموعة أُضيف إليها البوت.
يبدأ صاحب الجولة أو مشرف المجموعة الجولة مبكرًا بالضغط على زر «بدء الجولة» بعد تسجيل لاعبين على الأقل.
تستمر الأوامر القديمة `/game` و`/points` و`/playerpointendtostartgame` و`/top` و`/rules` في العمل،
وكذلك `/cancelgame` و`/players` و`/status`. يوجّه `/startgame` إلى الزر.

في الخاص، يعرض `/start` رسالة ترحيب، ويعرض `/help` طريقة اللعب.
يعرض `/mypoints` نقاطك وعدد مرات فوزك لكل مجموعة مرتبطة بحسابك على حدة.
يُحفظ الربط عند فتح التسجيل أو الانضمام. لإظهار رصيد قديم، اكتب `/mypoints` مرة واحدة في كل مجموعة
لديك فيها رصيد ثم أعد طلبه في الخاص. لا يوجد فهرس سابق يتيح اكتشاف جميع المجموعات القديمة تلقائيًا.
إذا تجاوز عدد المجموعات 20، اكتب مثلًا `/mypoints 2` لعرض الصفحة التالية.

اضغط «انضمام للجولة» للمشاركة. بعد 120 ثانية، تبدأ الجولة تلقائيًا إذا انضم لاعبان على الأقل، وإلا يُلغى التسجيل. يبدأ اللعب بترتيب عشوائي. امنح البوت صلاحية مشرف إذا أردت أن يعتمد على التحقق من أدوار مشرفي المجموعة عبر Telegram.

### تسجيل قائمة أوامر EndToStartBot بعد النشر

بعد اكتمال النشر، شغّل الأوامر التالية مرة واحدة من Git Bash أو Bash محليًا داخل مجلد المشروع. أدخل رمز البوت عند المطالبة به. الإدخال مخفي ويُمرَّر للعملية فقط.

```bash
(
  set +x
  read -rsp 'BOT_TOKEN: ' BOT_TOKEN && printf '\n' || exit 1
  export BOT_TOKEN
  npm run register-commands
)
```

يتحقق السكربت من هوية EndToStartBot ويحدّث قوائم أوامر المجموعات ومشرفي المجموعات والمحادثات الخاصة عبر `setMyCommands`. إعادة تشغيله تعطي القائمة نفسها. قوائم Telegram المخصصة لمجموعة أو لغة قد تُعرض بأولوية أعلى. احتفظ بالرمز بعيدًا عن ملفات GitHub وسجل الطرفية.

- أول لاعب يكتب **أي كلمة عربية**، ثم التالي يكتب كلمة تبدأ بآخر حرف من السابقة.
- تُقبل كلمة واحدة من 2 إلى 24 حرفًا دون أرقام أو مسافات.
- لا تُحسب الكلمة المستعملة سابقًا، ولا الكلمات التي تبدأ بحرف خاطئ؛ يستطيع اللاعب التصحيح ضمن الوقت المتبقي.
- عند انتهاء **15 ثانية**، يخسر اللاعب حياة؛ عند نفاد 3 حيوات يُقصى. تستمر اللعبة حتى يبقى لاعب واحد.
- في التعامل مع الحروف يُوحَّد `أ إ آ` إلى `ا`، و`ة` إلى `ه`، و`ى` إلى `ي`، وتُحذف التشكيلات.
- **تنبيه مهم:** البوت يراقب الحروف والتكرار فقط، ولا يستطيع التأكد أن الكلمة موجودة فعلًا في المعجم العربي. التحقق اللغوي الحقيقي يحتاج قاموسًا لاحقًا.
- الفائز الوحيد في نهاية الجولة يحصل على **10 نقاط**، وتُضاف تلقائيًا لرصيده الدائم؛ لا توجد نقاط لمجرد المشاركة.
- كل لاعب لديه رصيد مستقل يبدأ بـ **0**، مرتبط بـ **Telegram user ID** (وليس اسم المستخدم القابل للتغيير).
- رصيد النقاط والفوز يبقيان محفوظين عند بدء أو إلغاء جولة جديدة، وبعد إعادة تشغيل Worker أو نشره من جديد ضمن مساحة التخزين نفسها.
- الجوائز تُمنح مرة واحدة لكل جولة من خلال معرف فريد ومعاملة تخزين ذرية؛ يتم حفظ آخر 1000 حدث جائزة للربط المستقبلي.
- النقاط محليّة داخل هذا البوت والمجموعة؛ **لا تُضاف تلقائيًا لرصيد بوت صديقك** إلا بعد إنجاز الربط بين النظامين.
- التصدير الخارجي للرصيد معطّل افتراضيًا. راجع ملف `INTEGRATION.md` عندما تقرر ربطه مع بوت صديقك.

## 7) تجربة سريعة

1. أضف البوت إلى مجموعة.
2. أرسل `/start` في المجموعة.
3. اضغط من حساب ثانٍ على زر الانضمام.
4. يضغط صاحب الجولة على «بدء الجولة».
5. اللاعب الأول يكتب `كتاب`، فيطلب البوت من اللاعب التالي كلمة تبدأ بـ`ب` مثل `بحر`.
6. اترك دور أحد اللاعبين بلا جواب: بعد ~15 ثانية يتلقى إشعار خسارة حياة، ثم ينتقل الدور.

## مشاكل متكررة

- **لا يرد على كلمات المجموعة:** تعطيل Privacy Mode في BotFather، ثم أعد إضافة البوت للمجموعة.
- **404 عند فتح `/webhook` في المتصفح:** طبيعي؛ المسار يقبل POST مع التحقق من التوقيع السري فقط. اختبر `/` بدلًا منه.
- **لا تصل رسائل:** تحقق من إعداد webhook، Token، و`WEBHOOK_SECRET`، وشاهد سجل التشغيل بـ `npx wrangler tail`.
- **مهلة الدور ليست بالثانية الدقيقة:** Alarms تُشغَّل تقريبًا في الوقت المطلوب، لكن الشبكة والتشغيل قد يؤخران الإعلان قليلًا. أي إجابة متأخرة حسب توقيت الخادم تُرفض وتُحسب مهلة الدور.
- **تجاوز الاستخدام المجاني:** انتبه لحدود Cloudflare Free الحالية؛ لا توجد كفالة تشغيل غير محدود.

المراجع: https://developers.cloudflare.com/durable-objects/ و https://developers.cloudflare.com/durable-objects/api/alarms/ و https://core.telegram.org/bots/api

## 8) تحديث EndToStartBot في الإنتاج

1. شغّل `npm run check` و`npm test` قبل الدمج. استخدم Worker الإنتاج الحالي
   `arabic-last-letter-game` مع ربط `GAMES` وصنف `WordGame` وترحيل `v1` الحالي.
2. أبقِ رابط Webhook الحالي وإعدادَي `BOT_TOKEN` و`WEBHOOK_SECRET`.
   تعمل اللعبة في كل مجموعة أُضيف إليها البوت دون إعداد إضافي لاعتماد المجموعات.
3. بعد النشر، حدّث قوائم الأوامر باستخدام `npm run register-commands` كما هو موضح أعلاه.
   إذا بقيت قائمة قديمة مخصصة لمجموعة أو لغة، احذفها باستخدام `deleteMyCommands` بالنطاق واللغة نفسيهما.
4. تحقّق من `/start` و`/mypoints` في الخاص، ثم اطلب رصيدًا محفوظًا سابقًا في المجموعة وتحقّق من ظهوره في الخاص. جرّب بدء جولة في المجموعة. يمكن تجربة الانضمام في مجموعة أخرى أيضًا.

أوامر تعديل النقاط `/addpoints` و`/removepoints` و`/setpoints` و`/resetpoints` معطّلة.
يحصل الفائز على نقاطه تلقائيًا عند انتهاء الجولة.

## 9) اختبارات محلية

```bash
npm test
```

تغطي الاختبارات التسجيل والأوامر، المهل وقواعد الكلمات، أشكال الفرص، منح 10 نقاط مرة واحدة، وتوافق الأرصدة المخزنة. تحاكي الاختبارات واجهة Telegram محليًا.

## 10) Private owner setup and release checks

This update uses the existing production Worker `arabic-last-letter-game`, `GAMES` binding,
`WordGame` class, migration `v1`, and numeric group chat IDs. The directory and owner sessions
use separate object names in the same binding. Balances remain under the group's existing
`scores` key. No data migration is required.

### Enable private administration (temporary username-based setup)

For this temporary setup, only Telegram accounts whose current **usernames** match
`@mefxyou`, `@Am23zu8`, or `@i_lovezizi` (case-insensitive) can use
`/managepoints` in a private conversation with @EndToStartBot. No
`POINTS_OWNER_IDS`, `ADMIN_USER_IDS`, or `APPROVED_GROUP_IDS` setup is required for
this feature; `POINTS_OWNER_IDS` is ignored by this temporary version.

**Security caveat:** Telegram usernames can be changed or reassigned. If one of
these usernames is transferred to another account, that account will inherit
points-management access. This is not suitable for long-term authorization or
sensitive/high-value operations. Switch to verified numeric Telegram user IDs
before relying on it for production security.

An owner types `/managepoints` in private. To make an older group appear in the
selector, have someone issue `/leaderboard` in that group first. The private
menu allows adjusting one player's points at a time, requires confirmation,
and writes an audit record; resetting points can optionally reset wins too.

Ordinary group play is not restricted to these three owners. This change does
not register `/managepoints` in the general command menus, and does not affect
Cloudflare deployment or webhook configuration.

A historical player who has no private association should run `/mypoints` once in each group
with saved scores and then retry in private. This works without starting a new round or
changing the balance. If an old group is inaccessible or its Telegram chat ID changed, the
bot cannot reconstruct its former chat ID or associate those scores automatically.

### Verify the production release

- Before merging, run `npm test` and `npm run check`. Keep the existing main-branch
  Cloudflare deployment connected to the production Worker. Compare its dashboard bindings
  with `wrangler.toml` and confirm that `GAMES` targets the existing `WordGame` namespace.
- After the approved merge deploys, check the Worker root for its health response. In an
  authorized Telegram Bot API session, call `getMe` and `getWebhookInfo` using the production
  token. Confirm the bot is @EndToStartBot, the URL is the existing Worker URL followed by
  `/webhook`, and the webhook receives `message` and `callback_query` updates. If there is an
  explicit allowlist, both must be present. Telegram does not return the webhook secret.
  Verify it by sending commands and tapping an inline button successfully. Keep the token
  out of shared logs. These checks do not require re-registering the webhook.
- Run `npm run register-commands` with the production token after deployment. The script
  replaces the group, group-administrator, and private lists and deletes the obsolete
  default list. Telegram cannot enumerate other configured scope/language pairs. If you
  know of old overrides, supply the exact pairs using `OBSOLETE_COMMAND_SCOPES`, for
  example `'[{"scope":{"type":"all_private_chats"},"language_code":"ar"}]'`.
- For a player with an existing record, compare group and private `/mypoints`, including
  another group if available. Try `/managepoints` as a regular account and as a verified
  owner. Use a disposable player score for a confirmed adjustment, repeat the confirmation,
  and check `/mypoints` and `/leaderboard`. Open and play an ordinary group round.
