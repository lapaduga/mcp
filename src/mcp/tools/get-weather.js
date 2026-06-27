export const name = "get_weather";

export const description = "Прогноз погоды на 1–8 дней. Принимает название города на русском, без ключа.";

export const inputSchema = {
  type: "object",
  properties: {
    city: {
      type: "string",
      description: "Название города (можно на русском: Челябинск, Москва, Лондон)",
    },
    days: {
      type: "integer",
      description: "Количество дней прогноза (1–8, по умолчанию 1)",
      minimum: 1,
      maximum: 8,
    },
  },
  required: ["city"],
};

const WEATHER_RU = {
  clearday: "Ясно", clearnight: "Ясно",
  pcloudyday: "Малооблачно", pcloudynight: "Малооблачно",
  mcloudyday: "Облачно", mcloudynight: "Облачно",
  cloudyday: "Пасмурно", cloudynight: "Пасмурно",
  humidday: "Высокая влажность", humidnight: "Высокая влажность",
  lightrainday: "Небольшой дождь", lightrainnight: "Небольшой дождь",
  oshowerday: "Ливень", oshowernight: "Ливень",
  ishowerday: "Слабый ливень", ishowernight: "Слабый ливень",
  lightsnowday: "Небольшой снег", lightsnownight: "Небольшой снег",
  rainday: "Дождь", rainnight: "Дождь",
  snowday: "Снег", snownight: "Снег",
  rainsnowday: "Дождь со снегом", rainsnownight: "Дождь со снегом",
  tsday: "Гроза", tsnight: "Гроза",
  tsrainday: "Дождь с грозой", tsrainnight: "Дождь с грозой",
};

const WIND_DIR = {
  N: "С", NNE: "ССВ", NE: "СВ", ENE: "ВСВ",
  E: "В", ESE: "ВЮВ", SE: "ЮВ", SSE: "ЮЮВ",
  S: "Ю", SSW: "ЮЮЗ", SW: "ЮЗ", WSW: "ЗЮЗ",
  W: "З", WNW: "ЗСЗ", NW: "СЗ", NNW: "ССЗ",
};

function weatherRu(code) {
  return WEATHER_RU[code] || code?.replace(/(day|night)$/, "") || "—";
}

async function geocode(city) {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(city)}&format=json&limit=1`;
  const res = await fetch(url, {
    headers: { "User-Agent": "MCPToolsHub/1.0" },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Геокодинг: ${res.status}`);
  const data = await res.json();
  if (!data?.[0]) throw new Error(`Город "${city}" не найден`);
  return { lat: data[0].lat, lon: data[0].lon, name: data[0].display_name };
}

async function fetchForecast(lat, lon) {
  // 7Timer civil product — 64 timepoints (3-hourly, ~8 дней)
  const url = `https://www.7timer.info/bin/civil.php?lon=${lon}&lat=${lat}&ac=0&unit=metric&output=json&tzshift=0`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`7Timer: ${res.status}`);
  const data = await res.json();
  return data.dataseries || [];
}

function formatDate(timepoint, initStr) {
  const init = new Date(
    parseInt(initStr.slice(0, 4), 10),
    parseInt(initStr.slice(4, 6), 10) - 1,
    parseInt(initStr.slice(6, 8), 10),
    parseInt(initStr.slice(8, 10), 10)
  );
  const d = new Date(init.getTime() + timepoint * 3600000);
  const days = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
  return `${d.getDate().toString().padStart(2, "0")}.${(d.getMonth() + 1).toString().padStart(2, "0")} (${days[d.getDay()]})`;
}

export async function handler(args) {
  const { city, days } = args ?? {};

  if (!city) {
    throw new Error("Поле 'city' обязательно для заполнения");
  }

  const numDays = Math.min(Math.max(days ?? 1, 1), 8);

  try {
    const geo = await geocode(city);
    const data = await fetchForecast(geo.lat, geo.lon);

    if (!data || data.length === 0) {
      throw new Error("Нет данных прогноза");
    }

    const lines = [`📍 ${city}`, ""];

    // Группируем по дням: каждые 24 часа (8 точек = 24h / 3h)
    const hoursPerDay = 24;
    const pointsPerDay = hoursPerDay / 3;

    for (let d = 0; d < numDays; d++) {
      const start = d * pointsPerDay;
      const dayPoints = data.slice(start, start + pointsPerDay);

      if (dayPoints.length === 0) break;

      const first = dayPoints[0];
      const dateLabel = formatDate(first.timepoint, data._init || "2026062600");

      // Дневные и ночные экстремумы
      const temps = dayPoints.filter((p) => p.temp2m != null).map((p) => p.temp2m);
      const minT = Math.min(...temps);
      const maxT = Math.max(...temps);

      // Преобладающая погода
      const weatherCounts = {};
      for (const p of dayPoints) {
        if (p.weather) weatherCounts[p.weather] = (weatherCounts[p.weather] || 0) + 1;
      }
      const mainWeather = Object.entries(weatherCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "";

      // Средний ветер
      const windSpeeds = dayPoints.filter((p) => p.wind10m?.speed != null).map((p) => p.wind10m.speed);
      const avgWind = windSpeeds.length > 0
        ? Math.round(windSpeeds.reduce((a, b) => a + b, 0) / windSpeeds.length)
        : "—";

      // Преобладающее направление ветра
      const windDirs = dayPoints.filter((p) => p.wind10m?.direction).map((p) => p.wind10m.direction);
      const dirCounts = {};
      for (const dir of windDirs) dirCounts[dir] = (dirCounts[dir] || 0) + 1;
      const mainDir = Object.entries(dirCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "";
      const dirRu = WIND_DIR[mainDir] || mainDir;

      // Осадки
      const rain = dayPoints.filter((p) => p.prec_type && p.prec_type !== "none").length > 0;

      lines.push(`📅 ${dateLabel}`);
      lines.push(`  🌡 ${mainWeather ? weatherRu(mainWeather) + ", " : ""}${minT}..${maxT}°C`);
      lines.push(`  💨 Ветер: ${dirRu} ${avgWind} м/с${rain ? ", 🌧 осадки" : ""}`);

      // Почасовка
      const hours = dayPoints.map((p) => {
        const h = Math.floor(p.timepoint % 24);
        return `${h.toString().padStart(2, "0")}:00 ${p.temp2m}°C ${weatherRu(p.weather)}`;
      });
      lines.push(`  🕐 ${hours.slice(0, 4).join(" | ")}`);
      lines.push("");
    }

    return {
      content: [{ type: "text", text: lines.join("\n") }],
    };
  } catch (err) {
    return {
      content: [
        {
          type: "text",
          text: `Не удалось получить прогноз для "${city}": ${err.message}`,
        },
      ],
      isError: true,
    };
  }
}
