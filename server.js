import express from "express";
import multer from "multer";
import csv from "csv-parser";
import fs from "fs";
import TelegramBot from "node-telegram-bot-api";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());
app.use(express.static("public"));

const upload = multer({ dest: "uploads/" });

const bot = new TelegramBot(process.env.BOT_TOKEN);

app.post("/upload", upload.single("csv"), (req, res) => {
  const columns = [];

  fs.createReadStream(req.file.path)
    .pipe(csv())
    .on("headers", (headers) => {
      headers.forEach(h => columns.push(h));
      res.json({ columns });
    });
});

app.post("/send", (req, res) => {
  const { mapping, filePath } = req.body;

  fs.createReadStream(filePath)
    .pipe(csv())
    .on("data", async (row) => {
      const message = `
<b>${row[mapping.title]}</b>

${row[mapping.description]}

🔗 <a href="${row[mapping.view]}">View</a>
⬇️ <a href="${row[mapping.download]}">Download</a>
      `;

      await bot.sendPhoto(
        process.env.CHANNEL_ID,
        row[mapping.image],
        {
          caption: message,
          parse_mode: "HTML"
        }
      );
    })
    .on("end", () => {
      res.json({ success: true });
    });
});

app.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
});
