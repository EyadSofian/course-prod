# UX Copy — داشبورد إنتاج الكورسات

Copy layer for the Engosoft Course Production Dashboard (spec §8).
Source of truth for every user-facing string. Code keys stay English (`DRAFT`, `SUMMARIZE`);
only labels are localized.

**Context:** internal operator tool, ~10 producers, Arabic-first RTL.
**User state:** running slow, expensive, failure-prone pipelines. They are not delighted —
they are checking whether something broke and whether it cost money.
**Tone:** فصحى بيضاء, flat and factual. No exclamation marks, no encouragement, no personality.

---

## 0. Two decisions that govern everything below

### 0.1 Register: فصحى بيضاء in the UI, not عامية مصرية

The team is Egyptian, so عامية is tempting. Rejected for three reasons:

1. Producers read the tool and the lesson content in the same hour. §14 mandates فصحى بيضاء
   for content; switching register between the tool and the product is friction, and worse,
   it leaks — عامية from a button label ends up in a narration script.
2. Mixed register inside one product is the worst of both. Once one error message says
   "جرّب تاني" and another says "أعد المحاولة", every string becomes a judgment call.
3. Market is EG **and** KSA/GULF (§3 `target_market`). A Gulf hire reads فصحى without friction.

Applies to UI chrome only. Nothing here changes §14.

### 0.2 Western numerals (0–9), everywhere, including inside Arabic sentences

`18 شريحة` — not `١٨ شريحة`. Because:

- Slide IDs are `s01`…`s18`. Arabic-Indic digits in prose next to Latin-digit IDs in the same
  table row is unscannable.
- Costs are USD (`$0.42`), file sizes are `50 MB`, timestamps are `14:32`. All Latin-digit.
- The one surface that keeps Arabic-Indic digits is the §14 prompt body — that is model-facing
  text, a different surface. Do not "harmonize" it with the UI.

---

## 1. Terminology lock

Same term for the same thing on every screen, in every error, in every tooltip. Deviating from
this table is a bug, not a style choice.

| Concept | Locked term | Rejected | Why |
|---|---|---|---|
| Course | **كورس** | مساق، دورة | كورس is what the EG/Gulf training market actually says |
| Lesson | **درس** | حصة، محاضرة | |
| Stage | **مرحلة** | خطوة | خطوة implies the user acts; these run unattended |
| Pipeline | **خط الإنتاج** | — | |
| Deck | **العرض** | البريزنتيشن، الشرائح | الشرائح is the plural of شريحة — keep the two distinct |
| Slide | **شريحة** | سلايد | |
| Narration | **السرد** | التعليق الصوتي، الفويس أوفر | matches `narration` in `lesson_json` |
| Quiz | **الأسئلة** | الاختبار، الكويز | الاختبار implies a graded LMS exam; this is a question bank |
| Source text | **النص المصدر** | المادة الخام | |
| Approve | **اعتماد** | موافقة، تأكيد | اعتماد = editorial sign-off, which is what the gate is |
| Review | **مراجعة** | تدقيق | |
| **Retry** (free) | **إعادة المحاولة** | — | see below |
| **Regenerate** (costs) | **إعادة التوليد** | — | see below |
| Export | **تصدير** | — | |
| Publish | **نشر** | — | |
| Package | **الحزمة** | الباكدج | |
| Budget | **الميزانية** | — | |
| Cost | **التكلفة** | المصروف (totals only) | |
| Credits | **الرصيد** | كريديت | |
| Pronunciation dictionary | **قاموس النطق** | — | |
| Tashkeel | **التشكيل** | التشكيل الانتقائي (the selective kind) | |

### The one pair that must never blur

| | إعادة المحاولة | إعادة التوليد |
|---|---|---|
| Costs money | No | **Yes** |
| When | A stage failed on a retryable error | Output was fine, producer wants different output |
| Button style | Secondary / ghost | Destructive-weight, always behind a confirm |
| Appears on | Failed stages only | Succeeded stages only |

§6.4 names accidental regeneration as the single biggest historical cost leak. This lexical
split is the primary defense — a producer must never have to read a tooltip to know whether
a click spends money. **A stage never shows both buttons at once.**

