// ============================================
// 天气仪表盘 · script.js
// 数据来源：Open-Meteo（免费、无需 Key、支持浏览器跨域）
//   1) Geocoding API  —— 城市名 -> 经纬度
//   2) Forecast  API  —— 经纬度 -> 实时天气
// ============================================

// ---------- 1. 抓取页面元素 ----------
const el = {
  city: document.getElementById("city"),
  icon: document.getElementById("icon"),
  temp: document.getElementById("temp"),
  humidity: document.getElementById("humidity"),
  wind: document.getElementById("wind"),
  status: document.getElementById("status"),
  input: document.getElementById("search-input"),
  chart: document.getElementById("chart"),
  loader: document.getElementById("loader"),
  sunrise: document.getElementById("sunrise"),
  sunset: document.getElementById("sunset"),
  forecastList: document.getElementById("forecast-list"),
  weatherCard: document.querySelector(".weather-card"),
  chartBox: document.getElementById("chart-box"),
  searchBtn: document.getElementById("search-btn"),
  locateBtn: document.getElementById("locate-btn"),
};

// 加载态最短展示时长（毫秒）：网络太快时也能看清骨架屏，避免闪烁
const MIN_LOADING_MS = 700;
// 请求序号：只有最后一次请求的结果才允许渲染，防止旧数据覆盖新数据
let requestSeq = 0;

// 统一的加载态控制：显示转圈 + 骨架屏，隐藏卡片真实内容
function setLoading(loading) {
  el.loader.hidden = !loading;
  el.weatherCard.classList.toggle("is-loading", loading);
  el.chartBox.classList.toggle("is-loading", loading);
  el.searchBtn.disabled = loading;
  el.locateBtn.disabled = loading;
  if (loading) renderSkeletonForecast();
}

// 保证加载态至少持续 MIN_LOADING_MS，让骨架屏/转圈来得及展示
function withMinLoading(promise) {
  const delay = new Promise((resolve) => setTimeout(resolve, MIN_LOADING_MS));
  return Promise.all([promise, delay]).then(([result]) => result);
}

// 预报区的骨架占位（3 个，和真实数量一致，避免布局跳动）
function renderSkeletonForecast() {
  el.forecastList.innerHTML = Array.from({ length: 3 })
    .map(
      () => `
        <div class="forecast-item is-skeleton">
          <div class="sk sk-day"></div>
          <div class="sk sk-ico"></div>
          <div class="sk sk-tmp"></div>
        </div>`
    )
    .join("");
}

// ---------- 2. 天气代码(WMO) -> Emoji 图标 ----------
// Open-Meteo 用 WMO 天气代码表示天气现象，我们据此切换图标
function codeToEmoji(code) {
  if (code === 0) return "☀️";                       // 晴
  if (code === 1) return "🌤️";                      // 大致晴朗
  if (code === 2) return "⛅";                       // 局部多云
  if (code === 3) return "☁️";                       // 阴
  if (code === 45 || code === 48) return "🌫️";      // 雾
  if (code >= 51 && code <= 57) return "🌦️";        // 毛毛雨
  if (code >= 61 && code <= 67) return "🌧️";        // 雨
  if (code >= 71 && code <= 77) return "🌨️";        // 雪
  if (code >= 80 && code <= 82) return "🌦️";        // 阵雨
  if (code >= 85 && code <= 86) return "🌨️";        // 阵雪
  if (code >= 95) return "⛈️";                       // 雷暴
  return "🌡️";                                      // 未知兜底
}

// ---------- 3. 渲染函数（和之前一样，数据驱动视图） ----------
function renderWeather(data) {
  el.city.textContent = data.city;
  el.icon.textContent = data.icon;
  el.temp.textContent = data.temp + "°C";
  el.humidity.textContent = data.humidity;
  el.wind.textContent = data.wind;
  el.sunrise.textContent = data.sunrise || "--";
  el.sunset.textContent = data.sunset || "--";
}

// 把 "2026-10-25" + 序号 转成“明天/后天/周X”
const WEEK_CN = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
function dayLabel(dateStr, index) {
  if (index === 0) return "明天";
  if (index === 1) return "后天";
  const d = new Date(dateStr + "T00:00:00");
  return WEEK_CN[d.getDay()];
}

