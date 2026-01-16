import express from "express";
import path from "path";
import { fileURLToPath } from "url";
const app = express();
const port = process.env.PORT || 3000;
// Path helpers
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Serve static files from the current directory (where the compiled files are)
app.use(express.static(__dirname));
// OGP Fetch Endpoint
app.get("/api/ogp", async (req, res) => {
    const { url } = req.query;
    if (!url || typeof url !== 'string') {
        res.status(400).json({ error: "URL parameter is required" });
        return;
    }
    try {
        const response = await fetch(url);
        const html = await response.text();
        // Extract OGP metadata from the HTML
        const ogpData = {};
        const metaTags = html.match(/<meta[^>]+(property|name)="og:[^"]+"[^>]*>/g);
        if (metaTags) {
            metaTags.forEach((tag) => {
                const propertyMatch = tag.match(/(property|name)="([^"]+)"/);
                const contentMatch = tag.match(/content="([^"]*)"/);
                if (propertyMatch && contentMatch && propertyMatch[2]) {
                    ogpData[propertyMatch[2]] = contentMatch[1] || "";
                }
            });
        }
        res.json(ogpData);
    }
    catch (error) {
        console.error("Error fetching OGP data:", error);
        res.status(500).json({ error: "Failed to fetch OGP data" });
    }
});
// SPA fallback: always return index.html for any unknown routes
app.get("*", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});
// Start server
app.listen(port, () => {
    console.log(`🚀 Server running at http://localhost:${port}`);
});
