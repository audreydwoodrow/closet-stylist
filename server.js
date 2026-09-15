import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import sharp from 'sharp';
import Anthropic from '@anthropic-ai/sdk';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
const PHOTOS_DIR = path.join(DATA_DIR, 'photos');
const INSPIRATION_DIR = path.join(DATA_DIR, 'inspiration');
const ITEMS_FILE = path.join(DATA_DIR, 'items.json');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');

const MODEL = process.env.MODEL_NAME || 'claude-haiku-4-5-20251001';
const MAX_DIMENSION = 1024;

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/photos', express.static(PHOTOS_DIR));
app.use('/inspiration', express.static(INSPIRATION_DIR));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

async function migrateItemsSchema() {
  const items = await readJson(ITEMS_FILE);
  let changed = false;
  for (const item of items) {
    if (!item.filenames && item.filename) {
      item.filenames = [item.filename];
      delete item.filename;
      changed = true;
    }
  }
  if (changed) await writeJson(ITEMS_FILE, items);
}

async function readJson(file) {
  try {
    const text = await fs.readFile(file, 'utf-8');
    return JSON.parse(text);
  } catch {
    return [];
  }
}

async function writeJson(file, data) {
  await fs.writeFile(file, JSON.stringify(data, null, 2));
}

await migrateItemsSchema();

async function resizeToJpeg(buffer) {
  return sharp(buffer)
    .rotate()
    .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toBuffer();
}

// ---- Closet endpoints ----

app.get('/api/status', (req, res) => {
  res.json({ mockMode: !anthropic, model: MODEL });
});

app.get('/api/closet', async (req, res) => {
  const items = await readJson(ITEMS_FILE);
  res.json(items);
});

async function saveResizedPhotos(files) {
  const filenames = [];
  for (const file of files) {
    const filename = `${randomUUID()}.jpg`;
    const resized = await resizeToJpeg(file.buffer);
    await fs.writeFile(path.join(PHOTOS_DIR, filename), resized);
    filenames.push(filename);
  }
  return filenames;
}

app.post('/api/closet', upload.array('photos', 6), async (req, res) => {
  if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'No photo uploaded' });

  const filenames = await saveResizedPhotos(req.files);

  const tags = (req.body.tags || '')
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);

  const item = {
    id: randomUUID(),
    filenames,
    name: req.body.name || '',
    category: req.body.category || 'other',
    tags,
    notes: req.body.notes || '',
    addedAt: new Date().toISOString(),
  };

  const items = await readJson(ITEMS_FILE);
  items.push(item);
  await writeJson(ITEMS_FILE, items);

  res.json(item);
});

app.post('/api/closet/:id/photos', upload.array('photos', 6), async (req, res) => {
  if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'No photo uploaded' });

  const items = await readJson(ITEMS_FILE);
  const item = items.find((i) => i.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });

  const newFilenames = await saveResizedPhotos(req.files);
  item.filenames.push(...newFilenames);
  await writeJson(ITEMS_FILE, items);

  res.json(item);
});

app.delete('/api/closet/:id/photos/:filename', async (req, res) => {
  const items = await readJson(ITEMS_FILE);
  const item = items.find((i) => i.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  if (item.filenames.length <= 1) {
    return res.status(400).json({ error: 'An item needs at least one photo — delete the item instead.' });
  }

  item.filenames = item.filenames.filter((f) => f !== req.params.filename);
  await writeJson(ITEMS_FILE, items);

  try {
    await fs.unlink(path.join(PHOTOS_DIR, req.params.filename));
  } catch {
    // already gone
  }

  res.json(item);
});

app.delete('/api/closet/:id', async (req, res) => {
  const items = await readJson(ITEMS_FILE);
  const item = items.find((i) => i.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });

  const remaining = items.filter((i) => i.id !== req.params.id);
  await writeJson(ITEMS_FILE, remaining);

  for (const filename of item.filenames) {
    try {
      await fs.unlink(path.join(PHOTOS_DIR, filename));
    } catch {
      // file already gone, ignore
    }
  }

  res.json({ ok: true });
});

// ---- History endpoints ----

app.get('/api/history', async (req, res) => {
  const history = await readJson(HISTORY_FILE);
  res.json(history.slice().reverse());
});

app.delete('/api/history/:id', async (req, res) => {
  const history = await readJson(HISTORY_FILE);
  const entry = history.find((h) => h.id === req.params.id);
  const remaining = history.filter((h) => h.id !== req.params.id);
  await writeJson(HISTORY_FILE, remaining);
  if (entry) {
    try {
      await fs.unlink(path.join(INSPIRATION_DIR, entry.filename));
    } catch {
      // ignore
    }
  }
  res.json({ ok: true });
});

// ---- Matching ----