---

## 2. Stage labels

Nine states from §5, plus two stop states. Each needs four strings: the board column it sits
under, the chip on the card, the line shown while running, and the timeline tooltip.

| State (code) | Chip label | While running | Timeline tooltip |
|---|---|---|---|
| `DRAFT` | مسودة | — | رُفعت المادة ولم يبدأ الاستخراج |
| `INGESTED` | النص جاهز | جارٍ استخراج النص… | استُخرج النص المصدر من الملف المرفوع |
| `SUMMARIZED` | بانتظار المراجعة | جارٍ هيكلة الدرس… | حوّل Claude المادة إلى شرائح وسرد وأسئلة |
| `REVIEWED` | معتمَد | — | راجع منتِج واعتمد الدرس. النسخة مجمّدة |
| `DECK_READY` | العرض جاهز | جارٍ توليد العرض في Dokie… | وُلِّد العرض في Dokie ولم يُصدَّر بعد |
| `DECK_EXPORTED` | الملفات مصدَّرة | جارٍ تصدير العرض… | نُزِّل PPTX وحُوِّل إلى PDF وصور |
| `NARRATED` | السرد جاهز | جارٍ توليد السرد… | مقطع صوتي لكل شريحة |
| `ASSEMBLED` | الفيديو جاهز | جارٍ تجميع الفيديو… | دُمجت الشرائح مع السرد في MP4 |
| `PUBLISHED` | منشور | جارٍ تجهيز الحزمة… | الحزمة جاهزة للتنزيل |
| `FAILED` | متعثّر: {المرحلة} | — | توقّفت المرحلة. راجع السجل |
| `BLOCKED_BUDGET` | موقوف: الميزانية | — | تجاوز التشغيل سقف الميزانية الشهرية |

### Recommendation: name the `SUMMARIZE` stage «هيكلة الدرس», not «تلخيص»

The stage does not produce a summary. It produces a structured lesson — slides, narration,
quiz, objectives. Calling it تلخيص sets producers up to judge the output by "did it summarize
the PDF well" instead of "is the structure right and does the narration read aloud cleanly,"
which is the actual §12 M2 acceptance question. Keep `SUMMARIZE` as the state key in code.

### Recommendation: 8 board columns, not 9

`DECK_READY` and `DECK_EXPORTED` never need separate columns — nobody acts on a deck that is
generated but not exported; it is a 30-second machine transition. Same for `INGESTED`, which
is seconds long. Suggested grouping, columns named by **what is needed next** (standard kanban
practice — a column is a queue, not a past tense):

| Column | Holds | Colour role |
|---|---|---|
| مسودة | `DRAFT` | neutral |
| جارٍ التحضير | `INGESTED`, running summarize | neutral, animated |
| **بانتظار المراجعة** | `SUMMARIZED` | **loudest — this is the human gate** |
| جاهز للإنتاج | `REVIEWED` | teal |
| جارٍ الإنتاج | `DECK_READY`, `DECK_EXPORTED`, `NARRATED` | neutral, animated |
| جاهز للنشر | `ASSEMBLED` | teal |
| منشور | `PUBLISHED` | muted / collapsed by default |
| متوقف | `FAILED`, `BLOCKED_BUDGET` | red / amber, never auto-collapsed |

`بانتظار المراجعة` is the only column where work waits on a human. It should be visually
loudest — §5 says no auto-advance past `REVIEWED`, which means a card parked there stops the
entire pipeline silently. Colour is doing state work here, so pair it with the count in the
header: `بانتظار المراجعة (3)`.

**Per-card copy:** `{title_ar}` / `{course code} · {market}` / cost badge `$1.42` /
relative time `آخر تحديث: منذ 12 دقيقة`.

---

## 3. CTAs

Verb first, outcome matched, never a bare noun.

