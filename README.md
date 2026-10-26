# 🇺🇦 Power Outages Monitor (Data Aggregator)

Цей проєкт є агрегатором даних про графіки відключень електроенергії в Україні. Він збирає дані з різних джерел (сайти DTEK, API YASNO, офіційні JSON від обленерго) та нормалізує їх у єдиний формат для подальшого використання (наприклад, для Home Assistant інтеграції [svitlo_live](https://github.com/chaichuk/svitlo_live) та Cloudflare Workers).

## 🌍 Підтримувані Регіони та Джерела

Скрипт збирає дані для **15 областей** та **2 міст**:

### 🏢 DTEK (Офіційний сайт)
- Київська область
- Одеська область
- Дніпропетровська область

### 💡 YASNO (API)
- м. Київ
- м. Дніпро (ДнЕМ)
- м. Дніпро (ЦЕК)

### 📂 GitHub / Обленерго (JSON)
- Львівська область
- Полтавська область
- Черкаська область
- Чернігівська область
- Харківська область
- Хмельницька область
- Івано-Франківська область
- Рівненська область
- Тернопільська область
- Закарпатська область
- Запорізька область
- Житомирська область
- Чернівецька область (Telegram web)

## 🛡️ Відмовостійкість (Hybrid Failover Architecture)

1. **Основний парсер (Primary)**: Працює на локальному домашньому сервері (NUC / Home Assistant Addon) кожні 5 хвилин. Використовує домашній український IP, що мінімізує ризики WAF-блокувань від ДТЕК.
2. **Хмарний резерв (Standby Failover)**: Воркфлоу GitHub Actions запускається кожні 15 хвилин:
   - Перевіряє час останнього коміту `artifacts/last-message.json` (`scripts/check-failover.js`).
   - Якщо NUC оновлював дані < 20 хвилин тому — GitHub Actions одразу засинає (Standby, ~3 сек виконання).
   - Якщо NUC вимкнувся або зник інтернет (> 20 хв) — хмара автоматично перехоплює керування, піднімає Playwright і оновлює графіки для користувачів `svitlo_live`.

## 🛠 Як це працює

1. **Scraping**: Скрипт (`src/monitor.js`) запускається локально або через GitHub Actions Failover.
2. **Data Collection**:
   - Використовує **Playwright** для парсингу сайтів DTEK (обхід захисту, перевірка Emergency режимів) та Telegram каналу Чернівців.
   - Використовує `fetch` для отримання даних від Yasno та JSON-файлів обленерго.
3. **Normalization**: Всі дані приводяться до єдиного формату ("Svitlo Format").
4. **Aggregation**: Дані об'єднуються в один JSON-пакет (`artifacts/last-message.json`).
5. **Distribution**: Підсумковий JSON зберігається в репозиторії та відправляється на налаштований Cloudflare Worker.

## 🚀 Запуск та Налаштування

### Вимоги
- Node.js (v22+)
- `npm`

### Встановлення

```bash
npm install
npx playwright install chromium
```

### Налаштування (.env)

Створіть файл `.env` із наступними змінними:

```env
# Для парсингу DTEK (адреси для перевірки графіків)
# (Можна залишити порожнім, якщо не використовуєте DTEK регіони)
CITY_KYIV=Київ
STREET_KYIV=Хрещатик
HOUSE_KYIV=1

CITY_ODESA=Одеса
STREET_ODESA=Дерибасівська
HOUSE_ODESA=1

CITY_DNIPRO=Дніпро
STREET_DNIPRO=Яворницького
HOUSE_DNIPRO=1

# Cloudflare Worker (куди відправляти результат)
CF_WORKER_URL=https://your-worker.workers.dev
CF_WORKER_TOKEN=your-upload-token
```

### Запуск

```bash
# Разовий запуск
npm start

# Режим розробки (watch)
npm run watch

# Перевірка статусу Failover (перевіряє чи живий NUC)
node ./scripts/check-failover.js
```

## 📜 Ліцензія

MIT
