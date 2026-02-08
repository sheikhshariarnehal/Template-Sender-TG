import express from "express";
import dotenv from "dotenv";
import fetch from "node-fetch";

dotenv.config();

const app = express();

// Increase payload size limit for large CSV data
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));
app.use(express.static("public"));

const BOT_TOKEN = process.env.BOT_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID;

// Serve favicon (prevents 404)
app.get("/favicon.ico", (req, res) => {
  res.status(204).end();
});

// Health check
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    bot_configured: !!BOT_TOKEN,
    channel_configured: !!CHANNEL_ID
  });
});

// Send messages with progress updates via Server-Sent Events
app.post("/api/send", async (req, res) => {
  const { rows, mapping } = req.body;

  if (!rows || !mapping) {
    return res.status(400).json({ error: "Missing rows or mapping data" });
  }

  if (!BOT_TOKEN || !CHANNEL_ID) {
    return res.status(500).json({ error: "Bot token or channel ID not configured" });
  }

  // Set headers for JSON response
  res.setHeader("Content-Type", "application/json");

  const results = {
    success: true,
    total: rows.length,
    sent: 0,
    failed: 0,
    errors: []
  };

  console.log(`\n📤 Starting to send ${rows.length} messages...`);

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 1;

    const caption = `
<b>${row[mapping.title] || "No Title"}</b>

${row[mapping.description] || ""}

🔗 <a href="${row[mapping.view] || "#"}">View</a>
⬇️ <a href="${row[mapping.download] || "#"}">Download</a>
    `.trim();

    const imageUrl = row[mapping.image];

    if (!imageUrl) {
      console.log(`⚠️ Row ${rowNum}: No image URL, skipping`);
      results.failed++;
      results.errors.push({ row: rowNum, error: "No image URL" });
      continue;
    }

    // Retry logic (3 attempts)
    let success = false;
    let lastError = null;

    for (let attempt = 1; attempt <= 3 && !success; attempt++) {
      try {
        console.log(`📨 Row ${rowNum}/${rows.length} (attempt ${attempt})...`);

        const response = await fetch(
          `https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: CHANNEL_ID,
              photo: imageUrl,
              caption: caption,
              parse_mode: "HTML"
            }),
            timeout: 30000 // 30 second timeout
          }
        );

        const data = await response.json();

        if (data.ok) {
          console.log(`✅ Row ${rowNum}: Sent successfully`);
          results.sent++;
          success = true;
        } else {
          throw new Error(data.description || "Unknown Telegram error");
        }
      } catch (err) {
        lastError = err.message;
        console.error(`❌ Row ${rowNum} attempt ${attempt}: ${err.message}`);

        if (attempt < 3) {
          // Wait before retry (exponential backoff)
          await new Promise(r => setTimeout(r, 1000 * attempt));
        }
      }
    }

    if (!success) {
      results.failed++;
      results.errors.push({ row: rowNum, error: lastError });
    }

    // Rate limit safety (Telegram allows ~30 messages/second)
    await new Promise(r => setTimeout(r, 500));
  }

  results.success = results.failed === 0;

  console.log(`\n📊 Completed: ${results.sent} sent, ${results.failed} failed\n`);

  res.json(results);
});

// Test endpoint to verify Telegram connection
app.get("/api/test-connection", async (req, res) => {
  try {
    const response = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/getMe`,
      { timeout: 10000 }
    );
    const data = await response.json();

    if (data.ok) {
      res.json({
        success: true,
        bot_name: data.result.username,
        message: `Connected to @${data.result.username}`
      });
    } else {
      res.status(400).json({
        success: false,
        error: data.description
      });
    }
  } catch (err) {
    res.status(500).json({
      success: false,
      error: `Connection failed: ${err.message}`
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🚀 Server running on http://localhost:${PORT}`);
  console.log(`📋 Bot Token: ${BOT_TOKEN ? "✓ Configured" : "✗ Missing"}`);
  console.log(`📺 Channel ID: ${CHANNEL_ID ? "✓ Configured" : "✗ Missing"}\n`);
});
