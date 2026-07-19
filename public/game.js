/**
 * 快樂足球 — top-down 2v2 arcade soccer vs. AI.
 * Plain canvas, no dependencies. Coordinates use a fixed logical field
 * (W×H) scaled to fit the window; all speeds are px/sec of that space.
 *
 * Teams: blue = you + one AI teammate (attacks right),
 *        red  = two AI opponents (attacks left). Both goals have auto keepers.
 * A referee resets play (kickoff) if the ball stalls in one spot — prevents
 * corner deadlocks.
 */
'use strict';

// ── Field constants ───────────────────────────────────────────────────────────
const W = 900, H = 560;            // logical field size
const GOAL_MOUTH = 170;            // goal opening height
const GOAL_TOP = (H - GOAL_MOUTH) / 2;
const GOAL_BOT = GOAL_TOP + GOAL_MOUTH;
const GOAL_DEPTH = 26;             // drawn net depth outside the pitch
const MATCH_SECONDS = 180;

const PLAYER_R = 16, KEEPER_R = 15, BALL_R = 9;
const PLAYER_SPEED = 265, BOT_SPEED = 232, MATE_SPEED = 245, KEEPER_SPEED = 210;
const SHOOT_SPEED = 560, PASS_NUDGE = 1.35;
const BALL_DECAY = 0.9985;         // per-ms exponential-ish damping factor
const KICK_REACH = 10;             // extra reach beyond radii for kicking
const STALL_RADIUS = 26;           // ball considered "stuck" inside this radius
const STALL_SECONDS = 4;           // ...for this long → dead ball, re-kickoff
const WALL_ZONE = 60;              // near-wall band where bots clear to center

// ── State ─────────────────────────────────────────────────────────────────────
const state = {
  running: false,          // match in progress (clock ticking)
  frozen: true,            // entities frozen (kickoff countdown / banners)
  timeLeft: MATCH_SECONDS,
  scoreHome: 0,            // home = you (blue, attacks right)
  scoreAway: 0,
  input: { up: false, down: false, left: false, right: false, shoot: false,
           joyX: 0, joyY: 0, usingJoy: false },
  shootLatch: false,       // require release between shots
  stall: { x: 0, y: 0, t: 0 },
};

function makeEntities() {
  return {
    player: { x: W * 0.30, y: H * 0.62, vx: 0, vy: 0, r: PLAYER_R, dirX: 1, dirY: 0 },
    mate:   { x: W * 0.34, y: H * 0.30, vx: 0, vy: 0, r: PLAYER_R,
              attackDir: 1, speed: MATE_SPEED, shootCooldown: 0 },
    ai:     { x: W * 0.70, y: H * 0.42, vx: 0, vy: 0, r: PLAYER_R,
              attackDir: -1, speed: BOT_SPEED, shootCooldown: 0 },
    ai2:    { x: W * 0.66, y: H * 0.72, vx: 0, vy: 0, r: PLAYER_R,
              attackDir: -1, speed: BOT_SPEED * 0.96, shootCooldown: 0 },
    keeperL:{ x: 30,       y: H / 2, r: KEEPER_R, cooldown: 0 },
    keeperR:{ x: W - 30,   y: H / 2, r: KEEPER_R, cooldown: 0 },
    ball:   { x: W / 2,    y: H / 2, vx: 0, vy: 0, r: BALL_R },
  };
}
let ents = makeEntities();

// ── Canvas setup ──────────────────────────────────────────────────────────────
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
let viewScale = 1;

function resize() {
  const pad = 16;
  const maxW = window.innerWidth - pad * 2;
  const maxH = window.innerHeight - pad * 2;
  viewScale = Math.min(maxW / W, maxH / H);
  const dpr = window.devicePixelRatio || 1;
  canvas.width  = Math.round(W * viewScale * dpr);
  canvas.height = Math.round(H * viewScale * dpr);
  canvas.style.width  = Math.round(W * viewScale) + 'px';
  canvas.style.height = Math.round(H * viewScale) + 'px';
  ctx.setTransform(viewScale * dpr, 0, 0, viewScale * dpr, 0, 0);
}
window.addEventListener('resize', resize);
resize();

