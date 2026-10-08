# Бот графіка відключень ДТЕК — бриф для реалізації

Зведення дослідження від 8–9 жовтня 2026. Мета: Telegram-бот, який повідомляє, коли не буде світла за графіком ДТЕК, і сповіщає про зміни графіка. Усе має працювати на безкоштовних сервісах.

> Адреса (населений пункт і вулиця) зберігається тільки в GitHub Secrets `DTEK_CITY`, `DTEK_STREET` і в локальному `.env`, який не комітиться. У коді, JSON і цьому файлі — тільки номер черги.

## 1. Вихідні дані

| Параметр | Значення |
| --- | --- |
| Оператор | ДТЕК Київські регіональні електромережі (Київська область) |
| Сайт | `https://www.dtek-krem.com.ua/ua/shutdowns` |
| Населений пункт | секрет `DTEK_CITY` |
| Вулиця | секрет `DTEK_STREET` |
| Черга | `GPV5.1` (майже всі будинки вулиці; будинок `3` — `GPV6.2`) |
| Часовий пояс | `Europe/Kyiv` |

Чергу винести в конфіг (`DTEK_GROUP=GPV5.1`), щоб її можна було змінити без правок коду.

## 2. Звідки брати дані

Офіційного публічного API у ДТЕК немає. Варіанти, які розглядали:

| Джерело | Статус |
| --- | --- |
| Власний парсер сайту ДТЕК через headless-браузер | **Обрано** |
| `Baskerville42/outage-data-ua` (готові JSON на GitHub) | Не підходить: `kyiv-region.json` востаннє оновлено 2026-08-02, `fact.data` порожній |
| `yaroslav2901/OE_OUTAGE_DATA` | Інші обленерго (Полтава, Львів, Харків тощо), не ДТЕК Київщини |
| API Yasno (`app.yasno.ua/api/blackout-service/public/shutdowns/regions/{id}/dsos/{id}/planned-outages`) | Тільки міста Київ і Дніпро |

Орієнтир для власного парсера — `chaichuk/UA-power-outages-monitor`, функція `getDtekRegionInfo()` у `src/monitor.js`: Playwright відкриває сторінку, бере CSRF-токен і шле POST на `/ua/ajax`.

## 3. Як влаштований сайт ДТЕК

Сайт стоїть за WAF Imperva/Incapsula (IP `45.60.78.78`). Cookies WAF виставляє JavaScript, тому простий HTTP-клієнт (curl, Guzzle) замість сторінки зазвичай отримує заглушку. Потрібен справжній браузер.

### 3.1. Графік: глобальний об'єкт `DisconSchedule` на сторінці

Після завантаження `/ua/shutdowns` у JS доступні `DisconSchedule.fact` і `DisconSchedule.preset`. Перевірено вручну в консолі DevTools.

**`DisconSchedule.fact`** — фактичний графік на сьогодні й завтра:

```json
{
  "data": {
    "1791406800": { "GPV1.1": { "1": "no", "2": "no", "...": "..." }, "GPV5.1": { "...": "..." } },
    "1791493200": { "...": "..." }
  },
  "update": "08.10.2026 20:42",
  "today": 1791406800
}
```

- Ключ у `data` — unix-час півночі за Києвом. `1791406800` = `2026-10-08T00:00:00+03:00`. Конвертувати в дату тільки в поясі `Europe/Kyiv`: в UTC це ще 7 жовтня, 21:00. Зсув `+03:00` не хардкодити.
- Усередині — 12 черг (`GPV1.1` … `GPV6.2`), у кожній ключі `"1"`…`"24"`. Ключ `"1"` — це 00:00–01:00, `"24"` — 23:00–24:00.
- `update` — версія графіка у форматі `dd.MM.yyyy HH:mm` за Києвом. `today` — ключ сьогоднішнього дня.

**`DisconSchedule.preset`** — тижневий шаблон можливих відключень:

- `data[<черга>][<день тижня 1–7>][<година 1–24>]`, де 1 — понеділок.
- Довідники: `days`, `days_mini`, `sch_names`, `time_zone` (година → `["00-01", "00:00", "01:00"]`), `time_type`.
- `updateFact` — версія.

**Статуси години** (з `preset.time_type`):

