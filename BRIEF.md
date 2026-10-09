# Бот графіка відключень ДТЕК — бриф для реалізації

Зведення дослідження від 8–9 жовтня 2026, оновлене 9 жовтня за результатами пунктів 1–5 плану. Мета: Telegram-бот, який повідомляє, коли не буде світла за графіком ДТЕК, і сповіщає про зміни графіка. Усе має працювати на безкоштовних сервісах.

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

Черга задається секретом `DTEK_GROUP` (локально — у `.env`), щоб її можна було змінити без правок коду. Без нього парсер бере `GPV5.1`.

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

Тіло запиту, який шле сайт після вибору вулиці (`$('#discon_form').serializeArray()`: поля `city`, `street`, `house_num`, `updateFact`, неактивні поля не надсилаються):

```
method=getHomeNum
data[0][name]=city        data[0][value]=<DTEK_CITY>
data[1][name]=street      data[1][value]=<DTEK_STREET>
data[2][name]=updateFact  data[2][value]=08.10.2026 20:42
```

Відповідь — довідник «будинок → черга» для всієї вулиці:

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

- `sub_type_reason` — черга будинку. Буває кілька черг: у вибірці 9 жовтня (48 вулиць Фастова, Обухова, Бучі, Боярки, Ірпеня, Вишневого; 3237 будинків) дві черги мали 1371 будинок, жодної — 148.
- Якщо в `getHomeNum` прийшов `fact`, сайт підміняє ним `DisconSchedule.fact` і `preset` (розділ 3.3).

**Поля активного відключення** (логіка з `DisconSchedule.alertMessageBlock`):

| Поле | Значення |
| --- | --- |
| `sub_type`, `start_date`, `end_date` порожні | За адресою зараз відключення немає |
| `type: "1"` | Сайт пише «планові ремонтні роботи», з часом початку й орієнтовним відновленням |
| `type: "2"` | Причина — текст `sub_type` |
| `start_date`, `end_date` | Формат `HH:mm dd.MM.yyyy` за Києвом; `end_date` — орієнтовний час відновлення |
| `voluntarily` | Адресу обслуговує ОСББ/ЖЕК, графік сайт не показує |
| `cek` | Замість графіка — окремий текст (`getCekText`) |

Значення `sub_type`, що траплялися 9 жовтня в тій самій вибірці (448 будинків з активним відключенням):

| `type` | `sub_type` | Будинків |
| --- | --- | --- |
| `1` | Профілактичні роботи для підвищення надійності мережі | 6 |
| `2` | Аварійні ремонтні роботи | 391 |
| `2` | Екстренні відключення (Аварійне без застосування графіку погодинних відключень) | 48 |
| `2` | Стабілізаційне відключення (Згідно графіку погодинних відключень) | 3 |

Для «Екстренні відключення (Аварійне без застосування…)» сайт додає, що графіки стабілізаційних відключень не діють.

**Метод `checkDisconUpdate`** — легка перевірка версії, сторінка шле його кожні 5 хвилин:

```
method=checkDisconUpdate
update=<DisconSchedule.fact.update>
```

Версія збігається — відповідь `{"result": false}`. Не збігається — `{"result": true, "fact": …, "preset": …, "showTableSchedule": …, "showUserGroup": …}`.

### 3.3. Припущення та їх перевірка

1. **`updateFact` і ключ `fact` у відповіді — підтверджено 9 жовтня.** Сервер повертає `fact` і `preset`, лише коли `updateFact` не збігається з поточною версією, причому і для старішої, і для «майбутньої» дати. Без `updateFact` або з поточною версією їх немає. Повернутий `fact` збігається з `DisconSchedule.fact` на сторінці. Тому відкритий парсер, що шле поточний час, завжди отримує `fact`.
2. **`house` у запиті — не впливає.** З `house_num` і без нього `data` однакова: сервер завжди віддає всі будинки вулиці. Потрібний будинок вибирається на клієнті за ключем.
3. **WAF і IP дата-центрів.** Перевірено 9 жовтня: з домашньої IP сторінка відкривається з першої спроби навіть із User-Agent `HeadlessChrome`. На GitHub Actions перший запуск отримав порожню сторінку без `DisconSchedule` у всіх 3 спробах, наступні 9 пройшли з першої спроби. Блокування залежить від раннера, постійного бану IP GitHub немає. Cloudflare не перевіряли.

## 4. Архітектура

