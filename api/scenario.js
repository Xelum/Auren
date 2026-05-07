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

    const rsi15m = rsi(closes15, 14);
    const rsi30m = rsi(closes30, 14);
    const rsi1h = rsi(closes1h, 14);

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
      recentRange30m
    });

    const scenario = buildScenario({
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
      slope1h
    });

    return res.status(200).json({
      market: "XAU/USD",
      horizon: "30m",
      price: Number(price.toFixed(2)),
      support: Number(support.toFixed(2)),
      resistance: Number(resistance.toFixed(2)),
      rsi15m: Number(rsi15m.toFixed(2)),
      rsi30m: Number(rsi30m.toFixed(2)),
      rsi: Number(rsi1h.toFixed(2)),
      atr15m: Number(atr15m.toFixed(2)),
      atr30m: Number(atr30m.toFixed(2)),
      atr: Number(atr1h.toFixed(2)),
      atr4h: Number(atr4h.toFixed(2)),
      score: Number(directionData.score.toFixed(2)),
      confidence: directionData.confidence,
      threshold: Number(directionData.threshold.toFixed(2)),
      expectedMove: Number(directionData.expectedMove.toFixed(2)),
      structure15m,
      structure30m,
      structure1h,
      structure4h,
      momentum: {
        m15: Number(momentum15m.toFixed(2)),
        m30: Number(momentum30m.toFixed(2))
      },
      impulse: {
        m15: impulse15m,
        m30: impulse30m
      },
      slopes: {
        m15: Number(slope15m.toFixed(2)),
        m30: Number(slope30m.toFixed(2)),
        h1: Number(slope1h.toFixed(2))
      },
      updatedAt: analysisTime.toISOString(),
      nextUpdateAt: nextUpdate.toISOString(),
      cacheSeconds: secondsUntilNextUpdate,
      scenario
    });
  } catch (error) {
    return res.status(500).json({
      error: "Errore durante il calcolo dello scenario",
      details: error.message
    });
  }
}

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

function rsi(values, period) {
  if (!values || values.length < period + 1) return 50;

  let gains = 0;
  let losses = 0;

  for (let i = values.length - period; i < values.length; i++) {
    const diff = values[i] - values[i - 1];

    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }

  if (losses === 0) return 100;

  const rs = gains / losses;
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
      strength: 0
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
    strength: Number(strength.toFixed(2)),
    bodyRatio: Number(bodyRatio.toFixed(2)),
    atrRatio: Number(atrRatio.toFixed(2))
  };
}