| Статус | Значення | Перші 30 хв | Другі 30 хв |
| --- | --- | --- | --- |
| `yes` | Світло є | є | є |
| `no` | Світла немає | немає | немає |
| `first` | Світла не буде перші 30 хв | немає | є |
| `second` | Світла не буде другі 30 хв | є | немає |
| `maybe` | Можливе відключення | можливо | можливо |
| `mfirst` | Можливо не буде перші 30 хв | можливо | є |
| `msecond` | Можливо не буде другі 30 хв | є | можливо |

У `fact` за 8–9 жовтня траплялися тільки `yes`, `no`, `first`, `second`; `maybe`-статуси були лише в `preset`.

### 3.2. AJAX-ендпоінт `/ua/ajax`

```
POST https://www.dtek-krem.com.ua/ua/ajax
Content-Type: application/x-www-form-urlencoded
x-requested-with: XMLHttpRequest
x-csrf-token: <content з <meta name="csrf-token">>
Cookie: <cookies сесії, включно з cookies WAF>
```

Тіло запиту, який шле сайт після вибору вулиці:

```
method=getHomeNum
data[0][name]=city        data[0][value]=<DTEK_CITY>
data[1][name]=street      data[1][value]=<DTEK_STREET>
data[2][name]=updateFact  data[2][value]=08.10.2026 20:42
```

Відповідь — довідник «будинок → черга» для вулиці:

```json
{
  "result": true,
  "data": {
    "43": { "sub_type": "", "start_date": "", "end_date": "", "type": "",
            "sub_type_reason": ["GPV5.1"], "voluntarily": null, "cek": null },
    "3":  { "sub_type_reason": ["GPV6.2"], "...": "..." }
  },
  "showCurOutageParam": true, "showCurSchedule": true, "showTableSchedule": true,
  "showTablePlan": false, "showTableFact": true, "showUserGroup": true,
  "updateTimestamp": "22:33 08.10.2026"
}
```

- `sub_type_reason` — черга будинку.
- `sub_type`, `type`, `start_date`, `end_date` були порожні. Припущення: вони заповнюються, коли за адресою є активне (зокрема аварійне) відключення.

### 3.3. Неперевірені припущення

1. **`updateFact` і ключ `fact` у відповіді.** У моєму запиті `updateFact` збігався з версією на сторінці, і `fact` у відповіді не було. Відкритий парсер шле в `updateFact` поточний час і читає `data.fact.data` з відповіді цього ж запиту. Гіпотеза: сервер повертає `fact`, тільки якщо версія клієнта застаріла. Перевірка: повторити запит зі старою датою в `updateFact`.
2. **Відкритий парсер додає `house`** як `data[2]`, а `updateFact` як `data[3]`. Чи змінює це відповідь — не перевіряли.
3. **WAF і IP дата-центрів.** Раннери GitHub Actions і Cloudflare можуть блокуватися. Це перевіряється першим запуском.

## 4. Архітектура

```
GitHub Actions (cron */10)
  └─ Playwright → dtek-krem.com.ua/ua/shutdowns
       └─ page.evaluate(() => DisconSchedule.fact)
            ├─ розбір GPV5.1 на інтервали
            ├─ порівняння з schedule.json у репозиторії
            ├─ якщо змінилося: коміт schedule.json + sendMessage у Telegram
            └─ якщо ні: нічого

Telegram Serverless (етап 2)
  └─ handlers/message.js: на команду читає schedule.json за raw-посиланням і відповідає
```

Рішення:

- **Парсер — GitHub Actions.** У публічному репозиторії стандартні раннери безкоштовні без ліміту хвилин. У приватному 2000 хв/міс, чого на опитування кожні 10 хвилин не вистачить.
- **Кеш — файл `schedule.json` у репозиторії.** Окрема база не потрібна. Supabase відхилено: безкоштовний проєкт засинає після 7 днів без активності.
- **Сповіщення про зміну шле сам Action** через Bot API одразу після парсингу.
- **Парсинг по вебхуку на кожен запит відхилено:** браузер стартує близько десяти секунд. Бот відповідає з кешу.
- **Telegram Serverless — тільки для команд бота.** Парсер там не запустити: це V8-ізолят без npm-пакетів і файлової системи, код викликається лише на апдейти бота або з Mini App, планувальника в документації немає.
- **Запасний варіант для парсера — Cloudflare Workers + Browser Run:** на безкоштовному плані 10 хвилин браузера на добу, тобто опитування приблизно раз на 30 хвилин.

## 5. Етап 1: парсер на GitHub Actions

