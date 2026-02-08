export default function handler(req, res) {
    res.status(200).json({
        insforgeUrl: process.env.INSFORGE_URL,
        insforgeAnonKey: process.env.INSFORGE_ANON_KEY,
        defaultBotToken: process.env.BOT_TOKEN,
        defaultChannelId: process.env.CHANNEL_ID
    });
}
