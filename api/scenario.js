import { createClient } from "redis";

let redisClient;

const MIN_SCORE_TO_TRADE = 6.4;
const MIN_QUALITY_TO_TRADE = 68;
const MIN_BULLISH_QUALITY_TO_TRADE = 72;

// Auren V3.1 - versione riequilibrata dopo storico reale 09/06/2026 - 11/06/2026:
// 1) soglia operativa piu equilibrata: score minimo 6.4 e affidabilita minima 68;
// 2) H1 resta importante, ma non blocca automaticamente se M15/M30 e qualita sono forti;
// 3) le fasce orarie diventano penalita leggere, non un blocco operativo quasi totale;
// 4) i risk warning restano visibili, ma bloccano solo quando sono davvero numerosi;
// 5) scenario rialzista ancora piu prudente del ribassista, ma non eccessivamente bloccato;
// 6) classificazione errori basso/medio/alto basata sui punti effettivi contrari.

async function getRedisClient() {
  if (!redisClient) {
    redisClient = createClient({
      url: process.env.REDIS_URL
    });

    redisClient.on("error", (error) => {
      console.error("Redis error:", error);
    });
  }

  if (!redisClient.isOpen) {
    await redisClient.connect();
  }

  return redisClient;
}

export default async function handler(req, res) {
  const API_KEY = process.env.TWELVE_DATA_API_KEY;

  if (!API_KEY) {
    return res.status(500).json({
      error: "API key mancante. Controlla TWELVE_DATA_API_KEY su Vercel."
    });
  }

  const now = new Date();
  const analysisTime = getCurrentAnalysisTime(now);
  const nextUpdate = getNextHalfHour(now);

  const secondsUntilNextUpdate = Math.max(
    60,
    Math.floor((nextUpdate - now) / 1000)
  );

  res.setHeader(
    "Cache-Control",
    `s-maxage=${secondsUntilNextUpdate}, stale-while-revalidate=60`
  );

  try {
    const [tf15, tf30, tf1h, tf4h, tf1d] = await Promise.all([
      fetchCandles("15min", API_KEY, 180),
      fetchCandles("30min", API_KEY, 180),
      fetchCandles("1h", API_KEY, 180),
      fetchCandles("4h", API_KEY, 160),
      fetchCandles("1day", API_KEY, 100)
    ]);

    if (!tf30.length) {
      throw new Error("Timeframe 30m non disponibile");
    }

    const last = tf30[tf30.length - 1];
    const price = last.close;

    const closes15 = tf15.map(c => c.close);
    const closes30 = tf30.map(c => c.close);
    const closes1h = tf1h.map(c => c.close);
    const closes4h = tf4h.map(c => c.close);
    const closes1d = tf1d.map(c => c.close);

    const ema9_15m = ema(closes15, 9);
    const ema21_15m = ema(closes15, 21);
    const ema50_15m = ema(closes15, 50);

    const ema9_30m = ema(closes30, 9);
    const ema21_30m = ema(closes30, 21);
    const ema50_30m = ema(closes30, 50);
    const ema100_30m = ema(closes30, 100);

    const ema20_1h = ema(closes1h, 20);
    const ema50_1h = ema(closes1h, 50);

    const ema20_4h = ema(closes4h, 20);
    const ema50_4h = ema(closes4h, 50);

    const ema20_1d = ema(closes1d, 20);
    const ema50_1d = ema(closes1d, 50);

    const rsi15m = rsiWilder(closes15, 14);
    const rsi30m = rsiWilder(closes30, 14);
    const rsi1h = rsiWilder(closes1h, 14);

    const atr15m = atr(tf15, 14);
    const atr30m = atr(tf30, 14);
    const atr1h = atr(tf1h, 14);
    const atr4h = atr(tf4h, 14);

    const structure15m = marketStructure(tf15, 20);
    const structure30m = marketStructure(tf30, 24);
    const structure1h = marketStructure(tf1h, 24);
    const structure4h = marketStructure(tf4h, 24);

    const momentum15m = momentumScore(tf15, atr15m, 4);
    const momentum30m = momentumScore(tf30, atr30m, 4);

    const impulse15m = candleImpulse(tf15, atr15m);
    const impulse30m = candleImpulse(tf30, atr30m);

    const slope15m = emaSlope(closes15, 21, 6, atr15m);
    const slope30m = emaSlope(closes30, 21, 6, atr30m);
    const slope1h = emaSlope(closes1h, 20, 5, atr1h);

    const recentRange30m = recentRange(tf30, 10);

    const support = findMeaningfulSupport({
      candles15m: tf15,
      candles30m: tf30,
      candles1h: tf1h,
      candles4h: tf4h,
      candles1d: tf1d,
      price,
      atr30m,
      atr1h,
      atr4h
    });

    const resistance = findMeaningfulResistance({
      candles15m: tf15,
      candles30m: tf30,
      candles1h: tf1h,
      candles4h: tf4h,
      candles1d: tf1d,
      price,
      atr30m,
      atr1h,
      atr4h
    });

    const marketRegime = detectMarketRegime({
      price,
      atr15m,
      atr30m,
      atr1h,
      structure15m,
      structure30m,
      structure1h,
      momentum15m,
      momentum30m,
      slope15m,
      slope30m,
      slope1h,
      recentRange30m
    });

    const directionDataRaw = calculateM30DirectionScore({
      price,
      support,
      resistance,
      atr15m,
      atr30m,
      atr1h,
      ema9_15m,
      ema21_15m,
      ema50_15m,
      ema9_30m,
      ema21_30m,
      ema50_30m,
      ema100_30m,
      ema20_1h,
      ema50_1h,
      ema20_4h,
      ema50_4h,
      ema20_1d,
      ema50_1d,
      rsi15m,
      rsi30m,
      rsi1h,
      structure15m,
      structure30m,
      structure1h,
      structure4h,
      momentum15m,
      momentum30m,
      impulse15m,
      impulse30m,
      slope15m,
      slope30m,
      slope1h,
      recentRange30m,
      marketRegime
    });

    const signalQualityRaw = calculateSignalQuality({
      price,
      support,
      resistance,
      score: directionDataRaw.score,
      confidence: directionDataRaw.confidence,
      marketRegime,
      atr15m,
      atr30m,
      atr1h,
      rsi15m,
      rsi30m,
      rsi1h,
      structure15m,
      structure30m,
      structure1h,
      momentum15m,
      momentum30m,
      slope15m,
      slope30m,
      slope1h
    });

    const riskAdjustment = applyRiskPenalties({
      score: directionDataRaw.score,
      signalQuality: signalQualityRaw,
      marketRegime,
      rsi15m,
      rsi30m,
      atr30m,
      price,
      structure15m,
      structure30m,
      structure1h,
      momentum15m,
      momentum30m,
      recentRange30m
    });

    const timePenalty = getTimePenalty(analysisTime);

    const adjustedScore = riskAdjustment.score * timePenalty.multiplier;
    const adjustedQuality = clamp(
      riskAdjustment.quality - timePenalty.qualityPenalty,
      0,
      100
    );

    const riskWarnings = [
      ...riskAdjustment.penalties,
      ...(timePenalty.reason ? [timePenalty.reason] : [])
    ];

    const directionData = {
      ...directionDataRaw,
      score: adjustedScore,
      confidence: scoreToConfidence(adjustedScore),
      reasons: [
        ...(directionDataRaw.reasons || []),
        ...riskWarnings
      ].slice(0, 8)
    };

    const signalQuality = {
      ...signalQualityRaw,
      overall: Math.round(adjustedQuality),
      riskWarnings
    };

    const tradability = calculateTradability({
      directionData,
      signalQuality,
      marketRegime,
      price,
      support,
      resistance,
      atr30m,
      recentRange30m,
      structure15m,
      structure30m,
      structure1h,
      slope1h,
      rsi30m,
      riskWarnings
    });

    const scenario = buildScenarioV2({
      ...directionData,
      price,
      support,
      resistance,
      atr15m,
      atr30m,
      atr1h,
      atr4h,
      rsi15m,
      rsi30m,
      rsi1h,
      structure15m,
      structure30m,
      structure1h,
      structure4h,
      momentum15m,
      momentum30m,
      impulse15m,
      impulse30m,
      slope15m,
      slope30m,
      slope1h,
      marketRegime,
      signalQuality,
      tradability
    });

    const payload = {
      market: "XAU/USD",
      horizon: "30m",

      price: round(price),
      support: round(support),
      resistance: round(resistance),

      action: tradability.action,
      tradable: tradability.tradable,
      direction: scenario.type,
      marketRegime,

      score: round(directionData.score),
      rawScore: round(directionDataRaw.score),
      confidence: directionData.confidence,
      rawConfidence: directionDataRaw.confidence,
      reliability: signalQuality.overall,
      rawReliability: signalQualityRaw.overall,

      threshold: round(directionData.threshold),
      expectedMove: round(directionData.expectedMove),

      invalidation:
        scenario.type === "bullish"
          ? round(support)
          : scenario.type === "bearish"
            ? round(resistance)
            : null,

      rsi15m: round(rsi15m),
      rsi30m: round(rsi30m),
      rsi1h: round(rsi1h),

      atr15m: round(atr15m),
      atr30m: round(atr30m),
      atr1h: round(atr1h),
      atr4h: round(atr4h),

      structure15m,
      structure30m,
      structure1h,
      structure4h,

      momentum: {
        m15: round(momentum15m),
        m30: round(momentum30m)
      },

      impulse: {
        m15: impulse15m,
        m30: impulse30m
      },

      slopes: {
        m15: round(slope15m),
        m30: round(slope30m),
        h1: round(slope1h)
      },

      signalQuality,
      tradability,
      riskWarnings,

      updatedAt: analysisTime.toISOString(),
      nextUpdateAt: nextUpdate.toISOString(),
      cacheSeconds: secondsUntilNextUpdate,

      scenario
    };

    try {
      await updateScenarioHistory(payload, price, analysisTime);
    } catch (historyError) {
      console.error("Errore salvataggio storico:", historyError);
    }

    return res.status(200).json(payload);
  } catch (error) {
    return res.status(500).json({
      error: "Errore durante il calcolo dello scenario",
      details: error.message
    });
  }
}

