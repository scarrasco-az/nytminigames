const gridLetters = [
  "TMUTIS".split(''),
  "UOANSP".split(''),
  "NAINGO".split(''),
  "ATECAG".split(''),
  "DVTURE".split(''),
  "AENOOB".split(''),
  "LOSKYA".split(''),
  "CHOLGO".split('')
];
const themeWords = ['MOUNTAIN','TUNATECA', 'YOGA', 'GOSSIP', 'ALCOHOL', 'BOOKS'];
const spangram = 'ADVENTURE';
const allSolutions = [...themeWords, spangram];
const wordToPath = {
  'MOUNTAIN':[[1,4],[1,3],[2,2],[3,2]],
  'TUNATECA': [[3,0],[4,0],[4,1],[5,1],[5,0],[6,0],[7,0]],
  'YOGA': [[1,2],[1,1],[2,1],[3,1]],
  'GOSSIP': [[2,3],[3,3],[4,2],[4,3],[4,4],[3,4],[2,4],[3,5],[4,5]],
  'ALCOHOL': [[5,4],[6,4],[5,3],[6,3],[5,2],[6,1],[6,2],[7,1]],
  'BOOKS': [[7,2],[7,3],[7,4],[7,5],[6,5],[5,5]],
  'ADVENTURE': [[2,0],[1,0],[0,0],[0,1],[0,2],[0,3],[0,4],[0,5],[1,5],[2,5]]
};

let found = new Set();
let currentPath = [];
let permanentEdges = [];
let mistakeCount = 0;
let spentHints = 0;
let words = new Set();
let mouseDown = false;
let hasMoved = false;
let startR, startC;
let currentHintWord = null;
let usedWords = new Set();

/* rAF batching: draw only when the path changes */
let rafId = 0;
let needsDraw = false;

const grid = document.querySelector('.grid');
const edgesSvg = document.querySelector('svg.edges');
const currentWordDiv = document.querySelector('.current-word');
const foundCountDiv = document.querySelector('.found-count');
const hintButton = document.querySelector('.hint-button');
hintButton.addEventListener('click', handleHint);

/* ---------- Tunable thresholds (feel free to tweak) ---------- */
const START_DEADZONE_RATIO = 0.35;   // must leave ~22% of a cell radius before considering a move
const COMMIT_RATIO_ORTH     = 0.50;  // must move ~46% toward orth neighbor center to commit
const COMMIT_RATIO_DIAG     = 0.55;  // must move ~48% toward diagonal neighbor center to commit
const LATERAL_TOL_RATIO     = 0.35;  // corridor half-width (~42% of a cell) around the move direction

/* ---------- Metrics & mapping helpers ---------- */
function getGridMetrics() {
  const sampleCell = grid.querySelector('.letter');
  if (!sampleCell) return { cellSize: 54, padding: 12 };
  const cs = getComputedStyle(sampleCell);
  const w  = sampleCell.offsetWidth;
  const ml = parseFloat(cs.marginLeft)  || 0;
  const mr = parseFloat(cs.marginRight) || 0;
  const gridStyles = getComputedStyle(grid);
  const padding = parseFloat(gridStyles.paddingLeft) || 0;
  return { cellSize: w + ml + mr, padding };
}

function getCellFromEvent(e) {
  const clientX = e.clientX ?? (e.touches && e.touches[0]?.clientX);
  const clientY = e.clientY ?? (e.touches && e.touches[0]?.clientY);
  if (clientX === undefined || clientY === undefined) return null;

  const wrapper = document.querySelector('.game-wrapper');
  const scale = wrapper.getBoundingClientRect().width / wrapper.offsetWidth;
  const rect = grid.getBoundingClientRect();
  const x = (clientX - rect.left) / scale;
  const y = (clientY - rect.top) / scale;

  const { cellSize, padding } = getGridMetrics();
  const col = Math.floor((x - padding) / cellSize);
  const row = Math.floor((y - padding) / cellSize);

  if (row >= 0 && row < gridLetters.length && col >= 0 && col < gridLetters[0].length) {
    return [row, col];
  }
  return null;
}

