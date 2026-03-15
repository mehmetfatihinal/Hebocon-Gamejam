const config = {
    gameMode: "coop",       // "coop" or "chaos"
    moveDuration: 250,      // ms for block roll animation
    fallDuration: 600,      // ms for falling out of bounds
    cameraLerp: 0.1,        // Camera smoothing factor
    wobbleAmount: 0.05,     // Small random wobble chance per move for Heboi effect
    springDelay: 500,       // Delay before spring tile pushes
    fakeDelay: 800,         // Delay before fake tile drops
    reverseDuration: 1,     // Moves the reverse effect lasts (1 move = next move is reversed)
    deadzone: 0.2,          // Gamepad analog stick deadzone
    repeatDelay: 300,       // ms before analog/dpad triggers repeat movement
    repeatInterval: 150     // ms between repeated movements
};

// Global State
let scene, camera, renderer;
let light, ambientLight;
let boardGroup;
let currentLevelIndex = 0;
let moves = 0;
let isGameOver = false;
let isLevelReady = false;
let playersInHole = 0;
let gameState = "puzzle"; // "puzzle", "fight_intro", "fight_active", "fight_result"
let currentCamLookAt = new THREE.Vector3(0, 0, 0);

// 3D Visual Constants
const TILE_SIZE = 1;
let currentMap = [];
let tileMeshes = {}; // to store and remove physical tiles later for animations

let textureLoader;
let heboiTextures = [];

let collectibles = []; // Array of active collectable items

// --- Player State ---
let players = [];

function createPlayer(id) {
    return {
        id: id,
        x: 0,
        z: 0,
        state: "dik",
        mesh: null,
        pivot: null,
        inputSource: id === 1 ? "Klavye (WASD)" : "Klavye (Oklar)",
        gamepadIndex: null, // assigned dynamically
        moveQueue: [],
        isAnimating: false,
        pressedTime: {},
        lastRepeatTime: {},
        heboiReverseActive: false,
        isAlive: true,
        mashCount: 0,
        lastActionPressed: false,
        score: 0,
        baklavaCount: 0,
        zurnaCount: 0,
        scoreKillTriggered: false
    };
}

// Track which physical gamepad indices are confirmed as real controllers
let confirmedGamepads = {};

// --- Levels Data ---
// " ": Empty, "O": Floor, "X": Goal, "F": Fake, "S": Spring, "R": Reverse, "B": Fragile (Nazlı)
const levels = [
    // L1: Classic Introduction (2 Players)
    {
        startPos1: { x: 2, z: 3, state: "dik" },
        startPos2: { x: 4, z: 3, state: "dik" },
        map: [
            "          ",
            " OOOOO    ",
            " OOOOO    ",
            " OOOOO    ",
            " OOOOO    ",
            " OOOOO    ",
            "   OOX    ",
            "          "
        ]
    },
    // L2: Narrow Path
    {
        startPos1: { x: 2, z: 3, state: "dik" },
        startPos2: { x: 4, z: 3, state: "dik" },
        map: [
            "          ",
            " OOOOO    ",
            " OOOOO    ",
            " OOOOO    ",
            " OOOOO    ",
            " OOOO     ",
            "  OO      ",
            "  OO      ",
            "  OO      ",
            "  OOX     ",
            "          "
        ]
    },
    // L3: Spring Intro
    {
        startPos1: { x: 2, z: 3, state: "dik" },
        startPos2: { x: 4, z: 3, state: "dik" },
        map: [
            "          ",
            " OOOOO    ",
            " OOOOO    ",
            " OOOOO    ",
            " OOOOO    ",
            " OOOOO    ",
            "   SO     ",
            "   OO     ",
            "   OOX    "
        ]
    },
    // L4: Reverse Tile Warning
    {
        startPos1: { x: 2, z: 3, state: "dik" },
        startPos2: { x: 4, z: 3, state: "dik" },
        map: [
            "          ",
            " OOOOO    ",
            " OOOOO    ",
            " OOOOO    ",
            " OOOOO    ",
            " OOOOO    ",
            "  RRRO    ",
            "  OXO     ",
            "          "
        ]
    },
    // L5: Fragile Tile + Chaos
    {
        startPos1: { x: 2, z: 3, state: "dik" },
        startPos2: { x: 4, z: 3, state: "dik" },
        map: [
            "          ",
            " OOOOO    ",
            " OOOOO    ",
            " OOOOO    ",
            " OOOOO    ",
            " OOOOO    ",
            "   FO     ",
            "   BO     ",
            "   SO     ",
            "  OOOX    ",
            "          "
        ]
    }
];

// --- Initialization ---
function init() {
    initScene();
    initLights();
    initRenderer();

    // Create initial players
    players = [createPlayer(1), createPlayer(2)];

    initInput();
    initGamepads();

    loadLevel(currentLevelIndex);
    animate();

    window.addEventListener('resize', onWindowResize, false);
}

function initScene() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a2e); // Match CSS bg

    camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
    // Isometric-ish angle
    camera.position.set(-8, 12, 10);
    camera.lookAt(0, 0, 0);

    boardGroup = new THREE.Group();
    scene.add(boardGroup);

    // Players pivot groups will be added dynamically
}

function initLights() {
    ambientLight = new THREE.AmbientLight(0xffffff, 0.85); // Brighter ambient for mosaic details
    scene.add(ambientLight);

    light = new THREE.DirectionalLight(0xffffff, 1.0); // STRONGER SUN
    light.position.set(-5, 10, 5);
    light.castShadow = true;

    // Smooth shadow mapping
    light.shadow.camera.left = -10;
    light.shadow.camera.right = 10;
    light.shadow.camera.top = 10;
    light.shadow.camera.bottom = -10;
    light.shadow.mapSize.width = 1024;
    light.shadow.mapSize.height = 1024;

    scene.add(light);
}

function initRenderer() {
    const container = document.getElementById('gameContainer');
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    // Load Heboi Textures (Zurna / Baklava) - Base64 embedded to bypass file:// CORS
    textureLoader = new THREE.TextureLoader();
    heboiTextures.push(textureLoader.load(ZURNA_B64));
    heboiTextures.push(textureLoader.load(BAKLAVA_B64));
}

// --- Level Building ---
function loadLevel(index) {
    if (index >= levels.length) {
        showToast("Tebrikler, tüm Heboi seviyeleri bitti!", 5000);
        return;
    }

    // Clear old board and players
    while (boardGroup.children.length > 0) {
        boardGroup.remove(boardGroup.children[0]);
    }

    players.forEach(p => {
        if (p.pivot) {
            scene.remove(p.pivot);
        }

        // Reset player internal states
        p.isAnimating = false;
        p.moveQueue = [];
        p.heboiReverseActive = false;
        p.pressedTime = {};
        p.lastRepeatTime = {};
        p.isAlive = true;
        p.mashCount = 0;
        p.lastActionPressed = false;
        p.scoreKillTriggered = false;
        p.score = 0;
        p.baklavaCount = 0;
        p.zurnaCount = 0;
        // Restore visibility in case meteor eliminated this player last level
        if (p.pivot) p.pivot.visible = true;
    });

    // Clear any lingering fight or survival timer from the previous level
    clearInterval(fightTimerInterval);
    clearInterval(survivalTimerInterval);
    document.getElementById('survival-timer').classList.add('hidden');

    tileMeshes = {};

    // Clear old collectibles
    collectibles.forEach(c => {
        if (c.mesh && c.mesh.parent) c.mesh.parent.remove(c.mesh);
    });
    collectibles = [];

    let lvl = levels[index];
    currentMap = lvl.map.map(row => row.split(''));

    // Setup Player positional states
    players[0].x = lvl.startPos1.x;
    players[0].z = lvl.startPos1.z;
    players[0].state = lvl.startPos1.state;

    players[1].x = lvl.startPos2.x;
    players[1].z = lvl.startPos2.z;
    players[1].state = lvl.startPos2.state;

    moves = 0;
    isGameOver = false;
    isLevelReady = false; // Block input until level is fully ready
    playersInHole = 0;
    gameState = "puzzle";
    document.getElementById('fight-overlay').classList.add('hidden');

    buildLevelMesh();

    players.forEach(p => createPlayerMesh(p));

    updateUI();

    // Center camera roughly on board
    let mapW = currentMap[0].length * TILE_SIZE;
    let mapH = currentMap.length * TILE_SIZE;
    currentCamLookAt.set(mapW / 2, 0, mapH / 2);
    camera.position.set(mapW / 2 - 8, 12, mapH / 2 + 10);
    camera.lookAt(currentCamLookAt);

    // Reset Canvas Shake/Spin CSS
    const canvas = renderer.domElement;
    canvas.classList.remove('canvas-shake', 'canvas-spin-out');

    // Mark level as ready - input is now allowed
    isLevelReady = true;
}

