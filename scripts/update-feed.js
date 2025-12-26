
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
// IMPORTANT: Use GoogleGenAI as used in the client app
import { GoogleGenAI } from "@google/genai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read profiles from the file extracted from App.tsx
const profilesPath = path.join(__dirname, '../src/data/profiles.json');
const profiles = JSON.parse(fs.readFileSync(profilesPath, 'utf8'));

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
    console.error("GEMINI_API_KEY is missing!");
    process.exit(1);
}

const ai = new GoogleGenAI({ apiKey });

// Delay (Reduced to 5s since we have Paid API Key)
const BASE_DELAY_MS = 5000;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Global circuit breaker
let consecutive429Errors = 0;
const MAX_CONSECUTIVE_429 = 3;

async function generateContentWithRetry(prompt, retries = 3) {
    // Check circuit breaker
    if (consecutive429Errors >= MAX_CONSECUTIVE_429) {
        throw new Error("CIRCUIT_BROKEN_QUOTA_EXCEEDED");
    }

    const model = "gemini-3-flash-preview";

    for (let i = 0; i < retries; i++) {
        try {
            const result = await ai.models.generateContent({
                model: model,
                contents: prompt,
                config: { tools: [{ googleSearch: {} }] },
            });
            // Reset counter on success
            consecutive429Errors = 0;
            return result;
        } catch (error) {
            const errStr = error.toString();

            // Circuit Breaker Trigger
            if (errStr.includes("429") || errStr.includes("Quota exceeded") || (error.status === 429)) {
                consecutive429Errors++;
                console.log(`!! Rate Limit (429) hit. (${consecutive429Errors}/${MAX_CONSECUTIVE_429})`);

                if (consecutive429Errors >= MAX_CONSECUTIVE_429) {
                    console.error("!!! CIRCUIT BREAKER TRIPPED: Quota likely exhausted. Stopping all scans.");
                    throw new Error("CIRCUIT_BROKEN_QUOTA_EXCEEDED");
                }

                console.log(`Waiting 60s before retry ${i + 1}/${retries}...`);
                await sleep(60000);
                continue;
            }

            // Fallback for 404
            if ((errStr.includes("404") || errStr.includes("not found")) && i === 0) {
                console.log("Warngin: 'gemini-3-flash-preview' not found. Falling back to 'gemini-2.0-flash-exp'...");
                return await ai.models.generateContent({
                    model: "gemini-2.0-flash-exp",
                    contents: prompt,
                    config: { tools: [{ googleSearch: {} }] },
                });
            }
            throw error;
        }
    }
    throw new Error("Max retries exceeded for GEMINI API");
}

async function scrapeProfile(profile) {
    // Check breaker before starting
    if (consecutive429Errors >= MAX_CONSECUTIVE_429) {
        return [];
    }

    console.log(`Analyzing: ${profile.name} (${profile.platform})...`);

    // Prompt structure (Keeping original logic)
    const prompt = `
    Analyze this social media profile: "${profile.url}" (${profile.platform})
    Using Google Search, find the recent posts/news from this profile published ONLY within the last 2 hours.
    
    If a post is older than 2 hours, DO NOT include it.
    If no posts are found from the last 2 hours, return an empty array [].
    
    IMPORTANT: If the post has an image, you MUST extract its direct URL into "imageUrl".
    
    Return ONLY a JSON array with this format:
    [
        {
          "title": "Post Title / Summary (Turkish)",
          "link": "Direct URL to post",
          "description": "Content summary (Turkish)",
          "pubDate": "ISO 8601 Date",
          "imageUrl": "Direct Image URL (or null)"
        }
    ]
    `;

    try {
        const response = await generateContentWithRetry(prompt);
        // SDK @google/genai returns result with .text || ""

        const text = response.text || "";
        const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/) || text.match(/\[[\s\S]*\]/);

        if (!jsonMatch) {
            console.log(`- No JSON found for ${profile.name}`);
            return [];
        }

        const cleanText = jsonMatch[1] || jsonMatch[0];
        const items = JSON.parse(cleanText.trim());

        if (Array.isArray(items)) {
            return items.map(item => {
                // Format Author Name: "Ahmet Bolat (LI)" -> "Ahmet Bolat LinkedIn Hesabı"
                const cleanName = profile.name.replace(/\s*\(.*?\)\s*/g, '').trim();
                const formattedAuthor = `${cleanName} ${profile.platform} Hesabı`;

                return {
                    ...item,
                    author: formattedAuthor,
                    guid: item.link
                };
            });
        }
        return [];
    } catch (e) {
        if (e.message.includes("CIRCUIT_BROKEN")) {
            console.log("Skipping due to broken circuit.");
        } else {
            console.error(`- Error for ${profile.name}:`, e.message);
        }
        return [];
    }
}

