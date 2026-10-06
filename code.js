// Tetris — by Ali Omidi
// Retro falling-blocks game: canvas graphics, 8-bit sound effects and the
// classic "Korobeiniki" theme, all generated in the browser (no files needed).

const canvas = document.getElementById('game-canvas');
const c = canvas.getContext('2d');

const COLS = 10;
const ROWS = 20;
const HIDDEN = 2;            // extra rows above the board where pieces spawn
const FONT = '"Press Start 2P", "Courier New", monospace';

// Milliseconds per row drop, by level (gets faster as you level up)
// Starts slow, then gets much faster with each level
const GRAVITY = [1000, 800, 640, 500, 390, 300, 230, 175, 130, 100, 78, 60, 48, 38, 30, 24, 20];
const LINES_PER_LEVEL = 5;
const SCORE_PER_LEVEL = 2500; // a high score also raises the level
const LINE_POINTS = [0, 100, 300, 500, 800];
const LOCK_DELAY = 500;      // time a piece can slide on the floor before it locks (shrinks with level)
const MAX_LOCK_RESETS = 15;
const DAS = 170;             // delay before a held arrow key starts repeating
const ARR = 50;              // repeat speed while held

/* ---------- pieces ---------- */

const PIECES = {
    I: { color: '#3fe0ff', shape: [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]] },
    O: { color: '#ffd23f', shape: [[1, 1], [1, 1]] },
    T: { color: '#c77dff', shape: [[0, 1, 0], [1, 1, 1], [0, 0, 0]] },
    S: { color: '#5ef08c', shape: [[0, 1, 1], [1, 1, 0], [0, 0, 0]] },
    Z: { color: '#ff4b5c', shape: [[1, 1, 0], [0, 1, 1], [0, 0, 0]] },
    J: { color: '#4b7bff', shape: [[1, 0, 0], [1, 1, 1], [0, 0, 0]] },
    L: { color: '#ff9f3f', shape: [[0, 0, 1], [1, 1, 1], [0, 0, 0]] },
};
const TYPES = Object.keys(PIECES);

// Rotate a square matrix clockwise (dir = 1) or counter-clockwise (dir = -1)
function rotateMatrix(m, dir) {
    const n = m.length;
    const out = m.map((row) => row.slice());
    for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++)
            out[y][x] = dir > 0 ? m[n - 1 - x][y] : m[x][n - 1 - y];
    return out;
}

// "7-bag": every 7 pieces contain each shape once, so no long droughts
let bag = [];
function nextFromBag() {
    if (!bag.length) {
        bag = TYPES.slice();
        for (let i = bag.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [bag[i], bag[j]] = [bag[j], bag[i]];
        }
    }
    return bag.pop();
}

/* ---------- sound ---------- */

let audio = null;
let muted = false;
let musicOn = true;
try {
    muted = localStorage.getItem('tetrisMuted') === '1';
    musicOn = localStorage.getItem('tetrisMusic') !== '0';
} catch (e) {}

function audioCtx() {
    if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
    return audio;
}

// One retro tone. Square waves give the classic 8-bit sound.
function tone(freq, start, dur, { type = 'square', vol = 0.08, slideTo = null } = {}) {
    const ctx = audioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, start + dur);
    gain.gain.setValueAtTime(vol, start);
    gain.gain.exponentialRampToValueAtTime(0.0008, start + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + dur + 0.02);
}

function sfx(name) {
    if (muted || !audio) return;
    const t = audio.currentTime;
    switch (name) {
        case 'move': tone(180, t, 0.03, { vol: 0.04 }); break;
        case 'rotate': tone(420, t, 0.05, { vol: 0.05, slideTo: 620 }); break;
        case 'land': tone(110, t, 0.08, { type: 'triangle', vol: 0.2, slideTo: 60 }); break;
        case 'hard': tone(300, t, 0.12, { vol: 0.07, slideTo: 70 }); break;
        case 'hold': tone(520, t, 0.05, { vol: 0.05 }); tone(390, t + 0.05, 0.05, { vol: 0.05 }); break;
        case 'line': [523, 659, 784].forEach((f, i) => tone(f, t + i * 0.06, 0.08, { vol: 0.07 })); break;
        case 'tetris': [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => tone(f, t + i * 0.06, 0.09, { vol: 0.07 })); break;
        case 'level': [392, 523, 659, 784, 1047].forEach((f, i) => tone(f, t + i * 0.08, 0.1, { type: 'triangle', vol: 0.12 })); break;
        case 'over': [392, 330, 262, 196, 131].forEach((f, i) => tone(f, t + i * 0.18, 0.2, { type: 'triangle', vol: 0.15 })); break;
        case 'start': [262, 330, 392, 523].forEach((f, i) => tone(f, t + i * 0.08, 0.1, { vol: 0.06 })); break;
    }
}

