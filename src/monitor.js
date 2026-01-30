import { chromium } from "playwright"
import path from "node:path"
import fs from "node:fs"
import {
  CITY_KYIV, STREET_KYIV, HOUSE_KYIV,
  CITY_ODESA, STREET_ODESA, HOUSE_ODESA,
  CITY_DNIPRO, STREET_DNIPRO, HOUSE_DNIPRO,
  CF_WORKER_URL, CF_WORKER_TOKEN,
  LVIV_JSON_URL,
  POLTAVA_JSON_URL,
  CHERKASY_JSON_URL,
  CHERNIHIV_JSON_URL,
  KHARKIV_JSON_URL,
  KHMELNYTSKYI_JSON_URL,
  IVANO_FRANKIVSK_JSON_URL,
  RIVNE_JSON_URL,
  TERNOPIL_JSON_URL,
  ZAKARPATTIA_JSON_URL,
  ZAPORIZHZHIA_JSON_URL,
  ZHYTOMYR_JSON_URL,
  YASNO_KYIV_URL,
  YASNO_DNIPRO_DNEM_URL,
  YASNO_DNIPRO_CEK_URL,
  CHERNIVTSI_URL
} from "./constants.js"

// --- КОНФІГУРАЦІЯ РЕГІОНІВ (ДТЕК - ОБЛАСТІ) ---
const DTEK_REGIONS = [
  {
    id: "kiivska-oblast",
    url: "https://www.dtek-krem.com.ua/ua/shutdowns",
    city: CITY_KYIV,
    street: STREET_KYIV,
    house: HOUSE_KYIV,
    name_ua: "Київська область",
    name_ru: "Киевская область",
    name_en: "Kyiv Region"
  },
  {
    id: "odeska-oblast",
    url: "https://www.dtek-oem.com.ua/ua/shutdowns",
    city: CITY_ODESA,
    street: STREET_ODESA,
    house: HOUSE_ODESA,
    name_ua: "Одеська область",
    name_ru: "Одесская область",
    name_en: "Odesa Region"
  },
  {
    id: "dnipropetrovska-oblast",
    url: "https://www.dtek-dnem.com.ua/ua/shutdowns",
    city: CITY_DNIPRO,
    street: STREET_DNIPRO,
    house: HOUSE_DNIPRO,
    name_ua: "Дніпропетровська область",
    name_ru: "Днепропетровская область",
    name_en: "Dnipropetrovsk Region"
  }
];

// Допоміжна функція дати
function getKyivDate(offsetDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return date.toLocaleDateString("en-CA", { timeZone: "Europe/Kyiv" });
}

