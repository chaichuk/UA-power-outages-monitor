import { chromium } from "playwright"
import path from "node:path"
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
      console.log(`🌍 Visiting Chernivtsi (Attempt ${attempt})...`);
      await page.goto(CHERNIVTSI_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await sleep(5000);

      const schedule = await page.evaluate(() => {
        const dateEl = document.querySelector('#gsv_t b');
        if (!dateEl) return null;

        // Format: 30.01.2026
        const dateParts = dateEl.innerText.trim().split('.');
        if (dateParts.length !== 3) return null;
        const dateStr = `${dateParts[2]}-${dateParts[1]}-${dateParts[0]}`; // 2026-01-30

        const rows = document.querySelectorAll('#gsv .scrollable div[id^="inf"]');
        const map = {};

        rows.forEach(row => {
          const queueId = row.getAttribute('data-id');
          if (!queueId) return;

          // Checking for the active container inside the row
          const cellContainer = row.querySelector('o.active');
          if (!cellContainer) return;

          const cells = Array.from(cellContainer.children);
          if (cells.length < 48) return; // Expecting at least 48 slots

          const dailySchedule = {};
          cells.forEach((cell, i) => {
            if (i >= 48) return;
            const hour = Math.floor(i / 2);
            const min = (i % 2 === 0) ? "00" : "30";
            const timeKey = `${String(hour).padStart(2, '0')}:${min}`;

            const txt = cell.innerText.trim();
            // В = Відключено (2), МЗ = Можливо заживлено -> Відключено (2), З = Заживлено (1)
            let status = 1;
            if (txt === 'В' || txt === 'МЗ') status = 2;

            dailySchedule[timeKey] = status;
          });

          if (!map[queueId]) map[queueId] = {};
          map[queueId][dateStr] = dailySchedule;
        });
        return map;
      });

      await context.close();
      return schedule;

    } catch (e) {
      console.warn(`⚠️ Error scraping Chernivtsi: ${e.message}`);
      await context.close();
      if (attempt === MAX_RETRIES) return null;
      await sleep(3000);
    }
  }
}

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

// 4. ГОЛОВНИЙ ЗАПУСК
async function run() {
  console.log("🚀 Starting Multi-Region Scraper (Robust Mode with Odesa Fix)...");

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