// 渲染未来 3 天预报卡片
function renderForecast(days) {
  el.forecastList.innerHTML = days
    .map((d, i) => {
      return `
        <div class="forecast-item">
          <span class="forecast-day">${dayLabel(d.date, i)}</span>
          <span class="forecast-icon">${codeToEmoji(d.code)}</span>
          <span class="forecast-temp">
            <b>${d.max}°</b><span class="forecast-min">${d.min}°</span>
          </span>
        </div>`;
    })
    .join("");
}

// ---------- 4. 调用 API：城市名 -> 经纬度 ----------
async function getCoords(city) {
  const url =
    "https://geocoding-api.open-meteo.com/v1/search?count=1&language=zh&format=json&name=" +
    encodeURIComponent(city);
  const res = await fetch(url);
  const data = await res.json();
  if (!data.results || data.results.length === 0) {
    throw new Error("找不到这个城市，请检查拼写");
  }
  const r = data.results[0];
  return {
    latitude: r.latitude,
    longitude: r.longitude,
    name: r.name + (r.country ? "，" + r.country : ""),
  };
}

// ---------- 5. 调用 API：经纬度 -> 实时天气 + 未来 12 小时逐时温度 ----------
async function getWeather(lat, lon) {
  const url =
    "https://api.open-meteo.com/v1/forecast?latitude=" +
    lat +
    "&longitude=" +
    lon +
    "&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code" +
    "&hourly=temperature_2m" +
    "&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset" +
    "&forecast_days=4" + // 今天 + 未来 3 天，且保证逐时数据够 12 小时
    "&timezone=auto" + // 关键：按当地时区返回时间，否则图表小时会显示成 UTC
    "&wind_speed_unit=ms"; // 风速单位用 m/s，和之前界面一致
  const res = await fetch(url);
  const data = await res.json();
  const c = data.current;
  // 从“当前时刻”开始，取未来 12 小时的逐时温度
  const allTimes = data.hourly.time;
  const allTemps = data.hourly.temperature_2m;
  // current.time 可能带分钟（如 00:15），按整点对齐避免跳过当前小时
  const currentHour = c.time.slice(0, 13); // "2026-10-25T00"
  const startIdx = Math.max(
    0,
    allTimes.findIndex((t) => t.slice(0, 13) >= currentHour)
  );
  const hours = allTimes.slice(startIdx, startIdx + 12);
  const temps = allTemps.slice(startIdx, startIdx + 12);

  // 今日日出日落（当地时区，格式 "2026-10-25T06:32" -> "06:32"）
  const daily = data.daily;
  const sunrise = daily.sunrise[0] ? daily.sunrise[0].slice(11, 16) : "--";
  const sunset = daily.sunset[0] ? daily.sunset[0].slice(11, 16) : "--";

  // 未来 3 天（跳过今天，取第 1~3 天）
  const forecast = [];
  for (let i = 1; i <= 3; i++) {
    if (!daily.time[i]) break;
    forecast.push({
      date: daily.time[i],
      code: daily.weather_code[i],
      max: Math.round(daily.temperature_2m_max[i]),
      min: Math.round(daily.temperature_2m_min[i]),
    });
  }

  return {
    temp: Math.round(c.temperature_2m),
    humidity: c.relative_humidity_2m + "%",
    wind: c.wind_speed_10m + "m/s",
    code: c.weather_code,
    hours: hours,
    temps: temps,
    sunrise: sunrise,
    sunset: sunset,
    forecast: forecast,
  };
}

// ---------- 5.1 根据天气代码设置动态背景渐变 ----------
function setBackground(code) {
  // 默认沿用紫粉风格
  let theme = "default";
  if (code === 0 || code === 1) {
    theme = "sunny"; // 晴 / 大致晴朗
  } else if (code === 3 || code === 45 || code === 48) {
    theme = "cloudy"; // 阴 / 雾
  } else if (
    (code >= 51 && code <= 67) ||
    (code >= 80 && code <= 82) ||
    code >= 95
  ) {
    theme = "rainy"; // 雨 / 阵雨 / 雷暴
  }
  document.body.className = "bg-" + theme;
}