// Korobeiniki (Russian folk song, public domain), the classic Tetris theme.
// [note, beats] — 0 is a rest.
const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12); // MIDI note -> Hz
const E5 = 76, F5 = 77, G5 = 79, A5 = 81, B4 = 71, C5 = 72, D5 = 74, A4 = 69;
const MELODY = [
    [E5, 1], [B4, .5], [C5, .5], [D5, 1], [C5, .5], [B4, .5],
    [A4, 1], [A4, .5], [C5, .5], [E5, 1], [D5, .5], [C5, .5],
    [B4, 1.5], [C5, .5], [D5, 1], [E5, 1],
    [C5, 1], [A4, 1], [A4, 1], [0, 1],
    [0, .5], [D5, 1], [F5, .5], [A5, 1], [G5, .5], [F5, .5],
    [E5, 1.5], [C5, .5], [E5, 1], [D5, .5], [C5, .5],
    [B4, 1], [B4, .5], [C5, .5], [D5, 1], [E5, 1],
    [C5, 1], [A4, 1], [A4, 1], [0, 1],
];
// Bass root note for each 4-beat bar
const BASS = [40, 45, 40, 45, 38, 36, 40, 45]; // E2 A2 E2 A2 D2 C2 E2 A2

const music = { playing: false, timer: null, nextTime: 0, step: 0, beat: 0 };

function beatLength() {
    return Math.max(0.24, 0.42 - (level - 1) * 0.015); // speeds up with the level
}

function scheduleMusic() {
    const ctx = audio;
    while (music.nextTime < ctx.currentTime + 0.2) {
        const [note, beats] = MELODY[music.step];
        const len = beats * beatLength();
        if (note) tone(NOTE(note), music.nextTime, len * 0.9, { vol: 0.035 });

        // bass: alternating root / octave on every half beat
        const halves = Math.round(beats * 2);
        for (let h = 0; h < halves; h++) {
            const bar = Math.floor((music.beat + h * 0.5) / 4) % BASS.length;
            const root = BASS[bar] + ((music.beat * 2 + h) % 2 ? 12 : 0);
            tone(NOTE(root), music.nextTime + h * beatLength() / 2, beatLength() * 0.4, { type: 'triangle', vol: 0.09 });
        }

        music.nextTime += len;
        music.beat = (music.beat + beats) % 32;
        music.step = (music.step + 1) % MELODY.length;
    }
}

function startMusic() {
    if (muted || !musicOn || music.playing || !audio) return;
    music.playing = true;
    music.nextTime = audio.currentTime + 0.1;
    music.timer = setInterval(scheduleMusic, 50);
}

function stopMusic() {
    music.playing = false;
    clearInterval(music.timer);
}

/* ---------- game state ---------- */

let grid;          // grid[row][col] = color string or null
let piece;         // { type, matrix, x, y }
let queue;         // upcoming piece types
let held;          // held piece type
let canHold;
let score, lines, level;
let best = 0;
try { best = Number(localStorage.getItem('tetrisBest')) || 0; } catch (e) {}
let state = 'title'; // 'title' | 'playing' | 'paused' | 'clearing' | 'over'
let dropTimer = 0;
let lockTimer = 0;
let lockResets = 0;
let clearing = null;  // { rows, time } while the line-clear flash plays
let flash = null;     // { text, time } big message like "TETRIS!"

function newGame() {
    grid = Array.from({ length: ROWS + HIDDEN }, () => Array(COLS).fill(null));
    bag = [];
    queue = [nextFromBag(), nextFromBag(), nextFromBag()];
    held = null;
    canHold = true;
    score = 0;
    lines = 0;
    level = 1;
    flash = null;
    state = 'playing';
    spawn();
    sfx('start');
    stopMusic();
    startMusic();
}

function spawn(type) {
    if (!type) {
        type = queue.shift();
        queue.push(nextFromBag());
    }
    const matrix = PIECES[type].shape.map((r) => r.slice());
    piece = { type, matrix, x: Math.floor((COLS - matrix.length) / 2), y: type === 'I' ? 0 : 1 };
    dropTimer = 0;
    lockTimer = 0;
    lockResets = 0;
    if (collides(piece.matrix, piece.x, piece.y)) gameOver();
}