| Screen | Primary CTA | Notes |
|---|---|---|
| `/lessons/new` | **رفع المادة وبدء الاستخراج** | says both things that happen |
| `/lessons/[id]` (draft) | **هيكلة الدرس** | not "تشغيل" |
| `/lessons/[id]/review` | **اعتماد الدرس** | not "حفظ" — approval is not a save |
| review, non-final | حفظ المسودة | the actual save |
| after approve | **توليد العرض** | |
| deck ready | **تصدير الملفات** | |
| exported | **توليد السرد** | |
| narrated | **تجميع الفيديو** | |
| assembled | **نشر الحزمة** | |
| published | **تنزيل الحزمة الكاملة** | |
| failed stage | إعادة المحاولة | free, secondary weight |
| succeeded stage | إعادة التوليد | costs, always confirmed |
| `/dictionary` | **إضافة مصطلح** | |
| `/settings` | حفظ الإعدادات | |

Secondary / utility: `عرض السجل` · `تنزيل` · `إلغاء` · `رجوع` · `تعديل` · `حذف` ·
`نسخ الرابط` · `عرض الرد الخام`.

---

## 4. Error messages

Structure throughout: **what happened → why → what to do.** Never "حدث خطأ ما".

The `Retry` column is copy-relevant, not just engineering: a **terminal** error must not
render a retry button, and its copy must not imply waiting will help. §9 requires the
distinction; the copy has to express it or the taxonomy is invisible to the user.

### 4.1 Terminal — producer must act

| Trigger | Copy | Retry button |
|---|---|---|
| Claude returned non-schema JSON, repair attempt failed (§6.2) | **فشلت هيكلة الدرس.** ردّ Claude لا يطابق المخطط، وحاولنا إصلاحه مرة واحدة دون نجاح. غالبًا المادة المصدر مشوّشة أو قصيرة. راجع النص المصدر، أو عدّل قالب الهيكلة من الإعدادات، ثم أعد التشغيل. | none — offer `عرض الرد الخام` |
| `narration[].slide_id` mismatch (§4 invariant) | **عدد نصوص السرد لا يطابق عدد الشرائح** — 17 سرد مقابل 18 شريحة. التزامن بين الصوت والشرائح مبني على هذا التطابق، فأُوقفت المرحلة. افتح المراجعة وأضف سردًا للشريحة `s12`، أو احذف الشريحة. | none — `فتح المراجعة` |
| Dokie session invalid (§6.5) | **جلسة Dokie منتهية.** التصدير يحتاج تسجيل دخول صالح، وفشلت محاولة الدخول التلقائية. سجّل الدخول من الإعدادات ← Dokie ثم أعد المحاولة. | after re-login |
| Export controls not found | **لم نعثر على زر التصدير في صفحة Dokie.** الأرجح أنهم غيّروا تصميم الموقع. يحتاج الأمر تحديث `config/dokie-selectors.ts` من الفريق التقني. أُرسل تنبيه على Telegram. | none — `عرض لقطة الشاشة` |
| PNG count ≠ `slides.length` | **نتج 17 صورة من عرض يحتوي 18 شريحة.** هذا الفرق يكسر التزامن، فأُوقفت المرحلة. أعد تصدير العرض؛ إن تكرر، افتح ملف PDF وحدّد الشريحة الناقصة. | `إعادة التصدير` (free) |
| Narration entry over model limit, unsplittable | **نص الشريحة `s07` يتجاوز 3,000 حرف** (حد النموذج `eleven_v3`) ولا يحتوي على نهايات جُمل واضحة لتقسيمه. اختصر النص من المراجعة، أو بدّل إلى `eleven_multilingual_v2` (حد 10,000 حرف) من الإعدادات. | none — `فتح المراجعة` |
| Upload too large | **الملف 68 MB والحد 50 MB.** اضغط الملف أو قسّم المادة إلى دروس أصغر. | — |
| Unsupported type | **صيغة `.pages` غير مدعومة.** المدعوم: PDF، DOCX، PPTX، MD، TXT. | — |

Naming the exact slide (`s12`, `s07`) is the difference between a 30-second fix and a
20-minute hunt through the review editor. Never write "إحدى الشرائح".

### 4.2 Retryable — the system handles it, tell them not to click

| Trigger | Copy |
|---|---|
| 429 from ElevenLabs / Claude | **الخدمة مزدحمة.** سنعيد المحاولة تلقائيًا بعد 30 ثانية. (المحاولة 2 من 3) |
| Network / 5xx | **تعذّر الوصول إلى الخدمة.** سنعيد المحاولة تلقائيًا. (المحاولة 1 من 3) |
| Attempts exhausted | **فشلت المرحلة بعد 3 محاولات.** آخر خطأ: `{message}`. الخدمة قد تكون متوقفة — راجع السجل ثم أعد المحاولة يدويًا. |