function getCellCenter(r, c) {
  const wrapper = document.querySelector('.game-wrapper');
  const scale = wrapper.getBoundingClientRect().width / wrapper.offsetWidth;
  const rect = grid.getBoundingClientRect();
  const { cellSize, padding } = getGridMetrics();
  const cx = padding + c * cellSize + cellSize / 2;
  const cy = padding + r * cellSize + cellSize / 2;
  return { x: rect.left + cx * scale, y: rect.top + cy * scale };
}

/* ---------- Commit-style neighbor picking (diagonal friendly, no flicker) ---------- */
function neighborFromPointer(r0, c0, clientX, clientY) {
  const { cellSize } = getGridMetrics();

  // vector from current cell center to pointer
  const cur = getCellCenter(r0, c0);
  const dx = clientX - cur.x;
  const dy = clientY - cur.y;
  const vLen = Math.hypot(dx, dy);

  // require leaving a small dead-zone around the center before any move
  if (vLen < cellSize * START_DEADZONE_RATIO) return null;

  // test 8 neighbors, commit to the best that passes thresholds
  let best = null;
  let bestScore = -Infinity;

  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;

      // direction unit vector toward neighbor (screen coords: +y is down)
      const len = Math.hypot(dc, dr); // 1 for orth, sqrt(2) for diagonal
      const ux = dc / len;
      const uy = dr / len;

      // projection along direction and lateral deviation
      const s = dx * ux + dy * uy;                  // how far along the move direction
      const cross = Math.abs(dx * uy - dy * ux);    // perpendicular distance to direction line

      // distance between centers to that neighbor
      const distToNeighbor = cellSize * len;

      // required progress along the direction (slightly higher for diagonal)
      const commitNeeded = (len === 1 ? COMMIT_RATIO_ORTH : COMMIT_RATIO_DIAG) * distToNeighbor;

      // allowed lateral corridor (proportional to one cell)
      const lateralTol = LATERAL_TOL_RATIO * cellSize;

      if (s >= commitNeeded && cross <= lateralTol) {
        // prefer moves that are farther along and straighter
        const score = s - 0.5 * cross;
        if (score > bestScore) {
          bestScore = score;
          best = [r0 + dr, c0 + dc];
        }
      }
    }
  }

  // ensure within bounds
  if (!best) return null;
  const [nr, nc] = best;
  if (nr < 0 || nr >= gridLetters.length || nc < 0 || nc >= gridLetters[0].length) return null;
  return best;
}

/* ---------- rAF batching ---------- */
function requestDraw() {
  needsDraw = true;
  if (rafId) return;
  rafId = requestAnimationFrame(() => {
    rafId = 0;
    if (needsDraw) {
      needsDraw = false;
      drawEdges();
    }
  });
}

/* ---------- Memory ---------- */
function saveState() {
  const state = {
    found: Array.from(found),
    usedWords: Array.from(usedWords),
    mistakeCount,
    spentHints,
    currentHintWord
  };
  localStorage.setItem('strandsGameState', JSON.stringify(state));
}

function loadState() {
  const stateJSON = localStorage.getItem('strandsGameState');
  if (!stateJSON) return;
  try {
    const state = JSON.parse(stateJSON);
    found = new Set(state.found || []);
    usedWords = new Set(state.usedWords || []);
    mistakeCount = state.mistakeCount || 0;
    spentHints = state.spentHints || 0;

    // Restore UI for found words
    found.forEach(word => {
      const path = wordToPath[word];
      if (path) {
        const className = word === spangram ? 'found-yellow' : 'found-blue';
        path.forEach(([r, c]) => getCell(r, c).classList.add(className));
        for (let i = 1; i < path.length; i++) {
          const [r1, c1] = path[i-1];
          const [r2, c2] = path[i];
          const color = className === 'found-blue' ? "#B8DEEC" : "#F1D046";
          permanentEdges.push([r1, c1, r2, c2, color]);
        }
      }
    });

    if (state.currentHintWord) {
      currentHintWord = state.currentHintWord;
      const path = wordToPath[currentHintWord];
      if (path) path.forEach(([r, c]) => getCell(r, c).classList.add('hint-highlight'));
    }

    foundCountDiv.textContent = `${found.size} of ${themeWords.length + 1} theme words found.`;
    updateHintButton();
    requestDraw();
  } catch(e) {
    console.error("Failed to load game state", e);
  }
}

