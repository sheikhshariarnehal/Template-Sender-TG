// ========================================
// Template-Sender-TG - Application Logic (Cloud Version)
// ========================================

import { createClient } from 'https://esm.sh/@insforge/sdk@latest';

const params = new URLSearchParams(window.location.search);
const offlineMode = params.get("offline") === "true"; // Allow forcing offline mode for testing

// State
let client = null;
let rows = [];
let headers = [];
let currentJobId = null;
let pollInterval = null;
let defaultCredentials = { botToken: "", channelId: "" };

// DOM Elements
const csvInput = document.getElementById("csv");
const uploadZone = document.getElementById("uploadZone");
const fileInfo = document.getElementById("fileInfo");
const fileName = document.getElementById("fileName");
const fileMeta = document.getElementById("fileMeta");
const mappingDiv = document.getElementById("mapping");
const sendBtn = document.getElementById("sendBtn");
const status = document.getElementById("status");
const progressSection = document.getElementById("progressSection");
const progressBar = document.getElementById("progressBar");
const progressCount = document.getElementById("progressCount");
const progressPercent = document.getElementById("progressPercent");
const toast = document.getElementById("toast");
const steps = document.querySelectorAll(".step");
const envStatus = document.getElementById("envStatus");

// Expose toggle function to global scope for HTML click handler
window.toggleCredentials = function () {
  const content = document.getElementById("credentialsContent");
  const wrapper = document.getElementById("credentials");
  content.classList.toggle("collapsed");
  wrapper.classList.toggle("open");
};

// ========================================
// Initialization
// ========================================
document.addEventListener("DOMContentLoaded", async () => {
  try {
    // Fetch configuration
    const configRes = await fetch("/api/config");
    const config = await configRes.json();

    if (!config.insforgeUrl || !config.insforgeAnonKey) {
      console.error("Missing InsForge configuration");
      showToast("❌ Missing server configuration", "error");
      return;
    }

    // Initialize Client
    client = createClient({
      baseUrl: config.insforgeUrl,
      anonKey: config.insforgeAnonKey
    });
    console.log("Client initialized:", client);
    console.log("Client type:", typeof client);
    console.log("Client keys:", Object.keys(client));

    // Store defaults found in config
    if (config.defaultBotToken) defaultCredentials.botToken = config.defaultBotToken;
    if (config.defaultChannelId) defaultCredentials.channelId = config.defaultChannelId;

    // Update UI based on defaults
    if (defaultCredentials.botToken && defaultCredentials.channelId) {
      envStatus.textContent = "✅ Using default credentials from environment";
      envStatus.style.color = "#4ade80"; // Green
    } else if (defaultCredentials.botToken || defaultCredentials.channelId) {
      envStatus.textContent = "⚠️ Partial credentials found in environment";
      envStatus.style.color = "#facc15"; // Yellow
    } else {
      envStatus.textContent = "❌ No default credentials found";
      envStatus.style.color = "#f87171"; // Red
      // Open credentials by default if missing
      toggleCredentials();
    }

  } catch (err) {
    console.error("Failed to load config:", err);
    showToast("❌ Failed to load configuration", "error");
    return;
  }

  // Check if we have stored credentials (overrides)
  const storedBotToken = localStorage.getItem("bot_token");
  const storedChannelId = localStorage.getItem("channel_id");

  if (storedBotToken) document.getElementById("botToken").value = storedBotToken;
  if (storedChannelId) document.getElementById("channelId").value = storedChannelId;

  // Check for active job
  const persistedJobId = localStorage.getItem("current_job_id");
  if (persistedJobId && client) {
    console.log("Found persisted job:", persistedJobId);
    // Check if it's still relevant
    const { data: job } = await client.database.from('jobs').select('status').eq('id', persistedJobId).single();

    if (job && (job.status === 'pending' || job.status === 'running')) {
      currentJobId = persistedJobId;
      setActiveStep(3);
      progressSection.classList.add("visible");
      updateSendButton("sending");
      pollJobStatus();
    } else {
      localStorage.removeItem("current_job_id");
    }
  }
});

// ========================================
// Step Management
// ========================================
function setActiveStep(stepNumber) {
  steps.forEach((step, index) => {
    const num = index + 1;
    step.classList.remove("active", "completed");

    if (num < stepNumber) {
      step.classList.add("completed");
    } else if (num === stepNumber) {
      step.classList.add("active");
    }
  });
}

// ========================================
// Drag & Drop
// ========================================
uploadZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  uploadZone.classList.add("dragover");
});

uploadZone.addEventListener("dragleave", (e) => {
  e.preventDefault();
  uploadZone.classList.remove("dragover");
});