/* -------------------------------------------------------------------------- */
/* STORICO                                                                    */
/* -------------------------------------------------------------------------- */

const HISTORY_KEY = "auren:history";
const MAX_HISTORY_ITEMS = 3000;

async function updateScenarioHistory(payload, currentPrice, analysisTime) {
  const history = await getHistoryItems();

  const updatedHistory = history.map(item => {
    if (item.result !== "pending") return item;

    const createdAt = new Date(item.createdAt);
    const minutesElapsed = (analysisTime - createdAt) / 1000 / 60;

    if (minutesElapsed < 30) return item;

    const resultData = evaluateScenarioResult(item, currentPrice);

    return {
      ...item,
      result: resultData.result,
      resultText: resultData.resultText,
      closedAt: analysisTime.toISOString(),
      closePrice: round(currentPrice),
      priceDifference:
        resultData.priceDifference !== null && resultData.priceDifference !== undefined
          ? round(resultData.priceDifference)
          : null,
      percentageChange:
        resultData.percentageChange !== null && resultData.percentageChange !== undefined
          ? round(resultData.percentageChange, 3)
          : null,
      errorLevel: resultData.errorLevel
    };
  });

  const currentId = buildHistoryId(analysisTime);
  const alreadyExists = updatedHistory.some(item => item.id === currentId);

  if (!alreadyExists) {
    updatedHistory.push(buildHistoryItem(payload, analysisTime));
  }

  updatedHistory.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  await setHistoryItems(updatedHistory.slice(0, MAX_HISTORY_ITEMS));
}

function buildHistoryItem(payload, analysisTime) {
  const action = payload.action || "wait";
  const scenario = payload.scenario || {};
  const evaluation = scenario.evaluation || {};

  return {
    id: buildHistoryId(analysisTime),
    market: payload.market || "XAU/USD",
    horizon: payload.horizon || "30m",
    createdAt: analysisTime.toISOString(),
    date: formatDateKey(analysisTime),
    time: formatTimeKey(analysisTime),

    action,
    actionText: actionToItalian(action),
    result: "pending",
    resultText: "In verifica",

    entryPrice: round(payload.price),
    closePrice: null,
    priceDifference: null,
    percentageChange: null,
    errorLevel: null,

    support: round(payload.support),
    resistance: round(payload.resistance),

    reliability: payload.reliability,
    rawReliability: payload.rawReliability,
    marketRegime: payload.marketRegime,
    direction: payload.direction,
    tradable: payload.tradable,

    score: round(payload.score),
    rawScore: round(payload.rawScore),
    confidence: payload.confidence,
    rawConfidence: payload.rawConfidence,

    threshold: round(payload.threshold || evaluation.threshold || 0),
    expectedMove: round(payload.expectedMove || evaluation.expectedMove || 0),

    rsi15m: payload.rsi15m,
    rsi30m: payload.rsi30m,
    rsi1h: payload.rsi1h,

    atr15m: payload.atr15m,
    atr30m: payload.atr30m,
    atr1h: payload.atr1h,
    atr4h: payload.atr4h,

    structure15m: payload.structure15m,
    structure30m: payload.structure30m,
    structure1h: payload.structure1h,
    structure4h: payload.structure4h,

    momentum: payload.momentum,
    impulse: payload.impulse,
    slopes: payload.slopes,
    signalQuality: payload.signalQuality,
    tradability: payload.tradability,
    riskWarnings: payload.riskWarnings || [],

    title: scenario.main?.title || "Scenario salvato",
    description:
      scenario.main?.description ||
      scenario.interpretation ||
      "Scenario salvato nello storico.",
    evaluationRule:
      evaluation.rule ||
      "Verifica automatica alla chiusura dei 30 minuti."
  };
}

