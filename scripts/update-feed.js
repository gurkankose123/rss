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
                console.log("Warning: 'gemini-3-flash-preview' not found. Falling back to 'gemini-2.0-flash-exp'...");
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
    // Updated Prompt: Focus on direct links and longer time window
    const prompt = `
    Analyze this social media profile: "${profile.url}" (${profile.platform})
    Using Google Search, find the recent actual posts/content shared by this SPECIFIC profile within the last 12 hours.
    
    CRITICAL INSTRUCTIONS:
    1. EXCLUDE posts older than 12 hours.
    2. The "link" field MUST be the direct URL to the specific post or tweet if available. If a direct post link is not found, use the profile URL: "${profile.url}". DO NOT use random news sites or Google Search result links.
    3. If no new posts are found from the last 12 hours, return an empty array [].
    4. If the post has an image, extract its direct URL into "imageUrl".
    
    Return ONLY a JSON array with this format:
    [
        {
          "title": "Post Title / Summary (Turkish)",
          "link": "Direct URL to the post or profile",
          "description": "Content summary (Turkish)",
          "pubDate": "ISO 8601 Date (e.g. 2023-10-27T10:00:00Z)",
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
                
                // Fallback validation for link
                let finalLink = item.link;
                if (!finalLink || finalLink.includes("google.com")) {
                     finalLink = profile.url;
                }
                return {
                    ...item,
                    link: finalLink,
                    author: formattedAuthor,
                    guid: finalLink // Use link as GUID to prevent duplicates
                };
            });
        }
        return [];
    } catch (e) {
        console.error(`- Error for ${profile.name}:`, e.message);
        return [];
    }
}
// Helper to clean XML content
function escapeXML(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;')
              .replace(/'/g, '&apos;');
}
function generateXML(newItems, title, existingItems = []) {
    // Combine new and existing items
    let allItems = [...newItems, ...existingItems];
    
    // Deduplicate by GUID (link)
    const seenGuids = new Set();
    allItems = allItems.filter(item => {
        if (seenGuids.has(item.guid)) return false;
        seenGuids.add(item.guid);
        return true;
    });
    // Sort by Date (Newest first)
    allItems.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
    // Limit to last 100 items to keep file size manageable
    if (allItems.length > 100) {
        allItems = allItems.slice(0, 100);
    }
    const itemsXML = allItems.map(item => {
        const enclosureTag = item.imageUrl 
            ? `<enclosure url="${escapeXML(item.imageUrl)}" type="image/jpeg" />` 
            : '';
            
        return `
    <item>
      <title>${escapeXML(item.title)}</title>
      <link>${escapeXML(item.link)}</link>
      <description>${escapeXML(item.description)}</description>
      <pubDate>${new Date(item.pubDate).toUTCString()}</pubDate>
      <author>${escapeXML(item.author)}</author>
      <guid>${escapeXML(item.guid)}</guid>
      ${enclosureTag}
    </item>`;
    }).join('');
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
// Function to parse existing XML to preserve history
function parseExistingFeed(filePath) {
    try {
        if (!fs.existsSync(filePath)) return [];
        
        const xmlContent = fs.readFileSync(filePath, 'utf8');
        
        // Simple regex parsing sufficient for our own generated structure
        const itemRegex = /<item>([\s\S]*?)<\/item>/g;
        const items = [];
        let match;
        
        while ((match = itemRegex.exec(xmlContent)) !== null) {
            const itemBlock = match[1];
            
            const extract = (tag) => {
                const tagMatch = itemBlock.match(new RegExp(`<${tag}>(.*?)<\/${tag}>`, 's')); // 's' flag for multiline
                // Handle CDATA or plain text if we used CDATA before
                // But our new generator uses escapeXML. Let's handle generic XML content.
                // Assuming well-formed XML from our own generator.
                if (tagMatch) return tagMatch[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim(); 
                return null;
            };
            
            const extractAttr = (tag, attr) => {
                 const tagMatch = itemBlock.match(new RegExp(`<${tag}[^>]*${attr}="([^"]*)"[^>]*>`, 's'));
                 if (tagMatch) return tagMatch[1];
                 return null;
            }
            const title = extract('title');
            const link = extract('link');
            const description = extract('description');
            const pubDate = extract('pubDate');
            const author = extract('author');
            const guid = extract('guid');
            const imageUrl = extractAttr('enclosure', 'url'); // Try enclosure first
            if (title && link) {
                items.push({
                    title,
                    link,
                    description: description || '',
                    pubDate: pubDate || new Date().toISOString(),
                    author: author || '',
                    guid: guid || link,
                    imageUrl
                });
            }
        }
        console.log(`Parsed ${items.length} existing items from feed.xml`);
        return items;
        
    } catch (e) {
        console.error("Error parsing existing feed:", e);
        return [];
    }
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
    console.log(`Scan complete. Found total ${allNewItems.length} NEW items.`);
    const outputPath = path.join(__dirname, '../public/feed.xml');
    
    // Read existing items
    const existingItems = parseExistingFeed(outputPath);
    
    if (allNewItems.length === 0 && existingItems.length === 0) {
        console.log("No new items found and no existing history. Exiting.");
        return;
    }
    const xmlContent = generateXML(allNewItems, "Havacılık ve Savunma Gündemi", existingItems);
    // Ensure dir exists
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(outputPath, xmlContent);
    console.log(`Feed written to ${outputPath} with total ${(existingItems.length + allNewItems.length)} items (Limit 100).`);
}
main().catch(console.error);