uploadZone.addEventListener("drop", (e) => {
  e.preventDefault();
  uploadZone.classList.remove("dragover");

  const files = e.dataTransfer.files;
  if (files.length > 0 && files[0].name.endsWith(".csv")) {
    csvInput.files = files;
    handleFileUpload(files[0]);
  } else {
    showToast("Please upload a CSV file", "error");
  }
});

// ========================================
// File Upload
// ========================================
csvInput.addEventListener("change", () => {
  if (csvInput.files.length > 0) {
    handleFileUpload(csvInput.files[0]);
  }
});

function handleFileUpload(file) {
  setStatus("Reading CSV...", "loading");

  Papa.parse(file, {
    header: true,
    skipEmptyLines: true,
    complete: (result) => {
      if (result.errors.length > 0) {
        setStatus("CSV has errors", "error");
        showToast("Error parsing CSV", "error");
        console.error(result.errors);
        return;
      }

      rows = result.data;
      headers = result.meta.fields;

      // Show file info
      fileName.textContent = file.name;
      fileMeta.textContent = `${rows.length} rows • ${headers.length} columns`;
      fileInfo.classList.add("visible");

      // Render mapping
      renderMapping();
      setActiveStep(2);
      setStatus("Map your columns & enter credentials 👇", "");
      updateSendButton("ready");

      showToast(`${rows.length} rows loaded`, "success");
    },
    error: (error) => {
      setStatus("Failed to parse CSV", "error");
      showToast("Error parsing CSV file", "error");
      console.error(error);
    }
  });
}

// ========================================
// Column Mapping
// ========================================
function renderMapping() {
  const selects = mappingDiv.querySelectorAll("select");

  selects.forEach(select => {
    select.innerHTML = headers.map(h =>
      `<option value="${escapeHtml(h)}">${escapeHtml(h)}</option>`
    ).join("");
  });

  autoMapColumns();
  mappingDiv.classList.remove("hidden");

  // Show credential inputs if hidden
  document.getElementById("credentials").classList.remove("hidden");
}

function autoMapColumns() {
  const mappings = {
    title: ["title", "name", "product", "item", "product_name"],
    description: ["description", "desc", "details", "info", "summary"],
    download: ["download", "download_link", "download_url", "file", "file_url", "gdrive"],
    view: ["view", "view_link", "preview", "link", "url", "preview_url"],
    image: ["image", "img", "photo", "picture", "thumbnail", "image_url", "thumb"]
  };

  for (const [field, keywords] of Object.entries(mappings)) {
    const select = document.getElementById(field);
    if (!select) continue;

    const match = headers.find(h =>
      keywords.some(k => h.toLowerCase().includes(k))
    );

    if (match) {
      select.value = match;
    }
  }
}

// ========================================
// Send Button States
// ========================================
function updateSendButton(state) {
  switch (state) {
    case "ready":
      sendBtn.disabled = false;
      sendBtn.innerHTML = '<span class="btn-icon">📨</span><span>Send to Telegram (Cloud)</span>';
      sendBtn.onclick = startSendJob;
      break;
    case "sending":
      sendBtn.disabled = false;
      sendBtn.innerHTML = '<span class="btn-icon">⏹️</span><span>Stop Sending</span>';
      sendBtn.onclick = stopSendJob;
      sendBtn.classList.add("stop-btn");
      break;
    case "stopping":
      sendBtn.disabled = true;
      sendBtn.innerHTML = '<span class="loading-spinner">⏳</span><span>Stopping...</span>';
      break;
    case "disabled":
      sendBtn.disabled = true;
      sendBtn.innerHTML = '<span class="btn-icon">📨</span><span>Send to Telegram</span>';
      break;
  }
}