function buildLevelMesh() {
    const geo = new THREE.BoxGeometry(TILE_SIZE * 0.95, TILE_SIZE * 0.2, TILE_SIZE * 0.95);

    const matGoal = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.5 });

    for (let z = 0; z < currentMap.length; z++) {
        for (let x = 0; x < currentMap[z].length; x++) {
            let type = currentMap[z][x];
            if (type === ' ') continue;

            let mat;
            if (type === 'X') {
                mat = matGoal;
            } else {
                let tex = generateMosaicTexture(type);
                mat = new THREE.MeshStandardMaterial({
                    map: tex,
                    roughness: 0.85,
                    bumpMap: tex,
                    bumpScale: 0.03
                });

                if (type === 'B') {
                    mat.transparent = true;
                    mat.opacity = 0.85;
                }
            }

            let mesh = new THREE.Mesh(geo, mat);
            mesh.position.set(x * TILE_SIZE + TILE_SIZE / 2, -TILE_SIZE * 0.1, z * TILE_SIZE + TILE_SIZE / 2);
            mesh.receiveShadow = true;
            mesh.castShadow = true;

            if (type === 'X') {
                // Goal looks like a hole, modify mesh
                mesh.scale.y = 0.05;
                mesh.position.y -= TILE_SIZE * 0.1;
            } else if (type === 'O') {
                // Collectible Sporadic Spawning (Baklava / Zurna)
                if (Math.random() < 0.15 && heboiTextures.length > 0) {
                    let isZurna = Math.random() < 0.5;
                    let tex = isZurna ? heboiTextures[0] : heboiTextures[1]; // 0 is zurna, 1 is baklava
                    let iType = isZurna ? 'zurna' : 'baklava';

                    let spriteMat = new THREE.SpriteMaterial({
                        map: tex,
                        color: 0xffffff,
                        transparent: true
                    });

                    let sprite = new THREE.Sprite(spriteMat);
                    // Initial Position above tile
                    let baseY = mesh.position.y + TILE_SIZE;
                    sprite.position.set(mesh.position.x, baseY, mesh.position.z);
                    sprite.scale.set(0.6, 0.6, 0.6);

                    // Emissive glow effect equivalent using a backing plane or light
                    let glowMat = new THREE.MeshBasicMaterial({
                        color: isZurna ? 0xf39c12 : 0xf1c40f,
                        transparent: true,
                        opacity: 0.3,
                        blending: THREE.AdditiveBlending,
                        depthWrite: false
                    });
                    let glowMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), glowMat);
                    glowMesh.rotation.x = -Math.PI / 2;
                    sprite.add(glowMesh); // Attach glow to sprite

                    boardGroup.add(sprite);

                    collectibles.push({
                        type: iType,
                        mesh: sprite,
                        gridX: x,
                        gridZ: z,
                        baseY: baseY,
                        collected: false
                    });
                }
            }

            boardGroup.add(mesh);
            tileMeshes[`${x},${z}`] = mesh;
        }
    }
}

function generateMosaicTexture(type) {
    const canvas = document.createElement('canvas');
    const size = 256;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    // Base Grout
    ctx.fillStyle = '#6b5d4b';
    ctx.fillRect(0, 0, size, size);

    let options = {
        tesseraSize: 16 + Math.random() * 4,
        gap: 2,
        palette: ['#c2b280', '#e5d3b3', '#9b7653'],
        cracks: 0,
        missingChance: 0.03,
        restoration: 0,
        pattern: 'none'
    };

    if (type === 'O') {
        const styles = ['geometric', 'cracked', 'restored', 'faded', 'ornate', 'gypsy', 'euphrates'];
        const style = styles[Math.floor(Math.random() * styles.length)];

        if (style === 'geometric') {
            options.palette = ['#e5d3b3', '#2c2c2c', '#8b0000', '#d2b48c'];
            options.pattern = 'border';
        } else if (style === 'cracked') {
            options.cracks = 2 + Math.floor(Math.random() * 3);
            options.missingChance = 0.08;
        } else if (style === 'restored') {
            options.restoration = 1 + Math.floor(Math.random() * 2);
        } else if (style === 'faded') {
            options.palette = ['#d3c7b6', '#e5d3b3', '#bfa58a'];
            options.missingChance = 0.12;
        } else if (style === 'ornate') {
            options.palette = ['#e5d3b3', '#1a1a1a', '#8b0000', '#cd853f'];
            options.pattern = 'center';
            options.tesseraSize = 12;
        } else if (style === 'gypsy') {
            options.palette = ['#8b4513', '#a0522d', '#cd853f', '#deb887', '#556b2f', '#2f4f4f', '#222'];
            options.tesseraSize = 10 + Math.random() * 4;
        } else if (style === 'euphrates') {
            options.palette = ['#4682b4', '#5f9ea0', '#708090', '#778899', '#2f4f4f', '#b0c4de'];
        }
    } else if (type === 'F') { // Fake
        options.palette = ['#8b7d6b', '#696969', '#a9a9a9', '#555'];
        options.cracks = 4;
        options.missingChance = 0.2;
    } else if (type === 'S') { // Spring
        options.palette = ['#f1c40f', '#e67e22', '#d35400', '#8b4500'];
        options.pattern = 'center';
    } else if (type === 'R') { // Reverse
        options.palette = ['#9b59b6', '#8e44ad', '#2c3e50', '#ffffff'];
        options.pattern = 'border';
    } else if (type === 'B') { // Fragile
        options.palette = ['#aed6f1', '#5dade2', '#d4e6f1', '#ffffff'];
        options.cracks = 5;
        options.missingChance = 0.15;
    }

    const tSize = options.tesseraSize;
    const gap = options.gap;
    const rows = Math.floor(size / tSize);
    const cols = Math.floor(size / tSize);

    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            if (Math.random() < options.missingChance) continue;

            let x = c * tSize + gap;
            let y = r * tSize + gap;

            // Jitter to make hand-laid look
            x += (Math.random() - 0.5) * 3;
            y += (Math.random() - 0.5) * 3;

            let color = options.palette[Math.floor(Math.random() * options.palette.length)];

            if (options.pattern === 'border' && (r < 2 || r >= rows - 2 || c < 2 || c >= cols - 2)) {
                color = '#222222';
            } else if (options.pattern === 'center' && (Math.abs(r - rows / 2) < 3 && Math.abs(c - cols / 2) < 3)) {
                color = type === 'S' ? '#ffdf00' : '#550000';
            }

            ctx.fillStyle = color;
            ctx.fillRect(x, y, tSize - gap * 1.5, tSize - gap * 1.5);

            // Tessera texture shading
            ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.25})`;
            ctx.fillRect(x, y, tSize - gap * 1.5, tSize - gap * 1.5);
            ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.15})`;
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x + tSize - gap * 1.5, y);
            ctx.lineTo(x, y + tSize - gap * 1.5);
            ctx.fill();
        }
    }

    // Restoration plaster
    if (options.restoration) {
        ctx.fillStyle = 'rgba(210, 200, 180, 0.85)';
        for (let i = 0; i < options.restoration; i++) {
            ctx.beginPath();
            ctx.arc(Math.random() * size, Math.random() * size, 20 + Math.random() * 40, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    // Cracks
    if (options.cracks) {
        ctx.strokeStyle = '#2a2015';
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        for (let i = 0; i < options.cracks; i++) {
            ctx.lineWidth = 1 + Math.random() * 3;
            ctx.beginPath();
            let startX = Math.random() * size;
            let startY = Math.random() * size;
            ctx.moveTo(startX, startY);
            for (let j = 0; j < 4; j++) {
                startX += (Math.random() - 0.5) * 80;
                startY += (Math.random() - 0.5) * 80;
                ctx.lineTo(startX, startY);
            }
            ctx.stroke();
        }
    }

    // Global grime/dust layer to blend it uniformly
    ctx.fillStyle = 'rgba(60, 50, 40, 0.15)';
    ctx.fillRect(0, 0, size, size);

    const texture = new THREE.CanvasTexture(canvas);
    if (renderer) texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    texture.minFilter = THREE.LinearMipmapLinearFilter;

    return texture;
}

function createPlayerMesh(player) {
    const geo = new THREE.BoxGeometry(TILE_SIZE * 0.98, TILE_SIZE * 2, TILE_SIZE * 0.98);

    // Load texture for each player from Base64 (avoids file:// CORS)
    let b64 = player.id === 1 ? TA3_B64 : S8_B64;
    let tex = new THREE.TextureLoader().load(b64);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;

    const texMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.4 });

    // Apply texture to all 6 faces
    const mats = [texMat, texMat, texMat, texMat, texMat, texMat];
    player.mesh = new THREE.Mesh(geo, mats);
    player.mesh.castShadow = true;
    player.mesh.receiveShadow = true;

    player.pivot = new THREE.Group();
    player.pivot.add(player.mesh);
    scene.add(player.pivot);

    updatePlayerTransform(player, true);
}

