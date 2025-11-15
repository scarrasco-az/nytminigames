const CATEGORIES = [
  { name: "WORDLE STARTING WORDS", color: "group-yellow", words: ["PIOUS", "ADIEU", "CRANE", "STALE"] },
  { name: "THINGS YOU DO AT LUNCH", color: "group-green", words: ["YAP", "GAMES", "COMPLAIN", "STALK"] },
  { name: "ALE'S FACETS", color: "group-blue", words: ["VOGUE", "HOOD", "BOHO", "VASQUE"] },
  { name: "THAT'S SO...", color: "group-purple", words: ["FAIR", "REAL", "TRUE", "CRAZY"] }
];

let words = CATEGORIES.flatMap(c => c.words).sort(() => Math.random() - 0.5);
const grid = document.getElementById("grid");
const livesContainer = document.getElementById("lives");
const animOverlay = document.getElementById("animOverlay");
let selected = [];
let mistakes = 4;
const DUR = {
  move: 700,        // tile movement animation (ms)
  grow: 450,        // "merge grow" animation (ms)
  settle: 300,      // "settle down" after grow (ms)
  oneAway: 2000     // "One away..." message display time (ms)
};
let solvedGroups = 0;
let fusedTiles = [];

const pageWrapper = document.querySelector('.page-wrapper');
const transformStyle = window.getComputedStyle(pageWrapper).transform;
const matrix = new DOMMatrix(transformStyle);
const scale = matrix.a;

// === LOCAL STORAGE HANDLING (your original version) ===
function saveGameState() {
  const state = {
    words,
    mistakes,
    solvedGroups,
    fusedTilesHTML: fusedTiles.map(tile => tile.outerHTML),
    fusedTilesClasses: fusedTiles.map(tile => {
      return Array.from(tile.classList).find(c => c.startsWith("group-")) || "";
    })
  };
  localStorage.setItem("connectionsGameState", JSON.stringify(state));
}

function loadGameState() {
  const saved = localStorage.getItem("connectionsGameState");
  if (!saved) return false;

  try {
    const state = JSON.parse(saved);
    if (state.words) words = state.words;
    mistakes = state.mistakes ?? 4;
    solvedGroups = state.solvedGroups ?? 0;

    fusedTiles = [];
    if (state.fusedTilesHTML && state.fusedTilesClasses) {
      state.fusedTilesHTML.forEach((html, i) => {
        const div = document.createElement("div");
        div.innerHTML = html;
        const tile = div.firstElementChild;

        tile.classList.forEach(c => {
          if (c.startsWith("group-")) tile.classList.remove(c);
        });
        if (state.fusedTilesClasses[i]) {
          tile.classList.add(state.fusedTilesClasses[i]);
        }
        fusedTiles.push(tile);
      });
    }
    return true;
  } catch (e) {
    console.error("Error loading saved game:", e);
    return false;
  }
}

function clearGameState() { localStorage.removeItem("connectionsGameState"); }
function newGame() { clearGameState(); location.reload(); }

// === RENDERING & UI ===
function renderLives() {
  livesContainer.innerHTML = "";
  for (let i = 0; i < mistakes; i++) {
    const circle = document.createElement("div");
    circle.className = "life";
    livesContainer.appendChild(circle);
  }
}

function loseLife() {
  const circles = livesContainer.querySelectorAll(".life");
  if (circles.length > 0) {
    const lastLife = circles[circles.length - 1];
    lastLife.classList.add("shrink");
    lastLife.addEventListener("animationend", () => {
      lastLife.remove();
      saveGameState();
    }, { once: true });
  }
}

function renderGrid() {
  grid.innerHTML = "";
  fusedTiles.forEach(tile => grid.appendChild(tile));
  words.forEach(word => {
    const div = document.createElement("div");
    div.classList.add("tile");
    div.textContent = word;
    grid.appendChild(div);
    adjustFont(div);
  });
}

function toggleSelect(tile) {
  if (tile.classList.contains("correct")) return;
  if (selected.includes(tile)) {
    tile.classList.remove("selected");
    selected = selected.filter(t => t !== tile);
  } else if (selected.length < 4) {
    tile.classList.add("selected");
    selected.push(tile);
  }
}

function deselectAll() {
  selected.forEach(t => t.classList.remove("selected"));
  selected = [];
}

function shuffleTiles() {
  words = words.sort(() => Math.random() - 0.5);
  renderGrid();
  deselectAll();
}

function adjustFont(tile) {
  let fontSize = 14;
  const minFont = 8;
  tile.style.fontSize = fontSize + "px";
  while ((tile.scrollWidth > tile.clientWidth || tile.scrollHeight > tile.clientHeight) && fontSize > minFont) {
    fontSize -= 1;
    tile.style.fontSize = fontSize + "px";
  }
}