function collides(matrix, px, py) {
    for (let y = 0; y < matrix.length; y++)
        for (let x = 0; x < matrix.length; x++) {
            if (!matrix[y][x]) continue;
            const gx = px + x;
            const gy = py + y;
            if (gx < 0 || gx >= COLS || gy >= ROWS + HIDDEN) return true;
            if (gy >= 0 && grid[gy][gx]) return true;
        }
    return false;
}

const onFloor = () => collides(piece.matrix, piece.x, piece.y + 1);

// Moving or rotating on the floor gives a little extra time before locking
function touched() {
    if (onFloor() && lockResets < MAX_LOCK_RESETS) {
        lockTimer = 0;
        lockResets++;
    }
}

function move(dx) {
    if (collides(piece.matrix, piece.x + dx, piece.y)) return false;
    piece.x += dx;
    touched();
    sfx('move');
    return true;
}

function rotate(dir) {
    if (piece.type === 'O') return;
    const rotated = rotateMatrix(piece.matrix, dir);
    // "wall kicks": if the rotated piece doesn't fit, try nudging it a bit
    const kicks = piece.type === 'I'
        ? [[0, 0], [-1, 0], [1, 0], [-2, 0], [2, 0], [0, -1], [0, -2]]
        : [[0, 0], [-1, 0], [1, 0], [0, -1], [-1, -1], [1, -1], [0, 1]];
    for (const [kx, ky] of kicks) {
        if (!collides(rotated, piece.x + kx, piece.y + ky)) {
            piece.matrix = rotated;
            piece.x += kx;
            piece.y += ky;
            touched();
            sfx('rotate');
            return;
        }
    }
}

function softDrop() {
    if (collides(piece.matrix, piece.x, piece.y + 1)) return false;
    piece.y++;
    score += 1;
    dropTimer = 0;
    return true;
}

function hardDrop() {
    let dist = 0;
    while (!collides(piece.matrix, piece.x, piece.y + 1)) {
        piece.y++;
        dist++;
    }
    score += dist * 2;
    sfx('hard');
    lock();
}

function hold() {
    if (!canHold) return;
    const current = piece.type;
    canHold = false;
    if (held) spawn(held);
    else spawn();
    held = current;
    sfx('hold');
}

function ghostY() {
    let y = piece.y;
    while (!collides(piece.matrix, piece.x, y + 1)) y++;
    return y;
}

function lock() {
    const { matrix, x: px, y: py, type } = piece;
    let above = true;
    for (let y = 0; y < matrix.length; y++)
        for (let x = 0; x < matrix.length; x++) {
            if (!matrix[y][x]) continue;
            if (py + y >= HIDDEN) above = false;
            if (py + y >= 0) grid[py + y][px + x] = PIECES[type].color;
        }
    // a piece that locks entirely above the visible board ends the game
    if (above) return gameOver();

    const full = [];
    for (let y = 0; y < grid.length; y++) if (grid[y].every(Boolean)) full.push(y);

    canHold = true;
    if (full.length) {
        state = 'clearing';
        clearing = { rows: full, time: 0 };
        sfx(full.length === 4 ? 'tetris' : 'line');
        if (full.length === 4) flash = { text: 'TETRIS!', time: 0 };
    } else {
        sfx('land');
        spawn();
    }
}

function finishClear() {
    const count = clearing.rows.length;
    for (const row of clearing.rows) {
        grid.splice(row, 1);
        grid.unshift(Array(COLS).fill(null));
    }
    clearing = null;
    score += LINE_POINTS[count] * level;
    lines += count;
    const newLevel = Math.max(Math.floor(lines / LINES_PER_LEVEL), Math.floor(score / SCORE_PER_LEVEL)) + 1;
    if (newLevel > level) {
        level = newLevel;
        flash = { text: `LEVEL ${level}`, time: 0 };
        sfx('level');
    }
    state = 'playing';
    spawn();
}

function gameOver() {
    state = 'over';
    stopMusic();
    sfx('over');
    if (score > best) {
        best = score;
        try { localStorage.setItem('tetrisBest', String(best)); } catch (e) {}
    }
}

function togglePause() {
    if (state === 'playing') {
        state = 'paused';
        stopMusic();
    } else if (state === 'paused') {
        state = 'playing';
        startMusic();
    }
}