// Transform logical coordinate system to 3D View system
function updatePlayerTransform(player, snap = false) {
    let cx = player.x * TILE_SIZE;
    let cz = player.z * TILE_SIZE;

    let rotX = 0; let rotZ = 0;
    let posY = 0;

    if (player.state === "dik") {
        cx += TILE_SIZE / 2;
        cz += TILE_SIZE / 2;
        posY = TILE_SIZE;
        rotX = 0; rotZ = 0;
    } else if (player.state === "yatayX") {
        cx += TILE_SIZE;
        cz += TILE_SIZE / 2;
        posY = TILE_SIZE / 2;
        rotZ = Math.PI / 2;
    } else if (player.state === "yatayZ") {
        cx += TILE_SIZE / 2;
        cz += TILE_SIZE;
        posY = TILE_SIZE / 2;
        rotX = Math.PI / 2;
    }

    if (snap) {
        player.pivot.position.set(cx, posY, cz);
        player.mesh.rotation.set(rotX, 0, rotZ);
        player.mesh.position.set(0, 0, 0);
        player.pivot.rotation.set(0, 0, 0);
    }
    return { cx, posY, cz, rotX, MathPI2: Math.PI / 2 };
}

// --- Input Management (Keyboard & Gamepad) ---
function initInput() {
    document.addEventListener('keydown', (e) => {
        if (!isLevelReady) return; // Block input during level transitions

        let p1Keys = { "w": "up", "s": "down", "a": "left", "d": "right", "r": "reset" };
        let p2Keys = { "ArrowUp": "up", "ArrowDown": "down", "ArrowLeft": "left", "ArrowRight": "right" };

        // --- FIGHT MODE INPUT ---
        if (gameState === "fight_active") {
            if (e.code === "Space" && players[0].isAlive) {
                if (!players[0].lastActionPressed) {
                    players[0].lastActionPressed = true;
                    handleFightMash(players[0]);
                }
            }
            if (e.code === "Enter" && players[1].isAlive) {
                if (!players[1].lastActionPressed) {
                    players[1].lastActionPressed = true;
                    handleFightMash(players[1]);
                }
            }
            return;
        }

        // --- PUZZLE MODE INPUT ---
        if (gameState !== "puzzle") return;

        if (p1Keys[e.key] && players[0].isAlive) {
            players[0].inputSource = "Klavye (WASD)";
            if (p1Keys[e.key] === "reset") resetLevel();
            else queueMove(players[0], p1Keys[e.key]);
        }

        if (p2Keys[e.key] && players[1].isAlive) {
            players[1].inputSource = "Klavye (Oklar)";
            queueMove(players[1], p2Keys[e.key]);
        }
    });

    document.addEventListener('keyup', (e) => {
        if (e.code === "Space") players[0].lastActionPressed = false;
        if (e.code === "Enter") players[1].lastActionPressed = false;
    });
}

function initGamepads() {
    // Only log connection/disconnection. Assignment happens in pollGamepads on real button press.
    window.addEventListener("gamepadconnected", (e) => {
        let gp = e.gamepad;
        console.log(`Gamepad connected: index=${gp.index}, id="${gp.id}", buttons=${gp.buttons.length}, axes=${gp.axes.length}`);
    });
    window.addEventListener("gamepaddisconnected", (e) => {
        let gp = e.gamepad;
        console.log(`Gamepad disconnected: index=${gp.index}`);
        // Remove confirmation flag
        delete confirmedGamepads[gp.index];
        // Unassign from any player that was using this gamepad
        players.forEach(p => {
            if (p.gamepadIndex === gp.index) {
                p.gamepadIndex = null;
                p.inputSource = p.id === 1 ? "Klavye (WASD)" : "Klavye (Oklar)";
                showToast(`P${p.id}: Gamepad koptu.`);
            }
        });
        updateUI();
    });
}

// Check if a gamepad looks like a real controller (not an accelerometer or trackpad)
function isRealGamepad(gp) {
    // Standard mapping is a strong indicator of a real gamepad
    if (gp.mapping === "standard") return true;
    // Must have at least 4 axes and 12 buttons to be a plausible controller
    if (gp.buttons.length >= 12 && gp.axes.length >= 4) return true;
    // Reject everything else (accelerometers, touchpads, etc.)
    return false;
}

