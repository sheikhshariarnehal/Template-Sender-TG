// ========================================
// Template-Sender-TG - Application Logic
// ========================================

// State
let rows = [];
let headers = [];
let currentJobId = null;
let eventSource = null;

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

// ========================================
// Initialization
// ========================================
document.addEventListener("DOMContentLoaded", async () => {
  await testConnection();
});

async function testConnection() {
  try {
    const res = await fetch("/api/health");
    const data = await res.json();

    if (data.bot_configured && data.channel_configured) {
      console.log("✓ Bot and channel configured");
    } else {
      showToast("⚠️ Check .env configuration", "error");
    }
  } catch (err) {
    console.log("Server not reachable:", err.message);
  }
}

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
      setStatus("Map your columns below 👇", "");
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
      sendBtn.innerHTML = '<span class="btn-icon">📨</span><span>Send to Telegram</span>';
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
// Start Send Job
// ========================================
async function startSendJob() {
  if (currentJobId) return;

  setActiveStep(3);
  setStatus("Starting job...", "loading");
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
    // Start the job
    const res = await fetch("/api/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows, mapping })
    });

    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || "Failed to start job");
    }

    const data = await res.json();
    currentJobId = data.jobId;

    // Subscribe to SSE updates
    subscribeToEvents(currentJobId);

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
    await fetch(`/api/stop/${currentJobId}`, { method: "POST" });
  } catch (error) {
    console.error("Stop error:", error);
  }
}

// ========================================
// SSE Event Stream
// ========================================
function subscribeToEvents(jobId) {
  if (eventSource) {
    eventSource.close();
  }

  eventSource = new EventSource(`/api/events/${jobId}`);

  eventSource.addEventListener("connected", (e) => {
    const data = JSON.parse(e.data);
    console.log("Connected to job:", data.jobId);
    setStatus("Connected. Sending messages...", "loading");
  });

  eventSource.addEventListener("progress", (e) => {
    const data = JSON.parse(e.data);
    updateProgress(data.current, data.total, data.sent, data.failed);
    setStatus(`Sending: ${data.current}/${data.total} (${data.percent}%)`, "loading");
  });

  eventSource.addEventListener("log", (e) => {
    const data = JSON.parse(e.data);
    console.log(`[${data.time}] ${data.message}`);
  });

  eventSource.addEventListener("ratelimit", (e) => {
    const data = JSON.parse(e.data);
    setStatus(`⏳ Rate limited. Waiting ${data.retryAfter}s...`, "loading");
    showToast(`Rate limited. Waiting ${data.retryAfter}s...`, "error");
  });

  eventSource.addEventListener("done", (e) => {
    const data = JSON.parse(e.data);

    eventSource.close();
    eventSource = null;
    currentJobId = null;

    if (data.failed === 0) {
      setStatus(`✅ All ${data.sent} messages sent!`, "success");
      showToast(`Sent ${data.sent} messages!`, "success");
    } else {
      setStatus(`⚠️ ${data.sent}/${data.total} sent, ${data.failed} failed`, "error");
      showToast(`${data.failed} messages failed`, "error");
    }

    updateSendButton("ready");
  });

  eventSource.addEventListener("stopped", (e) => {
    eventSource.close();
    eventSource = null;
    currentJobId = null;

    setStatus("🛑 Job stopped", "error");
    showToast("Job stopped", "error");
    updateSendButton("ready");
  });

  eventSource.onerror = (e) => {
    console.error("SSE error:", e);
    if (eventSource.readyState === EventSource.CLOSED) {
      eventSource = null;
      currentJobId = null;
      updateSendButton("ready");
    }
  };
}

// ========================================
// Progress Tracking
// ========================================
function updateProgress(current, total, sent, failed) {
  const percent = total > 0 ? Math.round((current / total) * 100) : 0;

  progressBar.style.width = `${percent}%`;
  progressCount.textContent = `${current} / ${total}`;
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