/* ---------- Dictionary ---------- */
async function loadDictionary() {
  try {
    const res = await fetch('https://raw.githubusercontent.com/dwyl/english-words/master/words_alpha.txt');
    const text = await res.text();
    words = new Set(text.split('\n').map(w => w.trim().toLowerCase()).filter(w => w.length >= 4));
  } catch (e) {
    console.error('Failed to load dictionary. Using fallback.');
    words = new Set(['amen', 'real', 'word', 'test', 'laser', 'angel']);
  }
  allSolutions.forEach(w => words.add(w.toLowerCase()));
}
loadDictionary();

/* ---------- UI helpers ---------- */
function updateHintButton() {
  const earned = Math.floor(mistakeCount / 3);
  const hintsAvailable = earned - spentHints;
  const currentProgress = mistakeCount % 3;
  let filledFraction = currentProgress / 3;
  if (hintsAvailable > 0) {
    filledFraction = 1;
    hintButton.classList.add('inverted');
  } else {
    hintButton.classList.remove('inverted');
  }
  hintButton.style.background = `linear-gradient(to right, lightgray ${filledFraction * 100}%, white ${filledFraction * 100}%)`;
}

function clearHints() {
  document.querySelectorAll('.hint-highlight').forEach(el => el.classList.remove('hint-highlight'));
}

function handleHint() {
  const hintsAvailable = Math.floor(mistakeCount / 3) - spentHints;
  if (hintsAvailable <= 0) return;
  spentHints += 1;
  updateHintButton();
  saveState();
  if (currentHintWord) return;
  const unsolved = themeWords.filter(w => !found.has(w));
  if (unsolved.length === 0) return;
  currentHintWord = unsolved[Math.floor(Math.random() * unsolved.length)];
  saveState();
  const path = wordToPath[currentHintWord];
  path.forEach(([r, c]) => getCell(r, c).classList.add('hint-highlight'));
}

/* ---------- Core game ---------- */
function isAdjacent(p1, p2) {
  const dr = Math.abs(p1[0] - p2[0]);
  const dc = Math.abs(p1[1] - p2[1]);
  return dr <= 1 && dc <= 1 && !(dr === 0 && dc === 0);
}

function showMessage(message, duration = 3000) {
  currentWordDiv.classList.add('error');
  currentWordDiv.textContent = message;
  setTimeout(() => {
    currentWordDiv.classList.remove('error');
    if (currentPath.length > 0) {
      currentWordDiv.textContent = currentPath.map(([rr, cc]) => gridLetters[rr][cc]).join('').toUpperCase();
    } else {
      currentWordDiv.textContent = '';
      clearPath();
    }
  }, duration);
}

function clearPath() {
  document.querySelectorAll('.selected').forEach(el => el.classList.remove('selected'));
  currentPath = [];
  currentWordDiv.textContent = '';
  requestDraw();
}