function pollGamepads() {
    if (!isLevelReady) return; // Don't process any gamepad input until level is ready

    const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];

    // Scan all connected gamepads
    for (let i = 0; i < gamepads.length; i++) {
        const gp = gamepads[i];
        if (!gp) continue;

        // Skip non-real devices entirely
        if (!isRealGamepad(gp)) continue;

        // If this gamepad is not yet confirmed, wait for a real button press
        if (!confirmedGamepads[gp.index]) {
            let anyRealButton = false;
            for (let b = 0; b < Math.min(gp.buttons.length, 16); b++) {
                if (gp.buttons[b] && gp.buttons[b].pressed) {
                    anyRealButton = true;
                    break;
                }
            }
            if (!anyRealButton) continue; // Ignore until user presses a button

            // Confirm this gamepad and assign to the first unassigned player
            confirmedGamepads[gp.index] = true;
            let assignedPlayer = null;
            for (let pi = 0; pi < players.length; pi++) {
                if (players[pi].gamepadIndex === null) {
                    players[pi].gamepadIndex = gp.index;
                    players[pi].inputSource = `Gamepad ${gp.index + 1} 🎮`;
                    assignedPlayer = players[pi];
                    break;
                }
            }
            if (assignedPlayer) {
                showToast(`P${assignedPlayer.id}: Gamepad ${gp.index + 1} bağlandı!`);
                updateUI();
            }
            continue; // Skip processing this frame (just confirmed)
        }

        // Find which player owns this gamepad
        let p = players.find(pl => pl.gamepadIndex === gp.index);
        if (!p || !p.isAlive) continue;

        // --- FIGHT MODE INPUT ---
        if (gameState === "fight_active") {
            // Button 3 is Triangle on PS, Y on Xbox.
            let actionBtnPressed = gp.buttons[3] && gp.buttons[3].pressed;
            if (actionBtnPressed && !p.lastActionPressed) {
                p.lastActionPressed = true;
                handleFightMash(p);
            } else if (!actionBtnPressed) {
                p.lastActionPressed = false;
            }
            continue; // Skip movement processing during fight
        }

        // --- PUZZLE MODE INPUT ---
        if (gameState !== "puzzle") continue;

        // A/Cross: Reset (index 0), Start: Restart game (index 9)
        if (gp.buttons[0] && gp.buttons[0].pressed && !p.pressedTime["btn0"]) { p.pressedTime["btn0"] = true; resetLevel(); }
        if (!gp.buttons[0] || !gp.buttons[0].pressed) p.pressedTime["btn0"] = false;

        if (gp.buttons[9] && gp.buttons[9].pressed && !p.pressedTime["btn9"]) { p.pressedTime["btn9"] = true; currentLevelIndex = 0; loadLevel(0); }
        if (!gp.buttons[9] || !gp.buttons[9].pressed) p.pressedTime["btn9"] = false;

        // Movement: D-Pad (12 up, 13 down, 14 left, 15 right) + Analogs
        let dir = null;

        if (gp.buttons[12]?.pressed) dir = "up";
        else if (gp.buttons[13]?.pressed) dir = "down";
        else if (gp.buttons[14]?.pressed) dir = "left";
        else if (gp.buttons[15]?.pressed) dir = "right";

        if (!dir) { // Analog
            let ax = gp.axes[0]; // Left stick X
            let ay = gp.axes[1]; // Left stick Y
            if (ay < -config.deadzone) dir = "up";
            else if (ay > config.deadzone) dir = "down";
            else if (ax < -config.deadzone) dir = "left";
            else if (ax > config.deadzone) dir = "right";
        }

        handleContinuousInput(p, dir);
    }
}

function handleContinuousInput(player, dir) {
    let now = Date.now();

    if (dir) {
        if (!player.pressedTime[dir]) {
            player.pressedTime[dir] = now;
            player.lastRepeatTime[dir] = now + config.repeatDelay; // Delay before repeat
            queueMove(player, dir);
        } else if (now >= player.lastRepeatTime[dir]) {
            player.lastRepeatTime[dir] = now + config.repeatInterval;
            queueMove(player, dir);
        }

        // Clear other directions so we don't hold two
        ['up', 'down', 'left', 'right'].forEach(otherDir => {
            if (otherDir !== dir) player.pressedTime[otherDir] = false;
        });
    } else {
        ['up', 'down', 'left', 'right'].forEach(d => { player.pressedTime[d] = false; });
    }
}

// --- Movement & Rolling Mechanics ---
function queueMove(player, baseDirection) {
    if (!isLevelReady || isGameOver || player.isAnimating || player.moveQueue.length > 1) return;

    let direction = baseDirection;
    if (player.heboiReverseActive) {
        // Reverse direction map
        let revMap = { "up": "down", "down": "up", "left": "right", "right": "left" };
        direction = revMap[baseDirection];
        player.heboiReverseActive = false; // expires after 1 move logic
    }

    player.moveQueue.push(direction);
    processQueue(player);
}

function processQueue(player) {
    if (player.isAnimating || player.moveQueue.length === 0 || isGameOver) return;

    let direction = player.moveQueue.shift();
    animateBlockRoll(player, direction);
}

function animateBlockRoll(player, direction) {
    player.isAnimating = true;
    moves++;
    updateUI();

    // Math to determine visual pivot points
    // Pivot group moves to the rotation edge
    // Block moves relative inversely so it visually stays in place
    // Then Pivot rotates 90 degrees smoothly
    // Finally Math drops out to new logical block coordinates snapping

    let edgeX = 0; let edgeZ = 0;
    let axis = new THREE.Vector3(0, 0, 0);
    let rotAngle = Math.PI / 2;

    // Target logic coords based on current state geometry
    let newX = player.x; let newZ = player.z; let newState = player.state;

    if (player.state === "dik") {
        if (direction === "up") { newZ -= 2; newState = "yatayZ"; edgeZ = -TILE_SIZE / 2; axis.set(1, 0, 0); rotAngle = -Math.PI / 2; }
        else if (direction === "down") { newZ += 1; newState = "yatayZ"; edgeZ = TILE_SIZE / 2; axis.set(1, 0, 0); rotAngle = Math.PI / 2; }
        else if (direction === "left") { newX -= 2; newState = "yatayX"; edgeX = -TILE_SIZE / 2; axis.set(0, 0, 1); rotAngle = Math.PI / 2; }
        else if (direction === "right") { newX += 1; newState = "yatayX"; edgeX = TILE_SIZE / 2; axis.set(0, 0, 1); rotAngle = -Math.PI / 2; }
    } else if (player.state === "yatayX") {
        if (direction === "up") { newZ -= 1; edgeZ = -TILE_SIZE / 2; axis.set(1, 0, 0); rotAngle = -Math.PI / 2; }
        else if (direction === "down") { newZ += 1; edgeZ = TILE_SIZE / 2; axis.set(1, 0, 0); rotAngle = Math.PI / 2; }
        else if (direction === "left") { newX -= 1; newState = "dik"; edgeX = -TILE_SIZE; axis.set(0, 0, 1); rotAngle = Math.PI / 2; }
        else if (direction === "right") { newX += 2; newState = "dik"; edgeX = TILE_SIZE; axis.set(0, 0, 1); rotAngle = -Math.PI / 2; }
    } else if (player.state === "yatayZ") {
        if (direction === "up") { newZ -= 1; newState = "dik"; edgeZ = -TILE_SIZE; axis.set(1, 0, 0); rotAngle = -Math.PI / 2; }
        else if (direction === "down") { newZ += 2; newState = "dik"; edgeZ = TILE_SIZE; axis.set(1, 0, 0); rotAngle = Math.PI / 2; }
        else if (direction === "left") { newX -= 1; edgeX = -TILE_SIZE / 2; axis.set(0, 0, 1); rotAngle = Math.PI / 2; }
        else if (direction === "right") { newX += 1; edgeX = TILE_SIZE / 2; axis.set(0, 0, 1); rotAngle = -Math.PI / 2; }
    }

    // --- Collision Pre-Check (Solid Obstacles) ---
    let prospectiveCells = [{ x: newX, z: newZ }];
    if (newState === "yatayX") prospectiveCells.push({ x: newX + 1, z: newZ });
    else if (newState === "yatayZ") prospectiveCells.push({ x: newX, z: newZ + 1 });

    let otherPlayer = players.find(p => p.id !== player.id);
    if (otherPlayer && otherPlayer.isAlive) {
        let otherCells = getOccupiedCells(otherPlayer);
        let wouldCollide = prospectiveCells.some(c1 => otherCells.some(c2 => c1.x === c2.x && c1.z === c2.z));
        if (wouldCollide) {
            player.isAnimating = false;
            player.moveQueue = [];
            if (gameState === "puzzle") {
                enterFightMode(player, otherPlayer);
            }
            return; // Abort move completely
        }
    }

    // Prepare Animation Object Tree
    let startPivotPos = player.pivot.position.clone();

    // Shift pivot to the edge, but we must shift the blockMesh opposite to keep visually matching BEFORE rotation
    // Shift blockMesh inside the newly offset Pivot
    player.mesh.position.x -= edgeX;
    player.mesh.position.y -= -TILE_SIZE / 2; // bottom edge is always TILE_SIZE/2 down from center
    player.mesh.position.z -= edgeZ;

    // Move pivot to edge corner in world space
    player.pivot.position.x += edgeX;
    player.pivot.position.y -= TILE_SIZE / 2;
    player.pivot.position.z += edgeZ;

    let startTime = performance.now();

    function animateFrame(time) {
        let elapsed = time - startTime;
        let progress = Math.min(elapsed / config.moveDuration, 1);

        // Simple EaseInOutQuad
        let ease = progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;

        // Reset rotation first to avoid accumulation, then set to exact angle
        player.pivot.setRotationFromAxisAngle(axis, rotAngle * ease);

        if (progress < 1) {
            requestAnimationFrame(animateFrame);
        } else {
            // Apply logical change once animation finishes
            player.x = newX;
            player.z = newZ;
            player.state = newState;

            // Re-snap standard transforms completely
            // It fixes floating point errors and resets hierarchies perfectly
            updatePlayerTransform(player, true);

            // Heboi feature: random wobble/shake
            if (Math.random() < config.wobbleAmount) {
                renderer.domElement.classList.remove("canvas-shake");
                void renderer.domElement.offsetWidth; // trigger reflow
                renderer.domElement.classList.add("canvas-shake");
            }

            evaluatePlayerState(player);
        }
    }

    requestAnimationFrame(animateFrame);
}