// ---------- 5.2 用 Chart.js 绘制未来 12 小时温度平滑折线图 ----------
let chartInstance = null;
function renderChart(hours, temps) {
  // 把时刻 "2026-10-25T14:00" 转成 "14:00" 作为横轴标签
  const labels = hours.map((t) => t.slice(11, 16));

  // 紫粉渐变填充，和整体风格统一
  const ctx = el.chart.getContext("2d");
  const gradient = ctx.createLinearGradient(0, 0, 0, 200);
  gradient.addColorStop(0, "rgba(252, 92, 125, 0.4)"); // 粉
  gradient.addColorStop(1, "rgba(106, 130, 251, 0.03)"); // 紫

  const config = {
    type: "line",
    data: {
      labels: labels,
      datasets: [
        {
          label: "温度 (°C)",
          data: temps,
          borderColor: "#fc5c7d", // 主粉色线条
          backgroundColor: gradient,
          borderWidth: 3,
          fill: true,
          tension: 0.4, // 让折线平滑
          pointRadius: 3, // 显示数据点，曲线更清晰
          pointBackgroundColor: "#fff",
          pointBorderColor: "#fc5c7d",
          pointBorderWidth: 2,
          pointHoverRadius: 6,
          pointHoverBackgroundColor: "#6a82fb",
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { labels: { color: "#fff", font: { size: 12 } } },
        tooltip: {
          callbacks: {
            title: (items) => "时间 " + items[0].label,
            label: (item) => " " + item.formattedValue + "°C",
          },
        },
      },
      scales: {
        x: {
          ticks: {
            color: "rgba(255,255,255,0.8)",
            maxTicksLimit: 6,
            maxRotation: 0,
          },
          grid: { color: "rgba(255,255,255,0.12)" },
        },
        y: {
          // grace 给上下留白，温度区间再窄也不会挤成一条
          grace: "25%",
          ticks: {
            color: "rgba(255,255,255,0.8)",
            maxTicksLimit: 5,
            callback: (v) => v + "°",
          },
          grid: { color: "rgba(255,255,255,0.12)" },
        },
      },
    },
  };

  if (chartInstance) {
    chartInstance.data = config.data;
    chartInstance.update();
  } else {
    chartInstance = new Chart(ctx, config);
  }
}

// ---------- 6. 主流程：搜索城市并渲染 ----------
async function searchCity(city) {
  if (!city) return;
  const seq = ++requestSeq;
  setLoading(true);
  el.status.textContent = "";
  try {
    // 两次请求（城市 -> 经纬度 -> 天气）合并进同一个最短加载时长
    const { coords, w } = await withMinLoading(
      (async () => {
        const coords = await getCoords(city);
        const w = await getWeather(coords.latitude, coords.longitude);
        return { coords, w };
      })()
    );
    if (seq !== requestSeq) return; // 已有更新的请求，丢弃本次结果
    renderWeather({
      city: coords.name,
      icon: codeToEmoji(w.code),
      temp: w.temp,
      humidity: w.humidity,
      wind: w.wind,
      sunrise: w.sunrise,
      sunset: w.sunset,
    });
    renderForecast(w.forecast);
    setBackground(w.code);
    renderChart(w.hours, w.temps);
  } catch (err) {
    if (seq !== requestSeq) return;
    el.status.textContent = "⚠️ " + err.message;
  } finally {
    if (seq === requestSeq) setLoading(false);
  }
}

// ---------- 7. 绑定事件 ----------
document.getElementById("search-btn").addEventListener("click", () => {
  searchCity(el.input.value.trim());
});

el.input.addEventListener("keydown", (e) => {
  if (e.key === "Enter") searchCity(el.input.value.trim());
});

// 定位按钮：用浏览器定位拿到经纬度，直接查天气（无需城市名）
document.getElementById("locate-btn").addEventListener("click", () => {
  if (!navigator.geolocation) {
    el.status.textContent = "⚠️ 当前浏览器不支持定位";
    return;
  }
  const seq = ++requestSeq;
  setLoading(true);
  el.status.textContent = "";
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const { latitude, longitude } = pos.coords;
      try {
        const w = await withMinLoading(getWeather(latitude, longitude));
        if (seq !== requestSeq) return;
        renderWeather({
          city: "我的位置",
          icon: codeToEmoji(w.code),
          temp: w.temp,
          humidity: w.humidity,
          wind: w.wind,
          sunrise: w.sunrise,
          sunset: w.sunset,
        });
        renderForecast(w.forecast);
        setBackground(w.code);
        renderChart(w.hours, w.temps);
      } catch (err) {
        if (seq !== requestSeq) return;
        el.status.textContent = "⚠️ " + err.message;
      } finally {
        if (seq === requestSeq) setLoading(false);
      }
    },
    () => {
      if (seq !== requestSeq) return;
      el.status.textContent = "⚠️ 定位失败，请允许定位权限";
      setLoading(false);
    }
  );
});

// ---------- 8. 首次加载：默认展示北京的天气 ----------
searchCity("北京");
