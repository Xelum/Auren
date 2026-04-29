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
    const url =
      "https://api.twelvedata.com/time_series?symbol=XAU/USD&interval=1h&outputsize=50&apikey=" +
      API_KEY;

    const response = await fetch(url);
    const data = await response.json();

    if (!data.values || !Array.isArray(data.values)) {
      return res.status(500).json({
        error: "Dati Twelve Data non disponibili",
        details: data
      });
    }

    const candles = data.values
      .map((item) => ({
        datetime: item.datetime,
        open: Number(item.open),
        high: Number(item.high),
        low: Number(item.low),
        close: Number(item.close)
      }))
      .filter((c) => !Number.isNaN(c.close))
      .reverse();

    const last = candles[candles.length - 1];
    const closes = candles.map((c) => c.close);

    const average =
      closes.reduce((sum, value) => sum + value, 0) / closes.length;

    const recentCandles = candles.slice(-20);
    const support = Math.min(...recentCandles.map((c) => c.low));
    const resistance = Math.max(...recentCandles.map((c) => c.high));

    let scenario;

    if (last.close < average) {
      scenario = {
        type: "bearish",
        main: {
          probability: 65,
          title: "Continuazione ribassista",
          description:
            "Il prezzo resta sotto la media oraria e mostra debolezza. Una rottura del supporto potrebbe aumentare la pressione verso la successiva area di domanda.",
          label1: "Supporto da osservare",
          value1: support.toFixed(2),
          label2: "Resistenza",
          value2: resistance.toFixed(2)
        },
        secondary: {
          probability: 25,
          title: "Rimbalzo tecnico",
          description:
            "Il prezzo potrebbe recuperare verso la resistenza, ma il movimento resterebbe correttivo finche la struttura non cambia.",
          label1: "Area target",
          value1: resistance.toFixed(2),
          label2: "Forza scenario",
          value2: "Media"
        },
        alternative: {
          probability: 10,
          title: "Inversione rialzista",
          description:
            "Una vera inversione richiede il recupero della resistenza chiave e una tenuta sopra quel livello con maggiore forza.",
          label1: "Invalidazione bearish",
          value1: "oltre " + resistance.toFixed(2),
          label2: "Forza scenario",
          value2: "Bassa"
        }
      };
    } else {
      scenario = {
        type: "bullish",
        main: {
          probability: 60,
          title: "Recupero rialzista",
          description:
            "Il prezzo resta sopra la media oraria e mostra maggiore forza. La tenuta del supporto potrebbe favorire continuita verso la prossima resistenza.",
          label1: "Supporto da mantenere",
          value1: support.toFixed(2),
          label2: "Target tecnico",
          value2: resistance.toFixed(2)
        },
        secondary: {
          probability: 30,
          title: "Ritracciamento",
          description:
            "Il prezzo potrebbe tornare a testare il supporto prima di confermare una nuova spinta direzionale.",
          label1: "Area di test",
          value1: support.toFixed(2),
          label2: "Forza scenario",
          value2: "Media"
        },
        alternative: {
          probability: 10,
          title: "Falso breakout",
          description:
            "Una perdita rapida del supporto indebolirebbe la lettura positiva e riporterebbe il mercato in fase di rischio.",
          label1: "Invalidazione bullish",
          value1: "sotto " + support.toFixed(2),
          label2: "Forza scenario",
          value2: "Bassa"
        }
      };
    }

    return res.status(200).json({
      market: "XAU/USD",
      price: Number(last.close.toFixed(2)),
      average: Number(average.toFixed(2)),
      support: Number(support.toFixed(2)),
      resistance: Number(resistance.toFixed(2)),
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
