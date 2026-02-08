import fetch from "node-fetch";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { rows, mapping } = req.body;

  const BOT_TOKEN = process.env.BOT_TOKEN;
  const CHANNEL_ID = process.env.CHANNEL_ID;

  try {
    for (const row of rows) {
      const caption = `
<b>${row[mapping.title]}</b>

${row[mapping.description]}

🔗 <a href="${row[mapping.view]}">View</a>
⬇️ <a href="${row[mapping.download]}">Download</a>
      `.trim();

      await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: CHANNEL_ID,
          photo: row[mapping.image],
          caption,
          parse_mode: "HTML"
        })
      });

      // Telegram rate limit safety
      await new Promise(r => setTimeout(r, 800));
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