"سنعيد المحاولة تلقائيًا" is doing real work: without it the producer clicks retry, and on
a rate-limited endpoint that makes it worse.

### 4.3 Budget block — a policy stop, not a failure

Never styled or worded as an error. Amber, not red. The word خطأ must not appear.

> **موقوف: تجاوز الميزانية**
> تشغيل هذه المرحلة سيرفع مصروف الشهر إلى **$312**، والسقف **$300**.
> ارفع السقف من الإعدادات، أو انتظر بداية الشهر القادم.
> `[رفع السقف]` `[إبقاء التوقف]`

### 4.4 Dokie outline confirmation — an approval, not an error (§6.4)

Neutral / attention tone. This is Dokie asking a question, and the producer is answering it.

> **Dokie يطلب تأكيد المخطط قبل توليد العرض.**
> راجع المخطط أدناه. التأكيد يبدأ التوليد ويستهلك الرصيد.
> `[تأكيد وبدء التوليد]` `[تعديل الرد]`

### 4.5 Warnings — not blocking

| Trigger | Copy |
|---|---|
| Extracted text > 120k chars (§6.1) | **النص المستخرج 143,000 حرف.** فوق 120,000 تقل دقة الهيكلة وترتفع التكلفة. يُفضَّل تقسيم المادة إلى درسين. |
| Budget at 80% | **اقتربت من سقف الميزانية** — $246 من $300 (82%). المراحل المكلفة ستتوقف عند السقف. |
| Slides exceed cap | **الدرس 22 شريحة والحد 18.** احذف 4 شرائح من المراجعة، أو ارفع الحد من الإعدادات قبل توليد العرض. |
| Dictionary substring risk | **«PMP» يظهر داخل «PMBOK» في هذا النص.** الاستبدال يُطبَّق على الكلمات الكاملة فقط، فلن تتأثر «PMBOK». |

---

## 5. Confirmation dialogs

Per §6.4, this is where money is lost. Buttons are labelled with the **action**, never
OK/Cancel, and the destructive side carries the price.

### 5.1 Regenerate deck — the most important dialog in the product

> ### إعادة توليد العرض؟
> سيُستهلك رصيد Dokie من جديد — **18 شريحة، تقدير $0.90**.
> العرض الحالي وملفاته المصدَّرة (PPTX، PDF، 18 صورة) ستُستبدل.
> لا يمكن التراجع عن هذه العملية.
>
> `[إعادة التوليد واستهلاك الرصيد]`  `[إبقاء العرض الحالي]`

The primary button is deliberately long. Friction is the feature. Do not shorten it to
"تأكيد" to fit a layout — widen the dialog.

**Alternatives**

| Option | Primary button | Tone | Best for |
|---|---|---|---|
| A *(recommended)* | `إعادة التوليد واستهلاك الرصيد` | explicit, heavy | default for all regenerations |
| B | `إعادة التوليد — $0.90` | terse, price-forward | if the dialog gets used many times a day and A starts reading as noise |
| C | type `إعادة التوليد` to enable the button | maximum friction | escalation for estimates above a settings threshold |

Start with A. Add C only if a real incident happens — friction added preemptively gets
routed around.

### 5.2 Regenerate all narration

> ### إعادة توليد السرد لكل الشرائح؟
> 18 شريحة، 14,600 حرف — **تقدير $1.46**.
> إن كان التعديل في شريحة واحدة، استخدم `إعادة التوليد` من صف الشريحة نفسها بدل هذا الزر.
>
> `[توليد السرد كاملًا — $1.46]`  `[رجوع]`

That second sentence is the cheapest cost control in the product: it teaches the $0.08 path
at the exact moment of the $1.46 click.

### 5.3 Regenerate one slide's narration

Low stakes, no modal. Inline confirm on the row:

> إعادة توليد سرد `s07`؟ 812 حرف ≈ $0.08. `[توليد]` `[إلغاء]`