### 5.1. Скрипт

Стек: Node.js + Playwright (Chromium).

1. Відкрити `https://www.dtek-krem.com.ua/ua/shutdowns` з `locale: 'uk-UA'` і звичайним User-Agent.
2. Дочекатися появи `window.DisconSchedule` (а не фіксованої паузи).
3. Забрати `DisconSchedule.fact` через `page.evaluate`.
4. Якщо замість сторінки прийшла заглушка WAF або об'єкта немає — завершитися з помилкою і **не чіпати** `schedule.json`. Зробити 3 спроби з паузою.
5. Розібрати чергу з конфігу на інтервали (розділ 5.2).
6. Порівняти з поточним `schedule.json`. Порівнювати інтервали, а не поле `update`: версія може змінитися без змін для моєї черги.
7. Якщо інтервали змінилися — перезаписати файл, закомітити, надіслати повідомлення.

### 5.2. Розбір на інтервали

- Доба = 48 півгодинних слотів. `no` закриває обидва слоти години, `first` — перший, `second` — другий.
- Сусідні слоти без світла зливаються в один інтервал.
- `maybe`, `mfirst`, `msecond` збирати окремо як «можливі» відключення, не змішувати з точними.
- Інтервал, що закінчується о 24:00 і продовжується завтра з 00:00, у повідомленні бажано показувати як один.

### 5.3. Формат `schedule.json`

```json
{
  "group": "GPV5.1",
  "source_update": "08.10.2026 20:42",
  "checked_at": "2026-10-08T20:50:00+03:00",
  "days": [
    { "date": "2026-10-08", "off": ["00:00-00:30", "07:00-14:30", "17:30-21:00"], "maybe": [] },
    { "date": "2026-10-09", "off": ["14:30-18:30"], "maybe": [] }
  ]
}
```

Файл містить уже готові інтервали, щоб логіка статусів жила в одному місці, а бот лише форматував текст. `checked_at` оновлювати тільки разом зі зміною графіка, інакше буде коміт на кожен запуск.

### 5.4. Workflow

Ескіз, не запускався:

```yaml
name: scrape
on:
  schedule:
    - cron: '*/10 * * * *'   # UTC
  workflow_dispatch:
permissions:
  contents: write
concurrency:
  group: scrape
  cancel-in-progress: false
jobs:
  scrape:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: node src/scrape.js
        env:
          DTEK_GROUP: ${{ vars.DTEK_GROUP }}
          TELEGRAM_BOT_TOKEN: ${{ secrets.TELEGRAM_BOT_TOKEN }}
          TELEGRAM_CHAT_ID: ${{ secrets.TELEGRAM_CHAT_ID }}
      - name: Commit schedule.json if changed
        run: |
          git diff --quiet schedule.json && exit 0
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git commit -am "schedule: update"
          git push
```

Особливості `schedule` у GitHub Actions:

- Мінімальний інтервал 5 хвилин, час у UTC, працює лише з гілки за замовчуванням.
- Старт неточний: запуск може затриматися на кілька хвилин або пропуститися.
- У публічному репозиторії scheduled workflow вимикається після 60 днів без активності в репозиторії. Якщо графік довго не змінюється, комітів немає, тому потрібен окремий keepalive (наприклад, щотижневий коміт).
- Точний запуск за потреби: зовнішній планувальник смикає `workflow_dispatch` через GitHub API.

### 5.5. Тест

Фікстура — `fact` для `GPV5.1` за 8–9 жовтня 2026:

```json
{
  "1791406800": {"1":"first","2":"yes","3":"yes","4":"yes","5":"yes","6":"yes","7":"yes","8":"no","9":"no","10":"no","11":"no","12":"no","13":"no","14":"no","15":"first","16":"yes","17":"yes","18":"second","19":"no","20":"no","21":"no","22":"yes","23":"yes","24":"yes"},
  "1791493200": {"1":"yes","2":"yes","3":"yes","4":"yes","5":"yes","6":"yes","7":"yes","8":"yes","9":"yes","10":"yes","11":"yes","12":"yes","13":"yes","14":"yes","15":"second","16":"no","17":"no","18":"no","19":"first","20":"yes","21":"yes","22":"yes","23":"yes","24":"yes"}
}
```

Очікуваний результат (пораховано скриптом):

