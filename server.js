import express from "express";
import dotenv from "dotenv";
import fetch from "node-fetch";
import crypto from "crypto";

dotenv.config();

const app = express();

// Increase payload size limit for large CSV data
app.use(express.json({ limit: "100mb" }));
app.use(express.urlencoded({ limit: "100mb", extended: true }));
app.use(express.static("public"));

const BOT_TOKEN = process.env.BOT_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID;

// ========================================
// JOB MANAGER - Handles background processing
// ========================================
class JobManager {
  constructor() {
    this.jobs = new Map();
    this.clients = new Map(); // SSE clients per jobId
  }

  createJob(rows, mapping) {
    const jobId = crypto.randomUUID();
    const job = {
      id: jobId,
      status: "pending",
      total: rows.length,
      sent: 0,
      failed: 0,
      current: 0,
      logs: [],
      errors: [],
      startTime: Date.now(),
      endTime: null,
      isPaused: false,
      isStopped: false
    };

    this.jobs.set(jobId, job);

    // Start processing in background
    this.processJob(jobId, rows, mapping);

    return jobId;
  }

  getJob(jobId) {
    return this.jobs.get(jobId);
  }

  stopJob(jobId) {
    const job = this.jobs.get(jobId);
    if (job) {
      job.isStopped = true;
      this.log(jobId, "🛑 Job stopped by user");
      this.emit(jobId, "stopped", { message: "Job stopped" });
    }
  }

  // Add SSE client
  addClient(jobId, res) {
    if (!this.clients.has(jobId)) {
      this.clients.set(jobId, new Set());
    }
    this.clients.get(jobId).add(res);
  }

  // Remove SSE client
  removeClient(jobId, res) {
    if (this.clients.has(jobId)) {
      this.clients.get(jobId).delete(res);
    }
  }

  // Emit event to all clients for a job
  emit(jobId, event, data) {
    const clients = this.clients.get(jobId);
    if (clients) {
      const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
      clients.forEach(res => {
        try {
          res.write(message);
        } catch (e) {
          // Client disconnected
        }
      });
    }
  }

  // Add log entry
  log(jobId, message) {
    const job = this.jobs.get(jobId);
    if (job) {
      const entry = { time: new Date().toISOString(), message };
      job.logs.push(entry);
      console.log(`[Job ${jobId.slice(0, 8)}] ${message}`);
      this.emit(jobId, "log", entry);
    }
  }

  // Update progress
  updateProgress(jobId) {
    const job = this.jobs.get(jobId);
    if (job) {
      this.emit(jobId, "progress", {
        current: job.current,
        total: job.total,
        sent: job.sent,
        failed: job.failed,
        percent: Math.round((job.current / job.total) * 100)
      });
    }
  }

  // Process job in background
  async processJob(jobId, rows, mapping) {
    const job = this.jobs.get(jobId);
    job.status = "running";

    this.log(jobId, `📤 Starting to send ${rows.length} messages...`);
    this.emit(jobId, "started", { total: rows.length });

    for (let i = 0; i < rows.length; i++) {
      // Check if stopped
      if (job.isStopped) {
        job.status = "stopped";
        this.log(jobId, `⏹️ Job stopped at ${i}/${rows.length}`);
        break;
      }

      const row = rows[i];
      job.current = i + 1;

      const caption = `
<b>${row[mapping.title] || "No Title"}</b>

${row[mapping.description] || ""}

🔗 <a href="${row[mapping.view] || "#"}">View</a>
⬇️ <a href="${row[mapping.download] || "#"}">Download</a>
      `.trim();

      const imageUrl = row[mapping.image];

      if (!imageUrl) {
        job.failed++;
        this.log(jobId, `⚠️ Row ${i + 1}: No image URL, skipping`);
        job.errors.push({ row: i + 1, error: "No image URL" });
        this.updateProgress(jobId);
        continue;
      }

      // Retry logic with smart rate limiting
      let success = false;
      let attempts = 0;
      const maxAttempts = 5;

      while (!success && attempts < maxAttempts && !job.isStopped) {
        attempts++;

        try {
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
              })
            }
          );

          const data = await response.json();

          if (data.ok) {
            job.sent++;
            success = true;
            this.log(jobId, `✅ Row ${i + 1}: Sent successfully`);
          } else if (data.error_code === 429) {
            // Rate limited - respect retry_after
            const retryAfter = data.parameters?.retry_after || 30;
            this.log(jobId, `⏳ Rate limited. Waiting ${retryAfter}s...`);
            this.emit(jobId, "ratelimit", { retryAfter });

            // Wait for the specified time
            await this.sleep(retryAfter * 1000 + 1000);
            // Don't count this as an attempt
            attempts--;
          } else {
            throw new Error(data.description || "Unknown Telegram error");
          }
        } catch (err) {
          if (attempts >= maxAttempts) {
            job.failed++;
            job.errors.push({ row: i + 1, error: err.message });
            this.log(jobId, `❌ Row ${i + 1}: Failed after ${attempts} attempts - ${err.message}`);
          } else {
            // Exponential backoff
            const backoff = Math.min(1000 * Math.pow(2, attempts), 30000);
            this.log(jobId, `⚠️ Row ${i + 1} attempt ${attempts}: ${err.message}. Retrying in ${backoff / 1000}s...`);
            await this.sleep(backoff);
          }
        }
      }

      this.updateProgress(jobId);

      // Base delay between messages (safe for Telegram)
      if (success && i < rows.length - 1) {
        await this.sleep(3500); // 3.5s delay to prevent rate limits
      }
    }

    // Job complete
    job.endTime = Date.now();
    job.status = job.isStopped ? "stopped" : "completed";

    const duration = ((job.endTime - job.startTime) / 1000).toFixed(1);
    this.log(jobId, `📊 Completed: ${job.sent} sent, ${job.failed} failed in ${duration}s`);

    this.emit(jobId, "done", {
      sent: job.sent,
      failed: job.failed,
      total: job.total,
      duration
    });

    // Cleanup job after 1 hour
    setTimeout(() => {
      this.jobs.delete(jobId);
      this.clients.delete(jobId);
    }, 3600000);
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

