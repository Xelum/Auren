export default async function handler(req, res) {
  const API_KEY = process.env.TWELVE_DATA_API_KEY;

  if (!API_KEY) {
    return res.status(500).json({
      error: "API key mancante. Controlla TWELVE_DATA_API_KEY su Vercel."
    });
  }

  const now = new Date();
  const nextHour = new Date(now);
  nextHour.setHours(now.getHours() + 1, 0, 0, 0);

  const secondsUntilNextHour = Math.max(
    60,
    Math.floor((nextHour - now) / 1000)
  );

  res.setHeader(
    "Cache-Control",
    `s-maxage=${secondsUntilNextHour}, stale-while-revalidate=60`
  );

  try {
    const [tf15, tf1h, tf4h] = await Promise.all([
      fetchCandles("15min", API_KEY),
      fetchCandles("1h", API_KEY),
      fetchCandles("4h", API_KEY)
    ]);

    const candles1h = tf1h;
    const last = candles1h[candles1h.length - 1];
    const price = last.close;

    const ema20_15m = ema(tf15.map(c => c.close), 20);
    const ema50_15m = ema(tf15.map(c => c.close), 50);

    const ema20_1h = ema(tf1h.map(c => c.close), 20);
    const ema50_1h = ema(tf1h.map(c => c.close), 50);

    const ema20_4h = ema(tf4h.map(c => c.close), 20);
    const ema50_4h = ema(tf4h.map(c => c.close), 50);

    const rsi1h = rsi(tf1h.map(c => c.close), 14);
    const atr1h = atr(tf1h, 14);

    const recent = candles1h.slice(-30);
    const support = findSupport(recent);
    const resistance = findResistance(recent);

    const structure = marketStructure(tf1h);
    const volatilityRatio = atr1h / price;

    let score = 0;

    // Trend principale 4H
    if (price > ema20_4h && ema20_4h > ema50_4h) score += 3;
    if (price < ema20_4h && ema20_4h < ema50_4h) score -= 3;

    // Trend operativo 1H
    if (price > ema20_1h && ema20_1h > ema50_1h) score += 3;
    if (price < ema20_1h && ema20_1h < ema50_1h) score -= 3;

    // Momentum breve 15M
    if (ema20_15m > ema50_15m) score += 1;
    if (ema20_15m < ema50_15m) score -= 1;

    // Struttura
    if (structure === "bullish") score += 2;
    if (structure === "bearish") score -= 2;

    // RSI
    if (rsi1h > 58 && rsi1h < 72) score += 1.5;
    if (rsi1h < 42 && rsi1h > 28) score -= 1.5;

    // Evita segnali troppo aggressivi in ipercomprato/ipervenduto
    if (rsi1h >= 72) score -= 1;
    if (rsi1h <= 28) score += 1;

    // Vicinanza a livelli chiave
    const distanceFromResistance = Math.abs(resistance - price);
    const distanceFromSupport = Math.abs(price - support);

    if (distanceFromResistance < atr1h * 0.8 && score > 0) score -= 1.5;
    if (distanceFromSupport < atr1h * 0.8 && score < 0) score += 1.5;

    // Mercato troppo compresso: riduce sicurezza direzionale
    if (volatilityRatio < 0.0018) {
      score *= 0.65;
    }

    const scenario = buildScenario({
      score,
      price,
      support,
      resistance,
      atr1h,
      rsi1h,
      ema20_1h,
      ema50_1h,
      structure
    });

    return res.status(200).json({
      market: "XAU/USD",
      price: Number(price.toFixed(2)),
      support: Number(support.toFixed(2)),
      resistance: Number(resistance.toFixed(2)),
      rsi: Number(rsi1h.toFixed(2)),
      atr: Number(atr1h.toFixed(2)),
      score: Number(score.toFixed(2)),
      updatedAt: now.toISOString(),
      nextUpdateAt: nextHour.toISOString(),
      cacheSeconds: secondsUntilNextHour,
      scenario
    });

  } catch (error) {
    return res.status(500).json({
      error: "Errore durante il calcolo dello scenario",
      details: error.message
    });
  }
}

async function fetchCandles(interval, API_KEY) {
  const url =
    `https://api.twelvedata.com/time_series?symbol=XAU/USD&interval=${interval}&outputsize=100&apikey=${API_KEY}`;

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
  const k = 2 / (period + 1);
  let result = values[0];

  for (let i = 1; i < values.length; i++) {
    result = values[i] * k + result * (1 - k);
  }

  return result;
}

function rsi(values, period) {
  let gains = 0;
  let losses = 0;

  for (let i = values.length - period; i < values.length; i++) {
    const diff = values[i] - values[i - 1];

    if (diff >= 0) {
      gains += diff;
    } else {
      losses += Math.abs(diff);
    }
  }

  if (losses === 0) return 100;

  const rs = gains / losses;
  return 100 - 100 / (1 + rs);
}

function atr(candles, period) {
  const recent = candles.slice(-period - 1);
  const trueRanges = [];

  for (let i = 1; i < recent.length; i++) {
    const current = recent[i];
    const previous = recent[i - 1];

    const tr = Math.max(
      current.high - current.low,
      Math.abs(current.high - previous.close),
      Math.abs(current.low - previous.close)
    );

    trueRanges.push(tr);
  }

  return trueRanges.reduce((a, b) => a + b, 0) / trueRanges.length;
}

