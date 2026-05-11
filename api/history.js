import { createClient } from "redis";

const HISTORY_KEY = "auren:history";

let redisClient;

async function getRedisClient() {
  if (!redisClient) {
    redisClient = createClient({
      url: process.env.REDIS_URL
    });

    redisClient.on("error", (error) => {
      console.error("Redis error:", error);
    });

    await redisClient.connect();
  }

  return redisClient;
}

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