// ── DOM refs ──────────────────────────────────────────────────────────────────
const hudHome  = document.getElementById('score-home');
const hudAway  = document.getElementById('score-away');
const hudClock = document.getElementById('clock');
const banner   = document.getElementById('banner');
const overlay  = document.getElementById('overlay');
const startBtn = document.getElementById('start-btn');
const shootBtn = document.getElementById('shoot-btn');
const joyEl    = document.getElementById('joystick');
const joyKnob  = document.getElementById('joystick-knob');

// ── Keyboard input ────────────────────────────────────────────────────────────
const KEYMAP = {
  ArrowUp: 'up', KeyW: 'up',
  ArrowDown: 'down', KeyS: 'down',
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  Space: 'shoot',
};
window.addEventListener('keydown', e => {
  const k = KEYMAP[e.code];
  if (k) { state.input[k] = true; e.preventDefault(); }
});
window.addEventListener('keyup', e => {
  const k = KEYMAP[e.code];
  if (k) { state.input[k] = false; e.preventDefault(); }
});

// ── Touch input (joystick on left side, shoot button) ─────────────────────────
const isTouch = matchMedia('(pointer: coarse)').matches;
let joyPointerId = null, joyOrigin = null;
const JOY_RADIUS = 46;

function joySet(dx, dy) {
  const len = Math.hypot(dx, dy);
  const clamped = Math.min(len, JOY_RADIUS);
  const nx = len > 0 ? dx / len : 0;
  const ny = len > 0 ? dy / len : 0;
  state.input.joyX = nx * (clamped / JOY_RADIUS);
  state.input.joyY = ny * (clamped / JOY_RADIUS);
  joyKnob.style.transform =
    `translate(calc(-50% + ${nx * clamped}px), calc(-50% + ${ny * clamped}px))`;
}

window.addEventListener('pointerdown', e => {
  if (!isTouch || overlay.style.display !== 'none') return;
  if (e.target === shootBtn) return;
  if (e.clientX < window.innerWidth * 0.62) {
    joyPointerId = e.pointerId;
    joyOrigin = { x: e.clientX, y: e.clientY };
    joyEl.style.left = (e.clientX - 60) + 'px';
    joyEl.style.top  = (e.clientY - 60) + 'px';
    joyEl.classList.remove('hidden');
    state.input.usingJoy = true;
    joySet(0, 0);
  }
});
window.addEventListener('pointermove', e => {
  if (e.pointerId === joyPointerId && joyOrigin) {
    joySet(e.clientX - joyOrigin.x, e.clientY - joyOrigin.y);
  }
});
function joyEnd(e) {
  if (e.pointerId === joyPointerId) {
    joyPointerId = null; joyOrigin = null;
    state.input.usingJoy = false;
    state.input.joyX = 0; state.input.joyY = 0;
    joyEl.classList.add('hidden');
  }
}
window.addEventListener('pointerup', joyEnd);
window.addEventListener('pointercancel', joyEnd);

shootBtn.addEventListener('pointerdown', e => {
  e.preventDefault();
  state.input.shoot = true;
  shootBtn.classList.add('pressed');
});
shootBtn.addEventListener('pointerup', () => {
  state.input.shoot = false;
  shootBtn.classList.remove('pressed');
});
shootBtn.addEventListener('pointercancel', () => {
  state.input.shoot = false;
  shootBtn.classList.remove('pressed');
});

// ── Match flow ────────────────────────────────────────────────────────────────
let bannerTimer = null;
function showBanner(text, ms) {
  banner.textContent = text;
  banner.classList.remove('hidden');
  if (bannerTimer) clearTimeout(bannerTimer);
  if (ms) bannerTimer = setTimeout(() => banner.classList.add('hidden'), ms);
}

