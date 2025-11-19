import { query } from "../config/db.js";

// Fake price generator
const generatePrice = (symbol, basePrice) => {
  const volatility = {
    XAUUSD: 2,
    XAGUSD: 0.1,
    BTCUSDT: 500,
    ETHUSDT: 50
  };

  const change = (Math.random() - 0.5) * 2 * (volatility[symbol] || 1);
  return basePrice + change;
};

const basePrices = {
  XAUUSD: 2050,
  XAGUSD: 24,
  BTCUSDT: 43000,
  ETHUSDT: 2300
};

// Update all open trades
const updateTrades = async () => {
  try {
    const result = await query("SELECT * FROM trades WHERE status = 'open'");
    
    for (const trade of result.rows) {
      const currentPrice = generatePrice(trade.symbol, basePrices[trade.symbol] || 100);
      
      // Calculate PnL
      let pnl = 0;
      if (trade.direction === "BUY") {
        pnl = (currentPrice - trade.entry_price) * trade.lot_size * 100;
      } else {
        pnl = (trade.entry_price - currentPrice) * trade.lot_size * 100;
      }

      // Update current price and PnL
      await query(
        "UPDATE trades SET current_price = $1, pnl = $2 WHERE id = $3",
        [currentPrice, pnl, trade.id]
      );

      // Check TP/SL
      let shouldClose = false;
      let closeReason = null;

      if (trade.take_profit && currentPrice >= trade.take_profit && trade.direction === "BUY") {
        shouldClose = true;
        closeReason = "tp";
      } else if (trade.take_profit && currentPrice <= trade.take_profit && trade.direction === "SELL") {
        shouldClose = true;
        closeReason = "tp";
      } else if (trade.stop_loss && currentPrice <= trade.stop_loss && trade.direction === "BUY") {
        shouldClose = true;
        closeReason = "sl";
      } else if (trade.stop_loss && currentPrice >= trade.stop_loss && trade.direction === "SELL") {
        shouldClose = true;
        closeReason = "sl";
      }

      if (shouldClose) {
        // Close trade
        await query(
          "UPDATE trades SET status = 'closed', closed_at = NOW(), close_reason = $1 WHERE id = $2",
          [closeReason, trade.id]
        );

        // Update user balance
        if (pnl >= 0) {
          await query(
            "UPDATE users SET balance = balance + $1, wins = wins + $1 WHERE id = $2",
            [pnl, trade.user_id]
          );
        } else {
          await query(
            "UPDATE users SET losses = losses + $1 WHERE id = $2",
            [Math.abs(pnl), trade.user_id]
          );
        }

        // Log operation
        await query(
          "INSERT INTO ops (user_id, type, amount, note) VALUES ($1, 'pnl', $2, $3)",
          [trade.user_id, pnl, `Trade closed by ${closeReason.toUpperCase()}`]
        );

        // Move to history
        const duration = Math.floor((new Date() - new Date(trade.opened_at)) / 1000);
        await query(
          `INSERT INTO trades_history (user_id, trade_id, symbol, direction, entry_price, exit_price, lot_size, pnl, duration_seconds, opened_at, closed_at, close_reason)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), $11)`,
          [trade.user_id, trade.id, trade.symbol, trade.direction, trade.entry_price, currentPrice, trade.lot_size, pnl, duration, trade.opened_at, closeReason]
        );

        console.log(`✅ Trade #${trade.id} closed by ${closeReason.toUpperCase()}: PnL ${pnl.toFixed(2)}`);
      }
    }
  } catch (error) {
    console.error("Trading engine error:", error);
  }
};

// Update daily targets (gradual balance movement)
const updateDailyTargets = async () => {
  try {
    const result = await query("SELECT * FROM daily_targets WHERE active = TRUE");
    
    for (const target of result.rows) {
      const elapsed = Math.floor((new Date() - new Date(target.started_at)) / 1000);
      
      if (elapsed >= target.duration_sec) {
        // Target reached, deactivate
        await query("UPDATE daily_targets SET active = FALSE WHERE id = $1", [target.id]);
        
        // Apply final amount
        const remaining = target.target - target.current;
        if (Math.abs(remaining) > 0.01) {
          await query(
            "UPDATE users SET balance = balance + $1 WHERE id = $2",
            [remaining, target.user_id]
          );
          await query(
            "INSERT INTO ops (user_id, type, amount, note) VALUES ($1, 'pnl', $2, 'Daily target completed')",
            [target.user_id, remaining]
          );
        }
        
        console.log(`✅ Daily target #${target.id} completed: ${target.target}`);
      } else {
        // Calculate step
        const progress = elapsed / target.duration_sec;
        const newCurrent = target.target * progress;
        const step = newCurrent - target.current;
        
        if (Math.abs(step) > 0.01) {
          await query(
            "UPDATE daily_targets SET current = $1 WHERE id = $2",
            [newCurrent, target.id]
          );
          await query(
            "UPDATE users SET balance = balance + $1 WHERE id = $2",
            [step, target.user_id]
          );
        }
      }
    }
  } catch (error) {
    console.error("Daily targets error:", error);
  }
};

export const startTradingEngine = () => {
  // Update trades every 5 seconds
  setInterval(updateTrades, 5000);
  
  // Update daily targets every 5 seconds
  setInterval(updateDailyTargets, 5000);
  
  console.log("🤖 Trading engine initialized");
};