### 5.4 Edit an approved lesson (§6.3 freeze)

> ### تعديل درس معتمَد؟
> هذا الدرس معتمَد ونسخته مجمّدة. التعديل ينشئ **نسخة 2**.
> الملفات المُنتَجة بالفعل لن تتغيّر — ستحتاج إلى إعادة توليد ما يعتمد عليها.
>
> `[فتح التعديل وإنشاء نسخة 2]`  `[إبقاء النسخة المعتمدة]`

### 5.5 Delete lesson

> ### حذف درس «إدارة تكامل المشروع»؟
> سيُحذف الدرس و**44 ملفًا منتجًا**: العرض، 18 صورة، 18 مقطعًا صوتيًا، الفيديو، الأسئلة.
> التكلفة المدفوعة **$3.20** لا تُسترد. لا يمكن التراجع.
>
> `[حذف الدرس وملفاته]`  `[الاحتفاظ بالدرس]`

---

## 6. Empty states

What this is → why it's empty → how to start.

| Surface | Copy |
|---|---|
| Board, no lessons | **لا توجد دروس بعد.** ارفع أول مادة علمية لبدء خط الإنتاج. `[رفع مادة جديدة]` |
| Board column empty | *(no text — an empty column is self-evident and text adds noise to a dense board)* |
| Assets panel, pre-production | **لا توجد ملفات بعد.** تظهر هنا بعد اعتماد المراجعة وتوليد العرض. |
| Stage log, not yet run | **لم تُشغَّل هذه المرحلة بعد.** |
| Dictionary, course scope empty | **لا توجد مصطلحات خاصة بهذا الكورس.** المصطلحات العامة (4) تُطبَّق تلقائيًا على كل الدروس. `[إضافة مصطلح لهذا الكورس]` |
| Search, no results | **لا نتائج لـ «{query}».** جرّب اسم الكورس أو كود الدرس. |
| Cost panel, month start | **لا مصروف هذا الشهر بعد.** السقف الحالي $300. |

---

## 7. Loading states

Long-running stages need a time expectation and permission to leave. Silence for 15 minutes
reads as broken, and a producer who thinks it's broken clicks the expensive button.

| Stage | Copy |
|---|---|
| Ingest | جارٍ استخراج النص… |
| Summarize | جارٍ هيكلة الدرس… تستغرق عادةً 40–90 ثانية. |
| Deck generation | **جارٍ توليد العرض في Dokie** — بدأت 14:32. تستغرق عادةً 2–6 دقائق، والحد الأقصى 15 دقيقة. يمكنك مغادرة الصفحة؛ التشغيل مستمر. |
| Export | جارٍ تصدير العرض من Dokie… |
| PDF/PNG conversion | جارٍ تحويل العرض إلى صور… |
| Narration | **جارٍ توليد السرد** — 7 من 18 شريحة. |
| Assemble | **جارٍ تجميع الفيديو** — قد يستغرق 3–8 دقائق حسب طول الدرس. |
| Package | جارٍ تجهيز الحزمة… |

Per-slide progress on narration (`7 من 18`) is not decoration: it is the only signal that
distinguishes a slow run from a hung one on the longest-running billable stage.

---

## 8. Review editor (`/lessons/[id]/review`)

| Element | Copy |
|---|---|
| Left panel | **النص المصدر** · `143,000 حرف` |
| Right panel | **الدرس المُهيكَل** · `18 شريحة · 18 سرد · 10 أسئلة` |
| Approve helper (under CTA) | الاعتماد يجمّد هذه النسخة ويسمح ببدء الإنتاج. لا شيء يعمل تلقائيًا قبله. |
| Reorder notice | إعادة الترتيب تُحدِّث معرّفات الشرائح والسرد المرتبط بها معًا. |
| Unsaved changes | **تعديلات غير محفوظة.** |
| Leave with unsaved | تعديلاتك لم تُحفظ. `[حفظ المسودة]` `[المغادرة دون حفظ]` |
| Version indicator | نسخة 2 · النسخة المعتمدة: 1 `[عرض الفرق]` |

**Inline validation** (§14 rules, surfaced at the field):