function createCloneFromElement(el) {
  const rect = el.getBoundingClientRect();
  const clone = document.createElement("div");
  clone.className = "anim-clone";
  clone.style.left = rect.left + "px";
  clone.style.top = rect.top + "px";
  clone.style.width = rect.width + "px";
  clone.style.height = rect.height + "px";
  clone.style.fontSize = (parseFloat(window.getComputedStyle(el).fontSize) * scale) + "px";
  clone.style.background = window.getComputedStyle(el).backgroundColor;
  clone.style.color = window.getComputedStyle(el).color;
  clone.textContent = el.textContent;
  clone.dataset.original = el.textContent;
  clone.style.borderRadius = (8 * scale) + "px";
  clone.style.padding = (6 * scale) + "px";
  animOverlay.appendChild(clone);
  return { clone, rect };
}

// (You still have this; it’s no longer used after the refactor, safe to keep or remove)
function findTopRowTiles() {
  const tileEls = Array.from(grid.querySelectorAll('.tile'));
  return tileEls.slice(0, 4);
}

async function showOneAwayMessage() {
  const messageBox = document.createElement("div");
  messageBox.className = "one-away-message";
  messageBox.textContent = "One away...";
  pageWrapper.appendChild(messageBox);

  const gridRect = grid.getBoundingClientRect();
  messageBox.style.left = `${gridRect.left + (gridRect.width - messageBox.offsetWidth) / 2}px`;
  messageBox.style.top = `${gridRect.top - 80}px`;

  requestAnimationFrame(() => { messageBox.classList.add("show"); });

  await wait(DUR.oneAway);
  messageBox.classList.remove("show");
  await wait(300);
  messageBox.remove();
}

// === NEW HELPERS FROM STEP 5 ===
function currentTopRowTiles() {
  return Array.from(grid.querySelectorAll('.tile')).slice(0, 4);
}

function tileRects(tiles) {
  return tiles.map(t => t.getBoundingClientRect());
}

async function animateSwapIntoTopRow(selectedTiles) {
  const topRowTiles = currentTopRowTiles();
  const allTileEls = Array.from(grid.querySelectorAll('.tile'));

  const selectedRects = tileRects(selectedTiles);
  const topRects = tileRects(topRowTiles);

  const topNonSelected = topRowTiles.filter(t => !selectedTiles.includes(t));
  const selectedOnlyTiles = selectedTiles.filter(t => !topRowTiles.includes(t));
  const selectedOnlyRects = tileRects(selectedOnlyTiles);

  const clones = selectedTiles.map(t => { t.style.visibility = 'hidden'; return createCloneFromElement(t); });
  const topClones = topNonSelected.map(t => { t.style.visibility = 'hidden'; return createCloneFromElement(t); });

  clones.forEach((item, idx) => {
    const targetRect = topRects[idx] || selectedRects[idx] || item.rect;
    animateCloneToRect(item.clone, targetRect, DUR.move);
  });
  topClones.forEach((item, idx) => {
    const targetRect = selectedOnlyRects[idx] || item.rect;
    animateCloneToRect(item.clone, targetRect, DUR.move);
  });

  await wait(DUR.move + 10);

  clones.forEach(c => c.clone.remove());
  topClones.forEach(c => c.clone.remove());

  let newWords = new Array(words.length);
  for (let i = 0; i < 4; i++) newWords[i] = selectedTiles[i].textContent;

  const selectedOnlyIndices = selectedOnlyTiles.map(t => allTileEls.indexOf(t));
  for (let j = 0; j < topNonSelected.length; j++) {
    newWords[selectedOnlyIndices[j]] = topNonSelected[j].textContent;
  }
  for (let k = 0; k < words.length; k++) {
    if (newWords[k] === undefined) newWords[k] = words[k];
  }
  words = newWords;

  renderGrid();
  return currentTopRowTiles();
}