/* ---------- input ---------- */

const held_keys = {}; // arrow keys currently down, for auto-repeat

document.addEventListener('keydown', (e) => {
    audioCtx(); // browsers only allow sound after the player presses something
    const k = e.key;
    if (['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp', ' '].includes(k)) e.preventDefault();

    if (k === 'm' || k === 'M') {
        muted = !muted;
        if (muted) stopMusic(); else if (state === 'playing') startMusic();
        try { localStorage.setItem('tetrisMuted', muted ? '1' : '0'); } catch (err) {}
        return;
    }
    if (k === 'n' || k === 'N') {
        musicOn = !musicOn;
        if (musicOn && state === 'playing') startMusic(); else stopMusic();
        try { localStorage.setItem('tetrisMusic', musicOn ? '1' : '0'); } catch (err) {}
        return;
    }
    if (state === 'title' || state === 'over') {
        if (k === 'Enter' || k === ' ') newGame();
        return;
    }
    if (k === 'p' || k === 'P' || k === 'Escape') return togglePause();
    if (state !== 'playing' || e.repeat) return;

    switch (k) {
        case 'ArrowLeft': case 'a': case 'A':
            move(-1);
            held_keys.left = { since: performance.now(), last: 0 };
            delete held_keys.right;
            break;
        case 'ArrowRight': case 'd': case 'D':
            move(1);
            held_keys.right = { since: performance.now(), last: 0 };
            delete held_keys.left;
            break;
        case 'ArrowDown': case 's': case 'S':
            softDrop();
            held_keys.down = { since: performance.now(), last: 0 };
            break;
        case 'ArrowUp': case 'x': case 'X': case 'w': case 'W':
            rotate(1);
            break;
        case 'z': case 'Z': case 'q': case 'Q':
            rotate(-1);
            break;
        case ' ':
            hardDrop();
            break;
        case 'c': case 'C': case 'Shift':
            hold();
            break;
    }
});

document.addEventListener('keyup', (e) => {
    if (['ArrowLeft', 'a', 'A'].includes(e.key)) delete held_keys.left;
    if (['ArrowRight', 'd', 'D'].includes(e.key)) delete held_keys.right;
    if (['ArrowDown', 's', 'S'].includes(e.key)) delete held_keys.down;
});

// Auto-repeat for held keys (smoother than the keyboard's own repeat)
function handleHeldKeys(now) {
    for (const [name, k] of Object.entries(held_keys)) {
        const delay = name === 'down' ? 0 : DAS;
        if (now - k.since < delay) continue;
        if (now - k.last < ARR) continue;
        k.last = now;
        if (name === 'left') move(-1);
        if (name === 'right') move(1);
        if (name === 'down') softDrop();
    }
}

// Touch: tap = rotate, swipe left/right = move, swipe down = hard drop, swipe up = hold
let touchStart = null;
canvas.addEventListener('touchstart', (e) => {
    audioCtx();
    touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
}, { passive: true });
canvas.addEventListener('touchend', (e) => {
    if (!touchStart) return;
    const dx = e.changedTouches[0].clientX - touchStart.x;
    const dy = e.changedTouches[0].clientY - touchStart.y;
    touchStart = null;
    if (state === 'title' || state === 'over') return newGame();
    if (state === 'paused') return togglePause();
    if (state !== 'playing') return;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 20) return rotate(1);
    if (Math.abs(dx) > Math.abs(dy)) {
        const steps = Math.max(1, Math.round(Math.abs(dx) / cell));
        for (let i = 0; i < steps; i++) move(Math.sign(dx));
    } else if (dy > 0) hardDrop();
    else hold();
});

canvas.addEventListener('click', () => {
    audioCtx();
    if (state === 'title' || state === 'over') newGame();
});

// Pause when the window loses focus
window.addEventListener('blur', () => {
    if (state === 'playing') togglePause();
});

/* ---------- drawing ---------- */

let cell, boardX, boardY;

function layout() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    // board is 10 cells wide, side panels about 6 cells each
    cell = Math.max(10, Math.floor(Math.min((canvas.height - 40) / (ROWS + 1.5), (canvas.width - 40) / 24)));
    boardX = Math.floor((canvas.width - COLS * cell) / 2);
    boardY = Math.floor((canvas.height - ROWS * cell) / 2);
}
window.addEventListener('resize', layout);

