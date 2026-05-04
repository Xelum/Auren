export default async function handler(req, res) {
  const API_KEY = process.env.TWELVE_DATA_API_KEY;

  if (!API_KEY) {
    return res.status(500).json({
      error: "API key mancante. Controlla TWELVE_DATA_API_KEY su Vercel."
    });
  }

  const now = new Date();
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
    const [tf15, tf1h, tf4h, tf1d] = await Promise.all([
      fetchCandles("15min", API_KEY, 120),
      fetchCandles("1h", API_KEY, 180),
      fetchCandles("4h", API_KEY, 180),
      fetchCandles("1day", API_KEY, 120)
    ]);

    const last = tf1h[tf1h.length - 1];
    const price = last.close;

    const ema20_15m = ema(tf15.map(c => c.close), 20);
    const ema50_15m = ema(tf15.map(c => c.close), 50);

    const ema20_1h = ema(tf1h.map(c => c.close), 20);
    const ema50_1h = ema(tf1h.map(c => c.close), 50);

    const ema20_4h = ema(tf4h.map(c => c.close), 20);
    const ema50_4h = ema(tf4h.map(c => c.close), 50);

    const ema20_1d = ema(tf1d.map(c => c.close), 20);
    const ema50_1d = ema(tf1d.map(c => c.close), 50);

    const rsi1h = rsi(tf1h.map(c => c.close), 14);
    const atr1h = atr(tf1h, 14);
    const atr4h = atr(tf4h, 14);

    const support = findMeaningfulSupport({
      candles1h: tf1h,
      candles4h: tf4h,
      candles1d: tf1d,
      price,
      atr1h,
      atr4h
    });

    const resistance = findMeaningfulResistance({
      candles1h: tf1h,
      candles4h: tf4h,
      candles1d: tf1d,
      price,
      atr1h,
      atr4h
    });

    const structure1h = marketStructure(tf1h);
    const structure4h = marketStructure(tf4h);

    const volatilityRatio = atr1h / price;

    let score = 0;

    if (price > ema20_1d && ema20_1d > ema50_1d) score += 2;
    if (price < ema20_1d && ema20_1d < ema50_1d) score -= 2;

    if (price > ema20_4h && ema20_4h > ema50_4h) score += 3;
    if (price < ema20_4h && ema20_4h < ema50_4h) score -= 3;

    if (price > ema20_1h && ema20_1h > ema50_1h) score += 3;
    if (price < ema20_1h && ema20_1h < ema50_1h) score -= 3;

    if (ema20_15m > ema50_15m) score += 1;
    if (ema20_15m < ema50_15m) score -= 1;

    if (structure4h === "bullish") score += 2;
    if (structure4h === "bearish") score -= 2;

    if (structure1h === "bullish") score += 1.5;
    if (structure1h === "bearish") score -= 1.5;

    if (rsi1h > 55 && rsi1h < 70) score += 1;
    if (rsi1h < 45 && rsi1h > 30) score -= 1;

    if (rsi1h >= 72) score -= 1.5;
    if (rsi1h <= 28) score += 1.5;

    const distanceFromResistance = Math.abs(resistance - price);
    const distanceFromSupport = Math.abs(price - support);

    if (distanceFromResistance < atr1h * 1.2 && score > 0) score -= 1.5;
    if (distanceFromSupport < atr1h * 1.2 && score < 0) score += 1.5;

    if (volatilityRatio < 0.0016) {
      score *= 0.65;
    }

    const scenario = buildScenario({
      score,
      price,
      support,
      resistance,
      atr1h,
      atr4h,
      rsi1h,
      structure1h,
      structure4h
    });

    return res.status(200).json({
      market: "XAU/USD",
      price: Number(price.toFixed(2)),
      support: Number(support.toFixed(2)),
      resistance: Number(resistance.toFixed(2)),
      rsi: Number(rsi1h.toFixed(2)),
      atr: Number(atr1h.toFixed(2)),
      atr4h: Number(atr4h.toFixed(2)),
      score: Number(score.toFixed(2)),
      structure1h,
      structure4h,
      updatedAt: now.toISOString(),
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

function marketStructure(candles) {
  const recent = candles.slice(-20);

  const firstHalf = recent.slice(0, 10);
  const secondHalf = recent.slice(10);

  const firstHigh = Math.max(...firstHalf.map(c => c.high));
  const secondHigh = Math.max(...secondHalf.map(c => c.high));

  const firstLow = Math.min(...firstHalf.map(c => c.low));
  const secondLow = Math.min(...secondHalf.map(c => c.low));

  if (secondHigh > firstHigh && secondLow > firstLow) return "bullish";
  if (secondHigh < firstHigh && secondLow < firstLow) return "bearish";

  return "neutral";
}

function findMeaningfulSupport({ candles1h, candles4h, candles1d, price, atr1h, atr4h }) {
  const minDistance = Math.max(atr1h * 1.8, price * 0.0025);

  const levels = [
    ...extractSwingLows(candles1h, 2),
    ...extractSwingLows(candles4h, 2),
    ...extractSwingLows(candles1d, 2)
  ];

  const valid = levels
    .filter(level => level < price - minDistance)
    .map(level => ({
      level,
      score: levelStrength(level, levels, Math.max(atr1h * 0.7, price * 0.0012))
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.level - a.level;
    });

  if (valid.length > 0) {
    return valid[0].level;
  }

  return price - Math.max(atr4h * 0.9, atr1h * 3, price * 0.004);
}

function findMeaningfulResistance({ candles1h, candles4h, candles1d, price, atr1h, atr4h }) {
  const minDistance = Math.max(atr1h * 1.8, price * 0.0025);

  const levels = [
    ...extractSwingHighs(candles1h, 2),
    ...extractSwingHighs(candles4h, 2),
    ...extractSwingHighs(candles1d, 2)
  ];

  const valid = levels
    .filter(level => level > price + minDistance)
    .map(level => ({
      level,
      score: levelStrength(level, levels, Math.max(atr1h * 0.7, price * 0.0012))
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.level - b.level;
    });

  if (valid.length > 0) {
    return valid[0].level;
  }

  return price + Math.max(atr4h * 0.9, atr1h * 3, price * 0.004);
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
    price,
    support,
    resistance,
    atr1h,
    atr4h,
    rsi1h,
    structure1h,
    structure4h
  } = data;

  const strongBullish = score >= 7;
  const bullish = score >= 3.5 && score < 7;
  const neutral = score > -3.5 && score < 3.5;
  const bearish = score <= -3.5 && score > -7;
  const strongBearish = score <= -7;

  const supportText = support.toFixed(2);
  const resistanceText = resistance.toFixed(2);

  const operatingRange = supportText + " - " + resistanceText;
  const atrText = atr1h.toFixed(2);

  if (strongBearish || bearish) {
    const mainProb = strongBearish ? 72 : 63;
    const secondProb = strongBearish ? 18 : 27;
    const altProb = 100 - mainProb - secondProb;

    return {
      type: "bearish",
      main: {
        probability: mainProb,
        title: "Bias ribassista",
        description:
          "La pressione principale resta orientata al ribasso. Finché il prezzo rimane sotto la zona di resistenza, il mercato conserva una lettura debole.",
        label1: "Target / supporto utile",
        value1: supportText,
        label2: "Invalidazione",
        value2: "sopra " + resistanceText
      },
      secondary: {
        probability: secondProb,
        title: "Rimbalzo correttivo",
        description:
          "Un recupero tecnico è possibile, ma sarebbe considerato solo una correzione finché non avviene una rottura stabile della resistenza.",
        label1: "Area di rimbalzo",
        value1: resistanceText,
        label2: "Forza",
        value2: strongBearish ? "Bassa" : "Media"
      },
      alternative: {
        probability: altProb,
        title: "Cambio scenario rialzista",
        description:
          "Lo scenario ribassista verrebbe indebolito da una chiusura convincente sopra la resistenza, soprattutto se accompagnata da struttura 1H e 4H in miglioramento.",
        label1: "Range operativo",
        value1: operatingRange,
        label2: "RSI 1H",
        value2: rsi1h.toFixed(2)
      }
    };
  }

  if (strongBullish || bullish) {
    const mainProb = strongBullish ? 72 : 63;
    const secondProb = strongBullish ? 18 : 27;
    const altProb = 100 - mainProb - secondProb;

    return {
      type: "bullish",
      main: {
        probability: mainProb,
        title: "Bias rialzista",
        description:
          "La pressione principale resta orientata al rialzo. Finché il prezzo mantiene la zona di supporto, il mercato conserva una lettura costruttiva.",
        label1: "Target / resistenza utile",
        value1: resistanceText,
        label2: "Invalidazione",
        value2: "sotto " + supportText
      },
      secondary: {
        probability: secondProb,
        title: "Ritracciamento tecnico",
        description:
          "Un ritorno verso il supporto resta possibile prima di una nuova spinta. La lettura rimane positiva finché la zona chiave viene mantenuta.",
        label1: "Area di ritracciamento",
        value1: supportText,
        label2: "Forza",
        value2: strongBullish ? "Bassa" : "Media"
      },
      alternative: {
        probability: altProb,
        title: "Perdita di momentum",
        description:
          "Lo scenario rialzista perderebbe forza in caso di rottura del supporto, soprattutto con chiusure orarie deboli e peggioramento della struttura.",
        label1: "Range operativo",
        value1: operatingRange,
        label2: "RSI 1H",
        value2: rsi1h.toFixed(2)
      }
    };
  }

  return {
    type: "neutral",
    main: {
      probability: 45,
      title: "Mercato laterale",
      description:
        "Il mercato non mostra una direzione abbastanza pulita. In questa fase il segnale principale è attendere una conferma fuori dal range operativo.",
      label1: "Range operativo",
      value1: operatingRange,
      label2: "Volatilità ATR",
      value2: atrText
    },
    secondary: {
      probability: 35,
      title: "Breakout direzionale",
      description:
        "Una rottura confermata sopra resistenza o sotto supporto potrebbe riattivare momentum. Prima della rottura, il rischio di falso segnale resta elevato.",
      label1: "Sopra resistenza",
      value1: resistanceText,
      label2: "Sotto supporto",
      value2: supportText
    },
    alternative: {
      probability: 20,
      title: "Falso breakout",
      description:
        "In fase laterale possono verificarsi movimenti rapidi ma poco affidabili. Serve conferma con chiusure coerenti e aumento della volatilità.",
      label1: "Struttura 1H",
      value1: structure1h,
      label2: "Struttura 4H",
      value2: structure4h
    }
  };
}
