import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { securityHeaders, apiLimiter } from "./config/security.js";
import pool from "./config/db.js";

// Routes
import authRoutes from "./routes/auth.routes.js";
import walletRoutes from "./routes/wallet.routes.js";
import tradesRoutes from "./routes/trades.routes.js";
import userRoutes from "./routes/user.routes.js";
import adminRoutes from "./routes/admin.routes.js";
import marketsRoutes from "./routes/markets.routes.js";

// Bot
import bot from "../bot/bot.js";

// Services
import { startTradingEngine } from "./services/tradingEngine.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 10000;

// Middleware
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(securityHeaders);

// Serve static files
app.use(express.static(path.join(__dirname, "../client")));
app.use("/public", express.static(path.join(__dirname, "../public")));

// API Routes
app.use("/api", apiLimiter);
app.use("/api", authRoutes);
app.use("/api/wallet", walletRoutes);
app.use("/api/trades", tradesRoutes);
app.use("/api/user", userRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/markets", marketsRoutes);

// Telegram Webhook
app.post(`/webhook/${process.env.BOT_TOKEN}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// Health check
app.get("/health", (req, res) => {
  res.json({ ok: true, status: "running", timestamp: new Date().toISOString() });
});

// Serve frontend
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "../client/index.html"));
});

// Error handler
app.use((err, req, res, next) => {
  console.error("Server error:", err);
  res.status(500).json({ ok: false, error: "Internal server error" });
});

// Start server
app.listen(PORT, async () => {
  console.log(`🟢 QL Trading AI Server started on port ${PORT}`);
  console.log(`📅 ${new Date().toISOString()}`);
  
  // Set webhook
  if (process.env.WEBHOOK_URL && process.env.BOT_TOKEN) {
    const webhookUrl = `${process.env.WEBHOOK_URL}/webhook/${process.env.BOT_TOKEN}`;
    try {
      await bot.setWebHook(webhookUrl);
      console.log(`✅ Telegram webhook set to: ${webhookUrl}`);
    } catch (error) {
      console.error("❌ Failed to set webhook:", error.message);
    }
  }

  // Start trading engine
  startTradingEngine();
  console.log("🤖 Trading engine started");
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("SIGTERM received, shutting down gracefully...");
  pool.end(() => {
    console.log("Database pool closed");
    process.exit(0);
  });
});