function recentRange(candles, length = 10) {
  const recent = candles.slice(-length);

  if (!recent.length) {
    return {
      high: 0,
      low: 0,
      middle: 0
    };
  }

  const high = Math.max(...recent.map(c => c.high));
  const low = Math.min(...recent.map(c => c.low));

  return {
    high,
    low,
    middle: (high + low) / 2
  };
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
    recentRange30m
  } = data;

  let score = 0;
  const reasons = [];

  // M30 is the main timeframe for the 30-minute output.
  if (price > ema9_30m && ema9_30m > ema21_30m && ema21_30m > ema50_30m) {
    score += 3.2;
    reasons.push("M30 mostra medie allineate al rialzo");
  } else if (price < ema9_30m && ema9_30m < ema21_30m && ema21_30m < ema50_30m) {
    score -= 3.2;
    reasons.push("M30 mostra medie allineate al ribasso");
  } else if (price > ema21_30m && ema21_30m > ema50_30m) {
    score += 1.8;
    reasons.push("M30 resta costruttivo sopra le medie principali");
  } else if (price < ema21_30m && ema21_30m < ema50_30m) {
    score -= 1.8;
    reasons.push("M30 resta debole sotto le medie principali");
  }

  // M15 gives fast confirmation.
  if (price > ema9_15m && ema9_15m > ema21_15m && ema21_15m > ema50_15m) {
    score += 2.2;
    reasons.push("M15 conferma spinta veloce al rialzo");
  } else if (price < ema9_15m && ema9_15m < ema21_15m && ema21_15m < ema50_15m) {
    score -= 2.2;
    reasons.push("M15 conferma spinta veloce al ribasso");
  } else if (price > ema21_15m) {
    score += 0.8;
  } else if (price < ema21_15m) {
    score -= 0.8;
  }

  // H1 confirms but does not dominate.
  if (price > ema20_1h && ema20_1h > ema50_1h) {
    score += 1.5;
    reasons.push("H1 conferma contesto positivo");
  }
  if (price < ema20_1h && ema20_1h < ema50_1h) {
    score -= 1.5;
    reasons.push("H1 conferma contesto debole");
  }

  // H4 and D1 are only filters.
  if (price > ema20_4h && ema20_4h > ema50_4h) score += 0.7;
  if (price < ema20_4h && ema20_4h < ema50_4h) score -= 0.7;

  if (price > ema20_1d && ema20_1d > ema50_1d) score += 0.3;
  if (price < ema20_1d && ema20_1d < ema50_1d) score -= 0.3;

  // Market structure.
  if (structure30m === "bullish") score += 2.0;
  if (structure30m === "bearish") score -= 2.0;

  if (structure15m === "bullish") score += 1.2;
  if (structure15m === "bearish") score -= 1.2;

  if (structure1h === "bullish") score += 1.0;
  if (structure1h === "bearish") score -= 1.0;

  if (structure4h === "bullish") score += 0.4;
  if (structure4h === "bearish") score -= 0.4;

  // EMA slope / short-term acceleration.
  score += clamp(slope30m, -1.8, 1.8) * 1.2;
  score += clamp(slope15m, -1.5, 1.5) * 0.8;
  score += clamp(slope1h, -1.0, 1.0) * 0.5;

  // Recent price momentum.
  score += clamp(momentum30m, -2.0, 2.0) * 1.2;
  score += clamp(momentum15m, -1.8, 1.8) * 0.8;

  // Last candle impulse.
  if (impulse30m.direction === "bullish") score += impulse30m.strength;
  if (impulse30m.direction === "bearish") score -= impulse30m.strength;

  if (impulse15m.direction === "bullish") score += impulse15m.strength * 0.6;
  if (impulse15m.direction === "bearish") score -= impulse15m.strength * 0.6;

  // RSI interpretation for 30-minute horizon.
  if (rsi30m >= 54 && rsi30m <= 68) score += 1.2;
  if (rsi30m <= 46 && rsi30m >= 32) score -= 1.2;

  if (rsi15m >= 55 && rsi15m <= 68) score += 0.8;
  if (rsi15m <= 45 && rsi15m >= 32) score -= 0.8;

  // Avoid chasing extreme short-term overextension.
  if (rsi15m >= 76 && score > 0) score -= 1.3;
  if (rsi15m <= 24 && score < 0) score += 1.3;

  if (rsi30m >= 74 && score > 0) score -= 1.0;
  if (rsi30m <= 26 && score < 0) score += 1.0;

  // Breakout from recent M30 range.
  const breakoutBuffer = Math.max(atr30m * 0.12, price * 0.00025);

  if (price > recentRange30m.high - breakoutBuffer && score > 0) {
    score += 0.8;
    reasons.push("Prezzo vicino alla parte alta del range M30");
  }

  if (price < recentRange30m.low + breakoutBuffer && score < 0) {
    score -= 0.8;
    reasons.push("Prezzo vicino alla parte bassa del range M30");
  }

  // Support / resistance risk control.
  const distanceFromResistance = Math.abs(resistance - price);
  const distanceFromSupport = Math.abs(price - support);

  if (distanceFromResistance < atr30m * 1.0 && score > 0) {
    score -= 1.8;
    reasons.push("Prezzo vicino a una zona di blocco");
  }

  if (distanceFromSupport < atr30m * 1.0 && score < 0) {
    score += 1.8;
    reasons.push("Prezzo vicino a una zona di rimbalzo");
  }

  // Low volatility means lower reliability.
  const volatilityRatio = atr30m / price;
  if (volatilityRatio < 0.0010) {
    score *= 0.68;
    reasons.push("Volatilita bassa: segnale meno pulito");
  } else if (volatilityRatio < 0.0014) {
    score *= 0.82;
  }

  // If M15 and M30 are opposite, reduce conviction.
  const fastConflict =
    (structure15m === "bullish" && structure30m === "bearish") ||
    (structure15m === "bearish" && structure30m === "bullish");

  if (fastConflict) {
    score *= 0.72;
    reasons.push("M15 e M30 non sono allineati");
  }

  const absScore = Math.abs(score);

  const confidence =
    absScore >= 8 ? "Alta" :
    absScore >= 4.5 ? "Media" :
    absScore >= 2.5 ? "Debole" :
    "Bassa";

  return {
    score,
    confidence,
    threshold: Math.max(atr30m * 0.15, price * 0.00035),
    expectedMove: Math.max(atr30m * 0.55, atr15m * 0.9),
    reasons: reasons.slice(0, 4)
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
  atr1h,
  atr4h
}) {
  const minDistance = Math.max(atr30m * 1.2, price * 0.0012);

  const levels = [
    ...extractSwingLows(candles15m, 2),
    ...extractSwingLows(candles30m, 2),
    ...extractSwingLows(candles1h, 2),
    ...extractSwingLows(candles4h, 2),
    ...extractSwingLows(candles1d, 2)
  ];

  const valid = levels
    .filter(level => level < price - minDistance)
    .map(level => ({
      level,
      score: levelStrength(level, levels, Math.max(atr30m * 0.7, price * 0.0009))
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
  atr1h,
  atr4h
}) {
  const minDistance = Math.max(atr30m * 1.2, price * 0.0012);

  const levels = [
    ...extractSwingHighs(candles15m, 2),
    ...extractSwingHighs(candles30m, 2),
    ...extractSwingHighs(candles1h, 2),
    ...extractSwingHighs(candles4h, 2),
    ...extractSwingHighs(candles1d, 2)
  ];

  const valid = levels
    .filter(level => level > price + minDistance)
    .map(level => ({
      level,
      score: levelStrength(level, levels, Math.max(atr30m * 0.7, price * 0.0009))
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

function buildScenario(data) {
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
    structure1h
  } = data;

  const strongBullish = score >= 8;
  const bullish = score >= 4.5 && score < 8;
  const neutral = score > -4.5 && score < 4.5;
  const bearish = score <= -4.5 && score > -8;
  const strongBearish = score <= -8;

  const supportText = support.toFixed(2);
  const resistanceText = resistance.toFixed(2);
  const priceText = price.toFixed(2);
  const operatingRange = supportText + " - " + resistanceText;
  const atrText = atr30m.toFixed(2);

  const whyText = buildWhyText(reasons, structure15m, structure30m, structure1h);

  if (strongBearish || bearish) {
    const mainProb = strongBearish ? 70 : 61;
    const secondProb = strongBearish ? 20 : 29;
    const altProb = 100 - mainProb - secondProb;

    return {
      type: "bearish",
      horizon: "30m",
      interpretation: "Direzione attesa nei prossimi 30 minuti: ribassista.",
      main: {
        probability: mainProb,
        title: "Pressione ribassista a 30 minuti",
        description:
          "Nel breve termine il mercato mostra maggiore pressione in discesa. " +
          "Lo scenario resta valido finche' il prezzo rimane sotto la zona di blocco indicata. " +
          whyText,
        label1: "Prima zona da osservare",
        value1: supportText,
        label2: "Scenario cambia se",
        value2: "sopra " + resistanceText
      },
      secondary: {
        probability: secondProb,
        title: "Possibile rimbalzo temporaneo",
        description:
          "Un recupero tecnico puo avvenire, ma per ora viene letto come reazione temporanea se non supera la zona alta.",
        label1: "Zona di possibile rimbalzo",
        value1: resistanceText,
        label2: "Chiarezza",
        value2: confidence
      },
      alternative: {
        probability: altProb,
        title: "Cambio direzione",
        description:
          "La lettura ribassista perderebbe forza se il prezzo tornasse sopra la zona di blocco con movimento chiaro su M15 e M30.",
        label1: "Area complessiva",
        value1: operatingRange,
        label2: "RSI M30",
        value2: rsi30m.toFixed(2)
      },
      evaluation: {
        direction: "bearish",
        entryPrice: Number(priceText),
        threshold: Number(threshold.toFixed(2)),
        expectedMove: Number(expectedMove.toFixed(2)),
        rule: "Corretto se dopo 30 minuti il prezzo e' inferiore al prezzo di analisi oltre la soglia minima."
      }
    };
  }

  if (strongBullish || bullish) {
    const mainProb = strongBullish ? 70 : 61;
    const secondProb = strongBullish ? 20 : 29;
    const altProb = 100 - mainProb - secondProb;

    return {
      type: "bullish",
      horizon: "30m",
      interpretation: "Direzione attesa nei prossimi 30 minuti: rialzista.",
      main: {
        probability: mainProb,
        title: "Pressione rialzista a 30 minuti",
        description:
          "Nel breve termine il mercato mostra maggiore pressione in salita. " +
          "Lo scenario resta valido finche' il prezzo mantiene la zona di rimbalzo indicata. " +
          whyText,
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
          "La lettura rialzista perderebbe forza se il prezzo scendesse sotto la zona di rimbalzo con movimento chiaro su M15 e M30.",
        label1: "Area complessiva",
        value1: operatingRange,
        label2: "RSI M30",
        value2: rsi30m.toFixed(2)
      },
      evaluation: {
        direction: "bullish",
        entryPrice: Number(priceText),
        threshold: Number(threshold.toFixed(2)),
        expectedMove: Number(expectedMove.toFixed(2)),
        rule: "Corretto se dopo 30 minuti il prezzo e' superiore al prezzo di analisi oltre la soglia minima."
      }
    };
  }

  return {
    type: "neutral",
    horizon: "30m",
    interpretation: "Direzione attesa nei prossimi 30 minuti: laterale.",
    main: {
      probability: 45,
      title: "Mercato laterale a 30 minuti",
      description:
        "Nel breve termine il mercato non mostra una direzione abbastanza pulita. " +
        "In questa fase e' meglio attendere una conferma fuori dall'area principale. " +
        whyText,
      label1: "Area complessiva",
      value1: operatingRange,
      label2: "Movimento medio M30",
      value2: atrText
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
        "In fase laterale possono verificarsi movimenti rapidi ma poco affidabili. Serve conferma su M15 e M30.",
      label1: "Struttura M30",
      value1: structure30m,
      label2: "Struttura H1",
      value2: structure1h
    },
    evaluation: {
      direction: "neutral",
      entryPrice: Number(priceText),
      threshold: Number(threshold.toFixed(2)),
      expectedMove: Number(expectedMove.toFixed(2)),
      rule: "Corretto se dopo 30 minuti il prezzo resta vicino al prezzo di analisi entro la soglia minima."
    }
  };
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