function evaluateScenarioResult(item, currentPrice) {
  const action = item.action;
  const entryPrice = Number(item.entryPrice);
  const closePrice = Number(currentPrice);
  const threshold = Number(item.threshold || 0);

  if (!entryPrice || Number.isNaN(entryPrice) || Number.isNaN(closePrice)) {
    return {
      result: "pending",
      resultText: "In verifica",
      priceDifference: null,
      percentageChange: null,
      errorLevel: null
    };
  }

  if (action === "wait") {
    return {
      result: "neutral",
      resultText: "Attesa",
      priceDifference: null,
      percentageChange: null,
      errorLevel: null
    };
  }

  let difference = 0;

  if (action === "buy") {
    difference = closePrice - entryPrice;
  }

  if (action === "sell") {
    difference = entryPrice - closePrice;
  }

  const percentageChange = entryPrice ? (difference / entryPrice) * 100 : 0;

  let result = "neutral";
  let resultText = "Movimento insufficiente";

  if (difference >= threshold) {
    result = "correct";
    resultText = "Realizzato";
  } else if (difference <= -threshold) {
    result = "wrong";
    resultText = "Non realizzato";
  }

  return {
    result,
    resultText,
    priceDifference: difference,
    percentageChange,
    errorLevel: classifyErrorLevel(difference, threshold)
  };
}

function classifyErrorLevel(difference, threshold) {
  const diff = Number(difference || 0);

  // L'errore va classificato solo quando il movimento e' contrario alla previsione.
  if (diff >= 0) return null;

  const pointsAgainst = Math.abs(diff);
  const minThreshold = Math.max(Number(threshold || 0), 0.01);

  // Soglie miste: rispettano sia i punti reali sia la soglia dinamica ATR.
  if (pointsAgainst <= Math.max(5, minThreshold * 1.2)) return "basso";
  if (pointsAgainst <= Math.max(15, minThreshold * 2.8)) return "medio";
  return "alto";
}

function buildHistoryId(date) {
  const d = new Date(date);

  return "AUR-" +
    d.getFullYear() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    "-" +
    pad(d.getHours()) +
    pad(d.getMinutes());
}

function actionToItalian(action) {
  if (action === "buy") return "Acquisto";
  if (action === "sell") return "Vendita";
  return "Attesa";
}

function formatDateKey(date) {
  const d = new Date(date);
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}

function formatTimeKey(date) {
  const d = new Date(date);
  return pad(d.getHours()) + ":" + pad(d.getMinutes());
}

function pad(value) {
  return String(value).padStart(2, "0");
}

async function getHistoryItems() {
  const data = await kvGet(HISTORY_KEY);
  return Array.isArray(data) ? data : [];
}

async function setHistoryItems(items) {
  await kvSet(HISTORY_KEY, items);
}

async function kvGet(key) {
  if (!process.env.REDIS_URL) {
    return [];
  }

  const client = await getRedisClient();
  const value = await client.get(key);

  if (!value) {
    return [];
  }

  try {
    return JSON.parse(value);
  } catch {
    return [];
  }
}

async function kvSet(key, value) {
  if (!process.env.REDIS_URL) {
    return;
  }

  const client = await getRedisClient();
  await client.set(key, JSON.stringify(value));
}

/* -------------------------------------------------------------------------- */
/* ALGORITMO                                                                  */
/* -------------------------------------------------------------------------- */

function getCurrentAnalysisTime(now) {
  const analysisTime = new Date(now);

  if (now.getMinutes() < 30) {
    analysisTime.setMinutes(0, 0, 0);
  } else {
    analysisTime.setMinutes(30, 0, 0);
  }

  return analysisTime;
}

function getNextHalfHour(now) {
  const next = new Date(now);

  if (now.getMinutes() < 30) {
    next.setMinutes(30, 0, 0);
  } else {
    next.setHours(now.getHours() + 1, 0, 0, 0);
  }

  return next;
}

async function fetchCandles(interval, API_KEY, outputsize = 100) {
  const url =
    `https://api.twelvedata.com/time_series?symbol=XAU/USD&interval=${interval}&outputsize=${outputsize}&apikey=${API_KEY}`;

  const response = await fetch(url);
  const data = await response.json();

  if (!data.values || !Array.isArray(data.values)) {
    throw new Error("Dati non disponibili per timeframe " + interval);
  }

  return data.values
    .map(item => ({
      datetime: item.datetime,
      open: Number(item.open),
      high: Number(item.high),
      low: Number(item.low),
      close: Number(item.close)
    }))
    .filter(c =>
      !Number.isNaN(c.open) &&
      !Number.isNaN(c.high) &&
      !Number.isNaN(c.low) &&
      !Number.isNaN(c.close)
    )
    .reverse();
}

function ema(values, period) {
  if (!values || values.length === 0) return 0;

  const k = 2 / (period + 1);
  let result = values[0];

  for (let i = 1; i < values.length; i++) {
    result = values[i] * k + result * (1 - k);
  }

  return result;
}

function emaSeries(values, period) {
  if (!values || values.length === 0) return [];

  const k = 2 / (period + 1);
  const result = [values[0]];

  for (let i = 1; i < values.length; i++) {
    result.push(values[i] * k + result[i - 1] * (1 - k));
  }

  return result;
}

function emaSlope(values, period, barsBack, atrValue) {
  if (!values || values.length < period + barsBack + 2 || !atrValue) return 0;

  const series = emaSeries(values, period);
  const last = series[series.length - 1];
  const previous = series[series.length - 1 - barsBack];

  return (last - previous) / atrValue;
}