```
cron-job.org (кожні 10 хв)
  └─ POST api.github.com/.../actions/workflows/scrape.yml/dispatches
       └─ GitHub Actions: workflow scrape
            └─ Playwright → dtek-krem.com.ua/ua/shutdowns
                 └─ page.evaluate(() => DisconSchedule.fact)
                      ├─ розбір черги DTEK_GROUP на інтервали
                      ├─ порівняння з schedule.json у репозиторії
                      ├─ новий день або змінені інтервали: sendMessage у Telegram, коміт schedule.json
                      ├─ зник лише минулий день: коміт schedule.json без повідомлення
                      └─ без змін: нічого

Telegram Serverless (етап 2)
  └─ handlers/message.js: на команду читає schedule.json за raw-посиланням і відповідає
```

Рішення:

- **Парсер — GitHub Actions.** У публічному репозиторії стандартні раннери безкоштовні без ліміту хвилин. У приватному 2000 хв/міс, чого на опитування кожні 10 хвилин не вистачить. Один запуск триває близько 35 секунд, з них парсер — 5.
- **Запуск — cron-job.org через `workflow_dispatch`, а не `schedule`.** Cron GitHub для нового репозиторію за 12 годин дав 2 запуски замість ~70: заплановані запуски GitHub виконує за можливістю й під навантаженням відкидає. Workflow без `schedule` до того ж не підпадає під автовимкнення через 60 днів неактивності, тому окремий keepalive не потрібен.
- **Кеш — файл `schedule.json` у репозиторії.** Окрема база не потрібна. Supabase відхилено: безкоштовний проєкт засинає після 7 днів без активності.
- **Сповіщення про зміну шле сам Action** через Bot API одразу після парсингу.
- **Парсинг по вебхуку на кожен запит відхилено:** браузер стартує близько десяти секунд. Бот відповідає з кешу.
- **Telegram Serverless — тільки для команд бота.** Парсер там не запустити: це V8-ізолят без npm-пакетів і файлової системи, код викликається лише на апдейти бота або з Mini App, планувальника в документації немає.
- **Запасний варіант для парсера — Cloudflare Workers + Browser Run:** на безкоштовному плані 10 хвилин браузера на добу, тобто опитування приблизно раз на 30 хвилин.

## 5. Етап 1: парсер на GitHub Actions

### 5.1. Скрипт

Стек: Node.js + Playwright (Chromium).

Реалізовано в `src/scrape.js`, розбір — у `src/schedule.js`, текст повідомлення — у `src/message.js`.

1. Відкрити `https://www.dtek-krem.com.ua/ua/shutdowns` з `locale: 'uk-UA'` і звичайним User-Agent (версія береться з Chromium, `HeadlessChrome` замінюється на `Chrome`).
2. Дочекатися появи `DisconSchedule.fact.data` (а не фіксованої паузи).
3. Забрати `DisconSchedule.fact` через `page.evaluate`.
4. Якщо замість сторінки прийшла заглушка WAF або об'єкта немає — завершитися з помилкою і **не чіпати** `schedule.json`. 3 спроби з паузою 10 с; у помилці — HTTP-статус і початок HTML.
5. Розібрати чергу з конфігу на інтервали (розділ 5.2). Невідомий статус, неповна доба чи відсутня черга — помилка.
6. Порівняти з поточним `schedule.json`. Порівнювати інтервали, а не поле `update`: версія може змінитися без змін для моєї черги (9 жовтня так було тричі).
7. Повідомлення надсилати, лише якщо з'явився новий день або змінилися інтервали наявного. Опівночі ДТЕК прибирає вчорашній день — тоді файл оновлюється без повідомлення.
8. Спершу повідомлення, потім запис файлу: якщо Telegram не відповів, запуск падає, і наступний спробує ще раз.

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

### 5.4. Workflow і запуск

Workflow — `.github/workflows/scrape.yml`. Відмінності від первинного ескізу:

- Тригери: `workflow_dispatch` (cron-job.org і ручний запуск) і `push` у `src/`, `package*.json` чи сам workflow — щоб перевіряти зміни парсера одразу. Коміти бота з `GITHUB_TOKEN` нових запусків не створюють.
- `runs-on: ubuntu-24.04`, а не `ubuntu-latest`: з 19.10.2026 це Ubuntu 26, і `playwright install --with-deps` може її ще не підтримувати.
- Node 24 (Node 20 знято з підтримки у квітні 2026), `actions/checkout@v7`, `actions/setup-node@v7`.
- `npx playwright install --with-deps --only-shell chromium` — лише headless shell, без повного Chromium.
- Перед `git diff` — `git add schedule.json`, інакше новий, ще не відстежуваний файл не потрапить у коміт. Перед `push` — `git pull --rebase`.
- Секрети: `DTEK_GROUP`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`. Без Telegram-секретів надсилання пропускається з попередженням.

Задача на cron-job.org (кожні 10 хвилин):

```
POST https://api.github.com/repos/tucocsa/friendly-hora/actions/workflows/scrape.yml/dispatches
Authorization: Bearer <fine-grained токен tucocsa: тільки цей репозиторій, Actions — Read and write>
Accept: application/vnd.github+json
Content-Type: application/json

