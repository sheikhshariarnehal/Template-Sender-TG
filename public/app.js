let rows = [];
let headers = [];

const csvInput = document.getElementById("csv");
const mappingDiv = document.getElementById("mapping");
const sendBtn = document.getElementById("sendBtn");
const status = document.getElementById("status");

csvInput.addEventListener("change", () => {
  status.textContent = "Reading CSV...";

  Papa.parse(csvInput.files[0], {
    header: true,
    skipEmptyLines: true,
    complete: (result) => {
      rows = result.data;
      headers = result.meta.fields;

      renderMapping();
      status.textContent = "Map columns below 👇";
      sendBtn.disabled = false;
    }
  });
});

function renderMapping() {
  const fields = {
    title: "Title",
    description: "Description",
    download: "Download Link",
    view: "View Link",
    image: "Image URL"
  };

  mappingDiv.innerHTML = Object.entries(fields).map(
    ([key, label]) => `
      <label>${label}</label>
      <select id="${key}">
        ${headers.map(h => `<option value="${h}">${h}</option>`).join("")}
      </select>
    `
  ).join("");

  mappingDiv.classList.remove("hidden");
}

sendBtn.addEventListener("click", async () => {
  sendBtn.disabled = true;
  status.textContent = "Sending to Telegram...";

  const mapping = {
    title: title.value,
    description: description.value,
    download: download.value,
    view: view.value,
    image: image.value
  };

  const res = await fetch("/api/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rows, mapping })
  });

  if (res.ok) {
    status.textContent = "✅ Sent successfully!";
  } else {
    status.textContent = "❌ Failed to send";
  }
});