function shade(hex, amount) {
    const n = parseInt(hex.slice(1), 16);
    const ch = (v) => Math.max(0, Math.min(255, v + amount));
    const r = ch(n >> 16), g = ch((n >> 8) & 255), b = ch(n & 255);
    return `rgb(${r},${g},${b})`;
}

// Bevelled retro block
function block(x, y, size, color, alpha = 1) {
    const b = Math.max(2, Math.floor(size / 7));
    c.globalAlpha = alpha;
    c.fillStyle = color;
    c.fillRect(x, y, size, size);
    c.fillStyle = shade(color, 70);
    c.fillRect(x, y, size, b);
    c.fillRect(x, y, b, size);
    c.fillStyle = shade(color, -80);
    c.fillRect(x, y + size - b, size, b);
    c.fillRect(x + size - b, y, b, size);
    c.fillStyle = 'rgba(255,255,255,0.55)';
    c.fillRect(x + b, y + b, b, b); // shine
    c.globalAlpha = 1;
}

function text(str, x, y, color, size, align = 'left') {
    c.fillStyle = color;
    c.font = `${size}px ${FONT}`;
    c.textAlign = align;
    c.textBaseline = 'top';
    c.fillText(str, x, y);
}

function drawMini(type, x, y, size, alpha = 1) {
    if (!type) return;
    const m = PIECES[type].shape;
    // centre the shape inside a 4×2 box
    const cells = [];
    m.forEach((row, ry) => row.forEach((v, rx) => v && cells.push([rx, ry])));
    const minX = Math.min(...cells.map((p) => p[0])), maxX = Math.max(...cells.map((p) => p[0]));
    const minY = Math.min(...cells.map((p) => p[1])), maxY = Math.max(...cells.map((p) => p[1]));
    const ox = x + (4 - (maxX - minX + 1)) * size / 2;
    const oy = y + (2 - (maxY - minY + 1)) * size / 2;
    for (const [rx, ry] of cells) block(ox + (rx - minX) * size, oy + (ry - minY) * size, size, PIECES[type].color, alpha);
}

function panel(label, x, y, w, h) {
    c.fillStyle = 'rgba(255,255,255,0.03)';
    c.fillRect(x, y, w, h);
    c.strokeStyle = '#3a3a4a';
    c.lineWidth = 2;
    c.strokeRect(x, y, w, h);
    text(label, x + 8, y + cell * 0.3, '#ff7a3c', Math.max(7, Math.floor(cell * 0.34)));
}