function rsiWilder(values, period = 14) {
  if (!values || values.length < period + 1) return 50;

  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? Math.abs(diff) : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;

  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function atr(candles, period) {
  if (!candles || candles.length < period + 1) return 0;

  const recent = candles.slice(-period - 1);
  const trueRanges = [];

  for (let i = 1; i < recent.length; i++) {
    const current = recent[i];
    const previous = recent[i - 1];

    trueRanges.push(Math.max(
      current.high - current.low,
      Math.abs(current.high - previous.close),
      Math.abs(current.low - previous.close)
    ));
  }

  return trueRanges.reduce((a, b) => a + b, 0) / trueRanges.length;
}

function marketStructure(candles, length = 24) {
  const recent = candles.slice(-length);

  if (recent.length < 12) return "neutral";

  const firstHalf = recent.slice(0, Math.floor(recent.length / 2));
  const secondHalf = recent.slice(Math.floor(recent.length / 2));

  const firstHigh = Math.max(...firstHalf.map(c => c.high));
  const secondHigh = Math.max(...secondHalf.map(c => c.high));

  const firstLow = Math.min(...firstHalf.map(c => c.low));
  const secondLow = Math.min(...secondHalf.map(c => c.low));

  if (secondHigh > firstHigh && secondLow > firstLow) return "bullish";
  if (secondHigh < firstHigh && secondLow < firstLow) return "bearish";

  return "neutral";
}

function momentumScore(candles, atrValue, bars = 4) {
  if (!candles || candles.length < bars + 1 || !atrValue) return 0;

  const recent = candles.slice(-bars - 1);
  const start = recent[0].close;
  const end = recent[recent.length - 1].close;

  return (end - start) / atrValue;
}

function candleImpulse(candles, atrValue) {
  const last = candles[candles.length - 1];

  if (!last || !atrValue) {
    return {
      direction: "neutral",
      strength: 0,
      bodyRatio: 0,
      atrRatio: 0
    };
  }

  const body = Math.abs(last.close - last.open);
  const range = Math.max(last.high - last.low, 0.00001);
  const bodyRatio = body / range;
  const atrRatio = body / atrValue;

  const direction =
    last.close > last.open ? "bullish" :
    last.close < last.open ? "bearish" :
    "neutral";

  let strength = 0;

  if (bodyRatio >= 0.55 && atrRatio >= 0.35) strength = 0.8;
  if (bodyRatio >= 0.65 && atrRatio >= 0.55) strength = 1.2;
  if (bodyRatio >= 0.75 && atrRatio >= 0.75) strength = 1.6;

  return {
    direction,
    strength: round(strength),
    bodyRatio: round(bodyRatio),
    atrRatio: round(atrRatio)
  };
}

function recentRange(candles, length = 10) {
  const recent = candles.slice(-length);

  if (!recent.length) {
    return {
      high: 0,
      low: 0,
      middle: 0,
      width: 0
    };
  }

  const high = Math.max(...recent.map(c => c.high));
  const low = Math.min(...recent.map(c => c.low));

  return {
    high,
    low,
    middle: (high + low) / 2,
    width: high - low
  };
}

function detectMarketRegime(data) {
  const {
    price,
    atr30m,
    structure15m,
    structure30m,
    structure1h,
    momentum15m,
    momentum30m,
    slope15m,
    slope30m,
    slope1h,
    recentRange30m
  } = data;

  const volatilityRatio = atr30m / price;
  const rangeWidthRatio = recentRange30m.width / price;

  const alignedBullish =
    structure15m === "bullish" &&
    structure30m === "bullish" &&
    structure1h !== "bearish";

  const alignedBearish =
    structure15m === "bearish" &&
    structure30m === "bearish" &&
    structure1h !== "bullish";

  const strongSlope =
    Math.abs(slope30m) >= 0.9 &&
    Math.abs(momentum30m) >= 0.8;

  if (volatilityRatio < 0.0009) {
    return "low_volatility";
  }

  if (
    structure30m === "neutral" &&
    Math.abs(slope30m) < 0.35 &&
    Math.abs(momentum30m) < 0.55
  ) {
    return "choppy";
  }

  if ((alignedBullish || alignedBearish) && strongSlope) {
    return "trend";
  }

  if (
    rangeWidthRatio < 0.0025 &&
    Math.abs(slope15m) < 0.5 &&
    Math.abs(slope30m) < 0.5
  ) {
    return "compression";
  }

  if (
    Math.abs(momentum15m) > 1.4 &&
    Math.abs(momentum30m) > 1.1 &&
    Math.sign(momentum15m) === Math.sign(momentum30m)
  ) {
    return "impulse";
  }

  if (
    structure15m !== "neutral" &&
    structure30m !== "neutral" &&
    structure15m !== structure30m
  ) {
    return "conflict";
  }

  return "balanced";
}

function calculateM30DirectionScore(data) {
  const {
    price,
    support,
    resistance,
    atr15m,
    atr30m,
    atr1h,
    ema9_15m,
    ema21_15m,
    ema50_15m,
    ema9_30m,
    ema21_30m,
    ema50_30m,
    ema100_30m,
    ema20_1h,
    ema50_1h,
    ema20_4h,
    ema50_4h,
    ema20_1d,
    ema50_1d,
    rsi15m,
    rsi30m,
    structure15m,
    structure30m,
    structure1h,
    structure4h,
    momentum15m,
    momentum30m,
    impulse15m,
    impulse30m,
    slope15m,
    slope30m,
    slope1h,
    recentRange30m,
    marketRegime
  } = data;

  let score = 0;
  const reasons = [];

  if (price > ema9_30m && ema9_30m > ema21_30m && ema21_30m > ema50_30m) {
    score += 3.4;
    reasons.push("M30 mostra medie allineate al rialzo");
  } else if (price < ema9_30m && ema9_30m < ema21_30m && ema21_30m < ema50_30m) {
    score -= 3.4;
    reasons.push("M30 mostra medie allineate al ribasso");
  } else if (price > ema21_30m && ema21_30m > ema50_30m) {
    score += 1.8;
    reasons.push("M30 resta costruttivo sopra le medie principali");
  } else if (price < ema21_30m && ema21_30m < ema50_30m) {
    score -= 1.8;
    reasons.push("M30 resta debole sotto le medie principali");
  }

  if (price > ema100_30m && ema50_30m > ema100_30m) score += 0.8;
  if (price < ema100_30m && ema50_30m < ema100_30m) score -= 0.8;

  if (price > ema9_15m && ema9_15m > ema21_15m && ema21_15m > ema50_15m) {
    score += 2.1;
    reasons.push("M15 conferma spinta veloce al rialzo");
  } else if (price < ema9_15m && ema9_15m < ema21_15m && ema21_15m < ema50_15m) {
    score -= 2.1;
    reasons.push("M15 conferma spinta veloce al ribasso");
  } else if (price > ema21_15m) {
    score += 0.7;
  } else if (price < ema21_15m) {
    score -= 0.7;
  }

  if (price > ema20_1h && ema20_1h > ema50_1h) {
    score += 2.3;
    reasons.push("H1 conferma contesto positivo");
  }

  if (price < ema20_1h && ema20_1h < ema50_1h) {
    score -= 2.3;
    reasons.push("H1 conferma contesto debole");
  }

  if (price > ema20_4h && ema20_4h > ema50_4h) score += 0.7;
  if (price < ema20_4h && ema20_4h < ema50_4h) score -= 0.7;

  if (price > ema20_1d && ema20_1d > ema50_1d) score += 0.3;
  if (price < ema20_1d && ema20_1d < ema50_1d) score -= 0.3;

  if (structure30m === "bullish") score += 2.0;
  if (structure30m === "bearish") score -= 2.0;

  if (structure15m === "bullish") score += 1.1;
  if (structure15m === "bearish") score -= 1.1;

  if (structure1h === "bullish") score += 1.0;
  if (structure1h === "bearish") score -= 1.0;

  if (structure4h === "bullish") score += 0.4;
  if (structure4h === "bearish") score -= 0.4;

  score += clamp(slope30m, -1.8, 1.8) * 1.25;
  score += clamp(slope15m, -1.5, 1.5) * 0.75;
  score += clamp(slope1h, -1.2, 1.2) * 0.9;

  score += clamp(momentum30m, -2.0, 2.0) * 1.15;
  score += clamp(momentum15m, -1.8, 1.8) * 0.75;

  if (impulse30m.direction === "bullish") score += impulse30m.strength;
  if (impulse30m.direction === "bearish") score -= impulse30m.strength;

  if (impulse15m.direction === "bullish") score += impulse15m.strength * 0.55;
  if (impulse15m.direction === "bearish") score -= impulse15m.strength * 0.55;

  if (rsi30m >= 54 && rsi30m <= 68) score += 1.2;
  if (rsi30m <= 46 && rsi30m >= 32) score -= 1.2;

  if (rsi15m >= 55 && rsi15m <= 68) score += 0.8;
  if (rsi15m <= 45 && rsi15m >= 32) score -= 0.8;

  if (rsi15m >= 76 && score > 0) {
    score -= 1.5;
    reasons.push("M15 in possibile eccesso rialzista");
  }

  if (rsi15m <= 24 && score < 0) {
    score += 1.5;
    reasons.push("M15 in possibile eccesso ribassista");
  }

  if (rsi30m >= 74 && score > 0) {
    score -= 1.2;
    reasons.push("M30 vicino a ipercomprato");
  }

  if (rsi30m <= 26 && score < 0) {
    score += 1.2;
    reasons.push("M30 vicino a ipervenduto");
  }

  const breakoutBuffer = Math.max(atr30m * 0.12, price * 0.00025);

  const rangePosition =
    recentRange30m.width > 0
      ? (price - recentRange30m.low) / recentRange30m.width
      : 0.5;

  if (rangePosition >= 0.40 && rangePosition <= 0.60) {
    score *= 0.84;
    reasons.push("Prezzo nella zona centrale del range: segnale meno pulito");
  }

  if (score > 0 && rangePosition > 0.78) {
    score -= 1.4;
    reasons.push("Prezzo gia vicino alla parte alta del range: rischio ingresso tardivo");
  }

  if (score < 0 && rangePosition < 0.22) {
    score += 1.4;
    reasons.push("Prezzo gia vicino alla parte bassa del range: rischio ingresso tardivo");
  }

  if (score > 0 && rangePosition > 0.88 && Math.abs(momentum30m) > 1.1) {
    score -= 0.8;
    reasons.push("Movimento rialzista gia molto esteso nel range M30");
  }

  if (score < 0 && rangePosition < 0.12 && Math.abs(momentum30m) > 1.1) {
    score += 0.8;
    reasons.push("Movimento ribassista gia molto esteso nel range M30");
  }

  if (price > recentRange30m.high - breakoutBuffer && score > 0) {
    score += 0.7;
    reasons.push("Prezzo vicino alla parte alta del range M30");
  }

  if (price < recentRange30m.low + breakoutBuffer && score < 0) {
    score -= 0.7;
    reasons.push("Prezzo vicino alla parte bassa del range M30");
  }

  const distanceFromResistance = Math.abs(resistance - price);
  const distanceFromSupport = Math.abs(price - support);

  if (distanceFromResistance < atr30m * 1.0 && score > 0) {
    score -= 2.0;
    reasons.push("Prezzo vicino a una resistenza rilevante");
  }

  if (distanceFromSupport < atr30m * 1.0 && score < 0) {
    score += 2.0;
    reasons.push("Prezzo vicino a un supporto rilevante");
  }

  if (marketRegime === "trend") score *= 1.12;
  if (marketRegime === "impulse") score *= 1.08;
  if (marketRegime === "balanced") score *= 0.95;
  if (marketRegime === "compression") score *= 0.78;
  if (marketRegime === "choppy") score *= 0.62;
  if (marketRegime === "low_volatility") score *= 0.58;
  if (marketRegime === "conflict") score *= 0.55;

  if (marketRegime === "choppy") {
    reasons.push("Mercato sporco/laterale: segnale meno affidabile");
  }

  if (marketRegime === "conflict") {
    reasons.push("Timeframe veloci in conflitto");
  }

  const volatilityRatio = atr30m / price;

  if (volatilityRatio < 0.0010) {
    score *= 0.75;
    reasons.push("Volatilita bassa: segnale meno pulito");
  }

  const fastConflict =
    (structure15m === "bullish" && structure30m === "bearish") ||
    (structure15m === "bearish" && structure30m === "bullish");

  if (fastConflict) {
    score *= 0.72;
    reasons.push("M15 e M30 non sono allineati");
  }

  return {
    score,
    confidence: scoreToConfidence(score),
    threshold: Math.max(atr30m * 0.18, price * 0.0004),
    expectedMove: Math.max(atr30m * 0.65, atr15m * 1.0),
    reasons: reasons.slice(0, 5)
  };
}

function scoreToConfidence(score) {
  const absScore = Math.abs(Number(score || 0));

  if (absScore >= 9) return "Molto Alta";
  if (absScore >= 7) return "Alta";
  if (absScore >= 4.5) return "Media";
  if (absScore >= 2.8) return "Debole";

  return "Bassa";
}

function calculateSignalQuality(data) {
  const {
    price,
    support,
    resistance,
    score,
    confidence,
    marketRegime,
    atr30m,
    rsi15m,
    rsi30m,
    structure15m,
    structure30m,
    structure1h,
    momentum15m,
    momentum30m,
    slope15m,
    slope30m
  } = data;

  let trendAlignment = 50;
  let volatility = 50;
  let structure = 50;
  let momentum = 50;
  let riskReward = 50;
  let cleanliness = 50;

  if (
    structure15m === structure30m &&
    structure30m === structure1h &&
    structure30m !== "neutral"
  ) {
    trendAlignment = 85;
  } else if (
    structure30m !== "neutral" &&
    structure1h !== "neutral" &&
    structure30m === structure1h
  ) {
    trendAlignment = 72;
  } else if (structure15m !== structure30m) {
    trendAlignment = 35;
  }

  const volRatio = atr30m / price;

  if (volRatio >= 0.0012 && volRatio <= 0.0035) volatility = 78;
  else if (volRatio > 0.0035 && volRatio <= 0.006) volatility = 65;
  else if (volRatio < 0.001) volatility = 30;
  else volatility = 45;

  if (structure30m !== "neutral") structure += 20;
  if (structure1h === structure30m) structure += 15;
  if (structure15m === structure30m) structure += 10;
  structure = clamp(structure, 0, 100);

  if (
    Math.sign(momentum15m) === Math.sign(momentum30m) &&
    Math.abs(momentum30m) > 0.7
  ) {
    momentum = 75;
  }

  if (Math.abs(slope30m) > 0.8 && Math.sign(slope15m) === Math.sign(slope30m)) {
    momentum += 10;
  }

  momentum = clamp(momentum, 0, 100);

  const distanceToSupport = Math.abs(price - support);
  const distanceToResistance = Math.abs(resistance - price);

  if (score > 0) {
    const rr = distanceToResistance / Math.max(price - support, atr30m * 0.5);
    riskReward = rr >= 1.4 ? 78 : rr >= 1.0 ? 60 : 38;
  } else if (score < 0) {
    const rr = distanceToSupport / Math.max(resistance - price, atr30m * 0.5);
    riskReward = rr >= 1.4 ? 78 : rr >= 1.0 ? 60 : 38;
  }

  if (marketRegime === "trend") cleanliness = 82;
  if (marketRegime === "impulse") cleanliness = 76;
  if (marketRegime === "balanced") cleanliness = 62;
  if (marketRegime === "compression") cleanliness = 48;
  if (marketRegime === "choppy") cleanliness = 28;
  if (marketRegime === "conflict") cleanliness = 22;
  if (marketRegime === "low_volatility") cleanliness = 30;

  if ((rsi15m > 76 || rsi15m < 24) || (rsi30m > 74 || rsi30m < 26)) {
    cleanliness -= 12;
  }

  cleanliness = clamp(cleanliness, 0, 100);

  const confidenceBoost =
    confidence === "Molto Alta" ? 8 :
    confidence === "Alta" ? 5 :
    confidence === "Media" ? 0 :
    confidence === "Debole" ? -8 :
    -15;

  const overall = Math.round(clamp(
    (
      trendAlignment * 0.22 +
      volatility * 0.16 +
      structure * 0.18 +
      momentum * 0.16 +
      riskReward * 0.14 +
      cleanliness * 0.14
    ) + confidenceBoost,
    0,
    100
  ));

  return {
    overall,
    trendAlignment: Math.round(trendAlignment),
    volatility: Math.round(volatility),
    structure: Math.round(structure),
    momentum: Math.round(momentum),
    riskReward: Math.round(riskReward),
    cleanliness: Math.round(cleanliness)
  };
}

function applyRiskPenalties({
  score,
  signalQuality,
  marketRegime,
  rsi15m,
  rsi30m,
  atr30m,
  price,
  structure15m,
  structure30m,
  structure1h,
  momentum15m,
  momentum30m,
  recentRange30m
}) {
  let adjustedScore = score;
  let adjustedQuality = signalQuality.overall;
  const penalties = [];

  const volatilityRatio = atr30m / price;

  const highVolatility = volatilityRatio > 0.0048;
  const veryLowVolatility = volatilityRatio < 0.0010;

  const extremeRsi =
    rsi15m >= 76 ||
    rsi15m <= 24 ||
    rsi30m >= 74 ||
    rsi30m <= 26;

  const structureConflict =
    structure15m !== "neutral" &&
    structure30m !== "neutral" &&
    structure15m !== structure30m;

  const higherTimeframeConflict =
    structure30m !== "neutral" &&
    structure1h !== "neutral" &&
    structure30m !== structure1h;

  const momentumConflict =
    Math.sign(momentum15m) !== Math.sign(momentum30m) &&
    Math.abs(momentum15m) > 0.6 &&
    Math.abs(momentum30m) > 0.6;

  if (highVolatility) {
    adjustedScore *= 0.72;
    adjustedQuality -= 14;
    penalties.push("Volatilita molto alta");
  }

  if (veryLowVolatility) {
    adjustedScore *= 0.78;
    adjustedQuality -= 10;
    penalties.push("Volatilita troppo bassa");
  }

  if (extremeRsi) {
    adjustedScore *= 0.82;
    adjustedQuality -= 10;
    penalties.push("RSI in zona estrema");
  }

  if (structureConflict) {
    adjustedScore *= 0.70;
    adjustedQuality -= 16;
    penalties.push("Conflitto tra M15 e M30");
  }

  if (higherTimeframeConflict) {
    adjustedScore *= 0.72;
    adjustedQuality -= 12;
    penalties.push("H1 contrario alla direzione M30");
  }

  const h1NotAligned =
    structure30m !== "neutral" &&
    structure1h !== structure30m;

  if (h1NotAligned && !higherTimeframeConflict) {
    adjustedScore *= 0.93;
    adjustedQuality -= 6;
    penalties.push("H1 non conferma la direzione");
  }

  const rangePosition =
    recentRange30m && recentRange30m.width > 0
      ? (price - recentRange30m.low) / recentRange30m.width
      : 0.5;

  const centralRange = rangePosition >= 0.40 && rangePosition <= 0.60;

  if (centralRange) {
    adjustedScore *= 0.90;
    adjustedQuality -= 8;
    penalties.push("Prezzo nella zona centrale del range M30");
  }

  if (momentumConflict) {
    adjustedScore *= 0.84;
    adjustedQuality -= 8;
    penalties.push("Momentum non allineato");
  }

  if (marketRegime === "choppy" || marketRegime === "conflict") {
    adjustedScore *= 0.78;
    adjustedQuality -= 10;
    penalties.push("Mercato sporco o contrastato");
  }

  const bullishLateEntry =
    score > 0 &&
    rangePosition > 0.78 &&
    Math.abs(momentum30m) > 1.1;

  const bearishLateEntry =
    score < 0 &&
    rangePosition < 0.22 &&
    Math.abs(momentum30m) > 1.1;

  if (bullishLateEntry || bearishLateEntry) {
    adjustedScore *= 0.90;
    adjustedQuality -= 6;
    penalties.push("Rischio ingresso tardivo dopo movimento gia esteso");
  }

  if (
    signalQuality.overall >= 80 &&
    Math.abs(momentum30m) > 1.4 &&
    Math.abs(momentum15m) > 1.4
  ) {
    adjustedScore *= 0.92;
    adjustedQuality -= 5;
    penalties.push("Segnale forte ma possibile movimento gia esteso");
  }

  return {
    score: adjustedScore,
    quality: Math.max(0, Math.min(100, Math.round(adjustedQuality))),
    penalties
  };
}

function getTimePenalty(date = new Date()) {
  const hour = date.getHours();
  const minute = date.getMinutes();
  const halfHourKey = hour + ":" + (minute >= 30 ? "30" : "00");

  const veryUnstableHours = [15, 18, 19];
  const unstableHours = [9, 11];
  const lessStableHours = [13, 14, 16, 17];

  // V3.1: le fasce orarie restano un fattore di prudenza,
  // ma non devono trasformare quasi tutti gli scenari in attesa.
  if (veryUnstableHours.includes(hour)) {
    return {
      multiplier: 0.88,
      qualityPenalty: 6,
      reason: "Fascia oraria storicamente instabile per Auren"
    };
  }

  if (unstableHours.includes(hour)) {
    return {
      multiplier: 0.92,
      qualityPenalty: 5,
      reason: "Fascia oraria da trattare con prudenza"
    };
  }

  if (lessStableHours.includes(hour)) {
    return {
      multiplier: 0.96,
      qualityPenalty: 3,
      reason: "Fascia oraria leggermente meno stabile"
    };
  }

  return {
    multiplier: 1,
    qualityPenalty: 0,
    reason: null
  };
}

function calculateTradability(data) {
  const {
    directionData,
    signalQuality,
    marketRegime,
    price,
    support,
    resistance,
    atr30m,
    recentRange30m,
    structure15m,
    structure30m,
    structure1h,
    slope1h,
    rsi30m,
    riskWarnings
  } = data;

  const score = directionData.score;
  const absScore = Math.abs(score);

  const direction =
    score >= 4.5 ? "bullish" :
    score <= -4.5 ? "bearish" :
    "neutral";

  const hardBadRegime = marketRegime === "low_volatility";

  const softBadRegime =
    marketRegime === "choppy" ||
    marketRegime === "conflict";

  const distanceFromResistance = Math.abs(resistance - price);
  const distanceFromSupport = Math.abs(price - support);

  const tooCloseToResistance =
    direction === "bullish" && distanceFromResistance < atr30m * 1.25;

  const tooCloseToSupport =
    direction === "bearish" && distanceFromSupport < atr30m * 1.25;

  const rangePosition =
    recentRange30m && recentRange30m.width > 0
      ? (price - recentRange30m.low) / recentRange30m.width
      : 0.5;

  const centralRange = rangePosition >= 0.40 && rangePosition <= 0.60;

  const h1Contrary =
    (direction === "bullish" && (structure1h === "bearish" || slope1h < -0.25)) ||
    (direction === "bearish" && (structure1h === "bullish" || slope1h > 0.25));

  const h1Aligned =
    (direction === "bullish" && (structure1h === "bullish" || slope1h > 0.25)) ||
    (direction === "bearish" && (structure1h === "bearish" || slope1h < -0.25));

  const m15m30Aligned =
    direction === "bullish"
      ? structure15m === "bullish" && structure30m === "bullish"
      : direction === "bearish"
        ? structure15m === "bearish" && structure30m === "bearish"
        : false;

  let tradable = true;
  const reasons = [];

  if (direction === "neutral") {
    tradable = false;
    reasons.push("Direzione non sufficientemente chiara");
  }

  if (absScore < MIN_SCORE_TO_TRADE) {
    tradable = false;
    reasons.push("Score tecnico sotto la soglia operativa 6.4");
  }

  if (signalQuality.overall < MIN_QUALITY_TO_TRADE) {
    tradable = false;
    reasons.push("Affidabilita sotto 68: meglio attendere");
  }

  // La bassa volatilita resta un blocco forte, perche spesso genera falsi segnali.
  if (hardBadRegime) {
    tradable = false;
    reasons.push("Regime di mercato troppo poco volatile");
  }

  // Choppy/conflict non bloccano sempre: bloccano solo se il segnale non e' abbastanza forte.
  if (softBadRegime && signalQuality.overall < 76 && absScore < 7.2) {
    tradable = false;
    reasons.push("Regime di mercato sporco con segnale non abbastanza forte");
  }

  // H1 contrario non deve bloccare automaticamente ogni scenario.
  // Blocca solo quando la qualita non e' sufficiente.
  if (h1Contrary && signalQuality.overall < 78) {
    tradable = false;
    reasons.push("H1 contrario con affidabilita non sufficiente");
  }

  // H1 resta importante, ma la soglia e' piu equilibrata rispetto alla V3.
  if (signalQuality.overall < 72 && !h1Aligned) {
    tradable = false;
    reasons.push("Manca conferma H1 sufficiente");
  }

  // La zona centrale non deve annullare tutto se la qualita del segnale e' buona.
  if (centralRange && !h1Aligned && signalQuality.overall < 78) {
    tradable = false;
    reasons.push("Prezzo nella zona centrale del range senza conferma H1 forte");
  }

  if (tooCloseToResistance) {
    tradable = false;
    reasons.push("Prezzo troppo vicino alla resistenza");
  }

  if (tooCloseToSupport) {
    tradable = false;
    reasons.push("Prezzo troppo vicino al supporto");
  }

  // Il rialzista resta piu selettivo del ribassista, ma non eccessivamente bloccato.
  if (direction === "bullish") {
    if (signalQuality.overall < MIN_BULLISH_QUALITY_TO_TRADE) {
      tradable = false;
      reasons.push("Scenario rialzista sotto soglia rafforzata 72");
    }

    if (!m15m30Aligned) {
      tradable = false;
      reasons.push("Scenario rialzista senza pieno allineamento M15/M30");
    }

    if (!h1Aligned) {
      tradable = false;
      reasons.push("Scenario rialzista senza conferma H1");
    }

    if (rsi30m >= 68 && rangePosition > 0.68) {
      tradable = false;
      reasons.push("Rialzista gia esteso vicino alla parte alta del range");
    }
  }

  // I warning devono essere avvisi, non un blocco immediato.
  if (signalQuality.riskWarnings && signalQuality.riskWarnings.length >= 4) {
    tradable = false;
    reasons.push("Troppi segnali di rischio contemporanei");
  }

  if (Array.isArray(riskWarnings) && riskWarnings.length >= 5) {
    tradable = false;
    reasons.push("Accumulo eccessivo di penalita operative");
  }

  const action =
    !tradable ? "wait" :
    direction === "bullish" ? "buy" :
    direction === "bearish" ? "sell" :
    "wait";

  return {
    tradable,
    action,
    direction,
    rangePosition: round(rangePosition, 3),
    h1Aligned,
    h1Contrary,
    reasons
  };
}

function buildScenarioV2(data) {
  const {
    score,
    confidence,
    threshold,
    expectedMove,
    reasons,
    price,
    support,
    resistance,
    atr30m,
    rsi30m,
    structure15m,
    structure30m,
    structure1h,
    marketRegime,
    signalQuality,
    tradability
  } = data;

  const priceText = price.toFixed(2);
  const supportText = support.toFixed(2);
  const resistanceText = resistance.toFixed(2);
  const operatingRange = supportText + " - " + resistanceText;

  if (!tradability.tradable) {
    const mainProb = Math.min(75, Math.max(45, signalQuality.overall));
    const secondProb = Math.round((100 - mainProb) * 0.55);
    const altProb = 100 - mainProb - secondProb;

    return {
      type: "neutral",
      action: "wait",
      horizon: "30m",
      interpretation: "Scenario informativo: meglio attendere conferma.",
      main: {
        probability: mainProb,
        title: "Meglio attendere",
        description:
          "Il mercato non offre una condizione abbastanza pulita per una lettura affidabile. " +
          buildWhyText(reasons, structure15m, structure30m, structure1h),
        label1: "Motivo principale",
        value1: tradability.reasons[0] || "Segnale non sufficientemente chiaro",
        label2: "Regime mercato",
        value2: marketRegime
      },
      secondary: {
        probability: secondProb,
        title: "Attendere conferma",
        description:
          "Meglio attendere una rottura chiara della zona alta o bassa prima di dare peso a una direzione.",
        label1: "Sopra",
        value1: resistanceText,
        label2: "Sotto",
        value2: supportText
      },
      alternative: {
        probability: altProb,
        title: "Possibile falso segnale",
        description:
          "In condizioni sporche o laterali XAU/USD puo generare movimenti rapidi ma poco affidabili.",
        label1: "Area complessiva",
        value1: operatingRange,
        label2: "Forza M30",
        value2: rsi30m.toFixed(2)
      },
      evaluation: {
        direction: "neutral",
        entryPrice: Number(priceText),
        threshold: round(threshold),
        expectedMove: round(expectedMove),
        rule: "Scenario neutrale: la lettura viene considerata non operativa e non viene conteggiata come confermata o non confermata."
      }
    };
  }

  if (score >= 4.5) {
    const mainProb = Math.min(78, Math.max(58, signalQuality.overall));
    const secondProb = Math.max(15, Math.round((100 - mainProb) * 0.65));
    const altProb = 100 - mainProb - secondProb;

    return {
      type: "bullish",
      action: "buy",
      horizon: "30m",
      interpretation: "Direzione attesa nei prossimi 30 minuti: rialzista.",
      main: {
        probability: mainProb,
        title: "Pressione rialzista a 30 minuti",
        description:
          "Il mercato mostra una struttura favorevole al rialzo, ma il segnale resta valido solo se il prezzo mantiene la zona di supporto indicata. " +
          buildWhyText(reasons, structure15m, structure30m, structure1h),
        label1: "Prima zona da osservare",
        value1: resistanceText,
        label2: "Scenario cambia se",
        value2: "sotto " + supportText
      },
      secondary: {
        probability: secondProb,
        title: "Possibile pausa temporanea",
        description:
          "Un ritorno verso la zona bassa puo avvenire, ma per ora viene letto come pausa se la struttura M30 resta positiva.",
        label1: "Zona di possibile pausa",
        value1: supportText,
        label2: "Chiarezza",
        value2: confidence
      },
      alternative: {
        probability: altProb,
        title: "Perdita di forza",
        description:
          "La lettura rialzista perde validita se il prezzo scende sotto il supporto con conferma su M15 e M30.",
        label1: "Area complessiva",
        value1: operatingRange,
        label2: "RSI M30",
        value2: rsi30m.toFixed(2)
      },
      evaluation: {
        direction: "bullish",
        entryPrice: Number(priceText),
        threshold: round(threshold),
        expectedMove: round(expectedMove),
        rule: "Corretto se dopo 30 minuti il prezzo e' superiore al prezzo di analisi oltre la soglia minima."
      }
    };
  }

  if (score <= -4.5) {
    const mainProb = Math.min(78, Math.max(58, signalQuality.overall));
    const secondProb = Math.max(15, Math.round((100 - mainProb) * 0.65));
    const altProb = 100 - mainProb - secondProb;

    return {
      type: "bearish",
      action: "sell",
      horizon: "30m",
      interpretation: "Direzione attesa nei prossimi 30 minuti: ribassista.",
      main: {
        probability: mainProb,
        title: "Pressione ribassista a 30 minuti",
        description:
          "Il mercato mostra una struttura favorevole al ribasso, ma il segnale resta valido solo se il prezzo rimane sotto la resistenza indicata. " +
          buildWhyText(reasons, structure15m, structure30m, structure1h),
        label1: "Prima zona da osservare",
        value1: supportText,
        label2: "Scenario cambia se",
        value2: "sopra " + resistanceText
      },
      secondary: {
        probability: secondProb,
        title: "Possibile rimbalzo temporaneo",
        description:
          "Un recupero tecnico puo avvenire, ma viene letto come reazione temporanea se non supera la zona alta.",
        label1: "Zona di possibile rimbalzo",
        value1: resistanceText,
        label2: "Chiarezza",
        value2: confidence
      },
      alternative: {
        probability: altProb,
        title: "Cambio direzione",
        description:
          "La lettura ribassista perde validita se il prezzo torna sopra la resistenza con conferma su M15 e M30.",
        label1: "Area complessiva",
        value1: operatingRange,
        label2: "RSI M30",
        value2: rsi30m.toFixed(2)
      },
      evaluation: {
        direction: "bearish",
        entryPrice: Number(priceText),
        threshold: round(threshold),
        expectedMove: round(expectedMove),
        rule: "Corretto se dopo 30 minuti il prezzo e' inferiore al prezzo di analisi oltre la soglia minima."
      }
    };
  }

  return {
    type: "neutral",
    action: "wait",
    horizon: "30m",
    interpretation: "Direzione attesa nei prossimi 30 minuti: laterale.",
    main: {
      probability: 45,
      title: "Mercato laterale a 30 minuti",
      description:
        "Il mercato non mostra una direzione abbastanza pulita. Meglio attendere conferma.",
      label1: "Area complessiva",
      value1: operatingRange,
      label2: "Movimento medio M30",
      value2: atr30m.toFixed(2)
    },
    secondary: {
      probability: 35,
      title: "Possibile uscita dal range",
      description:
        "Un movimento chiaro sopra la zona alta o sotto la zona bassa potrebbe riattivare una direzione piu definita.",
      label1: "Se supera la zona alta",
      value1: resistanceText,
      label2: "Se perde la zona bassa",
      value2: supportText
    },
    alternative: {
      probability: 20,
      title: "Possibile falso segnale",
      description:
        "In fase laterale possono verificarsi movimenti rapidi ma poco affidabili.",
      label1: "Struttura M30",
      value1: structure30m,
      label2: "Struttura H1",
      value2: structure1h
    },
    evaluation: {
      direction: "neutral",
      entryPrice: Number(priceText),
      threshold: round(threshold),
      expectedMove: round(expectedMove),
      rule: "Corretto se dopo 30 minuti il prezzo resta vicino al prezzo di analisi entro la soglia minima."
    }
  };
}

function findMeaningfulSupport({
  candles15m,
  candles30m,
  candles1h,
  candles4h,
  candles1d,
  price,
  atr30m,
  atr1h
}) {
  const minDistance = Math.max(atr30m * 1.2, price * 0.0012);

  const levels = [
    ...extractSwingLows(candles15m, 2).map(level => ({ level, weight: 1 })),
    ...extractSwingLows(candles30m, 2).map(level => ({ level, weight: 1.4 })),
    ...extractSwingLows(candles1h, 2).map(level => ({ level, weight: 2 })),
    ...extractSwingLows(candles4h, 2).map(level => ({ level, weight: 3 })),
    ...extractSwingLows(candles1d, 2).map(level => ({ level, weight: 4 }))
  ];

  const rawLevels = levels.map(x => x.level);

  const valid = levels
    .filter(item => item.level < price - minDistance)
    .map(item => ({
      level: item.level,
      score:
        levelStrength(item.level, rawLevels, Math.max(atr30m * 0.7, price * 0.0009)) *
        item.weight
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.level - a.level;
    });

  if (valid.length > 0) {
    return valid[0].level;
  }

  return price - Math.max(atr1h * 0.9, atr30m * 2.2, price * 0.0025);
}

function findMeaningfulResistance({
  candles15m,
  candles30m,
  candles1h,
  candles4h,
  candles1d,
  price,
  atr30m,
  atr1h
}) {
  const minDistance = Math.max(atr30m * 1.2, price * 0.0012);

  const levels = [
    ...extractSwingHighs(candles15m, 2).map(level => ({ level, weight: 1 })),
    ...extractSwingHighs(candles30m, 2).map(level => ({ level, weight: 1.4 })),
    ...extractSwingHighs(candles1h, 2).map(level => ({ level, weight: 2 })),
    ...extractSwingHighs(candles4h, 2).map(level => ({ level, weight: 3 })),
    ...extractSwingHighs(candles1d, 2).map(level => ({ level, weight: 4 }))
  ];

  const rawLevels = levels.map(x => x.level);

  const valid = levels
    .filter(item => item.level > price + minDistance)
    .map(item => ({
      level: item.level,
      score:
        levelStrength(item.level, rawLevels, Math.max(atr30m * 0.7, price * 0.0009)) *
        item.weight
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.level - b.level;
    });

  if (valid.length > 0) {
    return valid[0].level;
  }

  return price + Math.max(atr1h * 0.9, atr30m * 2.2, price * 0.0025);
}

function extractSwingLows(candles, lookback = 2) {
  const levels = [];

  for (let i = lookback; i < candles.length - lookback; i++) {
    const current = candles[i];

    let isSwing = true;

    for (let j = 1; j <= lookback; j++) {
      if (
        current.low >= candles[i - j].low ||
        current.low >= candles[i + j].low
      ) {
        isSwing = false;
        break;
      }
    }

    if (isSwing) {
      levels.push(current.low);
    }
  }

  return levels;
}

function extractSwingHighs(candles, lookback = 2) {
  const levels = [];

  for (let i = lookback; i < candles.length - lookback; i++) {
    const current = candles[i];

    let isSwing = true;

    for (let j = 1; j <= lookback; j++) {
      if (
        current.high <= candles[i - j].high ||
        current.high <= candles[i + j].high
      ) {
        isSwing = false;
        break;
      }
    }

    if (isSwing) {
      levels.push(current.high);
    }
  }

  return levels;
}

function levelStrength(level, allLevels, tolerance) {
  return allLevels.filter(other => Math.abs(other - level) <= tolerance).length;
}

function buildWhyText(reasons, structure15m, structure30m, structure1h) {
  if (reasons && reasons.length > 0) {
    return "Motivo: " + reasons.slice(0, 2).join("; ") + ".";
  }

  return "Motivo: M15=" + structure15m + ", M30=" + structure30m + ", H1=" + structure1h + ".";
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function round(value, decimals = 2) {
  if (typeof value !== "number" || Number.isNaN(value)) return 0;
  return Number(value.toFixed(decimals));
}