function kickoff() {
  ents = makeEntities();
  state.stall = { x: W / 2, y: H / 2, t: 0 };
  state.frozen = true;
  showBanner('開球', 900);
  setTimeout(() => { state.frozen = false; }, 900);
}

function startMatch() {
  state.scoreHome = 0;
  state.scoreAway = 0;
  state.timeLeft = MATCH_SECONDS;
  state.running = true;
  overlay.style.display = 'none';
  if (isTouch) shootBtn.classList.remove('hidden');
  updateHud();
  kickoff();
}

function endMatch() {
  state.running = false;
  state.frozen = true;
  banner.classList.add('hidden');
  if (isTouch) shootBtn.classList.add('hidden');
  const h = state.scoreHome, a = state.scoreAway;
  const verdict = h > a ? '你贏了！' : h < a ? '電腦獲勝' : '平手';
  overlay.querySelector('h1').textContent = '全場結束';
  overlay.querySelector('p').innerHTML =
    `藍隊 ${h} : ${a} 紅隊 — ${verdict}`;
  startBtn.textContent = '再來一場';
  overlay.style.display = 'flex';
}

function onGoal(byHome) {
  if (byHome) state.scoreHome++; else state.scoreAway++;
  updateHud();
  state.frozen = true;
  showBanner('進球！', 1300);
  setTimeout(() => { if (state.running) kickoff(); }, 1300);
}

/** Ball has been stuck (corner scrum etc.) — referee restarts play. */
function deadBall() {
  state.frozen = true;
  showBanner('死球，重新開球', 1100);
  setTimeout(() => { if (state.running) kickoff(); }, 1100);
}

