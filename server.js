import express from 'express';
import https from 'https';
import http from 'http';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json({ limit: '50mb' }));
app.use(express.static(__dirname));

// Server download endpoint
app.post('/api/download-to-server', async (req, res) => {
    try {
        const { trackId, quality, track, apiBaseUrl } = req.body;
        
        // Get download path from settings (fallback to /tmp)
        const downloadPath = req.body.downloadPath || '/tmp/music';
        
        // Fetch track info from Tidal API
        const apiUrl = `${apiBaseUrl}/track/?id=${trackId}&quality=${quality}`;
        const apiResponse = await fetch(apiUrl);
        const apiData = await apiResponse.json();
        
        // Extract stream URL from manifest
        const manifestData = JSON.parse(Buffer.from(apiData.data.manifest, 'base64').toString());
        const streamUrl = manifestData.urls[0];
        
        // Download the audio file
        const audioResponse = await fetch(streamUrl);
        const audioBuffer = await audioResponse.arrayBuffer();
        
        // Build filename
        const artists = Array.isArray(track.artists) 
            ? track.artists.map(a => a.name).join(', ')
            : track.artist?.name || 'Unknown Artist';
        const title = track.title || 'Unknown Title';
        const ext = manifestData.mimeType === 'audio/flac' ? 'flac' : 'mp4';
        const filename = `${sanitizeFilename(artists)} - ${sanitizeFilename(title)}.${ext}`;
        
        // Create directory structure: downloadPath/Artist/Album/
        const artistFolder = sanitizeFilename(track.artist?.name || 'Unknown Artist');
        const albumFolder = sanitizeFilename(track.album?.title || 'Unknown Album');
        const fullPath = path.join(downloadPath, artistFolder, albumFolder);
        
        await fs.mkdir(fullPath, { recursive: true });
        
        // Save file
        const filePath = path.join(fullPath, filename);
        await fs.writeFile(filePath, Buffer.from(audioBuffer));
        
        res.json({ 
            success: true, 
            path: filePath,
            filename: filename
        });
        
    } catch (error) {
        console.error('Server download error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

function sanitizeFilename(str) {
    if (!str) return 'Unknown';
    return str.replace(/[/\\?%*:|"<>]/g, '-').substring(0, 200);
}

// SSL setup (use your existing certs)
const PORT = process.env.PORT || 8081;
const certPath = process.env.CERT_PATH || './cert.pem';
const keyPath = process.env.KEY_PATH || './key.pem';

try {
    const cert = await fs.readFile(certPath);
    const key = await fs.readFile(keyPath);
    https.createServer({ cert, key }, app).listen(PORT, () => {
        console.log(`Server running on https://localhost:${PORT}`);
    });
} catch (err) {
    console.log('SSL certs not found, running HTTP only');
    http.createServer(app).listen(PORT, () => {
        console.log(`Server running on http://localhost:${PORT}`);
    });
}