const jobManager = new JobManager();

// ========================================
// API ROUTES
// ========================================

// Serve favicon (prevents 404)
app.get("/favicon.ico", (req, res) => {
  res.status(204).end();
});

// Health check
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    bot_configured: !!BOT_TOKEN,
    channel_configured: !!CHANNEL_ID,
    active_jobs: jobManager.jobs.size
  });
});

// Get public config
app.get("/api/config", (req, res) => {
  res.json({
    insforgeUrl: process.env.INSFORGE_URL,
    insforgeAnonKey: process.env.INSFORGE_ANON_KEY,
    defaultBotToken: process.env.BOT_TOKEN,
    defaultChannelId: process.env.CHANNEL_ID
  });
});

// Test connection to Telegram
app.get("/api/test-connection", async (req, res) => {
  try {
    const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getMe`);
    const data = await response.json();

    if (data.ok) {
      res.json({
        success: true,
        bot_name: data.result.username,
        message: `Connected to @${data.result.username}`
      });
    } else {
      res.status(400).json({ success: false, error: data.description });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Start a new send job
app.post("/api/send", (req, res) => {
  const { rows, mapping } = req.body;

  if (!rows || !Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: "No rows provided" });
  }

  if (!mapping) {
    return res.status(400).json({ error: "No mapping provided" });
  }

  if (!BOT_TOKEN || !CHANNEL_ID) {
    return res.status(500).json({ error: "Bot token or channel ID not configured" });
  }

  // Create job and start processing
  const jobId = jobManager.createJob(rows, mapping);

  console.log(`\n🚀 Created job ${jobId} with ${rows.length} rows\n`);

  // Return immediately with job ID
  res.json({
    success: true,
    jobId,
    total: rows.length,
    message: `Job started. Subscribe to /api/events/${jobId} for updates.`
  });
});

// SSE endpoint for real-time updates
app.get("/api/events/:jobId", (req, res) => {
  const { jobId } = req.params;
  const job = jobManager.getJob(jobId);

  if (!job) {
    return res.status(404).json({ error: "Job not found" });
  }

  // Set SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  // Send initial state
  res.write(`event: connected\ndata: ${JSON.stringify({ jobId, status: job.status })}\n\n`);

  // Replay existing logs
  job.logs.forEach(log => {
    res.write(`event: log\ndata: ${JSON.stringify(log)}\n\n`);
  });

  // Send current progress
  res.write(`event: progress\ndata: ${JSON.stringify({
    current: job.current,
    total: job.total,
    sent: job.sent,
    failed: job.failed,
    percent: job.total > 0 ? Math.round((job.current / job.total) * 100) : 0
  })}\n\n`);

  // If job is already done, send done event
  if (job.status === "completed" || job.status === "stopped") {
    res.write(`event: done\ndata: ${JSON.stringify({
      sent: job.sent,
      failed: job.failed,
      total: job.total
    })}\n\n`);
  }

  // Register client
  jobManager.addClient(jobId, res);

  // Handle client disconnect
  req.on("close", () => {
    jobManager.removeClient(jobId, res);
  });
});

// Stop a job
app.post("/api/stop/:jobId", (req, res) => {
  const { jobId } = req.params;
  const job = jobManager.getJob(jobId);

  if (!job) {
    return res.status(404).json({ error: "Job not found" });
  }

  jobManager.stopJob(jobId);
  res.json({ success: true, message: "Job stop requested" });
});

// Get job status
app.get("/api/job/:jobId", (req, res) => {
  const { jobId } = req.params;
  const job = jobManager.getJob(jobId);

  if (!job) {
    return res.status(404).json({ error: "Job not found" });
  }

  res.json({
    id: job.id,
    status: job.status,
    total: job.total,
    sent: job.sent,
    failed: job.failed,
    current: job.current,
    errors: job.errors
  });
});

// ========================================
// START SERVER
// ========================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🚀 Server running on http://localhost:${PORT}`);
  console.log(`📋 Bot Token: ${BOT_TOKEN ? "✓ Configured" : "✗ Missing"}`);
  console.log(`📺 Channel ID: ${CHANNEL_ID ? "✓ Configured" : "✗ Missing"}\n`);
});