async function animateMergeBanner(category) {
  const topTiles = currentTopRowTiles();
  const rects = tileRects(topTiles);
  const mergedLeft = Math.min(...rects.map(r => r.left));
  const mergedTop = Math.min(...rects.map(r => r.top));
  const mergedRight = Math.max(...rects.map(r => r.left + r.width));
  const mergedBottom = Math.max(...rects.map(r => r.top + r.height));
  const mergedRect = { left: mergedLeft, top: mergedTop, width: mergedRight - mergedLeft, height: mergedBottom - mergedTop };

  const mergeClone = document.createElement('div');
  mergeClone.className = 'anim-clone merge-clone';
  Object.assign(mergeClone.style, {
    left: mergedRect.left + 'px',
    top: mergedRect.top + 'px',
    width: mergedRect.width + 'px',
    height: mergedRect.height + 'px',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    boxSizing: 'border-box',
    borderRadius: (8 * scale) + 'px',
    padding: (5 * scale) + 'px',
    opacity: '1',
    transform: 'scale(0.9)'
  });

  const mergeTitle = document.createElement('div');
  mergeTitle.className = 'merge-title';
  mergeTitle.style.fontSize = (14 * scale) + 'px';
  mergeTitle.textContent = category.name;

  const mergeSub = document.createElement('div');
  mergeSub.className = 'merge-sub';
  mergeSub.style.fontSize = (14 * scale) + 'px';
  mergeSub.textContent = category.words.join(", ");

  mergeClone.appendChild(mergeTitle);
  mergeClone.appendChild(mergeSub);

  const temp = document.createElement('div');
  temp.className = category.color;
  document.body.appendChild(temp);
  mergeClone.style.background = window.getComputedStyle(temp).backgroundColor;
  temp.remove();

  animOverlay.appendChild(mergeClone);

  await wait(10);
  mergeClone.style.transition = `transform ${DUR.grow}ms cubic-bezier(.2, .8, .2, 1)`;
  mergeClone.style.transform = 'scale(1.1)';
  await wait(DUR.grow);

  mergeClone.style.transition = `transform ${DUR.settle}ms ease-in-out`;
  mergeClone.style.transform = 'scale(1)';
  await wait(DUR.settle + 10);

  mergeClone.remove();
}

function fuseSolvedCategory(foundCategory) {
  const firstRemainingTile = Array.from(grid.querySelectorAll('.tile'))[4] || null;

  const longTile = document.createElement("div");
  longTile.className = "long-tile " + foundCategory.color;
  longTile.innerHTML = `<div class="title">${foundCategory.name}</div>
                        <div class="subtitle">${foundCategory.words.join(", ")}</div>`;

  longTile.style.opacity = '1';
  longTile.style.transform = 'translateY(0)';

  fusedTiles.push(longTile);

  currentTopRowTiles().forEach(t => t.remove());
  grid.insertBefore(longTile, firstRemainingTile);

  adjustFont(longTile);

  words = words.filter(w => !foundCategory.words.includes(w));

  solvedGroups++;
  saveGameState();
}

// === GAME FLOW ===
async function revealGroup(category) {
  const tiles = Array.from(grid.querySelectorAll('.tile'))
    .filter(t => category.words.includes(t.textContent));

  selected = tiles;
  selected.forEach(t => t.classList.add("selected"));
  selected.forEach(t => t.classList.remove("selected"));

  await animateSwapIntoTopRow(tiles);
  await animateMergeBanner(category);
  fuseSolvedCategory(category);

  deselectAll();
}

async function revealAllGroups() {
  document.querySelectorAll('.btn').forEach(btn => btn.disabled = true);
  const unsolved = CATEGORIES.filter(cat => !fusedTiles.some(tile => tile.querySelector('.title').textContent === cat.name));
  for (const category of unsolved) {
    await revealGroup(category);
    await wait(500);
  }
}

async function submitSelection() {
  if (selected.length !== 4) return;

  const wordsChosen = selected.map(t => t.textContent);
  const foundCategory = CATEGORIES.find(cat =>
    cat.words.every(w => wordsChosen.includes(w))
  );

  if (!foundCategory) {
    const isOneAway = CATEGORIES.some(cat => {
      const matches = wordsChosen.filter(w => cat.words.includes(w)).length;
      return matches === 3;
    });
    mistakes--;
    loseLife();
    selected.forEach(tile => {
      tile.classList.add("shake");
      tile.addEventListener("animationend", () => tile.classList.remove("shake"), { once: true });
    });
    if (mistakes === 0) {
      deselectAll();
      await wait(1000);
      document.getElementById("submitBtn").disabled = true;
      await revealAllGroups();
    }
    saveGameState();
    deselectAll();

    if (isOneAway) {
      await showOneAwayMessage();
    }
    return;
  }

  await animateSwapIntoTopRow([...selected]);
  await animateMergeBanner(foundCategory);
  fuseSolvedCategory(foundCategory);

  if (solvedGroups === 4) {
    document.getElementById("submitBtn").disabled = true;
  }
  deselectAll();
}

