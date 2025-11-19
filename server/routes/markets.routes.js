import express from "express";

const router = express.Router();

// GET /api/markets - Get fake market prices
router.get("/", async (req, res) => {
  try {
    // Fake market data
    const markets = {
      XAUUSD: (2000 + Math.random() * 100).toFixed(2),
      XAGUSD: (24 + Math.random() * 2).toFixed(2),
      BTCUSDT: (43000 + Math.random() * 2000).toFixed(2),
      ETHUSDT: (2300 + Math.random() * 200).toFixed(2),
    };

    res.json({ ok: true, data: markets });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

export default router;