// --- Game Logic Checks ---
function getOccupiedCells(player) {
    let cells = [{ x: player.x, z: player.z }];
    if (player.state === "yatayX") cells.push({ x: player.x + 1, z: player.z });
    else if (player.state === "yatayZ") cells.push({ x: player.x, z: player.z + 1 });
    return cells;
}

function getTile(x, z) {
    if (z < 0 || z >= currentMap.length || x < 0 || x >= currentMap[z].length) return ' ';
    return currentMap[z][x];
}

function evaluatePlayerState(player) {
    if (isGameOver) return; // one player failing might end game depending on mode

    let cells = getOccupiedCells(player);
    let fullyEmpty = true;
    let partiallyEmpty = false;
    let anyFragileBad = false;
    let allInHole = true;

    cells.forEach(c => {
        let t = getTile(c.x, c.z);
        if (t !== ' ') fullyEmpty = false;
        if (t === ' ') partiallyEmpty = true;
        if (t !== 'X') allInHole = false;
        // Fragile Check: breaks if block is Flat
        if (t === 'B' && player.state !== "dik") anyFragileBad = true;
    });

    if (allInHole && player.state === "dik" && player.isAlive) {
        triggerWin(player);
        return;
    }

    if (fullyEmpty || partiallyEmpty || anyFragileBad) {
        triggerFail(player, anyFragileBad ? "Nazlı zemin o ağırlığı taşıyamaz!" : "Boşluğa düştünüz.");
        // Simulate immediate drop from physics perspective visually
        fallAnimation(player);
        return;
    }

    checkSpecialTiles(player, cells);
    checkItemCollection(player, cells);
}

function checkSpecialTiles(player, cells) {
    let activated = false;
    cells.forEach(c => {
        let t = getTile(c.x, c.z);

        if (t === 'R' && !activated) {
            if (!player.heboiReverseActive) {
                player.heboiReverseActive = true;
                showToast(`P${player.id}: YÖNLER TERSİNE DÖNDÜ!`, 1500);
            }
        }

        if (t === 'S' && !activated) {
            activated = true;
            setTimeout(() => {
                if (isGameOver) return;
                showToast(`P${player.id}: BOING!`);
                animateBlockRoll(player, Math.random() > 0.5 ? 'right' : 'down');
            }, config.springDelay);
        }

        if (t === 'F' && !activated) {
            activated = true;
            setTimeout(() => {
                if (isGameOver) return;
                let cur = getOccupiedCells(player);
                if (cur.some(cc => cc.x === c.x && cc.z === c.z)) {
                    currentMap[c.z][c.x] = ' ';
                    let tMesh = tileMeshes[`${c.x},${c.z}`];
                    if (tMesh) boardGroup.remove(tMesh);
                    showToast(`P${player.id}: Sahte zemindi!`);
                    evaluatePlayerState(player);
                }
            }, config.fakeDelay);
        }
    });

    if (!activated) {
        // Unlock input — this is the critical line that was missing!
        player.isAnimating = false;
        processQueue(player);
    }
}

function checkItemCollection(player, cells) {
    if (!player.isAlive || isGameOver || gameState !== "puzzle") return;

    cells.forEach(c => {
        let itemsOnCell = collectibles.filter(item => !item.collected && item.gridX === c.x && item.gridZ === c.z);

        itemsOnCell.forEach(item => {
            item.collected = true;

            // Apply scores
            if (item.type === 'baklava') {
                player.score += 10;
                player.baklavaCount += 1;
                showToast(`P${player.id}: Baklava motivasyonu! (+10)`, 1500);
            } else if (item.type === 'zurna') {
                player.score += 20;
                player.zurnaCount += 1;
                showToast(`P${player.id}: Zurna enerjisi! (+20)`, 1500);
            }

            updateUI();
            playItemPickupEffect(item);

            // --- SCORE KILL: First to 50 points eliminates the other! ---
            if (player.score >= 50 && !player.scoreKillTriggered) {
                player.scoreKillTriggered = true;
                let victim = players.find(p => p.id !== player.id && p.isAlive);
                if (victim) {
                    gameState = "fight_result"; // Freeze normal movement
                    setTimeout(() => {
                        showToast(`⚡ P${player.id} 50 PUANA ULAŞTI! Rakip evrenden silinecek!`, 2000);
                        setTimeout(() => playMeteorSequence(victim, player), 1500);
                    }, 200);
                }
            }
        });
    });
}

function playItemPickupEffect(item) {
    let st = performance.now();
    let startY = item.mesh.position.y;
    let startScale = item.mesh.scale.x;

    function pickupAnim(time) {
        let el = time - st;
        let pr = Math.min(el / 600, 1); // 600ms animation

        // Float up and shrink
        item.mesh.position.y = startY + (pr * 3);
        let s = startScale * (1 - pr);
        item.mesh.scale.set(s, s, s);

        // Fade out glow children
        item.mesh.children.forEach(c => {
            if (c.material && c.material.opacity !== undefined) {
                c.material.opacity = 0.3 * (1 - pr);
            }
        });

        if (pr < 1) {
            requestAnimationFrame(pickupAnim);
        } else {
            // Remove from scene fully
            if (item.mesh.parent) item.mesh.parent.remove(item.mesh);
        }
    }
    requestAnimationFrame(pickupAnim);
}

// --- FIGHT MODE LOGIC ---
let fightTimerInterval;
let fightTimeLeft = 5.0;

let survivalTimerInterval;
let survivalTimeLeft = 15.0;