function animateCloneToRect(clone, targetRect, duration) {
  clone.style.transition = `left ${duration}ms cubic-bezier(.2,.8,.2,1), top ${duration}ms cubic-bezier(.2,.8,.2,1), width ${duration}ms cubic-bezier(.2,.8,.2,1), height ${duration}ms cubic-bezier(.2,.8,.2,1), transform ${duration}ms cubic-bezier(.2,.8,.2,1)`;
  requestAnimationFrame(() => {
    clone.style.left = targetRect.left + 'px';
    clone.style.top = targetRect.top + 'px';
    clone.style.width = targetRect.width + 'px';
    clone.style.height = targetRect.height + 'px';
  });
}

function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

// === INIT ===
if (loadGameState()) {
  console.log("Loaded saved game state.");
} else {
  console.log("No saved state found, starting fresh.");
}
renderGrid();

if (fusedTiles.length > 0) {
  [...fusedTiles].reverse().forEach(tile => {
    adjustFont(tile);
    grid.prepend(tile);
  });
}
renderLives();

// === EVENT LISTENERS ===
document.getElementById('newGameBtn').addEventListener('click', newGame);
document.getElementById('shuffleBtn').addEventListener('click', shuffleTiles);
document.getElementById('deselectBtn').addEventListener('click', deselectAll);
document.getElementById('submitBtn').addEventListener('click', submitSelection);

// Press/hold feedback (works for mouse & touch via Pointer Events)
let activePress = null;
let skipNextClick = false;

function clearAllPressed() {
  grid.querySelectorAll('.tile.pressed--select, .tile.pressed--unselect')
    .forEach(t => t.classList.remove('pressed--select', 'pressed--unselect'));
}

function pointInRect(el, x, y) {
  const r = el.getBoundingClientRect();
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

grid.addEventListener('pointerdown', (e) => {
  const tile = e.target.closest('.tile');
  if (!tile || tile.classList.contains('correct')) return;

  const willSelect = !tile.classList.contains('selected');
  tile.classList.add(willSelect ? 'pressed--select' : 'pressed--unselect');

  activePress = { tile, pointerId: e.pointerId };
  try { tile.setPointerCapture(e.pointerId); } catch {}
});

grid.addEventListener('pointerup', (e) => {
  if (!activePress) return;
  const { tile } = activePress;

  // If finger/mouse ends inside the same tile, commit the toggle NOW
  if (!tile.classList.contains('correct') && pointInRect(tile, e.clientX, e.clientY)) {
    toggleSelect(tile);          // commits while preview color is still applied
    skipNextClick = true;        // ignore the synthetic click that follows on iOS
  }

  clearAllPressed();
  activePress = null;
});

grid.addEventListener('pointercancel', () => {
  clearAllPressed();
  activePress = null;
});

window.addEventListener('blur', () => {
  clearAllPressed();
  activePress = null;
});

// Keep for keyboard/misc environments, but ignore if we already handled pointerup
grid.addEventListener('click', (e) => {
  if (skipNextClick) { skipNextClick = false; return; }

  const tile = e.target.closest('.tile');
  if (!tile || tile.classList.contains('correct')) return;

  toggleSelect(tile);
});


// ===== Button press/hold feedback (mobile + desktop) =====
let activeBtn = null;

function isInside(el, x, y) {
  const r = el.getBoundingClientRect();
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

document.addEventListener('pointerdown', (e) => {
  const btn = e.target.closest('.btn');
  if (!btn || btn.disabled) return;

  activeBtn = btn;
  btn.classList.add('pressed');
  try { btn.setPointerCapture(e.pointerId); } catch {}
});

document.addEventListener('pointermove', (e) => {
  if (!activeBtn) return;
  // Toggle pressed visual only while the pointer stays over the button
  if (isInside(activeBtn, e.clientX, e.clientY)) {
    activeBtn.classList.add('pressed');
  } else {
    activeBtn.classList.remove('pressed');
  }
});

function clearBtnPress() {
  if (activeBtn) activeBtn.classList.remove('pressed');
  activeBtn = null;
}

document.addEventListener('pointerup', clearBtnPress);
document.addEventListener('pointercancel', clearBtnPress);
window.addEventListener('blur', clearBtnPress);

// Optional: block context menu on long-press/right-click for buttons (like tiles)
document.addEventListener('contextmenu', (e) => {
  if (e.target.closest('.btn, .tile')) e.preventDefault();
});

// Disable double-tap zoom on iOS Safari, but allow pinch-zoom
let lastTouchEnd = 0;

document.addEventListener(
  'touchend',
  function (event) {
    // Skip if multi-touch (e.g., pinch)
    if (event.touches.length > 0) return;

    const now = Date.now();
    if (now - lastTouchEnd <= 300) {
      event.preventDefault();
    }
    lastTouchEnd = now;
  },
  { passive: false }
);
