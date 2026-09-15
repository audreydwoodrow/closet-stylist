const CATEGORIES = ['top', 'bottom', 'dress', 'outerwear', 'shoes', 'accessory', 'other'];

let closetItems = [];
let selectedCategories = new Set();
let inspoFileData = null; // { file }
let mockMode = false;

// ---- Tabs ----
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
    if (btn.dataset.tab === 'history') loadHistory();
  });
});

// ---- Helpers ----
function fileToPreview(file, imgEl, textEl) {
  const url = URL.createObjectURL(file);
  imgEl.src = url;
  imgEl.hidden = false;
  textEl.hidden = true;
}

function estimateCost(photoCount) {
  // Rough estimate only — actual pricing depends on your model and current rates.
  // ~1600 tokens/image (API caps large images), small text overhead per photo.
  const tokens = photoCount * 1650 + 700;
  const lowCost = (tokens / 1_000_000) * 0.8; // haiku-ish low bound
  const highCost = (tokens / 1_000_000) * 1.5;
  return { tokens, lowCost, highCost };
}

// ---- Closet: add item ----
const itemFileInput = document.getElementById('itemFile');
const itemDrop = document.getElementById('itemDrop');
const itemPreviewList = document.getElementById('itemPreviewList');
const itemDropText = document.getElementById('itemDropText');

itemDrop.addEventListener('click', () => itemFileInput.click());
itemFileInput.addEventListener('change', () => {
  itemPreviewList.innerHTML = '';
  const files = Array.from(itemFileInput.files);
  if (files.length === 0) return;
  itemDropText.hidden = true;
  files.forEach((file) => {
    const img = document.createElement('img');
    img.src = URL.createObjectURL(file);
    itemPreviewList.appendChild(img);
  });
});

document.getElementById('addItemForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const files = Array.from(itemFileInput.files);
  if (files.length === 0) return;

  const form = new FormData();
  files.forEach((file) => form.append('photos', file));
  form.append('name', document.getElementById('itemName').value);
  form.append('category', document.getElementById('itemCategory').value);
  form.append('tags', document.getElementById('itemTags').value);
  form.append('notes', document.getElementById('itemNotes').value);

  const res = await fetch('/api/closet', { method: 'POST', body: form });
  if (res.ok) {
    e.target.reset();
    itemPreviewList.innerHTML = '';
    itemDropText.hidden = false;
    await loadCloset();
  } else {
    alert('Failed to add item');
  }
});

async function addPhotosToItem(id, files) {
  const form = new FormData();
  files.forEach((file) => form.append('photos', file));
  const res = await fetch(`/api/closet/${id}/photos`, { method: 'POST', body: form });
  if (!res.ok) {
    alert('Failed to add photo(s)');
    return;
  }
  await loadCloset();
}

async function loadCloset() {
  const res = await fetch('/api/closet');
  closetItems = await res.json();
  renderClosetGrid();
  renderCategoryFilters();
  renderClosetFilterDropdown();
}

function renderClosetFilterDropdown() {
  const select = document.getElementById('closetFilter');
  const current = select.value;
  select.innerHTML = '<option value="">All categories</option>' +
    CATEGORIES.map((c) => `<option value="${c}">${capitalize(c)}</option>`).join('');
  select.value = current;
}

document.getElementById('closetFilter').addEventListener('change', renderClosetGrid);

function renderClosetGrid() {
  const filter = document.getElementById('closetFilter').value;
  const grid = document.getElementById('closetGrid');
  const filtered = filter ? closetItems.filter((i) => i.category === filter) : closetItems;
  document.getElementById('itemCount').textContent = closetItems.length;

  if (filtered.length === 0) {
    grid.innerHTML = '<p class="empty-note">No items yet.</p>';
    return;
  }

  grid.innerHTML = filtered.map((item) => {
    const [front, back1, back2] = item.filenames;
    return `
    <div class="item-card" data-id="${item.id}">
      <button class="delete-btn" title="Delete item">&times;</button>
      <div class="photo-stack">
        ${back2 ? `<img class="photo-back-2" src="/photos/${back2}" />` : ''}
        ${back1 ? `<img class="photo-back-1" src="/photos/${back1}" />` : ''}
        <img class="photo-front" src="/photos/${front}" alt="${escapeHtml(item.name)}" />
        <button class="add-photo-btn" title="Add another photo of this item (e.g. the back)">+</button>
      </div>
      <div class="item-info">
        <div class="item-name">${escapeHtml(item.name) || capitalize(item.category)}</div>
        <div class="item-tags">${item.tags.join(', ')}</div>
      </div>
    </div>
  `;
  }).join('');

  grid.querySelectorAll('.delete-btn').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      const id = e.target.closest('.item-card').dataset.id;
      if (!confirm('Remove this item from your closet?')) return;
      await fetch(`/api/closet/${id}`, { method: 'DELETE' });
      await loadCloset();
    });
  });

  grid.querySelectorAll('.add-photo-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const id = e.target.closest('.item-card').dataset.id;
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.multiple = true;
      input.onchange = () => {
        if (input.files.length) addPhotosToItem(id, Array.from(input.files));
      };
      input.click();
    });
  });
}

// ---- Match tab ----
const inspoFileInput = document.getElementById('inspoFile');
const inspoDrop = document.getElementById('inspoDrop');
const inspoPreview = document.getElementById('inspoPreview');
const inspoDropText = document.getElementById('inspoDropText');
const matchBtn = document.getElementById('matchBtn');

inspoDrop.addEventListener('click', () => inspoFileInput.click());
inspoFileInput.addEventListener('change', () => {
  if (inspoFileInput.files[0]) {
    fileToPreview(inspoFileInput.files[0], inspoPreview, inspoDropText);
    matchBtn.disabled = false;
  }
});