function enterFightMode(p1, p2) {
    if (gameState !== "puzzle") return;
    gameState = "fight_intro";

    // Reset inputs
    p1.moveQueue = []; p2.moveQueue = [];
    p1.lastActionPressed = false; p2.lastActionPressed = false;
    p1.mashCount = 0; p2.mashCount = 0;

    // UI Init
    document.getElementById('fight-p1-score').innerText = "0";
    document.getElementById('fight-p2-score').innerText = "0";
    document.getElementById('fight-timer').innerText = "5.0";
    document.getElementById('fight-countdown').innerText = "3";
    document.getElementById('fight-countdown').classList.remove('fight-countdown-pop');

    const overlay = document.getElementById('fight-overlay');
    overlay.classList.remove('hidden');

    // Zoom Camera to combat area
    let midX = (p1.pivot.position.x + p2.pivot.position.x) / 2;
    let midZ = (p1.pivot.position.z + p2.pivot.position.z) / 2;

    // Smoothly animate camera
    let startCamPos = camera.position.clone();
    let targetCamPos = new THREE.Vector3(midX - 4, 8, midZ + 5);

    let startLookAt = currentCamLookAt.clone();
    let targetLookAt = new THREE.Vector3(midX, 0, midZ);

    let st = performance.now();
    function moveCam(time) {
        let el = time - st;
        let pr = Math.min(el / 1000, 1);
        let ease = pr < 0.5 ? 2 * pr * pr : 1 - Math.pow(-2 * pr + 2, 2) / 2;

        camera.position.lerpVectors(startCamPos, targetCamPos, ease);
        currentCamLookAt.lerpVectors(startLookAt, targetLookAt, ease);
        camera.lookAt(currentCamLookAt);

        if (pr < 1) requestAnimationFrame(moveCam);
        else startFightCountdown();
    }
    requestAnimationFrame(moveCam);
}

function startFightCountdown() {
    let count = 3;
    const countEl = document.getElementById('fight-countdown');

    let interval = setInterval(() => {
        countEl.classList.remove('fight-countdown-pop');
        void countEl.offsetWidth; // trigger reflow
        countEl.classList.add('fight-countdown-pop');

        if (count > 0) {
            countEl.innerText = count;
            count--;
        } else {
            clearInterval(interval);
            countEl.innerText = "FIGHT!";
            gameState = "fight_active";
            startFightTimer();
        }
    }, 1000);
}

function startFightTimer() {
    fightTimeLeft = 5.0; // seconds
    const timerEl = document.getElementById('fight-timer');

    let lastTime = performance.now();

    fightTimerInterval = setInterval(() => {
        let now = performance.now();
        let dt = (now - lastTime) / 1000;
        lastTime = now;

        fightTimeLeft -= dt;
        if (fightTimeLeft <= 0) {
            fightTimeLeft = 0;
            clearInterval(fightTimerInterval);
            timerEl.innerText = "0.0";
            resolveFight();
        } else {
            timerEl.innerText = fightTimeLeft.toFixed(1);
        }
    }, 50);
}

function handleFightMash(player) {
    if (gameState !== "fight_active" || !player.isAlive) return;

    player.mashCount++;

    // Find UI element and update
    const scoreEl = document.getElementById(player.id === 1 ? 'fight-p1-score' : 'fight-p2-score');
    scoreEl.innerText = player.mashCount;

    // Add visual pop to the box
    const boxEl = document.querySelector(player.id === 1 ? '.p1-box' : '.p2-box');
    boxEl.classList.remove('mash-hit');
    void boxEl.offsetWidth;
    boxEl.classList.add('mash-hit');

    // Add tiny camera shake
    camera.position.x += (Math.random() - 0.5) * 0.2;
    camera.position.y += (Math.random() - 0.5) * 0.2;
}

function resolveFight() {
    gameState = "fight_result";

    const p1 = players[0];
    const p2 = players[1];

    let winner = null;
    let loser = null;

    if (p1.mashCount > p2.mashCount) {
        winner = p1; loser = p2;
    } else if (p2.mashCount > p1.mashCount) {
        winner = p2; loser = p1;
    } else {
        // Tie - Sudden Death (random for now if they actually tied perfectly)
        // Usually sudden death is complex, let's just do 1 sec extra
        document.getElementById('fight-countdown').innerText = "+1 SEC SUDDEN DEATH!";
        startFightTimer(); // +1s wait, but actually let's set it to 1s
        fightTimeLeft = 1.0;
        gameState = "fight_active";
        return;
    }

    // Show win message
    document.getElementById('fight-countdown').innerText = `P${winner.id} KAZANDI!`;

    // Trigger cinematic meteor sequence
    playMeteorSequence(loser, winner);
}

function playMeteorSequence(loser, winner) {
    let tx = loser.pivot.position.x;
    let ty = loser.pivot.position.y;
    let tz = loser.pivot.position.z;

    // 1. Zoom camera to loser
    let startCamPos = camera.position.clone();
    let targetCamPos = new THREE.Vector3(tx + 5, ty + 10, tz + 10);
    let startLookAt = currentCamLookAt.clone();
    let targetLookAt = new THREE.Vector3(tx, ty, tz);
    let st = performance.now();

    function focusLoser(time) {
        let pr = Math.min((time - st) / 600, 1);
        let ease = pr < 0.5 ? 2 * pr * pr : 1 - Math.pow(-2 * pr + 2, 2) / 2;
        camera.position.lerpVectors(startCamPos, targetCamPos, ease);
        currentCamLookAt.lerpVectors(startLookAt, targetLookAt, ease);
        camera.lookAt(currentCamLookAt);
        if (pr < 1) requestAnimationFrame(focusLoser);
        else spawnMeteorLogic(tx, ty, tz, loser, winner);
    }
    requestAnimationFrame(focusLoser);
}

