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

app.post('/api/download-to-server', async (req, res) => {
    try {
        const { trackId, quality, track, apiBaseUrl, downloadPath, filenameTemplate, folderTemplate } = req.body;
        
        // Get download path from settings (fallback to /tmp)
        const basePath = downloadPath || '/tmp/music';
        
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
        
        // Build paths using templates
        const folderPath = buildServerFolderPath(track, folderTemplate);
        const filename = buildServerFilename(track, quality, manifestData.mimeType, filenameTemplate);
        
        // Create full directory path
        const fullPath = path.join(basePath, folderPath);
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

/**
 * Sanitizes individual filename/folder components (removes all special chars including /)
 */
function sanitizeFilename(str) {
    if (!str) return 'Unknown';
    return str.replace(/[/\\?%*:|"<>]/g, '-').substring(0, 200);
}

/**
 * Replaces template placeholders with actual values
 * Path separators (/) are preserved, but values are sanitized
 */
function formatTemplate(template, data) {
    if (!template) return '';
    
    return template.replace(/\{(\w+)\}/g, (match, key) => {
        const value = data[key];
        if (value === undefined || value === null) return '';
        // Sanitize individual values (no slashes allowed in the actual data)
        return sanitizeFilename(String(value));
    });
}

/**
 * Sanitizes a string for use in file paths
 * Removes invalid characters but NOT forward slashes (which are path separators)
 */
function sanitizeForPath(str) {
    if (!str) return 'Unknown';
    // Remove everything EXCEPT forward slashes
    return str.replace(/[\\?%*:|"<>]/g, '-').substring(0, 200);
}

/**
 * Gets file extension based on quality/mime type
 */
function getExtensionFromMimeType(mimeType) {
    if (mimeType === 'audio/flac') return 'flac';
    if (mimeType === 'audio/mp4' || mimeType === 'audio/m4a') return 'm4a';
    return 'mp4'; // default fallback
}

/**
 * Builds filename using template
 */
function buildServerFilename(track, quality, mimeType, filenameTemplate) {
    const template = filenameTemplate || '{trackNumber} - {artist} - {title}';
    const extension = getExtensionFromMimeType(mimeType);
    
    const data = {
        trackNumber: track.trackNumber ? String(track.trackNumber).padStart(2, '0') : '',
        artist: track.artist?.name || 'Unknown Artist',
        title: track.title || 'Unknown Title',
        album: track.album?.title || 'Unknown Album'
    };
    
    return formatTemplate(template, data) + '.' + extension;
}

/**
 * Builds folder path using template
 */
function buildServerFolderPath(track, folderTemplate) {
    const template = folderTemplate || '{albumArtist}/{albumTitle}';
    
    // Extract year from release date if available
    let year = '';
    const releaseDateStr = track.album?.releaseDate || track.streamStartDate;
    if (releaseDateStr) {
        try {
            const releaseDate = new Date(releaseDateStr);
            if (!isNaN(releaseDate.getTime())) {
                year = releaseDate.getFullYear().toString();
            }
        } catch (e) {
            // Invalid date, leave year empty
        }
    }
    
    const data = {
        albumArtist: track.album?.artist?.name || track.artist?.name || 'Unknown Album Artist',
        albumTitle: track.album?.title || 'Unknown Album',
        artist: track.artist?.name || 'Unknown Artist',
        year: year
    };
    
    return formatTemplate(template, data);
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