| Дата | Без світла |
| --- | --- |
| 2026-10-08 | 00:00–00:30, 07:00–14:30, 17:30–21:00 |
| 2026-10-09 | 14:30–18:30 |

## 6. Етап 2: команди бота на Telegram Serverless

Ранній доступ, документація: `https://core.telegram.org/bots/serverless`. Увімкнення: @BotFather → бот → Serverless.

- Проєкт: `npm create @tgcloud/bot <dir>`, деплой `npx tgcloud push`, міграції `npx tgcloud migrate`, тестовий запуск `npx tgcloud run handlers/message '{...}'`.
- Доступні тільки `sdk` (`api`, `db`, `fetch`) і власні модулі в `tgcloud/`. Імпорти відносні, з розширенням `.js`.
- Вебхук платформа налаштовує сама; обробник — `tgcloud/handlers/message.js`.
- Вбудована SQLite (Drizzle-подібний синтаксис, без foreign keys) — для підписників, якщо знадобляться.

Ескіз обробника за документацією, не запускався:

```js
// tgcloud/handlers/message.js
import { api, fetch } from 'sdk';

const URL = 'https://raw.githubusercontent.com/<user>/<repo>/main/schedule.json';

export default async function (message) {
  if (message.text !== '/today') return;

  const res = await fetch(URL);
  if (!res.ok) throw new Error(res.statusText);
  const data = await res.json();

  const today = data.days[0];
  await api.sendMessage({
    chat_id: message.chat.id,
    text: today.off.length
      ? `Сьогодні без світла: ${today.off.join(', ')}`
      : 'Сьогодні відключень за графіком немає',
  });
}
```

Raw-посилання GitHub кешується приблизно на 5 хвилин, тож відповідь може трохи відставати від останнього коміту. Репозиторій має бути публічним, інакше до посилання потрібен токен.

## 7. Обмеження

- **Графік — не факт.** Добові графіки можуть змінюватися багато разів на день за вказівкою Укренерго, а під час аварійних відключень не діють. Бот має стежити за змінами, а не читати графік раз на добу.
- **Аварійні відключення** в `fact` не видно. Можливі джерела: поля `sub_type`/`start_date`/`end_date` у відповіді `getHomeNum` і банер `.m-attention__text` на сторінці (відкритий парсер шукає в ньому слова «екстрені», «аварійні»).
- **Нагадування «за 15 хвилин до відключення»** з cron GitHub ненадійні через затримки старту. Для них потрібен точний планувальник, наприклад Cron Trigger у Cloudflare Worker.

## 8. План

1. Репозиторій, `src/scrape.js`, модуль розбору інтервалів і тест на фікстурі з розділу 5.5.
2. Локальний запуск парсера, перевірка проти сайту.
3. Workflow, перший запуск на GitHub — перевірка, чи пропускає WAF.
4. `sendMessage` при зміні графіка.
5. Keepalive для cron.
6. Перевірка гіпотези про `updateFact` і полів активного відключення.
7. Команди бота на Telegram Serverless.

## 9. Джерела

- [Telegram Serverless](https://core.telegram.org/bots/serverless)
- [chaichuk/UA-power-outages-monitor — monitor.js](https://raw.githubusercontent.com/chaichuk/UA-power-outages-monitor/main/src/monitor.js)
- [DeepWiki: DTEK Website Scraping](https://deepwiki.com/chaichuk/UA-power-outages-monitor/2.2-dtek-website-scraping)
- [DeepWiki: Data Sources](https://deepwiki.com/chaichuk/UA-power-outages-monitor/1.2-data-sources)
- [Baskerville42/outage-data-ua](https://github.com/Baskerville42/outage-data-ua)
- [DOU: сервіс з графіками відключень світла](https://dou.ua/forums/topic/57751/)
- [GitHub Actions pricing 2026](https://cicdpipelinecost.com/github-actions-pricing)
- [GitHub Docs: scheduled workflows і ліміти](https://docs.github.com/en/enterprise-server@3.8/actions/learn-github-actions/usage-limits-billing-and-administration)
- [Cloudflare Browser Rendering changelog](https://developers.cloudflare.com/changelog/product/browser-rendering)
- [Supabase free tier limits](https://automationatlas.io/answers/supabase-free-tier-limits-2026/)
- [The Page: голова YASNO про графіки відключень](https://thepage.ua/ua/news/golova-yasno-nagadav-yak-rozumiti-grafiki-vidklyuchen)
