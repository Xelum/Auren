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