function submit() {
  if (currentPath.length < 4) {
    clearPath();
    return;
  }
  const word = currentPath.map(([r, c]) => gridLetters[r][c]).join('').toUpperCase();
  const lower = word.toLowerCase();
  if (usedWords.has(lower)) {
    showMessage("Word already found...");
    clearPath();
    return;
  }
  if (!words.has(lower)) {
    showMessage("Not a word...");
    clearPath();
    return;
  }
  usedWords.add(lower);

  if (allSolutions.includes(word)) {
    const isSpangram = word === spangram;
    const className = isSpangram ? 'found-yellow' : 'found-blue';
    currentPath.forEach(([r, c]) => getCell(r, c).classList.add(className));
    found.add(word);
    foundCountDiv.textContent = `${found.size} of ${themeWords.length + 1} theme words found.`;
    if (word === currentHintWord) {
      clearHints();
      currentHintWord = null;
    }
    for (let i = 1; i < currentPath.length; i++) {
      const [r1, c1] = currentPath[i - 1];
      const [r2, c2] = currentPath[i];
      let color = className === 'found-blue' ? "#B8DEEC" : "#F1D046";
      permanentEdges.push([r1, c1, r2, c2, color]);
    }
    currentWordDiv.textContent = isSpangram ? 'SPANGRAM!' : word;
    currentWordDiv.classList.remove('error', 'success-theme', 'success-spangram');
    currentWordDiv.classList.add(isSpangram ? 'success-spangram' : 'success-theme');
    requestDraw();
    setTimeout(() => {
      currentWordDiv.textContent = '';
      currentWordDiv.classList.remove('success-theme', 'success-spangram');
      clearPath();
    }, 3000);
  } else {
    mistakeCount += 1;
    updateHintButton();
    showMessage("Not a theme word...");
    clearPath();
  }
  saveState();
}

/* ---------- Input ---------- */
function handleMouseDown(r, c) {
  mouseDown = true;
  hasMoved = false;
  startR = r;
  startC = c;
  if (currentHintWord && !found.has(currentHintWord)) return;
  clearHints();
  currentHintWord = null;
}

/* ---------- Drawing ---------- */
function getCell(r, c) {
  const rows = grid.querySelectorAll('.row');
  return rows[r].children[c];
}

function drawEdges() {
  edgesSvg.innerHTML = "";
  for (const [r1, c1, r2, c2, color] of permanentEdges) {
    drawLine(r1, c1, r2, c2, color);
  }
  for (let i = 1; i < currentPath.length; i++) {
    const [r1, c1] = currentPath[i - 1];
    const [r2, c2] = currentPath[i];
    const cell1 = getCell(r1, c1);
    let color = "#DBD8C7";
    if (cell1.classList.contains('found-yellow')) color = "#F1D046";
    else if (cell1.classList.contains('found-blue')) color = "#B8DEEC";
    drawLine(r1, c1, r2, c2, color);
  }
}

function drawLine(r1, c1, r2, c2, color) {
  const wrapper = document.querySelector('.game-wrapper');
  const scale = wrapper.getBoundingClientRect().width / wrapper.offsetWidth;
  const cell1 = getCell(r1, c1);
  const cell2 = getCell(r2, c2);
  const rect1 = cell1.getBoundingClientRect();
  const rect2 = cell2.getBoundingClientRect();
  const gridRect = grid.getBoundingClientRect();
  const x1 = (rect1.left - gridRect.left + rect1.width / 2) / scale;
  const y1 = (rect1.top - gridRect.top + rect1.height / 2) / scale;
  const x2 = (rect2.left - gridRect.left + rect2.width / 2) / scale;
  const y2 = (rect2.top - gridRect.top + rect2.height / 2) / scale;
  const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
  line.setAttribute("x1", x1);
  line.setAttribute("y1", y1);
  line.setAttribute("x2", x2);
  line.setAttribute("y2", y2);
  line.setAttribute("stroke", color);
  line.setAttribute("stroke-width", "12");
  line.setAttribute("stroke-linecap", "round");
  edgesSvg.appendChild(line);
}

/* ---------- Build grid (no per-cell listeners) ---------- */
gridLetters.forEach((rowLetters, r) => {
  const row = document.createElement('div');
  row.classList.add('row');
  rowLetters.forEach((letter) => {
    const letDiv = document.createElement('div');
    letDiv.classList.add('letter');
    letDiv.textContent = letter;
    row.appendChild(letDiv);
  });
  grid.appendChild(row);
});