// Функція паузи
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// 1. ДТЕК (Playwright) - ВИПРАВЛЕНА ВЕРСІЯ
async function getDtekRegionInfo(browser, config) {
  if (!config.city || !config.street || !config.house) {
    console.log(`ℹ️ Skipping DTEK ${config.id}: No address configured.`);
    return null;
  }

  const MAX_RETRIES = 3;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    let page = null;
    try {
      console.log(`🌍 Visiting DTEK ${config.id} (Attempt ${attempt}/${MAX_RETRIES})...`);

      const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        locale: 'uk-UA'
      });

      page = await context.newPage();

      // Збільшуємо таймаут навігації до 60 сек
      await page.goto(config.url, { waitUntil: "domcontentloaded", timeout: 60000 });

      // Чекаємо, щоб провантажилися скрипти і можливі поп-апи
      await sleep(5000);

      // --- Перевірка на екстрені відключення (SMART GLOBAL CHECK v2) ---
      const isEmergency = await page.evaluate(() => {
        try {
          // Збираємо текст з: 1) Стандартного банера 2) Модальних вікон (Bootstrap/Popups)
          let fullText = "";

          const attentionBlock = document.querySelector('.m-attention__text');
          if (attentionBlock) fullText += " " + attentionBlock.innerText;

          // 🔥 ШУКАЄМО ТЕКСТ У МОДАЛКАХ (для Одеси та інших)
          const modals = document.querySelectorAll('.modal-content, .popup-content, [role="dialog"], .modal-body');
          modals.forEach(m => {
            // Беремо текст, якщо елемент існує і хоч трохи схожий на видимий
            if (m.innerText) fullText += " " + m.innerText;
          });

          const text = fullText.toLowerCase();

          // Якщо тексту немає - все добре
          if (!text.trim()) return false;

          // 1. Якщо написано "скасовано" або "відновлено" - це не аварія
          if (text.includes("скасовано") || text.includes("відновлено") || text.includes("повертаємось до графіків")) {
            return false;
          }

          // 2. Чи є ключові слова? 
          // Додано "обмеження" для кейсів типу "мережеві обмеження"
          const hasKeywords = text.includes("екстрені") || text.includes("аварійні") || text.includes("обмеження");
          if (!hasKeywords) return false;

          // 3. ФІЛЬТР: Глобально чи локально?
          if (text.includes("укренерго")) return true;

          // Перевірка локальних маркерів
          if (text.includes("районі") || text.includes("громаді") || text.includes("частині") || text.includes("населеному пункті")) {
            // ВИНЯТОК: Якщо згадано обласний центр (наприклад, "в Одеському районі, зокрема в Одесі") - це важливо
            const mentionsMajorCity = text.includes("київ") || text.includes("києв") ||
              text.includes("одес") || text.includes("дніпр");

            if (!mentionsMajorCity) {
              return false; // Це локальна аварія десь в селі, ігноруємо
            }
          }

          // Якщо слів-маркерів локальності немає, а тригери є - вважаємо глобальною
          return true;
        } catch (e) { return false; }
      }).catch(() => false);

      if (isEmergency) {
        console.log(`⚠️ DETECTED GLOBAL EMERGENCY for ${config.id}`);
      }

      // Спроба закрити модалку, щоб вона не блокувала отримання токенів (опціонально)
      try {
        await page.evaluate(() => {
          const closeBtn = document.querySelector('.modal .close, [data-dismiss="modal"], .btn-close');
          if (closeBtn) closeBtn.click();
        });
        await sleep(1000);
      } catch (e) { }

      // Чекаємо на CSRF токен
      const csrfTokenTag = await page.waitForSelector('meta[name="csrf-token"]', { state: "attached", timeout: 15000 });
      const csrfToken = await csrfTokenTag.getAttribute("content");

      // Виконуємо AJAX запит
      const info = await page.evaluate(
        async ({ city, street, house, csrfToken }) => {
          const formData = new URLSearchParams();
          formData.append("method", "getHomeNum");
          formData.append("data[0][name]", "city");
          formData.append("data[0][value]", city);
          formData.append("data[1][name]", "street");
          formData.append("data[1][value]", street);
          formData.append("data[2][name]", "house");
          formData.append("data[2][value]", house);
          formData.append("data[3][name]", "updateFact");
          formData.append("data[3][value]", new Date().toLocaleString("uk-UA"));

          const response = await fetch("/ua/ajax", {
            method: "POST",
            headers: { "x-requested-with": "XMLHttpRequest", "x-csrf-token": csrfToken },
            body: formData,
          });
          return await response.json();
        },
        { city: config.city, street: config.street, house: config.house, csrfToken }
      );

      await context.close();
      return { ...info, emergency: isEmergency };

    } catch (error) {
      console.warn(`⚠️ Error scraping DTEK ${config.id}: ${error.message}`);
      if (page) await page.close().catch(() => { });

      if (attempt === MAX_RETRIES) {
        console.error(`❌ Failed DTEK ${config.id} giving up.`);
        return null;
      }
      await sleep(5000 + (attempt * 2000));
    }
  }
}

// 4. YASNO (З RETRY)
async function getYasnoData(url, label) {
  const MAX_RETRIES = 3;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`🌍 Fetching Yasno ${label} data (Attempt ${attempt})...`);
      const response = await fetch(url);

      if (response.status === 304) {
        console.log(`ℹ️ Yasno ${label}: 304 Not Modified`);
      }

      if (!response.ok && response.status !== 304) {
        throw new Error(`HTTP ${response.status}`);
      }

      return await response.json();
    } catch (e) {
      console.warn(`⚠️ Error fetching Yasno ${label}: ${e.message}`);
      if (attempt === MAX_RETRIES) return null;
      await sleep(3000);
    }
  }
}

