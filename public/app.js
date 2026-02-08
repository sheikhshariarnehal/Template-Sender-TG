// ========================================
// Template-Sender-TG - Application Logic
// ========================================

// State
let rows = [];
let headers = [];
let isSending = false;

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
  // Test connection on load
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
      sendBtn.disabled = false;

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

  // Try to auto-map based on common column names
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
// Send Messages
// ========================================
sendBtn.addEventListener("click", sendMessages);

async function sendMessages() {
  if (isSending) return;

  isSending = true;
  sendBtn.disabled = true;
  sendBtn.innerHTML = '<span class="loading-spinner">⏳</span> Sending...';

  setActiveStep(3);
  setStatus("Connecting to Telegram...", "loading");

  // Show progress
  progressSection.classList.add("visible");
  updateProgress(0, rows.length);

  const mapping = {
    title: document.getElementById("title").value,
    description: document.getElementById("description").value,
    download: document.getElementById("download").value,
    view: document.getElementById("view").value,
    image: document.getElementById("image").value
  };

  try {
    setStatus(`Sending ${rows.length} messages...`, "loading");

    const res = await fetch("/api/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows, mapping })
    });

    if (!res.ok) {
      const errorText = await res.text();
      try {
        const error = JSON.parse(errorText);
        throw new Error(error.error || "Server error");
      } catch {
        throw new Error(`HTTP ${res.status}: ${errorText}`);
      }
    }

    const result = await res.json();

    updateProgress(result.sent, result.total);

    if (result.success) {
      setStatus(`✅ All ${result.sent} messages sent!`, "success");
      showToast(`Sent ${result.sent} messages!`, "success");
    } else {
      setStatus(`⚠️ ${result.sent}/${result.total} sent, ${result.failed} failed`, "error");
      showToast(`${result.failed} messages failed`, "error");

      // Log errors
      if (result.errors && result.errors.length > 0) {
        console.group("Failed messages:");
        result.errors.forEach(e => console.log(`Row ${e.row}: ${e.error}`));
        console.groupEnd();
      }
    }
  } catch (error) {
    setStatus(`❌ ${error.message}`, "error");
    showToast("Failed to send", "error");
    console.error("Send error:", error);
  } finally {
    isSending = false;
    sendBtn.disabled = false;
    sendBtn.innerHTML = '<span class="btn-icon">📨</span><span>Send to Telegram</span>';
  }
}

// ========================================
// Progress Tracking
// ========================================
function updateProgress(current, total) {
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