function draw(now) {
    c.fillStyle = '#0b0b10';
    c.fillRect(0, 0, canvas.width, canvas.height);

    const W = COLS * cell;
    const H = ROWS * cell;
    const small = Math.max(8, Math.floor(cell * 0.4));
    const big = Math.max(8, Math.floor(cell * 0.55));

    // board frame + grid
    c.fillStyle = '#05050a';
    c.fillRect(boardX, boardY, W, H);
    c.strokeStyle = 'rgba(255,255,255,0.04)';
    c.lineWidth = 1;
    for (let x = 1; x < COLS; x++) { c.beginPath(); c.moveTo(boardX + x * cell + 0.5, boardY); c.lineTo(boardX + x * cell + 0.5, boardY + H); c.stroke(); }
    for (let y = 1; y < ROWS; y++) { c.beginPath(); c.moveTo(boardX, boardY + y * cell + 0.5); c.lineTo(boardX + W, boardY + y * cell + 0.5); c.stroke(); }
    c.strokeStyle = '#a8a4ff';
    c.lineWidth = 3;
    c.strokeRect(boardX - 3, boardY - 3, W + 6, H + 6);

    if (grid) {
        // settled blocks (rows being cleared flash white)
        for (let y = HIDDEN; y < grid.length; y++)
            for (let x = 0; x < COLS; x++) {
                if (!grid[y][x]) continue;
                const flashing = clearing && clearing.rows.includes(y);
                const color = flashing ? (Math.floor(clearing.time / 60) % 2 ? '#ffffff' : grid[y][x]) : grid[y][x];
                block(boardX + x * cell, boardY + (y - HIDDEN) * cell, cell, color);
            }

        if (piece && (state === 'playing' || state === 'paused')) {
            // ghost piece shows where it will land
            const gy = ghostY();
            piece.matrix.forEach((row, ry) => row.forEach((v, rx) => {
                if (!v || gy + ry < HIDDEN) return;
                c.strokeStyle = PIECES[piece.type].color;
                c.globalAlpha = 0.45;
                c.lineWidth = 2;
                c.strokeRect(boardX + (piece.x + rx) * cell + 2, boardY + (gy + ry - HIDDEN) * cell + 2, cell - 4, cell - 4);
                c.globalAlpha = 1;
            }));
            piece.matrix.forEach((row, ry) => row.forEach((v, rx) => {
                if (!v || piece.y + ry < HIDDEN) return;
                block(boardX + (piece.x + rx) * cell, boardY + (piece.y + ry - HIDDEN) * cell, cell, PIECES[piece.type].color);
            }));
        }
    }

    // left side: HOLD + stats
    const pw = cell * 5;
    const lx = boardX - pw - cell * 0.8;
    panel('HOLD', lx, boardY, pw, cell * 3.4);
    drawMini(held, lx + cell * 0.5, boardY + cell * 1.2, cell, canHold ? 1 : 0.4); // dimmed until the next piece
    const stats = [['SCORE', score || 0], ['LEVEL', level || 1], ['LINES', lines || 0]];
    stats.forEach(([label, value], i) => {
        const y = boardY + cell * 4.2 + i * cell * 2.4;
        panel(label, lx, y, pw, cell * 2);
        text(String(value), lx + pw - 8, y + cell * 1.05, '#ffd23f', big, 'right');
    });

    // right side: NEXT queue + best + controls
    const rx = boardX + W + cell * 0.8;
    panel('NEXT', rx, boardY, pw, cell * 8);
    (queue || []).forEach((type, i) => drawMini(type, rx + cell * 0.5, boardY + cell * (1.2 + i * 2.3), cell));
    panel('BEST', rx, boardY + cell * 8.8, pw, cell * 2);
    text(String(best), rx + pw - 8, boardY + cell * 9.85, '#ffd23f', big, 'right');
    // plain ASCII: the pixel font has no arrow characters
    const help = ['< > MOVE', '^ ROTATE', 'v SOFT DROP', 'SPACE DROP', 'C HOLD', 'P PAUSE',
        `M SOUND ${muted ? 'OFF' : 'ON'}`, `N MUSIC ${musicOn ? 'ON' : 'OFF'}`];
    help.forEach((h, i) => text(h, rx, boardY + cell * 11.6 + i * small * 1.9, '#6f6c86', small));

    // big pop-up messages
    if (flash) {
        flash.time += 16;
        const a = Math.max(0, 1 - flash.time / 1200);
        c.globalAlpha = a;
        text(flash.text, boardX + W / 2, boardY + H * 0.35 - flash.time / 30, '#ffd23f', Math.floor(cell * 0.9), 'center');
        c.globalAlpha = 1;
        if (a <= 0) flash = null;
    }

    // overlays
    const overlay = (title, sub, color) => {
        c.fillStyle = 'rgba(0,0,0,0.72)';
        c.fillRect(boardX, boardY, W, H);
        text(title, boardX + W / 2, boardY + H * 0.38, color, Math.floor(cell * 0.85), 'center');
        if (Math.floor(now / 500) % 2) text(sub, boardX + W / 2, boardY + H * 0.52, '#ffffff', small, 'center');
    };
    if (state === 'title') overlay('TETRIS', 'PRESS ENTER', '#3fe0ff');
    if (state === 'paused') overlay('PAUSED', 'PRESS P', '#ffd23f');
    if (state === 'over') overlay('GAME OVER', 'PRESS ENTER', '#ff4b5c');

    // CRT scanlines over everything
    c.fillStyle = 'rgba(0,0,0,0.18)';
    for (let y = 0; y < canvas.height; y += 3) c.fillRect(0, y, canvas.width, 1);
}

/* ---------- main loop ---------- */

let last = performance.now();
function loop(now) {
    requestAnimationFrame(loop);
    const dt = Math.min(now - last, 100);
    last = now;

    if (state === 'playing') {
        handleHeldKeys(now);
        if (onFloor()) {
            lockTimer += dt;
            if (lockTimer >= Math.max(250, LOCK_DELAY - (level - 1) * 20)) lock();
        } else {
            dropTimer += dt;
            const speed = GRAVITY[Math.min(level - 1, GRAVITY.length - 1)];
            if (dropTimer >= speed) {
                dropTimer = 0;
                piece.y++;
                lockTimer = 0;
            }
        }
    } else if (state === 'clearing') {
        clearing.time += dt;
        if (clearing.time >= 360) finishClear();
    }

    draw(now);
}

layout();
requestAnimationFrame(loop);