function updateHud() {
  hudHome.textContent = state.scoreHome;
  hudAway.textContent = state.scoreAway;
  const t = Math.max(0, Math.ceil(state.timeLeft));
  hudClock.textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

startBtn.addEventListener('click', startMatch);

// ── Physics helpers ───────────────────────────────────────────────────────────
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

function kickBall(fromX, fromY, targetX, targetY, speed) {
  const dx = targetX - fromX, dy = targetY - fromY;
  const len = Math.hypot(dx, dy) || 1;
  ents.ball.vx = (dx / len) * speed;
  ents.ball.vy = (dy / len) * speed;
}

/**
 * Ball-vs-body contact. A fast ball (a shot in flight) bounces off bodies so
 * kicks can escape a crowd; a slow ball is captured into a dribble touch.
 */
const CAPTURE_SPEED = 260;
function ballContact(ent, dt) {
  const b = ents.ball;
  const dx = b.x - ent.x, dy = b.y - ent.y;
  const dist = Math.hypot(dx, dy);
  const minDist = ent.r + b.r;
  if (dist >= minDist) return false;
  const nx = dist > 0 ? dx / dist : 1;
  const ny = dist > 0 ? dy / dist : 0;
  b.x = ent.x + nx * minDist;
  b.y = ent.y + ny * minDist;

  const speed = Math.hypot(b.vx, b.vy);
  if (speed > CAPTURE_SPEED) {
    // Deflect: reflect the incoming velocity off the body, with damping
    const dot = b.vx * nx + b.vy * ny;
    if (dot < 0) {
      b.vx = (b.vx - 2 * dot * nx) * 0.72;
      b.vy = (b.vy - 2 * dot * ny) * 0.72;
    }
    return true;
  }

  // Gentle push in the entity's movement direction so dribbling feels natural
  const push = 120;
  b.vx = (ent.vx || 0) * PASS_NUDGE + nx * push * dt * 60;
  b.vy = (ent.vy || 0) * PASS_NUDGE + ny * push * dt * 60;
  return true;
}

function withinReach(ent) {
  return Math.hypot(ents.ball.x - ent.x, ents.ball.y - ent.y)
       <= ent.r + ents.ball.r + KICK_REACH;
}

/** Keep field players from stacking on top of each other. */
function separateFieldPlayers() {
  const group = [ents.player, ents.mate, ents.ai, ents.ai2];
  for (let i = 0; i < group.length; i++) {
    for (let j = i + 1; j < group.length; j++) {
      const a = group[i], b = group[j];
      const dx = b.x - a.x, dy = b.y - a.y;
      const dist = Math.hypot(dx, dy);
      const min = a.r + b.r;
      if (dist > 0 && dist < min) {
        const nx = dx / dist, ny = dy / dist;
        const push = (min - dist) / 2;
        a.x = clamp(a.x - nx * push, a.r, W - a.r);
        a.y = clamp(a.y - ny * push, a.r, H - a.r);
        b.x = clamp(b.x + nx * push, b.r, W - b.r);
        b.y = clamp(b.y + ny * push, b.r, H - b.r);
      }
    }
  }
}

// ── Update: player ────────────────────────────────────────────────────────────
function updatePlayer(dt) {
  const p = ents.player, inp = state.input;
  let mx = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
  let my = (inp.down ? 1 : 0) - (inp.up ? 1 : 0);
  if (inp.usingJoy) { mx = inp.joyX; my = inp.joyY; }
  const len = Math.hypot(mx, my);
  if (len > 1) { mx /= len; my /= len; }
  p.vx = mx * PLAYER_SPEED;
  p.vy = my * PLAYER_SPEED;
  p.x = clamp(p.x + p.vx * dt, p.r, W - p.r);
  p.y = clamp(p.y + p.vy * dt, p.r, H - p.r);
  if (len > 0.1) {
    const l = Math.hypot(mx, my);
    p.dirX = mx / l; p.dirY = my / l;
  }
  ballContact(p, dt);

  // Shoot: aim in facing direction (or straight at goal if barely moving)
  if (inp.shoot && !state.shootLatch && withinReach(p)) {
    const aimX = p.dirX || 1, aimY = p.dirY || 0;
    kickBall(p.x, p.y, p.x + aimX * 100, p.y + aimY * 100, SHOOT_SPEED);
    state.shootLatch = true;
  }
  if (!inp.shoot) state.shootLatch = false;
}

// ── Update: AI field players (red pair + blue teammate) ───────────────────────
/**
 * One generic brain: the teammate closest to the ball chases it and shoots
 * at the attacked goal; the other takes a support position between the ball
 * and their own goal. The blue mate never fights you for the ball — it only
 * chases when it is clearly closer than you are.
 */
function updateBot(bot, isChaser, dt) {
  const b = ents.ball;
  bot.shootCooldown = Math.max(0, bot.shootCooldown - dt);

  let tx, ty;
  if (isChaser) {
    // Get goal-side of the ball relative to the attack direction
    tx = b.x - bot.attackDir * 20;
    ty = b.y;
    // Near top/bottom walls, angle in from the field side to avoid pinning
    if (b.y < 48)      ty = b.y + 16;
    if (b.y > H - 48)  ty = b.y - 16;
  } else {
    // Support: hang back between the ball and own goal, off the ball's line
    tx = clamp(b.x - bot.attackDir * 150, 70, W - 70);
    ty = clamp(b.y + (b.y > H / 2 ? -110 : 110), 50, H - 50);
  }

  const dx = tx - bot.x, dy = ty - bot.y;
  const len = Math.hypot(dx, dy);
  if (len > 2) {
    bot.vx = (dx / len) * bot.speed;
    bot.vy = (dy / len) * bot.speed;
  } else { bot.vx = 0; bot.vy = 0; }
  bot.x = clamp(bot.x + bot.vx * dt, bot.r, W - bot.r);
  bot.y = clamp(bot.y + bot.vy * dt, bot.r, H - bot.r);
  ballContact(bot, dt);

  // Kick when in reach: normally shoot at the attacked goal, but if the
  // ball is pinned near a wall (outside the goal mouth) clear it toward
  // midfield instead — breaks up corner and sideline scrums.
  if (bot.shootCooldown === 0 && withinReach(bot)) {
    const nearWall =
      b.y < WALL_ZONE || b.y > H - WALL_ZONE ||
      ((b.x < WALL_ZONE || b.x > W - WALL_ZONE) &&
       (b.y < GOAL_TOP || b.y > GOAL_BOT));
    if (nearWall) {
      kickBall(bot.x, bot.y,
               W / 2 + bot.attackDir * 120,
               H / 2 + (Math.random() * 120 - 60),
               SHOOT_SPEED * 0.85);
    } else {
      const goalX = bot.attackDir > 0 ? W : 0;
      const aimY = clamp(GOAL_TOP + 20 + Math.random() * (GOAL_MOUTH - 40),
                         GOAL_TOP + 12, GOAL_BOT - 12);
      kickBall(bot.x, bot.y, goalX, aimY, SHOOT_SPEED * 0.92);
    }
    bot.shootCooldown = 0.7;
  }
}

function updateTeams(dt) {
  const b = ents.ball;
  const d = ent => Math.hypot(b.x - ent.x, b.y - ent.y);

  // Red: closer of the two chases, the other supports
  const redChaser = d(ents.ai) <= d(ents.ai2) ? ents.ai : ents.ai2;
  updateBot(ents.ai,  ents.ai  === redChaser, dt);
  updateBot(ents.ai2, ents.ai2 === redChaser, dt);

  // Blue teammate: chase only when clearly closer than you (won't steal)
  const mateChases = d(ents.mate) < d(ents.player) - 40;
  updateBot(ents.mate, mateChases, dt);
}

// ── Update: goalkeepers ───────────────────────────────────────────────────────
/** clearDir: +1 clears toward the right half, -1 toward the left half. */
function updateKeeper(k, clearDir, dt) {
  k.cooldown = Math.max(0, k.cooldown - dt);
  const targetY = clamp(ents.ball.y, GOAL_TOP + k.r, GOAL_BOT - k.r);
  const dy = targetY - k.y;
  const step = KEEPER_SPEED * dt;
  k.y += clamp(dy, -step, step);

  // Punt the ball clear when it gets close
  const b = ents.ball;
  if (k.cooldown === 0 &&
      Math.hypot(b.x - k.x, b.y - k.y) <= k.r + b.r + 4) {
    kickBall(k.x, k.y,
             k.x + clearDir * 200,
             b.y + (Math.random() * 160 - 80),
             SHOOT_SPEED * 0.8);
    k.cooldown = 0.5;
  }
}

// ── Update: ball ──────────────────────────────────────────────────────────────
function updateBall(dt) {
  const b = ents.ball;
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  const decay = Math.pow(BALL_DECAY, dt * 1000);
  b.vx *= decay;
  b.vy *= decay;
  if (Math.hypot(b.vx, b.vy) < 4) { b.vx = 0; b.vy = 0; }

  // Top/bottom walls
  if (b.y < b.r)      { b.y = b.r;      b.vy = -b.vy * 0.82; }
  if (b.y > H - b.r)  { b.y = H - b.r;  b.vy = -b.vy * 0.82; }

  // Left/right: goal if within the mouth, otherwise bounce
  if (b.x < b.r) {
    if (b.y > GOAL_TOP && b.y < GOAL_BOT) { onGoal(false); return; }
    b.x = b.r; b.vx = -b.vx * 0.82;
  }
  if (b.x > W - b.r) {
    if (b.y > GOAL_TOP && b.y < GOAL_BOT) { onGoal(true); return; }
    b.x = W - b.r; b.vx = -b.vx * 0.82;
  }

  // Anti-stall referee: ball glued to one spot → dead ball, re-kickoff
  const s = state.stall;
  if (Math.hypot(b.x - s.x, b.y - s.y) > STALL_RADIUS) {
    s.x = b.x; s.y = b.y; s.t = 0;
  } else {
    s.t += dt;
    if (s.t >= STALL_SECONDS) deadBall();
  }
}

// ── Render ────────────────────────────────────────────────────────────────────
function drawField() {
  ctx.fillStyle = '#1c7a37';
  ctx.fillRect(0, 0, W, H);

  // Mowing stripes
  ctx.fillStyle = 'rgba(255,255,255,0.045)';
  for (let i = 0; i < 9; i += 2) ctx.fillRect(i * (W / 9), 0, W / 9, H);

  ctx.strokeStyle = 'rgba(255,255,255,0.8)';
  ctx.lineWidth = 2.5;

  // Border, halfway line, center circle
  ctx.strokeRect(6, 6, W - 12, H - 12);
  ctx.beginPath(); ctx.moveTo(W / 2, 6); ctx.lineTo(W / 2, H - 6); ctx.stroke();
  ctx.beginPath(); ctx.arc(W / 2, H / 2, 62, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(W / 2, H / 2, 4, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.fill();

  // Penalty boxes
  const boxH = GOAL_MOUTH + 90, boxY = (H - boxH) / 2, boxW = 95;
  ctx.strokeRect(6, boxY, boxW, boxH);
  ctx.strokeRect(W - 6 - boxW, boxY, boxW, boxH);

  // Goal mouths (net area drawn just inside the border)
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.fillRect(0, GOAL_TOP, GOAL_DEPTH, GOAL_MOUTH);
  ctx.fillRect(W - GOAL_DEPTH, GOAL_TOP, GOAL_DEPTH, GOAL_MOUTH);
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(7, GOAL_TOP); ctx.lineTo(7, GOAL_BOT); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(W - 7, GOAL_TOP); ctx.lineTo(W - 7, GOAL_BOT); ctx.stroke();
}

function drawDisc(x, y, r, fill, ring) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  if (ring) { ctx.lineWidth = 3; ctx.strokeStyle = ring; ctx.stroke(); }
}

function render() {
  drawField();
  // Shadows
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  for (const e of [ents.player, ents.mate, ents.ai, ents.ai2,
                   ents.keeperL, ents.keeperR, ents.ball]) {
    ctx.beginPath();
    ctx.ellipse(e.x + 3, e.y + 5, e.r * 0.95, e.r * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  drawDisc(ents.keeperL.x, ents.keeperL.y, ents.keeperL.r, '#93c5fd', '#1e3a8a');
  drawDisc(ents.keeperR.x, ents.keeperR.y, ents.keeperR.r, '#fca5a5', '#7f1d1d');
  drawDisc(ents.mate.x, ents.mate.y, ents.mate.r, '#60a5fa', '#1e40af');
  drawDisc(ents.ai2.x, ents.ai2.y, ents.ai2.r, '#ef4444', '#fecaca');
  drawDisc(ents.player.x, ents.player.y, ents.player.r, '#2563eb', '#dbeafe');
  drawDisc(ents.ai.x, ents.ai.y, ents.ai.r, '#dc2626', '#fee2e2');
  drawDisc(ents.ball.x, ents.ball.y, ents.ball.r, '#ffffff', '#334155');
}

// ── Main loop ─────────────────────────────────────────────────────────────────
let lastTs = performance.now();
function frame(ts) {
  const dt = Math.min((ts - lastTs) / 1000, 0.05); // clamp long tab-away frames
  lastTs = ts;

  if (state.running && !state.frozen) {
    state.timeLeft -= dt;
    if (state.timeLeft <= 0) { state.timeLeft = 0; updateHud(); endMatch(); }
    else {
      updatePlayer(dt);
      updateTeams(dt);
      separateFieldPlayers();
      updateKeeper(ents.keeperL, +1, dt);
      updateKeeper(ents.keeperR, -1, dt);
      updateBall(dt);
      updateHud();
    }
  }
  render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
