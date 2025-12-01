require("dotenv").config();
const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3000;

// CWA API 設定
const CWA_API_BASE_URL = "https://opendata.cwa.gov.tw/api";
const CWA_API_KEY = process.env.CWA_API_KEY;

// 定義要查詢的城市列表
const TAIWAN_CITIES = [
  "新竹縣",
  "桃園市",
  "新竹市",
  "苗栗縣",
];

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/**
 * 取得指定城市的天氣預報
 * CWA 氣象資料開放平臺 API (F-C0032-001: 一般天氣預報-今明 36 小時天氣預報)
 * @param {string} locationName 城市名稱，如 "新竹縣"
 */
const getWeatherByLocation = async (locationName) => {
  // 檢查是否有設定 API Key
  if (!CWA_API_KEY) {
    throw new Error("伺服器設定錯誤: 請在 .env 檔案中設定 CWA_API_KEY");
  }

  // 呼叫 CWA API
  const response = await axios.get(
    `${CWA_API_BASE_URL}/v1/rest/datastore/F-C0032-001`,
    {
      params: {
        Authorization: CWA_API_KEY,
        locationName: locationName,
      },
    }
  );

  // 取得指定城市的天氣資料
  const locationData = response.data.records.location.find(
    (loc) => loc.locationName === locationName
  );

  if (!locationData) {
    throw new Error(`查無資料: 無法取得 ${locationName} 天氣資料`);
  }

  // 整理天氣資料
  const weatherData = {
    city: locationName,
    datasetDescription: response.data.records.datasetDescription,
    dataUpdateTime: response.data.records.issueTime, // 使用發布時間作為資料更新時間
    forecasts: [],
  };

  // 解析天氣要素
  const weatherElements = locationData.weatherElement;
  // 假設所有 element 的 time 陣列長度相同
  const timeCount = weatherElements[0].time.length;

  for (let i = 0; i < timeCount; i++) {
    const forecast = {
      startTime: weatherElements[0].time[i].startTime,
      endTime: weatherElements[0].time[i].endTime,
      weather: "", // Wx: 天氣狀況
      rain: "", // PoP: 降雨機率
      minTemp: "", // MinT: 最低溫度
      maxTemp: "", // MaxT: 最高溫度
      comfort: "", // CI: 舒適度
      windSpeed: "", // WS: 風速 (此資料集 F-C0032-001 並未包含 WS 或 WD，這裡先保留，但可能不會有值)
    };

    weatherElements.forEach((element) => {
      const value = element.time[i].parameter;
      switch (element.elementName) {
        case "Wx":
          forecast.weather = value.parameterName;
          break;
        case "PoP":
          forecast.rain = value.parameterName + "%";
          break;
        case "MinT":
          forecast.minTemp = value.parameterName + "°C";
          break;
        case "MaxT":
          forecast.maxTemp = value.parameterName + "°C";
          break;
        case "CI":
          forecast.comfort = value.parameterName;
          break;
        // 由於 F-C0032-001 資料集不包含 WS (風速)，此處的 switch 就不會匹配到
        // case "WS":
        //   forecast.windSpeed = value.parameterName;
        //   break;
      }
    });

    weatherData.forecasts.push(forecast);
  }

  return weatherData;
};

/**
 * Express 路由處理器 (通用)
 */
const handleWeatherRequest = (locationName) => async (req, res) => {
  try {
    const data = await getWeatherByLocation(locationName);
    res.json({
      success: true,
      data: data,
    });
  } catch (error) {
    console.error(`取得 ${locationName} 天氣資料失敗:`, error.message);

    if (error.message.includes("CWA_API_KEY")) {
      return res.status(500).json({
        error: "伺服器設定錯誤",
        message: error.message,
      });
    }

    if (error.response) {
      // CWA API 回應錯誤
      return res.status(error.response.status).json({
        error: "CWA API 錯誤",
        message: error.response.data.message || "無法取得天氣資料",
        details: error.response.data,
      });
    }

    // 查無資料或網路錯誤等其他錯誤
    res.status(500).json({
      error: "伺服器錯誤",
      message: `無法取得 ${locationName} 天氣資料，請稍後再試`,
    });
  }
};

// Routes
// -----------------------------------------------------------

// 根目錄和健康檢查
app.get("/", (req, res) => {
  const endpoints = {
    health: "/api/health",
  };
  // 動態生成城市天氣預報的 endpoints
  TAIWAN_CITIES.forEach((city) => {
    // 將中文城市名稱轉換為 URL friendly 的 slug (例如: 新竹縣 -> hsinchucounty)
    const slug = city.replace("縣", "county").replace("市", "city").toLowerCase();
    endpoints[city] = `/api/weather/${slug}`;
  });

  res.json({
    message: "歡迎使用 CWA 天氣預報 API",
    endpoints: endpoints,
  });
});

app.get("/api/health", (req, res) => {
  res.json({ status: "OK", timestamp: new Date().toISOString() });
});

// 註冊各城市的天氣預報路由
// 為了程式碼的簡潔和未來擴展性，我們使用一個迴圈來動態創建路由
TAIWAN_CITIES.forEach((city) => {
  const slug = city.replace("縣", "county").replace("市", "city").toLowerCase();
  app.get(`/api/weather/${slug}`, handleWeatherRequest(city));
});

// -----------------------------------------------------------

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    error: "伺服器錯誤",
    message: err.message,
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: "找不到此路徑",
  });
});

app.listen(PORT, () => {
  console.log(`🚀 伺服器已運作，監聽 Port ${PORT}`);
  console.log(`📍 環境: ${process.env.NODE_ENV || "development"}`);
});