/* ---------- Pointer Events: draw only on commit ---------- */
grid.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  const pos = getCellFromEvent(e);
  if (!pos) return;
  const [r, c] = pos;
  handleMouseDown(r, c);
  try { grid.setPointerCapture(e.pointerId); } catch {}
});

grid.addEventListener('pointermove', (e) => {
  if (!mouseDown) return;

  if (!hasMoved) {
    hasMoved = true;
    currentPath = [[startR, startC]];
    getCell(startR, startC).classList.add('selected');
    currentWordDiv.textContent = gridLetters[startR][startC];
    requestDraw();
  }

  // Commit to the next neighbor only when thresholds are met
  const last = currentPath[currentPath.length - 1];
  const cand = neighborFromPointer(last[0], last[1], e.clientX, e.clientY);
  if (!cand) return;

  const [r, c] = cand;
  const indexInPath = currentPath.findIndex(p => p[0] === r && p[1] === c);
  let changed = false;

  if (indexInPath === -1) {
    if (isAdjacent(last, cand)) {
      currentPath.push(cand);
      getCell(r, c).classList.add('selected');
      changed = true;
    }
  } else if (indexInPath < currentPath.length - 1) {
    for (let i = currentPath.length - 1; i > indexInPath; i--) {
      const [rr, cc] = currentPath[i];
      getCell(rr, cc).classList.remove('selected');
    }
    currentPath = currentPath.slice(0, indexInPath + 1);
    changed = true;
  }

  if (changed) {
    currentWordDiv.textContent = currentPath.map(([rr, cc]) => gridLetters[rr][cc]).join('').toUpperCase();
    requestDraw();
  }
});

grid.addEventListener('pointerup', (e) => {
  if (!mouseDown) return;
  e.preventDefault();
  mouseDown = false;

  const pos = getCellFromEvent(e) || [startR, startC];

  if (hasMoved) {
    hasMoved = false;
    submit();
  } else {
    const [r, c] = pos;
    if (currentPath.length === 0) {
      currentPath = [pos];
      getCell(r, c).classList.add('selected');
    } else {
      const last = currentPath[currentPath.length - 1];
      if (last[0] === r && last[1] === c) {
        submit();
      } else if (isAdjacent(last, pos) && !currentPath.some(p => p[0] === r && p[1] === c)) {
        currentPath.push(pos);
        getCell(r, c).classList.add('selected');
      } else {
        clearPath();
        currentPath = [pos];
        getCell(r, c).classList.add('selected');
      }
    }
    currentWordDiv.textContent = currentPath.map(([rr, cc]) => gridLetters[rr][cc]).join('').toUpperCase();
    requestDraw();
  }

  try { grid.releasePointerCapture(e.pointerId); } catch {}
});

grid.addEventListener('pointercancel', (e) => {
  mouseDown = false;
  hasMoved = false;
  clearPath();
  try { grid.releasePointerCapture(e.pointerId); } catch {}
});

/* ---------- State restore & misc ---------- */
loadState();

window.addEventListener('resize', () => {
  edgesSvg.setAttribute("width", grid.offsetWidth);
  edgesSvg.setAttribute("height", grid.offsetHeight);
  requestDraw();
});

updateHintButton();
const newGameBtn = document.getElementById('newGameBtn');
newGameBtn.addEventListener('click', () => {
  localStorage.removeItem('strandsGameState');
  location.reload();
});

// Disable double-tap zoom on iOS Safari, but allow pinch-zoom
let lastTouchEnd = 0;

document.addEventListener(
  'touchend',
  function (event) {
    // Don't block if it's part of a pinch or multitouch
    if (event.touches.length > 0) return;

    const now = Date.now();
    if (now - lastTouchEnd <= 300) {
      // Two taps within 300ms = double-tap
      event.preventDefault();
    }
    lastTouchEnd = now;
  },
  { passive: false }
);