// ========================================
// Start Send Job (Cloud)
// ========================================
async function startSendJob() {
  if (currentJobId) return;

  const botTokenInput = document.getElementById("botToken").value;
  const channelIdInput = document.getElementById("channelId").value;

  // Use input or fallback to defaults
  const botToken = botTokenInput || defaultCredentials.botToken;
  const channelId = channelIdInput || defaultCredentials.channelId;

  if (!botToken || !channelId) {
    showToast("Please enter Bot Token and Channel ID (or configure in .env)", "error");
    // Open the accordion so they can see input is needed
    const content = document.getElementById("credentialsContent");
    const wrapper = document.getElementById("credentials");
    if (content.classList.contains("collapsed")) {
      content.classList.remove("collapsed");
      wrapper.classList.add("open");
    }
    return;
  }

  // Save credentials for next time (only if user entered them)
  if (botTokenInput) localStorage.setItem("bot_token", botTokenInput);
  if (channelIdInput) localStorage.setItem("channel_id", channelIdInput);

  if (!client || !client.database) {
    console.error("Client invalid:", client);
    showToast("System Error: Database client not ready. See console.", "error");
    return;
  }

  setActiveStep(3);
  setStatus("Uploading job to cloud...", "loading");
  updateSendButton("sending");

  // Show progress
  progressSection.classList.add("visible");
  updateProgress(0, rows.length, 0, 0);

  const mapping = {
    title: document.getElementById("title").value,
    description: document.getElementById("description").value,
    download: document.getElementById("download").value,
    view: document.getElementById("view").value,
    image: document.getElementById("image").value
  };

  try {
    // 1. Create Job in Database
    const { data: job, error: jobError } = await client.database
      .from('jobs')
      .insert([{
        total: rows.length,
        status: 'pending',
        mapping: mapping,
        bot_token: botToken,
        channel_id: channelId
      }])
      .select()
      .single();

    if (jobError) throw new Error("Failed to create job: " + jobError.message);

    currentJobId = job.id;
    console.log("Job created:", currentJobId);

    // 2. Upload Rows (in batches)
    const BATCH_SIZE = 100;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE).map((row, index) => ({
        job_id: currentJobId,
        row_index: i + index,
        data: row,
        status: 'pending'
      }));

      const { error: rowsError } = await client.database.from('job_rows').insert(batch);
      if (rowsError) throw new Error("Failed to upload rows: " + rowsError.message);

      setStatus(`Uploaded ${Math.min(i + BATCH_SIZE, rows.length)}/${rows.length} rows...`, "loading");
    }

    // 3. Trigger Cloud Processing
    const { error: invokeError } = await client.functions.invoke('process-job', {
      body: { jobId: currentJobId }
    });

    if (invokeError) {
      console.warn("Auto-start failed, but job is saved:", invokeError);
      showToast("Job saved but auto-start failed. It may run later.", "warning");
    } else {
      showToast("Cloud job started! You can close this tab.", "success");
    }

    // 4. Start Polling for Updates
    pollJobStatus();

  } catch (error) {
    setStatus(`❌ ${error.message}`, "error");
    showToast("Failed to start job", "error");
    updateSendButton("ready");
    console.error("Start job error:", error);
  }
}

// ========================================
// Stop Send Job
// ========================================
async function stopSendJob() {
  if (!currentJobId) return;

  updateSendButton("stopping");

  try {
    const { error } = await client.database
      .from('jobs')
      .update({ status: 'stopped' })
      .eq('id', currentJobId);

    if (error) throw error;

    showToast("Job stopped", "success");
  } catch (error) {
    console.error("Stop error:", error);
    showToast("Failed to stop job", "error");
  }
}

// ========================================
// Job Polling
// ========================================
function pollJobStatus() {
  if (pollInterval) clearInterval(pollInterval);

  pollInterval = setInterval(async () => {
    if (!currentJobId) {
      clearInterval(pollInterval);
      return;
    }

    const { data: job, error } = await client.database
      .from('jobs')
      .select('status, sent, failed, total, current')
      .eq('id', currentJobId)
      .single();

    if (error || !job) {
      console.error("Poll error:", error);
      return;
    }

    updateProgress(job.current, job.total, job.sent, job.failed);
    setStatus(`Cloud Processing: ${job.sent}/${job.total} sent (${Math.round((job.sent / job.total) * 100)}%)`, "loading");

    if (job.status === 'completed' || job.status === 'stopped' || job.status === 'failed') {
      clearInterval(pollInterval);
      pollInterval = null;
      currentJobId = null;

      if (job.status === 'completed') {
        setStatus(`✅ Cloud job completed! ${job.sent} sent.`, "success");
        showToast("Job completed!", "success");
      } else {
        setStatus(`🛑 Job ${job.status}`, "error");
      }
      updateSendButton("ready");
    }
  }, 2000); // Poll every 2 seconds
}

// ========================================
// Progress Tracking
// ========================================
function updateProgress(current, total, sent, failed) {
  const percent = total > 0 ? Math.round((current / total) * 100) : 0;

  progressBar.style.width = `${percent}%`;
  progressCount.textContent = `${sent} / ${total}`; // Show sent count instead of current processed
  progressPercent.textContent = `${percent}%`;
}

// ========================================
// Status & Toast
// ========================================
function setStatus(message, type = "") {
  status.textContent = message;
  status.className = "status";
  if (type) {
    status.classList.add(type);
  }
}

function showToast(message, type = "success") {
  const toastIcon = toast.querySelector(".toast-icon");
  const toastMessage = toast.querySelector(".toast-message");

  toastIcon.textContent = type === "success" ? "✅" : "❌";
  toastMessage.textContent = message;

  toast.className = "toast";
  toast.classList.add(type, "visible");

  setTimeout(() => {
    toast.classList.remove("visible");
  }, 3000);
}

// ========================================
// Utilities
// ========================================
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}