function generateXML(items, title) {
    // Sort descending by date
    items.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

    const itemsXML = items.map(item => `
    <item>
      <title><![CDATA[${item.title}]]></title>
      <link>${item.link}</link>
      <description><![CDATA[${item.description}]]></description>
      <pubDate>${new Date(item.pubDate).toUTCString()}</pubDate>
      <author>${item.author}</author>
      <guid>${item.guid}</guid>
      ${item.imageUrl ? `<enclosure url="${item.imageUrl}" type="image/jpeg" />` : ''} 
    </item>`).join('');
    // Added enclosure for advanced readers, though description usually carries image too.

    return `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0">
  <channel>
    <title>${title}</title>
    <link>https://github.com/gurkankose123/rss</link>
    <description>Otomatik güncellenen RSS akışı (Social2RSS Pro)</description>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <language>tr</language>
    ${itemsXML}
  </channel>
</rss>`;
}

// Helper to parse existing XML and retrieve items
function parseExistingFeed(xmlContent) {
    const items = [];
    // Regex to capture content inside <item>...</item>
    const itemRegex = /<item>[\s\S]*?<\/item>/g;
    const matches = xmlContent.match(itemRegex);

    if (matches) {
        matches.forEach(itemStr => {
            try {
                const titleMatch = itemStr.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/);
                const linkMatch = itemStr.match(/<link>(.*?)<\/link>/);
                const descMatch = itemStr.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/);
                const dateMatch = itemStr.match(/<pubDate>(.*?)<\/pubDate>/);
                const authorMatch = itemStr.match(/<author>(.*?)<\/author>/);
                const guidMatch = itemStr.match(/<guid>(.*?)<\/guid>/);
                // Also capture enclosure/image if needed, but for dedupe link is enough.

                if (linkMatch && dateMatch) {
                    items.push({
                        title: titleMatch ? titleMatch[1] : '',
                        link: linkMatch[1],
                        description: descMatch ? descMatch[1] : '',
                        pubDate: new Date(dateMatch[1]).toISOString(), // Store as ISO for sorting
                        author: authorMatch ? authorMatch[1] : '',
                        guid: guidMatch ? guidMatch[1] : linkMatch[1]
                    });
                }
            } catch (e) {
                // Ignore malformed items
            }
        });
    }
    return items;
}

async function main() {
    console.log(`Starting scan for ${profiles.length} profiles...`);

    // 1. Read existing feed to prevent duplicates
    const outputPath = path.join(__dirname, '../public/feed.xml');
    let existingItems = [];
    const existingGuids = new Set();

    if (fs.existsSync(outputPath)) {
        console.log("Reading existing feed...");
        try {
            const existingXML = fs.readFileSync(outputPath, 'utf8');
            existingItems = parseExistingFeed(existingXML);
            existingItems.forEach(item => existingGuids.add(item.link)); // Use link as unique ID
            console.log(`Loaded ${existingItems.length} existing items.`);
        } catch (e) {
            console.log("Could not read existing feed, starting fresh.");
        }
    }

    let allNewItems = [];

    // Turbo Mode: Process 5 profiles in parallel
    const CHUNK_SIZE = 5;
    for (let i = 0; i < profiles.length; i += CHUNK_SIZE) {
        const chunk = profiles.slice(i, i + CHUNK_SIZE);
        console.log(`Processing chunk ${Math.floor(i / CHUNK_SIZE) + 1}/${Math.ceil(profiles.length / CHUNK_SIZE)} (Profiles ${i + 1}-${Math.min(i + CHUNK_SIZE, profiles.length)})...`);

        const results = await Promise.all(chunk.map(profile => scrapeProfile(profile)));

        results.forEach(items => {
            if (items.length > 0) {
                // Filter duplicates
                const uniqueItems = items.filter(item => !existingGuids.has(item.link));

                if (uniqueItems.length > 0) {
                    console.log(`  + Found ${items.length} items (${uniqueItems.length} new).`);
                    allNewItems = [...allNewItems, ...uniqueItems];

                    // Add new GUIDs to Set to prevent dupes within the same run 
                    uniqueItems.forEach(u => existingGuids.add(u.link));
                } else {
                    console.log(`  . Found ${items.length} items (All duplicates).`);
                }
            }
        });

        // Small breather between batches
        if (i + CHUNK_SIZE < profiles.length) {
            await sleep(2000);
        }
    }

    console.log(`Scan complete. Found ${allNewItems.length} NEW items.`);

    // Merge New + Old
    const combinedItems = [...allNewItems, ...existingItems];

    // Sort by Date Descending
    combinedItems.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

    // Limit to max 100 items to keep feed size healthy
    const MAX_ITEMS = 100;
    const finalItems = combinedItems.slice(0, MAX_ITEMS);

    // Write even if no new items to keep health check
    if (finalItems.length === 0) {
        console.log("No items at all. Exiting.");
        return;
    }

    const xmlContent = generateXML(finalItems, "Havacılık ve Savunma Gündemi");

    // Ensure dir exists
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(outputPath, xmlContent);
    console.log(`Feed written to ${outputPath} with ${finalItems.length} items.`);
}

main().catch(console.error);