function findSupport(candles) {
  const lows = candles.map(c => c.low);
  lows.sort((a, b) => a - b);

  return lows[Math.floor(lows.length * 0.15)];
}

function findResistance(candles) {
  const highs = candles.map(c => c.high);
  highs.sort((a, b) => b - a);

  return highs[Math.floor(highs.length * 0.15)];
}

function marketStructure(candles) {
  const recent = candles.slice(-12);

  const firstHalf = recent.slice(0, 6);
  const secondHalf = recent.slice(6);

  const firstHigh = Math.max(...firstHalf.map(c => c.high));
  const secondHigh = Math.max(...secondHalf.map(c => c.high));

  const firstLow = Math.min(...firstHalf.map(c => c.low));
  const secondLow = Math.min(...secondHalf.map(c => c.low));

  if (secondHigh > firstHigh && secondLow > firstLow) return "bullish";
  if (secondHigh < firstHigh && secondLow < firstLow) return "bearish";

  return "neutral";
}

function buildScenario(data) {
  const {
    score,
    price,
    support,
    resistance,
    atr1h,
    rsi1h,
    structure
  } = data;

  const strongBullish = score >= 6;
  const bullish = score >= 3 && score < 6;
  const neutral = score > -3 && score < 3;
  const bearish = score <= -3 && score > -6;
  const strongBearish = score <= -6;

  if (strongBearish || bearish) {
    const mainProb = strongBearish ? 70 : 62;
    const secondProb = strongBearish ? 20 : 28;
    const altProb = 100 - mainProb - secondProb;

    return {
      type: "bearish",
      main: {
        probability: mainProb,
        title: "Continuazione ribassista",
        description:
          "La lettura multi-timeframe resta debole. Il prezzo lavora sotto le medie operative e la struttura favorisce pressione verso il supporto.",
        label1: "Supporto da osservare",
        value1: support.toFixed(2),
        label2: "Resistenza",
        value2: resistance.toFixed(2)
      },
      secondary: {
        probability: secondProb,
        title: "Rimbalzo tecnico",
        description:
          "Un recupero verso la resistenza resta possibile, ma finche il prezzo non consolida sopra quel livello il movimento resta correttivo.",
        label1: "Area target",
        value1: resistance.toFixed(2),
        label2: "Forza scenario",
        value2: strongBearish ? "Bassa" : "Media"
      },
      alternative: {
        probability: altProb,
        title: "Inversione rialzista",
        description:
          "La lettura ribassista verrebbe indebolita solo da un recupero deciso sopra la resistenza, accompagnato da maggiore forza sul timeframe 1H.",
        label1: "Invalidazione bearish",
        value1: "oltre " + resistance.toFixed(2),
        label2: "Forza scenario",
        value2: "Bassa"
      }
    };
  }

  if (strongBullish || bullish) {
    const mainProb = strongBullish ? 70 : 62;
    const secondProb = strongBullish ? 20 : 28;
    const altProb = 100 - mainProb - secondProb;

    return {
      type: "bullish",
      main: {
        probability: mainProb,
        title: "Continuazione rialzista",
        description:
          "La lettura multi-timeframe resta costruttiva. Il prezzo mantiene forza sopra le medie operative e potrebbe cercare continuita verso la resistenza.",
        label1: "Supporto da mantenere",
        value1: support.toFixed(2),
        label2: "Target tecnico",
        value2: resistance.toFixed(2)
      },
      secondary: {
        probability: secondProb,
        title: "Ritracciamento tecnico",
        description:
          "Un ritorno verso il supporto resta possibile prima di una nuova spinta. La struttura resta positiva finche il supporto viene mantenuto.",
        label1: "Area di test",
        value1: support.toFixed(2),
        label2: "Forza scenario",
        value2: strongBullish ? "Bassa" : "Media"
      },
      alternative: {
        probability: altProb,
        title: "Falso breakout",
        description:
          "La lettura rialzista verrebbe indebolita da una perdita del supporto con chiusure orarie sotto la zona chiave.",
        label1: "Invalidazione bullish",
        value1: "sotto " + support.toFixed(2),
        label2: "Forza scenario",
        value2: "Bassa"
      }
    };
  }

  return {
    type: "neutral",
    main: {
      probability: 45,
      title: "Fase laterale di attesa",
      description:
        "Il mercato non mostra una direzione sufficientemente pulita. La lettura principale privilegia attesa e conferme sui livelli chiave.",
      label1: "Supporto",
      value1: support.toFixed(2),
      label2: "Resistenza",
      value2: resistance.toFixed(2)
    },
    secondary: {
      probability: 35,
      title: "Breakout direzionale",
      description:
        "Una rottura confermata del range potrebbe riattivare momentum. La direzione dipendera dalla tenuta sopra resistenza o sotto supporto.",
      label1: "Range operativo",
      value1: support.toFixed(2) + " - " + resistance.toFixed(2),
      label2: "Forza scenario",
      value2: "Media"
    },
    alternative: {
      probability: 20,
      title: "Falso segnale",
      description:
        "In condizioni laterali aumenta il rischio di falsi breakout. Serve conferma prima di considerare valido un movimento direzionale.",
      label1: "Volatilita ATR",
      value1: atr1h.toFixed(2),
      label2: "RSI 1H",
      value2: rsi1h.toFixed(2)
    }
  };
}
