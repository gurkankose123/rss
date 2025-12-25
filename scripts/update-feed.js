
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

async function generateContentWithRetry(prompt, retries = 3) {
    // Exact model from user's code: gemini-3-flash-preview
    // With @google/genai SDK
    const model = "gemini-3-flash-preview";

    for (let i = 0; i < retries; i++) {
        try {
            return await ai.models.generateContent({
                model: model,
                contents: prompt,
                config: { tools: [{ googleSearch: {} }] },
            });
        } catch (error) {
            const errStr = error.toString();

            // Fallback
            if ((errStr.includes("404") || errStr.includes("not found")) && i === 0) {
                console.log("Warngin: 'gemini-3-flash-preview' not found. Falling back to 'gemini-2.0-flash-exp'...");
                return await ai.models.generateContent({
                    model: "gemini-2.0-flash-exp",
                    contents: prompt,
                    config: { tools: [{ googleSearch: {} }] },
                });
            }

            if (errStr.includes("429") || errStr.includes("Quota exceeded") || (error.status === 429)) {
                console.log(`!! Rate Limit (429) hit. Waiting 60s before retry ${i + 1}/${retries}...`);
                await sleep(60000);
                continue;
            }
            throw error;
        }
    }
    throw new Error("Max retries exceeded for GEMINI API");
}

async function scrapeProfile(profile) {
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
        // SDK @google/genai returns result with .text() getter or property?
        // Wait, @google/genai result structure is different from @google/generative-ai
        // The user's code `services/profileService.ts` used `response.text || ""`
        // Let's stick to that.

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
        console.error(`- Error for ${profile.name}:`, e.message);
        return [];
    }
}

function generateXML(items, title) {
    items.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

    const itemsXML = items.map(item => `
    <item>
      <title><![CDATA[${item.title}]]></title>
      <link>${item.link}</link>
      <description><![CDATA[${item.description}]]></description>
      <pubDate>${new Date(item.pubDate).toUTCString()}</pubDate>
      <author>${item.author}</author>
      <guid>${item.guid}</guid>
    </item>`).join('');

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

async function main() {
    console.log(`Starting scan for ${profiles.length} profiles...`);
    let allNewItems = [];

    // Turbo Mode: Process 5 profiles in parallel
    const CHUNK_SIZE = 5;
    for (let i = 0; i < profiles.length; i += CHUNK_SIZE) {
        const chunk = profiles.slice(i, i + CHUNK_SIZE);
        console.log(`Processing chunk ${Math.floor(i / CHUNK_SIZE) + 1}/${Math.ceil(profiles.length / CHUNK_SIZE)} (Profiles ${i + 1}-${Math.min(i + CHUNK_SIZE, profiles.length)})...`);

        const results = await Promise.all(chunk.map(profile => scrapeProfile(profile)));

        results.forEach(items => {
            if (items.length > 0) {
                console.log(`  + Found ${items.length} items.`);
                allNewItems = [...allNewItems, ...items];
            }
        });

        // Small breather between batches
        if (i + CHUNK_SIZE < profiles.length) {
            await sleep(2000);
        }
    }

    console.log(`Scan complete. Found total ${allNewItems.length} items.`);

    if (allNewItems.length === 0) {
        console.log("No new items found. Exiting.");
        return;
    }

    const xmlContent = generateXML(allNewItems, "Havacılık ve Savunma Gündemi");
    const outputPath = path.join(__dirname, '../public/feed.xml');

    // Ensure dir exists
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(outputPath, xmlContent);
    console.log(`Feed written to ${outputPath}`);
}

main().catch(console.error);