function renderCategoryFilters() {
  const container = document.getElementById('categoryFilters');
  const present = CATEGORIES.filter((c) => closetItems.some((i) => i.category === c));
  const cats = present.length ? present : CATEGORIES;

  if (selectedCategories.size === 0) {
    cats.forEach((c) => selectedCategories.add(c));
  }

  container.innerHTML = cats.map((c) => `
    <span class="chip ${selectedCategories.has(c) ? 'active' : ''}" data-cat="${c}">${capitalize(c)}</span>
  `).join('');

  container.querySelectorAll('.chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const cat = chip.dataset.cat;
      if (selectedCategories.has(cat)) selectedCategories.delete(cat);
      else selectedCategories.add(cat);
      chip.classList.toggle('active');
      updateCostEstimate();
    });
  });

  updateCostEstimate();
}

function updateCostEstimate() {
  const matched = closetItems.filter((i) => selectedCategories.has(i.category));
  const photoCount = matched.reduce((sum, i) => sum + i.filenames.length, 0);
  const el = document.getElementById('costEstimate');
  if (matched.length === 0) {
    el.textContent = 'No closet items match the selected categories.';
    return;
  }
  if (mockMode) {
    el.textContent = `~${matched.length} item(s), ${photoCount} photo(s) would be sent — running in MOCK MODE (no API key set), so this match will be free and simulated.`;
    return;
  }
  const { lowCost, highCost } = estimateCost(photoCount);
  el.textContent = `~${matched.length} item(s), ${photoCount} photo(s) will be sent to Claude — roughly $${lowCost.toFixed(3)}–$${highCost.toFixed(3)} per match (estimate, varies by model/rates).`;
}

matchBtn.addEventListener('click', async () => {
  const file = inspoFileInput.files[0];
  if (!file) return;

  const form = new FormData();
  form.append('photo', file);
  form.append('context', document.getElementById('matchContext').value);
  form.append('categories', JSON.stringify(Array.from(selectedCategories)));

  matchBtn.disabled = true;
  document.getElementById('matchStatus').textContent = 'Asking Claude to compare your closet against this look...';
  document.getElementById('matchResult').hidden = true;

  try {
    const res = await fetch('/api/match', { method: 'POST', body: form });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Match failed');
    renderMatchResult(data);
    document.getElementById('matchStatus').textContent = '';
  } catch (err) {
    document.getElementById('matchStatus').textContent = `Error: ${err.message}`;
  } finally {
    matchBtn.disabled = false;
  }
});

function renderMatchResult(entry) {
  const el = document.getElementById('matchResult');
  const itemsById = Object.fromEntries(closetItems.map((i) => [i.id, i]));
  const outfits = entry.result.outfits || [];

  el.innerHTML = `
    ${entry.mock ? '<div class="mock-banner">MOCK MODE — no API call was made. Add ANTHROPIC_API_KEY to .env for real matching.</div>' : ''}
    <div class="result-header">
      <img src="/inspiration/${entry.filename}" alt="inspiration" />
      <div>
        <strong>${outfits.length ? `${outfits.length} suggestion(s)` : 'No strong matches found'}</strong>
        <p class="hint">Compared against ${entry.itemsConsidered} closet item(s) using ${entry.model}.</p>
      </div>
    </div>
    ${outfits.map((outfit) => `
      <div class="outfit-card">
        <div class="outfit-items">
          ${outfit.itemIds.filter((id) => itemsById[id]).map((id) => `
            <img src="/photos/${itemsById[id].filenames[0]}" title="${escapeHtml(itemsById[id].name)}" />
          `).join('')}
        </div>
        <div class="reasoning">${escapeHtml(outfit.reasoning || '')}</div>
      </div>
    `).join('')}
    ${entry.result.overallNotes ? `<div class="overall-notes">${escapeHtml(entry.result.overallNotes)}</div>` : ''}
  `;
  el.hidden = false;
}

// ---- History ----
async function loadHistory() {
  const res = await fetch('/api/history');
  const history = await res.json();
  const itemsById = Object.fromEntries(closetItems.map((i) => [i.id, i]));
  const list = document.getElementById('historyList');

  if (history.length === 0) {
    list.innerHTML = '<p class="empty-note">No matches yet — try the Find a Match tab.</p>';
    return;
  }

  list.innerHTML = history.map((entry) => {
    const outfits = entry.result?.outfits || [];
    const summary = outfits.length
      ? outfits.map((o) => o.itemIds.filter((id) => itemsById[id]).map((id) => itemsById[id].name || itemsById[id].category).join(' + ')).join(' | ')
      : (entry.result?.overallNotes || 'No suggestions');
    return `
      <div class="history-entry">
        <img src="/inspiration/${entry.filename}" alt="inspiration" />
        <div>
          <div class="history-meta">${new Date(entry.createdAt).toLocaleString()} · ${entry.itemsConsidered} items considered</div>
          <div class="history-notes">${escapeHtml(summary)}</div>
        </div>
      </div>
    `;
  }).join('');
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

async function loadStatus() {
  const res = await fetch('/api/status');
  const status = await res.json();
  mockMode = status.mockMode;
  if (mockMode) {
    const banner = document.createElement('div');
    banner.className = 'mock-banner';
    banner.textContent = 'MOCK MODE: no ANTHROPIC_API_KEY set in .env — matches are simulated and free until you add one.';
    document.querySelector('header').appendChild(banner);
  }
  updateCostEstimate();
}

loadStatus();
loadCloset();
