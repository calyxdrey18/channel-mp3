const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, generateForwardMessageContent, prepareWAMessageMedia, relayMessage } = require('@adiwajshing/baileys');
const express = require('express');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('.')); // Serve frontend

// Multer config for uploads
const upload = multer({ dest: 'uploads/' });

// WhatsApp connection setup
let sock;
async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: true
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            console.log('Connection closed, reconnecting...');
            connectToWhatsApp();
        } else if (connection === 'open') {
            console.log('WhatsApp connected!');
        }
    });
}
connectToWhatsApp();

// Endpoint: Send MP3 to channel
app.post('/send-mp3', upload.single('mp3'), async (req, res) => {
    try {
        const { channelLink, start, duration } = req.body;
        const mp3Path = req.file.path;

        // Trim audio if requested
        const trimmedPath = `uploads/trimmed_${req.file.filename}.mp3`;
        await new Promise((resolve, reject) => {
            let command = ffmpeg(mp3Path).output(trimmedPath);
            if (start && duration) {
                command = command.setStartTime(Number(start)).setDuration(Number(duration));
            }
            command.on('end', resolve).on('error', reject).run();
        });

        // Send to WhatsApp channel
        const media = await prepareWAMessageMedia({ audio: fs.readFileSync(trimmedPath), mimetype: 'audio/mpeg' }, { upload: sock.waUploadToServer });
        const message = { audio: media.audio, mimetype: 'audio/mpeg', fileName: 'audio.mp3' };
        await sock.sendMessage(channelLink, message);

        // Clean up
        fs.unlinkSync(mp3Path);
        fs.unlinkSync(trimmedPath);

        res.json({ success: true, message: 'MP3 sent successfully!' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Start server
app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));