- النقطة أطول من 12 كلمة (14).
- الشريحة بها 6 نقاط، والحد 5.
- العنوان أطول من 7 كلمات.
- لا يوجد سرد لهذه الشريحة.
- السؤال `q4` يشير إلى شريحة محذوفة (`s19`).
- هذا السرد يحتوي تشكيلًا. التشكيل يُطبَّق من قاموس النطق، لا من هنا.

That last one enforces §13's "do not auto-diacritize" at the one place a human could break it.

---

## 9. Pronunciation dictionary (`/dictionary`)

| Element | Copy |
|---|---|
| Page intro | يُطبَّق القاموس على نص السرد قبل إرساله إلى ElevenLabs. الاستبدال بالكلمات الكاملة فقط. |
| Columns | المصطلح · البديل · ملاحظة · النطاق · آخر تعديل |
| Scope values | عام (كل الكورسات) · {course title} |
| Preview headers | **قبل** ⟷ **بعد** |
| Char delta, neutral | `+48 حرفًا لكل تشغيل ≈ $0.005` |
| Char delta, tashkeel | التشكيل يضيف 6 أحرف مفوترة لكل ورود. المصطلح يتكرر 12 مرة في هذا الدرس → **+72 حرفًا ≈ $0.007**. |
| Empty replacement | البديل مطلوب. اتركه مطابقًا للمصطلح إن أردت التشكيل فقط. |
| Duplicate term | «PMP» موجود بالفعل في النطاق العام. عدّل المصطلح الحالي بدل إضافة نسخة ثانية. |
| Save toast | حُفظ المصطلح. يُطبَّق على السرد المولَّد بعد الآن — السرد الموجود لا يتغيّر. |

That save toast prevents a specific support question: *"I fixed the pronunciation, why does
the old MP3 still say it wrong?"* §6.6 makes narration per-slide and re-generatable, so the
answer is "regenerate that slide" — say it before they ask.

---

## 10. Cost panel (§7)

| Element | Copy |
|---|---|
| Panel title | التكلفة |
| Rows | `Claude — الهيكلة` · `ElevenLabs — السرد` · `Dokie — الرصيد (تقديري)` |
| Lesson total | إجمالي الدرس |
| Monthly | مصروف الشهر: **$187** من $300 |
| Dokie footnote | تقديري — Dokie لا يوفّر التكلفة الفعلية عبر الـ API. |
| Zero-cost stage | مجانية |

The Dokie footnote is not a disclaimer for its own sake. Without it someone reconciles the
dashboard against the Dokie invoice and loses an hour deciding the numbers are broken.

---

## 11. Toasts

Flat, past tense, no celebration. This is an operator tool (§8: density and legibility beat
decoration) and a producer may see twenty of these a day.

| Event | Copy |
|---|---|
| Approved | تم اعتماد الدرس. |
| Deck ready | العرض جاهز. |
| Export done | نُزِّلت الملفات: PPTX، PDF، 18 صورة. |
| Narration done | السرد جاهز — 18 مقطعًا. |
| Video ready | الفيديو جاهز. |
| Published | نُشرت الحزمة. |
| Settings saved | حُفظت الإعدادات. |
| Link copied | نُسخ الرابط. صالح 24 ساعة. |

That expiry note belongs on the copy action, not in a tooltip — §6.8 signs URLs for 24h and
the person pasting a link into WhatsApp needs to know before they paste, not after it 404s.

---

## 12. Settings (`/settings`)