// 5. ЧЕРНІВЦІ (Playwright)
async function getChernivtsiData(browser) {
  const MAX_RETRIES = 3;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();
    try {
      console.log(`🌍 Visiting Chernivtsi (Telegram) (Attempt ${attempt})...`);
      await page.goto(CHERNIVTSI_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await sleep(3000);

      const schedule = await page.evaluate(() => {
        const posts = Array.from(document.querySelectorAll('.tgme_widget_message_wrap'));
        // Reversing to find the latest relevant post first
        const latestPost = posts.reverse().find(post => {
          const text = post.innerText || "";
          return text.includes("Орієнтовний графік заживлення") && text.includes("💡 Група");
        });

        if (!latestPost) return null;

        const text = latestPost.innerText;

        // Extract date: "30.01.2026"
        const dateMatch = text.match(/(\d{2})\.(\d{2})\.(\d{4})/);
        if (!dateMatch) return null;
        const dateStr = `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`; // YYYY-MM-DD

        const scheduleMap = {};

        // Splitting by groups
        // Example: "💡 Група 1"
        const groupChunks = text.split("💡 Група");
        // Skip the first chunk as it contains header info
        for (let i = 1; i < groupChunks.length; i++) {
          const chunk = groupChunks[i].trim();
          const lines = chunk.split('\n').map(l => l.trim()).filter(Boolean);

          // First line should be group number "1" or "1..."
          // But sometimes it might be just "1" then new line.
          // Let's simplified parse: parsing the number at the start.
          const groupNumMatch = lines[0].match(/^(\d+)/);
          if (!groupNumMatch) continue;

          const groupKey = groupNumMatch[1];
          // Remaining lines are time ranges or other text
          const timeRanges = lines.slice(1);

          if (!scheduleMap[groupKey]) scheduleMap[groupKey] = {};
          if (!scheduleMap[groupKey][dateStr]) scheduleMap[groupKey][dateStr] = {};

          // Default: Shutdown (2)
          // We mark only ON intervals as (1)
          const dailySchedule = {};
          for (let h = 0; h < 24; h++) {
            dailySchedule[`${String(h).padStart(2, '0')}:00`] = 2;
            dailySchedule[`${String(h).padStart(2, '0')}:30`] = 2;
          }

          timeRanges.forEach(range => {
            // "03:30 - 06:00"
            // "з 23:00" => 23:00 - 24:00

            let startH, startM, endH, endM;

            if (range.toLowerCase().startsWith("з ")) {
              const timeMatch = range.match(/(\d{2}):(\d{2})/);
              if (timeMatch) {
                startH = parseInt(timeMatch[1]);
                startM = parseInt(timeMatch[2]);
                endH = 24;
                endM = 0;
              }
            } else {
              const rangeMatch = range.match(/(\d{2}):(\d{2})\s*-\s*(\d{2}):(\d{2})/);
              if (rangeMatch) {
                startH = parseInt(rangeMatch[1]);
                startM = parseInt(rangeMatch[2]);
                endH = parseInt(rangeMatch[3]);
                endM = parseInt(rangeMatch[4]);
              }
            }

            if (startH !== undefined) {
              // Convert to 30-min slots indices
              const startIdx = startH * 2 + (startM === 30 ? 1 : 0);
              const endIdx = endH * 2 + (endM === 30 ? 1 : 0);

              for (let k = startIdx; k < endIdx; k++) {
                if (k >= 48) break; // End of day
                const h = Math.floor(k / 2);
                const m = (k % 2 === 0) ? "00" : "30";
                dailySchedule[`${String(h).padStart(2, '0')}:${m}`] = 1; // Light ON
              }
            }
          });

          scheduleMap[groupKey][dateStr] = dailySchedule;
        }

        return scheduleMap;
      });

      await context.close();
      return schedule;

    } catch (e) {
      console.warn(`⚠️ Error scraping Chernivtsi (Telegram): ${e.message}`);
      await context.close();
      if (attempt === MAX_RETRIES) return null;
      await sleep(3000);
    }
  }
}
// --- ТРАНСФОРМАЦІЇ ---


// --- ТРАНСФОРМАЦІЇ ---

