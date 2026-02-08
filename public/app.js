let columns = [];
let filePath = "";

document.getElementById("csv").addEventListener("change", async (e) => {
  const formData = new FormData();
  formData.append("csv", e.target.files[0]);

  const res = await fetch("/upload", {
    method: "POST",
    body: formData
  });

  const data = await res.json();
  columns = data.columns;
  filePath = e.target.files[0].name;

  renderDropdowns();
});

function renderDropdowns() {
  const fields = ["title", "description", "download", "view", "image"];
  const div = document.getElementById("mapping");

  div.innerHTML = fields.map(f => `
    <label>${f}</label>
    <select id="${f}">
      ${columns.map(c => `<option value="${c}">${c}</option>`).join("")}
    </select><br/>
  `).join("");
}

async function send() {
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
    body: JSON.stringify({ mapping, filePath })
  });

  alert("Sent to Telegram 🚀");
}