| Field | Label | Helper |
|---|---|---|
| Summarize model | نموذج الهيكلة | `claude-sonnet-5` افتراضيًا. `claude-opus-5` للمواد فوق 40,000 حرف أو الكثيفة. |
| Dense material | مادة كثيفة | يرفع النموذج إلى `claude-opus-5` لهذا الدرس. تكلفة أعلى، دقة أعلى في المواد المتخصصة. |
| Voice | الصوت | يُطبَّق على الدروس الجديدة. الدروس المولَّدة لا تتغيّر. |
| TTS model | نموذج الصوت | `eleven_v3` (حد 3,000 حرف/طلب) · `eleven_multilingual_v2` (حد 10,000) |
| Slide cap | الحد الأقصى للشرائح | 18 افتراضيًا. الرفع يزيد استهلاك رصيد Dokie لكل عرض. |
| Monthly budget | سقف الميزانية الشهرية | عند بلوغ السقف تتوقف المراحل المكلفة ويُرسل تنبيه على Telegram. |
| Prompt template | قالب الهيكلة | يتجاوز القالب الأساسي في `packages/core/prompts/summarize.ar.md`. `[استعادة القالب الأساسي]` |
| Prompt reset confirm | استعادة القالب الأساسي؟ سيُحذف التعديل المخصص. `[استعادة]` `[إبقاء التعديل]` |
| Dokie session | جلسة Dokie | الحالة: صالحة · آخر فحص 08:00 `[إعادة تسجيل الدخول]` |
| Dokie session dead | **الحالة: منتهية** — التصدير متوقف حتى تسجيل الدخول. |

---

## 13. Auth (§10)

| Element | Copy |
|---|---|
| Page title | تسجيل الدخول |
| Fields | البريد الإلكتروني · كلمة المرور |
| CTA | تسجيل الدخول |
| Wrong credentials | البريد الإلكتروني أو كلمة المرور غير صحيحة. |
| Rate limited | محاولات كثيرة. أعد المحاولة بعد 5 دقائق. |
| Session expired | انتهت الجلسة. سجّل الدخول للمتابعة. |
| No signup | الحسابات يُنشئها المسؤول. تواصل مع مسؤول النظام. |

Never distinguish "unknown email" from "wrong password" — one string for both.

---

## 14. Localization & RTL notes

**Bidi isolation is mandatory, not cosmetic.** Latin-script tokens inside Arabic sentences —
`s01`, `$0.42`, `50 MB`, `PPTX`, `eleven_v3`, `14:32` — will visually reorder next to Arabic
punctuation without isolation. Wrap every one:

```css
.ltr-token { unicode-bidi: isolate; direction: ltr; }
```

Untreated, `أضف سردًا للشريحة s12.` renders the period on the wrong side of `s12` and, worse,
adjacent numbers merge. This is the single most common RTL bug in dashboards like this.

**Keep Latin terms Latin.** Dokie, ElevenLabs, Claude, Telegram, Railway, PPTX, MP4, SRT, PMP,
PMBOK, Agile. Do not transliterate — it matches §14 rule 4, and producers search logs and
Slack for these exact strings. «إليفن لابز» is unsearchable.

**Do not truncate cost-bearing button labels.** `إعادة التوليد واستهلاك الرصيد` is long on
purpose (§5.1). If it overflows, widen the container or wrap to two lines. Never ellipsize a
label whose length is the safety mechanism.

**Arabic runs ~15–25% shorter than English** for equivalent content, so an English port would
need more room, not less — size containers off the English string if one is ever added.

**Stage names appear in three places** — kanban chip, timeline, and Telegram alerts. Alerts
are plain text with no RTL shaping, so lead with the Latin lesson code:
`[pmp-02-integration] فشل التصدير — لم نعثر على زر التصدير في Dokie`

**Pluralization:** Arabic has dual and plural forms and the naive `{n} شريحة` breaks at 2 and
at 3–10. Use: `شريحة واحدة` (1) · `شريحتان` (2) · `3 شرائح` (3–10) · `18 شريحة` (11+).
Same for مقطع/مقطعان/مقاطع and سؤال/سؤالان/أسئلة. Put this in one `pluralAr()` helper — do
not hand-write it at 30 call sites.

---

## 15. Strings that must never ship

| Never | Instead |
|---|---|
| حدث خطأ ما | name the stage and the cause |
| هل أنت متأكد؟ | name the action: `إعادة توليد العرض؟` |
| موافق / إلغاء on a destructive dialog | label both buttons with their action |
| تم بنجاح! 🎉 | flat past tense, no emoji |
| جارٍ التحميل… on a multi-minute stage | name the stage and give a time range |
| «إعادة المحاولة» on a stage that succeeded | that is `إعادة التوليد`, and it costs money |
| «إعادة التوليد» on a stage that failed | that is `إعادة المحاولة`, and it is free |
| a cost figure with no currency | always `$`, always 2 decimals |