function mockMatch(itemBlocks) {
  const shuffled = [...itemBlocks].sort(() => Math.random() - 0.5);
  const pickCount = Math.min(itemBlocks.length, Math.random() < 0.5 ? 2 : 3);
  const picks = shuffled.slice(0, pickCount);

  const outfits = picks.length
    ? [{
        itemIds: picks.map((p) => p.item.id),
        reasoning: '[MOCK] This is a placeholder pick, not a real comparison — no API call was made. ' +
          `Randomly selected from: ${picks.map((p) => p.item.name || p.item.category).join(', ')}.`,
      }]
    : [];

  return {
    outfits,
    overallNotes: '[MOCK MODE] No ANTHROPIC_API_KEY is configured, so this result is randomly generated placeholder ' +
      'data to let you test the app\'s flow for free. Add a key to .env for real matching.',
  };
}

app.post('/api/match', upload.single('photo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No inspiration photo uploaded' });

  const mockMode = !anthropic;
  const categories = req.body.categories ? JSON.parse(req.body.categories) : null;
  const context = req.body.context || '';

  const allItems = await readJson(ITEMS_FILE);
  const items = categories && categories.length
    ? allItems.filter((i) => categories.includes(i.category))
    : allItems;

  if (items.length === 0) {
    return res.status(400).json({ error: 'No closet items match the selected filters. Add items or widen the category filter.' });
  }

  const inspoResized = await resizeToJpeg(req.file.buffer);
  const inspoId = randomUUID();
  const inspoFilename = `${inspoId}.jpg`;
  await fs.writeFile(path.join(INSPIRATION_DIR, inspoFilename), inspoResized);

  const itemBlocks = [];
  for (const item of items) {
    const base64Photos = [];
    if (!mockMode) {
      for (const filename of item.filenames) {
        try {
          const buf = await fs.readFile(path.join(PHOTOS_DIR, filename));
          base64Photos.push(buf.toString('base64'));
        } catch {
          // skip missing files
        }
      }
    }
    itemBlocks.push({ item, base64Photos });
  }

  if (mockMode) {
    const historyEntry = {
      id: inspoId,
      filename: inspoFilename,
      context,
      categories: categories || [],
      itemsConsidered: itemBlocks.length,
      result: mockMatch(itemBlocks),
      model: 'mock',
      mock: true,
      usage: null,
      createdAt: new Date().toISOString(),
    };
    const history = await readJson(HISTORY_FILE);
    history.push(historyEntry);
    await writeJson(HISTORY_FILE, history);
    return res.json(historyEntry);
  }

  const content = [
    {
      type: 'text',
      text:
        `Here is a Pinterest inspiration photo of an outfit/look:` +
        (context ? `\n\nContext from the user: ${context}` : ''),
    },
    { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: inspoResized.toString('base64') } },
    {
      type: 'text',
      text:
        `Here are ${itemBlocks.length} items from the user's own closet. Each is labeled with an ID and its tags/notes, ` +
        `followed by one or more photos of that SAME item (e.g. front and back views of one garment — they are not ` +
        `separate items). Use ONLY these IDs when referencing items.`,
    },
  ];

  for (const { item, base64Photos } of itemBlocks) {
    content.push({
      type: 'text',
      text: `ITEM ID: ${item.id} | name: ${item.name || '(untitled)'} | category: ${item.category} | tags: ${item.tags.join(', ') || 'none'}${item.notes ? ` | notes: ${item.notes}` : ''} | photos of this item: ${base64Photos.length}`,
    });
    for (const base64 of base64Photos) {
      content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64 } });
    }
  }

  content.push({
    type: 'text',
    text:
      `Based on the inspiration photo, suggest up to 3 outfit combinations using ONLY the closet items above that best ` +
      `recreate the look (color palette, silhouette, vibe). It's fine to suggest fewer than 3 if the closet doesn't ` +
      `support more good options, or to say honestly that nothing in the closet is a close match.\n\n` +
      `Respond with ONLY valid JSON, no markdown fences, in this exact shape:\n` +
      `{"outfits": [{"itemIds": ["<id>", "<id>"], "reasoning": "1-2 sentences on why this recreates the look"}], "overallNotes": "1-2 sentences of general styling advice, or a note if nothing matches well"}`,
  });

  try {
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      messages: [{ role: 'user', content }],
    });

    const rawText = message.content.map((c) => (c.type === 'text' ? c.text : '')).join('');
    let parsed;
    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : rawText);
    } catch {
      parsed = { outfits: [], overallNotes: rawText };
    }

    const historyEntry = {
      id: inspoId,
      filename: inspoFilename,
      context,
      categories: categories || [],
      itemsConsidered: itemBlocks.length,
      result: parsed,
      model: MODEL,
      mock: false,
      usage: message.usage,
      createdAt: new Date().toISOString(),
    };
    const history = await readJson(HISTORY_FILE);
    history.push(historyEntry);
    await writeJson(HISTORY_FILE, history);

    res.json(historyEntry);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Matching failed' });
  }
});

const PORT = process.env.PORT || 3131;
app.listen(PORT, () => {
  console.log(`Closet Stylist running at http://localhost:${PORT}`);
  if (!anthropic) {
    console.log('No ANTHROPIC_API_KEY set — matching will not work until you add one to .env');
  }
});
