// File consigliato: /api/scenario.js
// Richiede una variabile ambiente già presente: TWELVE_DATA_API_KEY
// Per salvare davvero lo storico su Vercel serve anche un database/KV.
// Questo codice usa Redis compatibile Upstash/Vercel KV tramite REST API:
// - KV_REST_API_URL
// - KV_REST_API_TOKEN
//
// Devi creare anche /api/history.js usando il codice che trovi dopo questo file.

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

    const directionData = calculateM30DirectionScore({
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

    const signalQuality = calculateSignalQuality({
      price,
      support,
      resistance,
      score: directionData.score,
      confidence: directionData.confidence,
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

    const tradability = calculateTradability({
      directionData,
      signalQuality,
      marketRegime,
      price,
      support,
      resistance,
      atr30m
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
      confidence: directionData.confidence,
      reliability: signalQuality.overall,

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

      updatedAt: analysisTime.toISOString(),
      nextUpdateAt: nextUpdate.toISOString(),
      cacheSeconds: secondsUntilNextUpdate,

      scenario
    };

    await updateScenarioHistory(payload, price, analysisTime);

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
      priceDifference: round(currentPrice - item.entryPrice)
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

    support: round(payload.support),
    resistance: round(payload.resistance),
    reliability: payload.reliability,
    marketRegime: payload.marketRegime,
    direction: payload.direction,
    tradable: payload.tradable,

    threshold: round(payload.threshold || evaluation.threshold || 0),
    expectedMove: round(payload.expectedMove || evaluation.expectedMove || 0),

    title: scenario.main?.title || "Scenario salvato",
    description: scenario.main?.description || scenario.interpretation || "Scenario salvato nello storico.",
    evaluationRule: evaluation.rule || "Verifica automatica alla chiusura dei 30 minuti."
  };
}

function evaluateScenarioResult(item, currentPrice) {
  const action = item.action;
  const entryPrice = Number(item.entryPrice);
  const threshold = Math.max(Number(item.threshold || 0), 0);
  const difference = currentPrice - entryPrice;

  if (action === "buy") {
    const isCorrect = difference >= threshold;

    return {
      result: isCorrect ? "correct" : "wrong",
      resultText: isCorrect ? "Realizzato" : "Non realizzato"
    };
  }

  if (action === "sell") {
    const isCorrect = difference <= -threshold;

    return {
      result: isCorrect ? "correct" : "wrong",
      resultText: isCorrect ? "Realizzato" : "Non realizzato"
    };
  }

  const isStillNeutral = Math.abs(difference) <= threshold;

  return {
    result: isStillNeutral ? "correct" : "wrong",
    resultText: isStillNeutral ? "Realizzato" : "Non realizzato"
  };
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
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;

  if (!url || !token) {
    return [];
  }

  const response = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  if (!response.ok) {
    return [];
  }

  const data = await response.json();

  if (!data || data.result === null || data.result === undefined) {
    return [];
  }

  if (typeof data.result === "string") {
    try {
      return JSON.parse(data.result);
    } catch {
      return [];
    }
  }

  return data.result;
}

async function kvSet(key, value) {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;

  if (!url || !token) {
    return;
  }

  await fetch(`${url}/set/${encodeURIComponent(key)}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(value)
  });
}

/* -------------------------------------------------------------------------- */
/* IL RESTO DEL TUO ALGORITMO RESTA UGUALE                                    */
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
    score += 1.5;
    reasons.push("H1 conferma contesto positivo");
  }

  if (price < ema20_1h && ema20_1h < ema50_1h) {
    score -= 1.5;
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
  score += clamp(slope1h, -1.0, 1.0) * 0.5;

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

  const absScore = Math.abs(score);

  const confidence =
    absScore >= 9 ? "Molto Alta" :
    absScore >= 7 ? "Alta" :
    absScore >= 4.5 ? "Media" :
    absScore >= 2.8 ? "Debole" :
    "Bassa";

  return {
    score,
    confidence,
    threshold: Math.max(atr30m * 0.18, price * 0.0004),
    expectedMove: Math.max(atr30m * 0.65, atr15m * 1.0),
    reasons: reasons.slice(0, 5)
  };
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

function calculateTradability(data) {
  const {
    directionData,
    signalQuality,
    marketRegime,
    price,
    support,
    resistance,
    atr30m
  } = data;

  const score = directionData.score;
  const absScore = Math.abs(score);

  const direction =
    score >= 4.5 ? "bullish" :
    score <= -4.5 ? "bearish" :
    "neutral";

  const badRegime =
    marketRegime === "choppy" ||
    marketRegime === "conflict" ||
    marketRegime === "low_volatility";

  const distanceFromResistance = Math.abs(resistance - price);
  const distanceFromSupport = Math.abs(price - support);

  const tooCloseToResistance = direction === "bullish" && distanceFromResistance < atr30m * 0.8;
  const tooCloseToSupport = direction === "bearish" && distanceFromSupport < atr30m * 0.8;

  let tradable = true;
  const reasons = [];

  if (direction === "neutral") {
    tradable = false;
    reasons.push("Direzione non sufficientemente chiara");
  }

  if (absScore < 5.2) {
    tradable = false;
    reasons.push("Score tecnico non abbastanza forte");
  }

  if (signalQuality.overall < 62) {
    tradable = false;
    reasons.push("Qualita complessiva del segnale sotto soglia");
  }

  if (badRegime) {
    tradable = false;
    reasons.push("Regime di mercato poco affidabile");
  }

  if (tooCloseToResistance) {
    tradable = false;
    reasons.push("Prezzo troppo vicino alla resistenza");
  }

  if (tooCloseToSupport) {
    tradable = false;
    reasons.push("Prezzo troppo vicino al supporto");
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
    return {
      type: "neutral",
      action: "wait",
      horizon: "30m",
      interpretation: "Scenario operativo: attendere.",
      main: {
        probability: signalQuality.overall,
        title: "Nessun ingresso consigliato",
        description:
          "Il mercato non offre una condizione abbastanza pulita per un segnale operativo affidabile. " +
          buildWhyText(reasons, structure15m, structure30m, structure1h),
        label1: "Motivo principale",
        value1: tradability.reasons[0] || "Segnale non sufficientemente chiaro",
        label2: "Regime mercato",
        value2: marketRegime
      },
      secondary: {
        probability: Math.max(20, Math.round(signalQuality.overall * 0.45)),
        title: "Attendere conferma",
        description:
          "Meglio attendere una rottura chiara della zona alta o bassa prima di considerare una direzione.",
        label1: "Sopra",
        value1: resistanceText,
        label2: "Sotto",
        value2: supportText
      },
      alternative: {
        probability: 100 - Math.min(85, signalQuality.overall),
        title: "Possibile falso segnale",
        description:
          "In condizioni sporche o laterali XAU/USD puo generare movimenti rapidi ma poco affidabili.",
        label1: "Range operativo",
        value1: operatingRange,
        label2: "RSI M30",
        value2: rsi30m.toFixed(2)
      },
      evaluation: {
        direction: "neutral",
        entryPrice: Number(priceText),
        threshold: round(threshold),
        expectedMove: round(expectedMove),
        rule: "Scenario corretto se il prezzo resta poco direzionale o non supera zone chiave con conferma."
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

/* -------------------------------------------------------------------------- */
/* File separato consigliato: /api/history.js                                 */
/* -------------------------------------------------------------------------- */

/*
const HISTORY_KEY = "auren:history";

export default async function handler(req, res) {
  try {
    const items = await kvGet(HISTORY_KEY);

    return res.status(200).json({
      items: Array.isArray(items) ? items : []
    });
  } catch (error) {
    return res.status(500).json({
      error: "Errore durante il caricamento dello storico",
      details: error.message
    });
  }
}

async function kvGet(key) {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;

  if (!url || !token) {
    return [];
  }

  const response = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  if (!response.ok) {
    return [];
  }

  const data = await response.json();

  if (!data || data.result === null || data.result === undefined) {
    return [];
  }

  if (typeof data.result === "string") {
    try {
      return JSON.parse(data.result);
    } catch {
      return [];
    }
  }

  return data.result;
}
*/