// 🔥 ОНОВЛЕНА ЛОГІКА ДЛЯ ПОЛТАВИ ТА ІНШИХ JSON 🔥
function transformToSvitloFormat(dtekRaw) {
  let daysData = null;
  if (dtekRaw?.data?.fact?.data) daysData = dtekRaw.data.fact.data;
  else if (dtekRaw?.fact?.data) daysData = dtekRaw.fact.data;
  else if (dtekRaw?.data) daysData = dtekRaw.data;

  if (!daysData) return {};

  const scheduleMap = {};

  for (const [timestamp, queues] of Object.entries(daysData)) {
    const dateObj = new Date(parseInt(timestamp) * 1000);
    const dateStr = dateObj.toLocaleDateString("en-CA", { timeZone: "Europe/Kyiv" });

    for (const [gpvKey, hours] of Object.entries(queues)) {
      const groupKey = gpvKey.replace("GPV", "");

      if (!scheduleMap[groupKey]) scheduleMap[groupKey] = {};
      if (!scheduleMap[groupKey][dateStr]) scheduleMap[groupKey][dateStr] = {};

      // Змінна для зберігання статусу ПОПЕРЕДНЬОЇ години
      // За замовчуванням "yes", щоб не малювати відключення на 00:00 без причини
      let prevStatus = "yes";

      for (let h = 1; h <= 24; h++) {
        const status = hours[h.toString()];
        const hourIndex = h - 1;
        const hh = String(hourIndex).padStart(2, "0");

        let val00 = 1; // 1 = Є світло
        let val30 = 1; // 1 = Є світло

        switch (status) {
          case "yes":
            val00 = 1; val30 = 1;
            break;

          case "no":
            val00 = 2; val30 = 2; // 2 = Немає світла
            break;

          // --- Точні відключення (без "m") - це точно НЕМАЄ ---
          case "first": // Немає 00-30
            val00 = 2; val30 = 1;
            break;

          case "second": // Немає 30-60
            val00 = 1; val30 = 2;
            break;

          // --- Сірі зони (з "m") - вважаємо, що світло Є (1) ---

          case "mfirst":
            // "Можливе 1-ша половина". Вважаємо як Є (1).
            // Навіть якщо до цього було "no", mfirst означає початок слота зі світлом.
            val00 = 1; val30 = 1;
            break;

          case "msecond":
            // "Можливе 2-га половина".
            // Друга половина (30-60) - це сіра зона, тому вважаємо Є (1).
            val30 = 1;

            // Перша половина (00-30) залежить від попередньої години:
            if (prevStatus === "no") {
              // Якщо минула година була "чорна", то перші 30 хв поточної - 
              // це гарантоване продовження відключення.
              val00 = 2;
            } else {
              // Інакше все ок, світло є.
              val00 = 1;
            }
            break;

          default:
            val00 = 1; val30 = 1;
        }

        scheduleMap[groupKey][dateStr][`${hh}:00`] = val00;
        scheduleMap[groupKey][dateStr][`${hh}:30`] = val30;

        // Оновлюємо статус для наступної ітерації
        prevStatus = status;
      }
    }
  }
  return scheduleMap;
}

function transformYasnoFormat(yasnoRaw) {
  if (!yasnoRaw) return { schedule: {}, emergency: false };

  const scheduleMap = {};
  let isEmergency = false;

  for (const [groupKey, daysData] of Object.entries(yasnoRaw)) {
    if (!scheduleMap[groupKey]) scheduleMap[groupKey] = {};

    for (const dayKey of ["today", "tomorrow"]) {
      const dayInfo = daysData[dayKey];
      if (!dayInfo || !dayInfo.date) continue;

      if (dayInfo.status === "EmergencyShutdowns") {
        isEmergency = true;
      }

      const dateStr = dayInfo.date.substring(0, 10);
      if (!scheduleMap[groupKey][dateStr]) scheduleMap[groupKey][dateStr] = {};

      const slots = dayInfo.slots || [];
      const halfHours = new Array(48).fill(1); // 1 = Світло є

      slots.forEach(slot => {
        let status = 1;
        if (slot.type === "Definite") status = 2;
        else if (slot.type === "Possible") status = 2;

        const startIdx = Math.floor(slot.start / 30);
        const endIdx = Math.floor(slot.end / 30);

        for (let i = startIdx; i < endIdx; i++) {
          if (i >= 0 && i < 48) {
            halfHours[i] = status;
          }
        }
      });

      for (let i = 0; i < 48; i++) {
        const hour = Math.floor(i / 2);
        const minute = (i % 2) === 0 ? "00" : "30";
        const hh = String(hour).padStart(2, "0");
        scheduleMap[groupKey][dateStr][`${hh}:${minute}`] = halfHours[i];
      }
    }
  }

  return { schedule: scheduleMap, emergency: isEmergency };
}