function spawnMeteorLogic(tx, ty, tz, loser, winner) {
    // Red pulsing target ring under loser
    let ringGeo = new THREE.RingGeometry(TILE_SIZE * 0.5, TILE_SIZE * 0.7, 32);
    let ringMat = new THREE.MeshBasicMaterial({ color: 0xff0000, transparent: true, side: THREE.DoubleSide, opacity: 0.8 });
    let targetRing = new THREE.Mesh(ringGeo, ringMat);
    targetRing.rotation.x = -Math.PI / 2;
    targetRing.position.set(tx, ty + 0.05, tz);
    boardGroup.add(targetRing);

    // Tremble loser cube and pulse ring
    let isTrembling = true;
    function trembleAnim(time) {
        if (!isTrembling || !loser.pivot) return;
        loser.pivot.position.x = tx + Math.sin(time) * 0.1;
        loser.pivot.position.z = tz + Math.cos(time * 0.8) * 0.1;
        let s = 1.0 + Math.sin(time * 0.01) * 0.3;
        targetRing.scale.set(s, s, s);
        targetRing.material.opacity = 0.5 + Math.sin(time * 0.01) * 0.5;
        requestAnimationFrame(trembleAnim);
    }
    requestAnimationFrame(trembleAnim);

    // Build meteor group (core + trail)
    let meteorGroup = new THREE.Group();
    let core = new THREE.Mesh(
        new THREE.SphereGeometry(TILE_SIZE, 16, 16),
        new THREE.MeshStandardMaterial({ color: 0xff5500, emissive: 0xff3300, emissiveIntensity: 1.0 })
    );
    let trail = new THREE.Mesh(
        new THREE.CylinderGeometry(0.1, TILE_SIZE * 1.5, TILE_SIZE * 8, 12),
        new THREE.MeshBasicMaterial({ color: 0xffaa00, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    trail.position.y = TILE_SIZE * 4;
    meteorGroup.add(core);
    meteorGroup.add(trail);

    let startPos = new THREE.Vector3(tx + 15, ty + 35, tz - 10);
    let endPos = new THREE.Vector3(tx, ty, tz);
    meteorGroup.position.copy(startPos);
    let dir = new THREE.Vector3().subVectors(startPos, endPos).normalize();
    meteorGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    boardGroup.add(meteorGroup);

    // Fall after a short delay (let the player panic)
    let fallSt;
    setTimeout(() => {
        fallSt = performance.now();
        requestAnimationFrame(doFall);
    }, 800);

    function doFall(time) {
        let pr = Math.min((time - fallSt) / 700, 1);
        meteorGroup.position.lerpVectors(startPos, endPos, pr * pr * pr);
        if (pr < 1) requestAnimationFrame(doFall);
        else {
            isTrembling = false;
            boardGroup.remove(targetRing);
            executeImpact(tx, ty, tz, loser, meteorGroup, winner);
        }
    }
}

function executeImpact(tx, ty, tz, loser, meteorGroup, winner) {
    // Squash loser (pancake)
    loser.pivot.position.set(tx, ty, tz);
    loser.pivot.scale.set(1.5, 0.1, 1.5);

    // Camera shake (decreasing magnitude)
    let shakeSt = performance.now();
    function shakeCam(time) {
        let pr = (time - shakeSt) / 800;
        if (pr < 1) {
            let mag = (1 - pr) * 2.0;
            camera.position.x += (Math.random() - 0.5) * mag;
            camera.position.y += (Math.random() - 0.5) * mag;
            requestAnimationFrame(shakeCam);
        }
    }
    requestAnimationFrame(shakeCam);

    // Flash point light
    let flashLight = new THREE.PointLight(0xffddaa, 100, 50);
    flashLight.position.set(tx, ty + 2, tz);
    boardGroup.add(flashLight);

    // Shockwave torus
    let shockwave = new THREE.Mesh(
        new THREE.TorusGeometry(1, 0.4, 8, 32),
        new THREE.MeshBasicMaterial({ color: 0xff2200, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending })
    );
    shockwave.rotation.x = Math.PI / 2;
    shockwave.position.set(tx, ty + 0.1, tz);
    boardGroup.add(shockwave);

    // Animate impact effects out
    let efSt = performance.now();
    function explodeFx(time) {
        let pr = Math.min((time - efSt) / 500, 1);
        flashLight.intensity = 100 * (1 - pr);
        let s = 1 + pr * 15;
        shockwave.scale.set(s, s, s);
        shockwave.material.opacity = 0.8 * (1 - pr);
        meteorGroup.children[0].scale.setScalar(1 - pr);
        meteorGroup.children[1].material.opacity = 0.6 * (1 - pr);

        if (pr < 1) {
            requestAnimationFrame(explodeFx);
        } else {
            boardGroup.remove(flashLight);
            boardGroup.remove(shockwave);
            boardGroup.remove(meteorGroup);
            loser.isAlive = false;
            loser.pivot.visible = false;
            triggerFail(loser, "Evrensel Yaptırım!", false);

            // Full screen Lo Siento Wilson – inject into a SEPARATE div so fight UI HTML is NOT destroyed
            let overlay = document.getElementById('fight-overlay');
            overlay.classList.remove('hidden');

            let wilsonDiv = document.getElementById('wilson-overlay');
            if (!wilsonDiv) {
                wilsonDiv = document.createElement('div');
                wilsonDiv.id = 'wilson-overlay';
                wilsonDiv.style.cssText = `
                    position:absolute;top:0;left:0;right:0;bottom:0;
                    display:flex;align-items:center;justify-content:center;
                    background:rgba(0,0,0,0.85);z-index:9999;
                `;
                document.body.appendChild(wilsonDiv);
            }
            // Process horoz.png to remove white background using offscreen Canvas
            let tmpImg = new Image();
            tmpImg.onload = () => {
                let cvs = document.createElement('canvas');
                cvs.width = tmpImg.naturalWidth;
                cvs.height = tmpImg.naturalHeight;
                let ctx = cvs.getContext('2d');
                ctx.drawImage(tmpImg, 0, 0);

                let imageData = ctx.getImageData(0, 0, cvs.width, cvs.height);
                let d = imageData.data;
                for (let i = 0; i < d.length; i += 4) {
                    let r = d[i], g = d[i+1], b = d[i+2];
                    // Make near-white/grey pixels transparent
                    let brightness = (r + g + b) / 3;
                    if (brightness > 200 && Math.abs(r - g) < 30 && Math.abs(g - b) < 30) {
                        d[i+3] = 0; // fully transparent
                    }
                }
                ctx.putImageData(imageData, 0, 0);

                let cleanSrc = cvs.toDataURL('image/png');
                let imgEl = wilsonDiv.querySelector('img');
                if (imgEl) imgEl.src = cleanSrc;
            };
            tmpImg.src = HOROZ_B64;

            wilsonDiv.innerHTML = `
                <div style="
                    color:#ff0033;font-size:8vw;font-weight:900;
                    text-shadow:0 0 30px #000,0 0 10px #ff0000;
                    text-align:center;animation:popIn 0.5s ease-out forwards;
                    display:flex;flex-direction:column;align-items:center;gap:20px;
                ">
                    <span>🔥 LO SIENTO WILSON!! 🔥</span>
                    <img src="${HOROZ_B64}" style="width:200px;height:auto;filter:drop-shadow(0 0 20px #ff0000);animation:popIn 0.7s ease-out forwards;">
                </div>`;
            wilsonDiv.style.display = 'flex';

            // Play sound based on winner: P1 wins → konusma.mp3, P2 wins → recep.mp3
            let soundFile = (winner && winner.id === 1) ? 'konusma.mp3' : 'recep.mp3';
            let recepAudio = new Audio(soundFile);
            recepAudio.volume = 1.0;
            recepAudio.play().catch(() => {});

            setTimeout(() => {
                recepAudio.pause();
                recepAudio.currentTime = 0;
                wilsonDiv.style.display = 'none';
                endFight();
            }, 3500);
        }
    }
    requestAnimationFrame(explodeFx);
}

function endFight() {
    document.getElementById('fight-overlay').classList.add('hidden');

    // Only start the survival timer if exactly ONE player survived the fight
    let alivePlayers = players.filter(p => p.isAlive).length;
    if (alivePlayers === 1) {
        survivalTimeLeft = 15.0;
        let timerEl = document.getElementById('survival-timer');
        timerEl.classList.remove('hidden');
        timerEl.innerText = `KAÇIŞ: ${survivalTimeLeft.toFixed(1)}`;
        
        clearInterval(survivalTimerInterval);
        survivalTimerInterval = setInterval(() => {
            if (isGameOver || gameState !== "puzzle") return;
            survivalTimeLeft -= 0.1;
            
            if (survivalTimeLeft <= 0) {
                survivalTimeLeft = 0;
                clearInterval(survivalTimerInterval);
                timerEl.classList.add('hidden');
                let winner = players.find(p => p.isAlive);
                let opponent = players.find(p => !p.isAlive);
                if (winner) {
                    gameState = "fight_result"; // freeze input immediately
                    setTimeout(() => playMeteorSequence(winner, opponent), 500);
                }
            } else {
                timerEl.innerText = `KAÇIŞ: ${survivalTimeLeft.toFixed(1)}`;
            }
        }, 100);
    }

    // Immediately unblock the winner so they can move
    gameState = "puzzle";
    players.forEach(p => {
        if (p.isAlive) {
            p.isAnimating = false;
            p.moveQueue = [];
            p.pivot.scale.set(1, 1, 1); // Reset any squash from impact
        }
    });

    // Smoothly return camera to puzzle angle and board center lookAt
    let startCamPos = camera.position.clone();

    let midX = 0; let midZ = 0;
    let activePlayers = players.filter(p => p.isAlive && p.pivot);
    if (activePlayers.length > 0) {
        activePlayers.forEach(p => { midX += p.pivot.position.x; midZ += p.pivot.position.z; });
        midX /= activePlayers.length; midZ /= activePlayers.length;
    } else {
        midX = currentMap[0].length * TILE_SIZE / 2;
        midZ = currentMap.length * TILE_SIZE / 2;
    }
    let targetCamPos = new THREE.Vector3(midX - 8, 12, midZ + 10);

    let startLookAt = currentCamLookAt.clone();
    let targetLookAt = new THREE.Vector3(currentMap[0].length * TILE_SIZE / 2, 0, currentMap.length * TILE_SIZE / 2);

    let st = performance.now();
    function moveCamBack(time) {
        let el = time - st;
        let pr = Math.min(el / 1000, 1);
        let ease = pr < 0.5 ? 2 * pr * pr : 1 - Math.pow(-2 * pr + 2, 2) / 2;

        camera.position.lerpVectors(startCamPos, targetCamPos, ease);
        currentCamLookAt.lerpVectors(startLookAt, targetLookAt, ease);
        camera.lookAt(currentCamLookAt);

        if (pr < 1) requestAnimationFrame(moveCamBack);
    }
    requestAnimationFrame(moveCamBack);
}

// --- Failure & Fall Visuals ---
// --- Failure & Fall Visuals ---
function triggerFail(player, msg, endGame = true) {
    if (isGameOver && endGame) return;

    if (endGame) {
        isGameOver = true;
    }

    // Always stop survival timer if anyone dies
    clearInterval(survivalTimerInterval);
    document.getElementById('survival-timer').classList.add('hidden');

    const fails = ["Bu hamleye kimse hazır değildi.", `P${player.id} elendi.`, "Yine olmadı."];
    let joke = fails[Math.floor(Math.random() * fails.length)];

    showToast(msg + " " + joke);

    if (endGame) {
        // Heboi feature: Dramatic CSS UI spinout on fail
        renderer.domElement.classList.add('canvas-spin-out');
        setTimeout(() => resetLevel(), 1200);
    } else {
        // If the game didn't explicitly end (e.g. one player died in a fight), 
        // we still need to check if ANY players are left alive.
        // If both are dead, we MUST restart the level.
        let alivePlayers = players.filter(p => p.isAlive).length;
        if (alivePlayers === 0) {
            isGameOver = true;
            renderer.domElement.classList.add('canvas-spin-out');
            setTimeout(() => resetLevel(), 1200);
        }
    }
}

function fallAnimation(player) {
    let startY = player.pivot.position.y;
    let startTime = performance.now();

    function drop(time) {
        let el = time - startTime;
        let pr = Math.min(el / config.fallDuration, 1);

        // Gravity accel curve
        player.pivot.position.y = startY - (10 * pr * pr);

        // Tumble
        player.pivot.rotation.x += 0.1;
        player.pivot.rotation.z += 0.05;

        if (pr < 1) requestAnimationFrame(drop);
    }
    requestAnimationFrame(drop);
}


function triggerWin(player) {
    if (isGameOver || !player.isAlive) return;

    // Player reached the hole, clear survival timer
    clearInterval(survivalTimerInterval);
    document.getElementById('survival-timer').classList.add('hidden');

    // Animate falling gracefully exactly into the hole
    let startY = player.pivot.position.y;
    let st = performance.now();
    player.isAnimating = true; // lock player

    function suckIn(time) {
        let el = time - st;
        let pr = Math.min(el / config.fallDuration, 1);
        player.pivot.position.y = startY - (TILE_SIZE * 2 * pr);

        if (pr < 1) {
            requestAnimationFrame(suckIn);
        } else {
            playersInHole++;
            player.pivot.visible = false; // Hide player once fully in

            // Note: Since we have combat, only one player might be left alive
            let alivePlayers = players.filter(p => p.isAlive).length;

            if (config.gameMode === "chaos") {
                isGameOver = true;
                showToast(`P${player.id} KAZANDI! Diğeri ağlıyor.`);
                setTimeout(() => {
                    currentLevelIndex++;
                    loadLevel(currentLevelIndex);
                }, 2000);
            } else {
                // Co-op mode logic or Post-Fight Logic
                if (playersInHole >= alivePlayers) {
                    isGameOver = true;
                    showToast(alivePlayers === 1 ? "Hayatta kalan tek kişi hedefe ulaştı!" : "İnanılmaz! İkiniz de sığdınız.");
                    setTimeout(() => {
                        currentLevelIndex++;
                        playersInHole = 0;
                        loadLevel(currentLevelIndex);
                    }, 2000);
                } else {
                    showToast(`P${player.id} hedefe ulaştı. Diğerini bekliyor...`);
                }
            }
        }
    }
    requestAnimationFrame(suckIn);
}

// --- Utils & Loop ---
// --- Utils & Loop ---
function resetLevel() {
    if (players.some(p => p.isAnimating) && !isGameOver) return; // avoid reset mid regular move
    loadLevel(currentLevelIndex);
}

function updateUI() {
    document.getElementById('levelDisplay').innerText = (currentLevelIndex + 1) + " / " + levels.length;

    // Update P1
    if (players[0]) {
        document.getElementById('p1InputDisplay').innerText = players[0].inputSource;
        let el = document.getElementById('p1-score'); if (el) el.innerText = players[0].score;
        el = document.getElementById('p1-baklava'); if (el) el.innerText = players[0].baklavaCount;
        el = document.getElementById('p1-zurna'); if (el) el.innerText = players[0].zurnaCount;
    }
    // Update P2
    if (players[1]) {
        document.getElementById('p2InputDisplay').innerText = players[1].inputSource;
        let el = document.getElementById('p2-score'); if (el) el.innerText = players[1].score;
        el = document.getElementById('p2-baklava'); if (el) el.innerText = players[1].baklavaCount;
        el = document.getElementById('p2-zurna'); if (el) el.innerText = players[1].zurnaCount;
    }
}

let toastTimeout;
function showToast(msg, duration = 2500) {
    const t = document.getElementById('toastMessage');
    t.innerText = msg;
    t.classList.remove('hidden');
    clearTimeout(toastTimeout);
    if (duration > 0) {
        toastTimeout = setTimeout(() => { t.classList.add('hidden'); }, duration);
    }
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
    requestAnimationFrame(animate);

    pollGamepads();

    // Camera Smoothing Lerp to follow MIDPOINT of both players roughly (or alive ones)
    if (gameState === "puzzle") {
        let activePlayers = players.filter(p => p.isAlive && p.pivot);
        if (activePlayers.length > 0) {
            let midX = 0; let midZ = 0;
            activePlayers.forEach(p => {
                midX += p.pivot.position.x;
                midZ += p.pivot.position.z;
            });
            midX /= activePlayers.length;
            midZ /= activePlayers.length;

            let tX = midX - 8;
            let tZ = midZ + 10;

            camera.position.x += (tX - camera.position.x) * config.cameraLerp * 0.5;
            camera.position.z += (tZ - camera.position.z) * config.cameraLerp * 0.5;
        }
    }

    // Update Collectibles Hover Animation
    let timeRaw = performance.now() * 0.002;
    collectibles.forEach(c => {
        if (!c.collected && c.mesh) {
            // Hover bob only, no rotation
            c.mesh.position.y = c.baseY + Math.sin(timeRaw + c.gridX * 2 + c.gridZ) * 0.2;
        }
    });

    renderer.render(scene, camera);
}

// Ensure execution waits for HTML to fully load
window.onload = init;