{"ref":"main"}
```

Успішна відповідь — `204`. Коли токен закінчиться, cron-job.org надішле листа про невдалі запуски.

Чому не `schedule` у GitHub Actions:

- Запуски за можливістю: під навантаженням затримуються на години або губляться. Тут — 2 із ~70 за 12 годин.
- У публічному репозиторії scheduled workflow мовчки вимикається після 60 днів без активності. Чи рахуються коміти бота як активність, GitHub не уточнює.
- Автоматичні порожні коміти як keepalive відхилено: найпопулярніший такий action (`gautamkrishnar/keepalive-workflow`) GitHub заблокував за порушення умов.

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

У реалізації день шукати за датою (`days.find(d => d.date === сьогодні за Києвом)`), а не брати `days[0]`: одразу після півночі файл ще може містити вчорашній день.

## 7. Обмеження

- **Графік — не факт.** Добові графіки можуть змінюватися багато разів на день за вказівкою Укренерго, а під час аварійних відключень не діють. Бот має стежити за змінами, а не читати графік раз на добу.
- **Аварійні відключення** в `fact` не видно. Джерела: поля активного відключення будинку у відповіді `getHomeNum` (розділ 3.2; потрібні населений пункт, вулиця й номер будинку) і банер `.m-attention__text` на сторінці (загальний текст про райони, напр. 9 жовтня — аварійні відключення у Фастівському, Обухівському й Бучанському районах).
- **Активне відключення за адресою не можна публікувати в репозиторії.** Точні `start_date`/`end_date` разом із чергою дозволяють перебрати `getHomeNum` по вулицях і знайти будинок. Такі дані — лише в Telegram; якщо для захисту від повторних повідомлень потрібен стан у `schedule.json`, то лише HMAC із секретним ключем, а не самі значення чи простий хеш.
- **Нагадування «за 15 хвилин до відключення».** Cron GitHub для них непридатний. Запуски від cron-job.org щодесять хвилин достатньо точні, тож кожен запуск може перевіряти, чи не починається відключення в найближчі 10–20 хвилин; потрібен захист від повторних нагадувань.
- **Умови GitHub Actions.** Вони забороняють на раннерах GitHub «будь-яку іншу діяльність, не пов'язану з виробництвом, тестуванням, розгортанням чи публікацією програмного проєкту». Регулярний парсер зі сповіщеннями — сіра зона: так роблять часто, навантаження мале (~35 с кожні 10 хв). Якщо GitHub обмежить Actions, запасні варіанти — Cloudflare (розділ 4) або домашній комп'ютер.

## 8. План

1. ✅ Репозиторій, `src/scrape.js`, модуль розбору інтервалів і тест на фікстурі з розділу 5.5.
2. ✅ Локальний запуск парсера, перевірка проти сайту.
3. ✅ Workflow, перший запуск на GitHub — перевірка, чи пропускає WAF.
4. ✅ `sendMessage` при зміні графіка.
5. ✅ Запуск кожні 10 хвилин: замість keepalive для cron — cron-job.org і `workflow_dispatch` (розділ 5.4).
6. ✅ Перевірка гіпотези про `updateFact` і полів активного відключення (розділи 3.2–3.3).
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
- [GitHub Docs: вимкнення workflow через 60 днів неактивності](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/disable-and-enable-workflows)
- [GitHub Docs: затримки й пропуски scheduled-запусків](https://docs.github.com/en/enterprise-cloud@latest/actions/monitoring-and-troubleshooting-workflows/troubleshooting-workflows/about-troubleshooting-workflows)
- [GitHub Community: scheduled workflow затримується на 8–14 годин](https://github.com/orgs/community/discussions/185355)
- [Умови GitHub для Actions](https://docs.github.com/en/site-policy/github-terms/github-terms-for-additional-products-and-features)
- [Дзеркало keepalive-workflow з приміткою про блокування](https://gitea.com/sekedus/keepalive-workflow)
- [cron-job.org](https://cron-job.org)
- [Cloudflare Browser Rendering changelog](https://developers.cloudflare.com/changelog/product/browser-rendering)
- [Supabase free tier limits](https://automationatlas.io/answers/supabase-free-tier-limits-2026/)
- [The Page: голова YASNO про графіки відключень](https://thepage.ua/ua/news/golova-yasno-nagadav-yak-rozumiti-grafiki-vidklyuchen)
