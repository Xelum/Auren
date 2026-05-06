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
      fetchCandles("15min", API_KEY, 160),
      fetchCandles("30min", API_KEY, 160),
      fetchCandles("1h", API_KEY, 180),
      fetchCandles("4h", API_KEY, 180),
      fetchCandles("1day", API_KEY, 120)
    ]);

    const last = tf30[tf30.length - 1];
    const price = last.close;

    const ema20_15m = ema(tf15.map(c => c.close), 20);
    const ema50_15m = ema(tf15.map(c => c.close), 50);

    const ema20_30m = ema(tf30.map(c => c.close), 20);
    const ema50_30m = ema(tf30.map(c => c.close), 50);

    const ema20_1h = ema(tf1h.map(c => c.close), 20);
    const ema50_1h = ema(tf1h.map(c => c.close), 50);

    const ema20_4h = ema(tf4h.map(c => c.close), 20);
    const ema50_4h = ema(tf4h.map(c => c.close), 50);

    const ema20_1d = ema(tf1d.map(c => c.close), 20);
    const ema50_1d = ema(tf1d.map(c => c.close), 50);

    const rsi15m = rsi(tf15.map(c => c.close), 14);
    const rsi30m = rsi(tf30.map(c => c.close), 14);
    const rsi1h = rsi(tf1h.map(c => c.close), 14);

    const atr15m = atr(tf15, 14);
    const atr30m = atr(tf30, 14);
    const atr1h = atr(tf1h, 14);
    const atr4h = atr(tf4h, 14);

    const structure15m = marketStructure(tf15);
    const structure30m = marketStructure(tf30);
    const structure1h = marketStructure(tf1h);
    const structure4h = marketStructure(tf4h);

    const volume15m = volumeAnalysis(tf15);
    const volume30m = volumeAnalysis(tf30);
    const volume1h = volumeAnalysis(tf1h);

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

    let score = 0;

    // D1 - contesto macro leggero
    if (price > ema20_1d && ema20_1d > ema50_1d) score += 1;
    if (price < ema20_1d && ema20_1d < ema50_1d) score -= 1;

    // H4 - contesto principale
    if (price > ema20_4h && ema20_4h > ema50_4h) score += 2;
    if (price < ema20_4h && ema20_4h < ema50_4h) score -= 2;

    // H1 - struttura breve
    if (price > ema20_1h && ema20_1h > ema50_1h) score += 2.5;
    if (price < ema20_1h && ema20_1h < ema50_1h) score -= 2.5;

    // M30 - timeframe operativo principale
    if (price > ema20_30m && ema20_30m > ema50_30m) score += 2.2;
    if (price < ema20_30m && ema20_30m < ema50_30m) score -= 2.2;

    // M15 - conferma rapida
    if (price > ema20_15m && ema20_15m > ema50_15m) score += 1.3;
    if (price < ema20_15m && ema20_15m < ema50_15m) score -= 1.3;

    // Struttura mercato
    if (structure4h === "bullish") score += 1.5;
    if (structure4h === "bearish") score -= 1.5;

    if (structure1h === "bullish") score += 2;
    if (structure1h === "bearish") score -= 2;

    if (structure30m === "bullish") score += 1.7;
    if (structure30m === "bearish") score -= 1.7;

    if (structure15m === "bullish") score += 0.8;
    if (structure15m === "bearish") score -= 0.8;

    // RSI multi timeframe
    if (rsi1h > 55 && rsi1h < 70) score += 1;
    if (rsi1h < 45 && rsi1h > 30) score -= 1;

    if (rsi30m > 55 && rsi30m < 70) score += 0.8;
    if (rsi30m < 45 && rsi30m > 30) score -= 0.8;

    if (rsi15m >= 72) score -= 0.8;
    if (rsi15m <= 28) score += 0.8;

    // Volumi M30
    if (volume30m.direction === "bullish" && volume30m.status !== "basso") {
      score += volume30m.strength;
    }

    if (volume30m.direction === "bearish" && volume30m.status !== "basso") {
      score -= volume30m.strength;
    }

    // Volumi H1
    if (volume1h.direction === "bullish" && volume1h.status === "alto") {
      score += 1;
    }

    if (volume1h.direction === "bearish" && volume1h.status === "alto") {
      score -= 1;
    }

    // Penalizza segnali con volume basso
    if (volume30m.status === "basso") {
      score *= 0.82;
    }

    const distanceFromResistance = Math.abs(resistance - price);
    const distanceFromSupport = Math.abs(price - support);

    if (distanceFromResistance < atr30m * 1.4 && score > 0) score -= 1.2;
    if (distanceFromSupport < atr30m * 1.4 && score < 0) score += 1.2;

    const volatilityRatio = atr30m / price;

    if (volatilityRatio < 0.0012) {
      score *= 0.7;
    }

    const scenario = buildScenario({
      score,
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
      volume15m,
      volume30m,
      volume1h
    });

    return res.status(200).json({
      market: "XAU/USD",
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
      score: Number(score.toFixed(2)),
      structure15m,
      structure30m,
      structure1h,
      structure4h,
      volume: {
        m15: volume15m,
        m30: volume30m,
        h1: volume1h
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
      close: Number(item.close),
      volume: Number(item.volume || 0)
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
  const recent = candles.slice(-24);

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

function volumeAnalysis(candles, period = 20) {
  const recent = candles.slice(-period);
  const last = candles[candles.length - 1];

  if (!recent.length || !last || !last.volume) {
    return {
      status: "unknown",
      direction: "neutral",
      ratio: 0,
      strength: 0,
      message: "Volumi non disponibili per questa lettura."
    };
  }

  const avgVolume =
    recent.reduce((sum, c) => sum + (c.volume || 0), 0) / recent.length;

  const lastVolume = last.volume;
  const volumeRatio = avgVolume > 0 ? lastVolume / avgVolume : 1;

  const candleDirection =
    last.close > last.open ? "bullish" :
    last.close < last.open ? "bearish" :
    "neutral";

  let status = "normale";
  let strength = 0;

  if (volumeRatio >= 1.6) {
    status = "alto";
    strength = 1.5;
  } else if (volumeRatio >= 1.2) {
    status = "sopra media";
    strength = 0.8;
  } else if (volumeRatio <= 0.65) {
    status = "basso";
    strength = -0.8;
  }

  let message = "I volumi sono nella media.";

  if (status === "alto" && candleDirection === "bullish") {
    message = "I volumi stanno aumentando durante la salita.";
  }

  if (status === "alto" && candleDirection === "bearish") {
    message = "I volumi stanno aumentando durante la discesa.";
  }

  if (status === "sopra media" && candleDirection === "bullish") {
    message = "La salita e' accompagnata da volumi sopra la media.";
  }

  if (status === "sopra media" && candleDirection === "bearish") {
    message = "La discesa e' accompagnata da volumi sopra la media.";
  }

  if (status === "basso") {
    message = "Il movimento attuale mostra volumi bassi, quindi il segnale e' meno forte.";
  }

  return {
    status,
    direction: candleDirection,
    ratio: Number(volumeRatio.toFixed(2)),
    strength,
    message
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
  const minDistance = Math.max(atr30m * 1.8, price * 0.0018);

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
      score: levelStrength(level, levels, Math.max(atr30m * 0.8, price * 0.001))
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.level - a.level;
    });

  if (valid.length > 0) {
    return valid[0].level;
  }

  return price - Math.max(atr4h * 0.7, atr1h * 2, atr30m * 3, price * 0.003);
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
  const minDistance = Math.max(atr30m * 1.8, price * 0.0018);

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
      score: levelStrength(level, levels, Math.max(atr30m * 0.8, price * 0.001))
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.level - b.level;
    });

  if (valid.length > 0) {
    return valid[0].level;
  }

  return price + Math.max(atr4h * 0.7, atr1h * 2, atr30m * 3, price * 0.003);
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
    atr30m,
    atr1h,
    rsi1h,
    structure30m,
    structure1h,
    structure4h,
    volume30m,
    volume1h
  } = data;

  const strongBullish = score >= 8;
  const bullish = score >= 4 && score < 8;
  const neutral = score > -4 && score < 4;
  const bearish = score <= -4 && score > -8;
  const strongBearish = score <= -8;

  const supportText = support.toFixed(2);
  const resistanceText = resistance.toFixed(2);

  const operatingRange = supportText + " - " + resistanceText;
  const atrText = atr30m.toFixed(2);

  const volumeMessage =
    volume30m && volume30m.message
      ? volume30m.message
      : "I volumi non aggiungono conferme rilevanti in questa fase.";

  const signalStrength =
    Math.abs(score) >= 8 ? "Alta" :
    Math.abs(score) >= 4 ? "Media" :
    "Bassa";

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
          "La pressione principale resta orientata al ribasso. Il segnale e' piu affidabile finche' il prezzo rimane sotto la zona di blocco indicata. " +
          volumeMessage,
        label1: "Target / supporto utile",
        value1: supportText,
        label2: "Invalidazione",
        value2: "sopra " + resistanceText
      },
      secondary: {
        probability: secondProb,
        title: "Rimbalzo correttivo",
        description:
          "Un recupero tecnico e' possibile, ma sarebbe considerato solo una correzione finche' non avviene un superamento chiaro della zona di blocco.",
        label1: "Area di rimbalzo",
        value1: resistanceText,
        label2: "Forza",
        value2: signalStrength
      },
      alternative: {
        probability: altProb,
        title: "Cambio scenario rialzista",
        description:
          "Lo scenario di discesa verrebbe indebolito da un movimento chiaro sopra la zona di blocco, soprattutto se accompagnato da volumi in aumento e struttura M30/H1 in miglioramento.",
        label1: "Range operativo",
        value1: operatingRange,
        label2: "RSI 1H",
        value2: rsi1h.toFixed(2)
      },
      volumeNote: volumeMessage
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
          "La pressione principale resta orientata al rialzo. Il segnale e' piu affidabile finche' il prezzo mantiene la zona di rimbalzo indicata. " +
          volumeMessage,
        label1: "Target / resistenza utile",
        value1: resistanceText,
        label2: "Invalidazione",
        value2: "sotto " + supportText
      },
      secondary: {
        probability: secondProb,
        title: "Ritracciamento tecnico",
        description:
          "Un ritorno verso la zona di rimbalzo resta possibile prima di una nuova spinta. La lettura rimane positiva finche' la zona chiave viene mantenuta.",
        label1: "Area di ritracciamento",
        value1: supportText,
        label2: "Forza",
        value2: signalStrength
      },
      alternative: {
        probability: altProb,
        title: "Perdita di momentum",
        description:
          "Lo scenario di salita perderebbe forza in caso di rottura della zona di rimbalzo, soprattutto con volumi in aumento sulla discesa e peggioramento della struttura M30/H1.",
        label1: "Range operativo",
        value1: operatingRange,
        label2: "RSI 1H",
        value2: rsi1h.toFixed(2)
      },
      volumeNote: volumeMessage
    };
  }

  return {
    type: "neutral",
    main: {
      probability: 45,
      title: "Mercato laterale",
      description:
        "Il mercato non mostra una direzione abbastanza pulita. In questa fase e' meglio attendere una conferma fuori dall'area principale. " +
        volumeMessage,
      label1: "Range operativo",
      value1: operatingRange,
      label2: "Volatilita ATR",
      value2: atrText
    },
    secondary: {
      probability: 35,
      title: "Breakout direzionale",
      description:
        "Un movimento chiaro sopra la zona alta o sotto la zona bassa potrebbe riattivare direzione. Prima della conferma, il rischio di falso segnale resta elevato.",
      label1: "Sopra resistenza",
      value1: resistanceText,
      label2: "Sotto supporto",
      value2: supportText
    },
    alternative: {
      probability: 20,
      title: "Falso breakout",
      description:
        "In fase laterale possono verificarsi movimenti rapidi ma poco affidabili. Serve conferma con chiusure coerenti e aumento dei volumi.",
      label1: "Struttura M30",
      value1: structure30m,
      label2: "Struttura H1",
      value2: structure1h
    },
    volumeNote: volumeMessage
  };
}
