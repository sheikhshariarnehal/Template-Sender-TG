let columns = [];
let uploadedFilePath = "";

const csvInput = document.getElementById("csv");
const mappingDiv = document.getElementById("mapping");
const sendBtn = document.getElementById("sendBtn");
const status = document.getElementById("status");

csvInput.addEventListener("change", async () => {
  status.textContent = "Reading CSV...";
  sendBtn.disabled = true;

  const formData = new FormData();
  formData.append("csv", csvInput.files[0]);

  const res = await fetch("/upload", {
    method: "POST",
    body: formData
  });

  const data = await res.json();
  columns = data.columns;

  renderMapping();
  status.textContent = "Map columns below 👇";
});

function renderMapping() {
  const fields = [
    ["title", "Title"],
    ["description", "Description"],
    ["download", "Download Link"],
    ["view", "View Link"],
    ["image", "Image URL"]
  ];

  mappingDiv.innerHTML = fields.map(([id, label]) => `
    <label>${label}</label>
    <select id="${id}">
      ${columns.map(c => `<option value="${c}">${c}</option>`).join("")}
    </select>
  `).join("");

  mappingDiv.classList.remove("hidden");
  sendBtn.disabled = false;
}

sendBtn.addEventListener("click", async () => {
  sendBtn.disabled = true;
  status.textContent = "Sending posts to Telegram...";

  const mapping = {
    title: title.value,
    description: description.value,
    download: download.value,
    view: view.value,
    image: image.value
  };

  await fetch("/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mapping })
  });

  status.textContent = "✅ Sent successfully!";
});