// --- ЕКСПОРТ ---
function transformToExportFormat(schedule, regionId) {
  const exportData = {
    regionId: regionId,
    lastUpdated: new Date().toISOString(),
    fact: {
      data: {}
    }
  };

  const dates = new Set();

  for (const [groupId, dateMap] of Object.entries(schedule)) {
    for (const [dateStr, dailyMap] of Object.entries(dateMap)) {
      // Parse date as Kyiv Midnight
      // dateStr is YYYY-MM-DD
      // Winter Time (Jan) is UTC+2. 
      // Simple workaround: Create UTC date and substract 2 hours (7200s) if we assume strict winter time,
      // OR better: use date string constructs that Date() accepts.
      // "2026-01-30T00:00:00+02:00"
      const ts = Math.floor(new Date(`${dateStr}T00:00:00+02:00`).getTime() / 1000);
      const timestampKey = ts.toString();

      if (!exportData.fact.data[timestampKey]) {
        exportData.fact.data[timestampKey] = {};
      }

      const gpvKey = `GPV${groupId}`;
      const hoursData = {};

      for (let h = 1; h <= 24; h++) {
        const hh = String(h - 1).padStart(2, '0');
        const val00 = dailyMap[`${hh}:00`];
        const val30 = dailyMap[`${hh}:30`];

        let status = 'yes'; // Default ON
        if (val00 === 1 && val30 === 1) status = 'yes';
        else if (val00 === 2 && val30 === 2) status = 'no';
        else if (val00 === 2 && val30 === 1) status = 'first'; // OFF first half = first half is 'shutdown' -> wait.
        // User mappings:
        // "first": 00-30 OFF (2), 30-00 ON (1) -> "first" status usually means "first half off" or "first half something".
        // Let's check user example:
        // "GPV2.1" "1": "first" => Val00=?, Val30=? 
        // In example GPV2.1 hour 1 is 'first'.
        // Let's see transformToSvitloFormat logic (reverse):
        // case "first": val00 = 2; val30 = 1; (OFF, ON)
        // So 'first' maps to [2, 1]
        // case "second": val00 = 1; val30 = 2; (ON, OFF)

        if (val00 === 2 && val30 === 1) status = 'first';
        else if (val00 === 1 && val30 === 2) status = 'second';

        hoursData[h.toString()] = status;
      }

      exportData.fact.data[timestampKey][gpvKey] = hoursData;
    }
  }

  // Fill summary
  const keys = Object.keys(exportData.fact.data).sort();
  if (keys.length > 0) {
    exportData.fact.today = parseInt(keys[0]);

    const now = new Date();
    now.setHours(now.getHours() + 2); // Quick hack for Kyiv approx if env is UTC, or just use local
    // Actually user wanted "30.01.2026 00:02" format.
    // Let's just formatting current time.
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    exportData.fact.update = `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  return exportData;
}

// 4. ГОЛОВНИЙ ЗАПУСК
async function run() {
  console.log("🚀 Starting Multi-Region Scraper (Robust Mode with Odesa Fix)...");

  // Ensure artifacts directory exists
  const artifactsDir = path.resolve("artifacts");
  if (!fs.existsSync(artifactsDir)) {
    fs.mkdirSync(artifactsDir);
  }

  const browser = await chromium.launch({ headless: true });
  const processedRegions = [];
  const globalDates = { today: null, tomorrow: null };

  // 1. ДТЕК (ОБЛАСТІ)
  try {
    for (const config of DTEK_REGIONS) {
      await sleep(2000);
      const rawInfo = await getDtekRegionInfo(browser, config);
      if (rawInfo) {
        const cleanSchedule = transformToSvitloFormat(rawInfo);
        const hasSchedule = Object.keys(cleanSchedule).length > 0;

        // Додаємо регіон, якщо Є графік АБО Є аварійний режим
        if (hasSchedule || rawInfo.emergency) {
          console.log(`✅ Success DTEK: ${config.id} (Emergency: ${rawInfo.emergency})`);

          if (hasSchedule) {
            updateGlobalDates(cleanSchedule, globalDates);
          }

          processedRegions.push({
            cpu: config.id,
            name_ua: config.name_ua,
            name_ru: config.name_ru,
            name_en: config.name_en,
            schedule: cleanSchedule,
            emergency: rawInfo.emergency || false
          });
        } else {
          console.log(`ℹ️ Skipping DTEK ${config.id}: No schedule and no emergency detected.`);
        }
      }
    }
  } catch (err) {
    console.error("DTEK Critical Error:", err);
  }

  // 2. РЕГІОНИ З GITHUB (GENERIC)
  const GITHUB_REGIONS = [
    {
      id: "lvivska-oblast",
      url: LVIV_JSON_URL,
      name_ua: "Львівська область",
      name_ru: "Львовская область",
      name_en: "Lviv Region"
    },
    {
      id: "poltavska-oblast",
      url: POLTAVA_JSON_URL,
      name_ua: "Полтавська",
      name_ru: "Полтавская",
      name_en: "Poltava"
    },
    {
      id: "cherkaska-oblast",
      url: CHERKASY_JSON_URL,
      name_ua: "Черкаська область",
      name_ru: "Черкасская область",
      name_en: "Cherkasy Region"
    },
    {
      id: "chernihivska-oblast",
      url: CHERNIHIV_JSON_URL,
      name_ua: "Чернігівська область",
      name_ru: "Черниговская область",
      name_en: "Chernihiv Region"
    },
    {
      id: "kharkivska-oblast",
      url: KHARKIV_JSON_URL,
      name_ua: "Харківська область",
      name_ru: "Харьковская область",
      name_en: "Kharkiv Region"
    },
    {
      id: "khmelnytska-oblast",
      url: KHMELNYTSKYI_JSON_URL,
      name_ua: "Хмельницька область",
      name_ru: "Хмельницкая область",
      name_en: "Khmelnytskyi Region"
    },
    {
      id: "ivano-frankivska-oblast",
      url: IVANO_FRANKIVSK_JSON_URL,
      name_ua: "Івано-Франківська область",
      name_ru: "Ивано-Франковская область",
      name_en: "Ivano-Frankivsk Region"
    },
    {
      id: "rivnenska-oblast",
      url: RIVNE_JSON_URL,
      name_ua: "Рівненська область",
      name_ru: "Ровненская область",
      name_en: "Rivne Region"
    },
    {
      id: "ternopilska-oblast",
      url: TERNOPIL_JSON_URL,
      name_ua: "Тернопільська область",
      name_ru: "Тернопольская область",
      name_en: "Ternopil Region"
    },
    {
      id: "zakarpatska-oblast",
      url: ZAKARPATTIA_JSON_URL,
      name_ua: "Закарпатська область",
      name_ru: "Закарпатская область",
      name_en: "Zakarpattia Region"
    },
    {
      id: "zaporizka-oblast",
      url: ZAPORIZHZHIA_JSON_URL,
      name_ua: "Запорізька область",
      name_ru: "Запорожская область",
      name_en: "Zaporizhzhia Region"
    },
    {
      id: "zhytomyrska-oblast",
      url: ZHYTOMYR_JSON_URL,
      name_ua: "Житомирська область",
      name_ru: "Житомирская область",
      name_en: "Zhytomyr Region"
    }
  ];

  for (const region of GITHUB_REGIONS) {
    console.log(`🌍 Fetching ${region.name_en}...`);
    try {
      const response = await fetch(region.url);
      if (!response.ok) {
        console.warn(`⚠️ Failed to fetch ${region.name_en}: ${response.status}`);
        continue;
      }
      const rawData = await response.json();
      const schedule = transformToSvitloFormat(rawData);

      if (Object.keys(schedule).length > 0) {
        console.log(`✅ Success ${region.name_en}`);
        updateGlobalDates(schedule, globalDates);
        processedRegions.push({
          cpu: region.id,
          name_ua: region.name_ua,
          name_ru: region.name_ru,
          name_en: region.name_en,
          schedule: schedule,
          emergency: false
        });
      } else {
        console.log(`ℹ️ Empty schedule for ${region.name_en}`);
      }
    } catch (e) {
      console.error(`❌ Error processing ${region.name_en}: ${e.message}`);
    }
  }

  // 3. YASNO KYIV
  const yasnoKyivRaw = await getYasnoData(YASNO_KYIV_URL, "Kyiv");
  if (yasnoKyivRaw) {
    const { schedule, emergency } = transformYasnoFormat(yasnoKyivRaw);
    if (Object.keys(schedule).length > 0) {
      console.log(`✅ Success Yasno Kyiv (Emergency: ${emergency})`);
      updateGlobalDates(schedule, globalDates);
      processedRegions.push({
        cpu: "kyiv",
        name_ua: "Київ",
        name_ru: "Киев",
        name_en: "Kyiv",
        schedule: schedule,
        emergency: emergency
      });
    }
  }

  // 5. YASNO DNIPRO (DNEM)
  const yasnoDniproDnemRaw = await getYasnoData(YASNO_DNIPRO_DNEM_URL, "Dnipro DNEM");
  if (yasnoDniproDnemRaw) {
    const { schedule, emergency } = transformYasnoFormat(yasnoDniproDnemRaw);
    if (Object.keys(schedule).length > 0) {
      console.log(`✅ Success Yasno Dnipro DNEM (Emergency: ${emergency})`);
      updateGlobalDates(schedule, globalDates);
      processedRegions.push({
        cpu: "dnipro-dnem",
        name_ua: "м. Дніпро (ДнЕМ)",
        name_ru: "г. Днепр (ДнЭМ)",
        name_en: "Dnipro City (DNEM)",
        schedule: schedule,
        emergency: emergency
      });
    }
  }

  // 6. YASNO DNIPRO (CEK)
  const yasnoDniproCekRaw = await getYasnoData(YASNO_DNIPRO_CEK_URL, "Dnipro CEK");
  if (yasnoDniproCekRaw) {
    const { schedule, emergency } = transformYasnoFormat(yasnoDniproCekRaw);
    if (Object.keys(schedule).length > 0) {
      console.log(`✅ Success Yasno Dnipro CEK (Emergency: ${emergency})`);
      updateGlobalDates(schedule, globalDates);
      processedRegions.push({
        cpu: "dnipro-cek",
        name_ua: "м. Дніпро (ЦЕК)",
        name_ru: "г. Днепр (ЦЭК)",
        name_en: "Dnipro City (CEK)",
        schedule: schedule,
        emergency: emergency
      });
    }
  }

  // 7. ЧЕРНІВЦІ
  const chernivtsiSchedule = await getChernivtsiData(browser);
  if (chernivtsiSchedule && Object.keys(chernivtsiSchedule).length > 0) {
    console.log(`✅ Success Chernivtsi`);
    updateGlobalDates(chernivtsiSchedule, globalDates);
    processedRegions.push({
      cpu: "chernivetska-oblast",
      name_ua: "Чернівецька",
      name_ru: "Черновицкая",
      name_en: "Chernivtsi",
      schedule: chernivtsiSchedule,
      emergency: false
    });

    // Save to JSON for repo
    try {
      const exportData = transformToExportFormat(chernivtsiSchedule, "Chernivtsi");
      fs.writeFileSync(path.join(artifactsDir, "chernivtsi.json"), JSON.stringify(exportData, null, 2));
      console.log("💾 Saved artifacts/chernivtsi.json");
    } catch (e) {
      console.error("❌ Failed to save artifacts/chernivtsi.json:", e);
    }
  }

  await browser.close();

  // ВІДПРАВКА
  if (processedRegions.length === 0) {
    console.error("❌ No data collected.");
    process.exit(1);
  }

  const realDateToday = globalDates.today || getKyivDate(0);
  const realDateTomorrow = globalDates.tomorrow || getKyivDate(1);

  const finalOutput = {
    body: JSON.stringify({
      date_today: realDateToday,
      date_tomorrow: realDateTomorrow,
      regions: processedRegions
    }),
    timestamp: Date.now()
  };

  // Save last-message.json for repo
  try {
    fs.writeFileSync(path.join(artifactsDir, "last-message.json"), JSON.stringify(JSON.parse(finalOutput.body), null, 2));
    console.log("💾 Saved artifacts/last-message.json");
  } catch (e) {
    console.error("❌ Failed to save artifacts/last-message.json:", e);
  }

  if (!CF_WORKER_URL || !CF_WORKER_TOKEN) {
    console.error("❌ Missing Cloudflare secrets!");
    process.exit(1);
  }

  console.log(`📤 Sending ${processedRegions.length} regions to Cloudflare...`);
  try {
    const response = await fetch(CF_WORKER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${CF_WORKER_TOKEN}`
      },
      body: JSON.stringify(finalOutput)
    });
    if (!response.ok) throw new Error(await response.text());
    console.log(`✅ Success!`);
  } catch (err) {
    console.error("❌ Send Error:", err.message);
    process.exit(1);
  }
}

function updateGlobalDates(schedule, globalDates) {
  if (!globalDates.today) {
    const dates = new Set();
    Object.values(schedule).forEach(g => Object.keys(g).forEach(d => dates.add(d)));
    const sorted = Array.from(dates).sort();
    globalDates.today = sorted[0];
    globalDates.tomorrow = sorted[1];
  }
}

run();
