const config = {
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
let blockMesh, pivotGroup;
let boardGroup;
let currentLevelIndex = 0;
let moves = 0;
let isAnimating = false;
let isGameOver = false;

// Input State
let activeInputSource = "Klavye ⌨️";
let moveQueue = [];
let pressedTime = {};
let lastRepeatTime = {};
let heboiReverseActive = false;

// 3D Visual Constants
const TILE_SIZE = 1;

// Block State
let block = {
    x: 0,
    z: 0,
    state: "dik", // "dik", "yatayX", "yatayZ"
};

let currentMap = [];
let tileMeshes = {}; // to store and remove physical tiles later for animations

// --- Levels Data ---
// " ": Empty, "O": Floor, "X": Goal, "F": Fake, "S": Spring, "R": Reverse, "B": Fragile (Nazlı)
const levels = [
    // L1: Classic Introduction
    {
        startPos: { x: 3, z: 3, state: "dik" },
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
    // L2: Narrow Path + Fake Tile -> REVISED: Solvable setup
    {
        startPos: { x: 3, z: 3, state: "dik" },
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
        startPos: { x: 3, z: 3, state: "dik" },
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
        startPos: { x: 3, z: 3, state: "dik" },
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
        startPos: { x: 3, z: 3, state: "dik" },
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
    initInput();
    initGamepad();

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

    pivotGroup = new THREE.Group();
    scene.add(pivotGroup);
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
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);
}

// --- Level Building ---
function loadLevel(index) {
    if (index >= levels.length) {
        showToast("Tebrikler, tüm Heboi seviyeleri bitti!", 5000);
        return;
    }

    // Clear old board
    while (boardGroup.children.length > 0) {
        boardGroup.remove(boardGroup.children[0]);
    }
    if (blockMesh) {
        pivotGroup.remove(blockMesh);
    }
    tileMeshes = {};

    let lvl = levels[index];
    currentMap = lvl.map.map(row => row.split(''));

    // Setup Block internal state
    block.x = lvl.startPos.x;
    block.z = lvl.startPos.z;
    block.state = lvl.startPos.state;

    moves = 0;
    isGameOver = false;
    heboiReverseActive = false;
    isAnimating = false;
    moveQueue = [];

    updateUI();
    buildLevelMesh();
    createBlock();

    // Center camera roughly on board
    let mapW = currentMap[0].length * TILE_SIZE;
    let mapH = currentMap.length * TILE_SIZE;
    camera.position.set(mapW / 2 - 8, 12, mapH / 2 + 10);
    camera.lookAt(mapW / 2, 0, mapH / 2);

    // Reset Canvas Shake/Spin CSS
    const canvas = renderer.domElement;
    canvas.classList.remove('canvas-shake', 'canvas-spin-out');
}

function buildLevelMesh() {
    const geo = new THREE.BoxGeometry(TILE_SIZE * 0.95, TILE_SIZE * 0.2, TILE_SIZE * 0.95);

    const matGoal = new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.5 });

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

function createBlock() {
    const geo = new THREE.BoxGeometry(TILE_SIZE * 0.98, TILE_SIZE * 2, TILE_SIZE * 0.98);
    // Give varying colors/textures for "face" illusion using materials array
    const redMat = new THREE.MeshStandardMaterial({ color: 0xe94560, roughness: 0.4 });
    const faceMat = new THREE.MeshStandardMaterial({ color: 0xff5270 }); // slightly lighter for face

    // Provide face map roughly
    const mats = [redMat, redMat, redMat, redMat, faceMat, faceMat];
    blockMesh = new THREE.Mesh(geo, mats);
    blockMesh.castShadow = true;
    blockMesh.receiveShadow = true;

    pivotGroup.add(blockMesh);
    updateBlockTransform(true); // Snap to start
}

// Transform logical coordinate system to 3D View system
function updateBlockTransform(snap = false) {
    // Determine logical center point based on state
    let cx = block.x * TILE_SIZE;
    let cz = block.z * TILE_SIZE;

    // The rotation for the mesh
    let rotX = 0;
    let rotZ = 0;

    let posY = 0; // vertical offset

    if (block.state === "dik") {
        cx += TILE_SIZE / 2;
        cz += TILE_SIZE / 2;
        posY = TILE_SIZE; // stands 2 units high, center is 1 unit up
        rotX = 0;
        rotZ = 0;
    } else if (block.state === "yatayX") {
        cx += TILE_SIZE; // span 2 horizontal tiles
        cz += TILE_SIZE / 2;
        posY = TILE_SIZE / 2; // Flat height is 1, center is 0.5 up
        rotZ = Math.PI / 2; // laid flat along X
    } else if (block.state === "yatayZ") {
        cx += TILE_SIZE / 2;
        cz += TILE_SIZE;
        posY = TILE_SIZE / 2;
        rotX = Math.PI / 2; // laid flat along Z
    }

    if (snap) {
        pivotGroup.position.set(cx, posY, cz);
        blockMesh.rotation.set(rotX, 0, rotZ);
        // blockMesh relative pos is 0,0,0 inside pivotGroup initially
        blockMesh.position.set(0, 0, 0);
        pivotGroup.rotation.set(0, 0, 0);
    }
    return { cx, posY, cz, rotX, MathPI2: Math.PI / 2 };
}

// --- Input Management (Keyboard & Gamepad) ---
function initInput() {
    document.addEventListener('keydown', (e) => {
        activeInputSource = "Klavye ⌨️";
        let allowed = { "ArrowUp": "up", "w": "up", "ArrowDown": "down", "s": "down", "ArrowLeft": "left", "a": "left", "ArrowRight": "right", "d": "right", "r": "reset" };
        if (allowed[e.key]) {
            if (allowed[e.key] === "reset") resetLevel();
            else queueMove(allowed[e.key]);
        }
    });
}

function initGamepad() {
    window.addEventListener("gamepadconnected", (e) => {
        showToast("Gamepad bağlandı. Kaosa analog giriş yapabiliyorsun.");
        activeInputSource = "Gamepad 🎮";
    });
    window.addEventListener("gamepaddisconnected", (e) => {
        showToast("Gamepad koptu. Şimdi bütün hata sende.");
        activeInputSource = "Klavye ⌨️";
    });
}

function pollGamepad() {
    const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
    if (!gamepads[0]) return;

    const gp = gamepads[0];
    if (activeInputSource !== "Gamepad 🎮") {
        activeInputSource = "Gamepad 🎮";
        document.getElementById('inputSourceDisplay').innerText = activeInputSource;
    }

    // A/Cross: Reset (index 0), Start: Restart game (index 9)
    if (gp.buttons[0] && gp.buttons[0].pressed && !pressedTime["btn0"]) { pressedTime["btn0"] = true; resetLevel(); }
    if (!gp.buttons[0] || !gp.buttons[0].pressed) pressedTime["btn0"] = false;

    if (gp.buttons[9] && gp.buttons[9].pressed && !pressedTime["btn9"]) { pressedTime["btn9"] = true; currentLevelIndex = 0; loadLevel(0); }
    if (!gp.buttons[9] || !gp.buttons[9].pressed) pressedTime["btn9"] = false;

    // Movement: D-Pad (12 up, 13 down, 14 left, 15 right) + Analogs
    let dir = null;

    // Check D-Pad
    if (gp.buttons[12]?.pressed) dir = "up";
    else if (gp.buttons[13]?.pressed) dir = "down";
    else if (gp.buttons[14]?.pressed) dir = "left";
    else if (gp.buttons[15]?.pressed) dir = "right";

    // Check Analog if no D-pad
    if (!dir) {
        let ax = gp.axes[0]; // Left stick X
        let ay = gp.axes[1]; // Left stick Y
        if (ay < -config.deadzone) dir = "up";
        else if (ay > config.deadzone) dir = "down";
        else if (ax < -config.deadzone) dir = "left";
        else if (ax > config.deadzone) dir = "right";
    }

    handleContinuousInput(dir);
}

function handleContinuousInput(dir) {
    let now = Date.now();

    if (dir) {
        if (!pressedTime[dir]) {
            // First press
            pressedTime[dir] = now;
            lastRepeatTime[dir] = now + config.repeatDelay; // Delay before repeat
            queueMove(dir);
        } else if (now >= lastRepeatTime[dir]) {
            // Repeat press
            lastRepeatTime[dir] = now + config.repeatInterval;
            queueMove(dir);
        }

        // Clear other directions so we don't hold two
        ['up', 'down', 'left', 'right'].forEach(otherDir => {
            if (otherDir !== dir) pressedTime[otherDir] = false;
        });
    } else {
        // Clear all movement flags safely when stick returns to center
        ['up', 'down', 'left', 'right'].forEach(d => { pressedTime[d] = false; });
    }
}

// --- Movement & Rolling Mechanics ---
function queueMove(baseDirection) {
    if (isGameOver || isAnimating || moveQueue.length > 1) return;

    let direction = baseDirection;
    if (heboiReverseActive) {
        // Reverse direction map
        let revMap = { "up": "down", "down": "up", "left": "right", "right": "left" };
        direction = revMap[baseDirection];
        heboiReverseActive = false; // expires after 1 move logic
    }

    moveQueue.push(direction);
    processQueue();
}

function processQueue() {
    if (isAnimating || moveQueue.length === 0 || isGameOver) return;

    let direction = moveQueue.shift();
    animateBlockRoll(direction);
}

function animateBlockRoll(direction) {
    isAnimating = true;
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
    let newX = block.x; let newZ = block.z; let newState = block.state;

    if (block.state === "dik") {
        if (direction === "up") { newZ -= 2; newState = "yatayZ"; edgeZ = -TILE_SIZE / 2; axis.set(1, 0, 0); rotAngle = -Math.PI / 2; }
        else if (direction === "down") { newZ += 1; newState = "yatayZ"; edgeZ = TILE_SIZE / 2; axis.set(1, 0, 0); rotAngle = Math.PI / 2; }
        else if (direction === "left") { newX -= 2; newState = "yatayX"; edgeX = -TILE_SIZE / 2; axis.set(0, 0, 1); rotAngle = Math.PI / 2; }
        else if (direction === "right") { newX += 1; newState = "yatayX"; edgeX = TILE_SIZE / 2; axis.set(0, 0, 1); rotAngle = -Math.PI / 2; }
    } else if (block.state === "yatayX") {
        if (direction === "up") { newZ -= 1; edgeZ = -TILE_SIZE / 2; axis.set(1, 0, 0); rotAngle = -Math.PI / 2; }
        else if (direction === "down") { newZ += 1; edgeZ = TILE_SIZE / 2; axis.set(1, 0, 0); rotAngle = Math.PI / 2; }
        else if (direction === "left") { newX -= 1; newState = "dik"; edgeX = -TILE_SIZE; axis.set(0, 0, 1); rotAngle = Math.PI / 2; }
        else if (direction === "right") { newX += 2; newState = "dik"; edgeX = TILE_SIZE; axis.set(0, 0, 1); rotAngle = -Math.PI / 2; }
    } else if (block.state === "yatayZ") {
        if (direction === "up") { newZ -= 1; newState = "dik"; edgeZ = -TILE_SIZE; axis.set(1, 0, 0); rotAngle = -Math.PI / 2; }
        else if (direction === "down") { newZ += 2; newState = "dik"; edgeZ = TILE_SIZE; axis.set(1, 0, 0); rotAngle = Math.PI / 2; }
        else if (direction === "left") { newX -= 1; edgeX = -TILE_SIZE / 2; axis.set(0, 0, 1); rotAngle = Math.PI / 2; }
        else if (direction === "right") { newX += 1; edgeX = TILE_SIZE / 2; axis.set(0, 0, 1); rotAngle = -Math.PI / 2; }
    }

    // Prepare Animation Object Tree
    let startPivotPos = pivotGroup.position.clone();

    // Shift pivot to the edge, but we must shift the blockMesh opposite to keep visually matching BEFORE rotation
    // Shift blockMesh inside the newly offset Pivot
    blockMesh.position.x -= edgeX;
    blockMesh.position.y -= -TILE_SIZE / 2; // bottom edge is always TILE_SIZE/2 down from center
    blockMesh.position.z -= edgeZ;

    // Move pivot to edge corner in world space
    pivotGroup.position.x += edgeX;
    pivotGroup.position.y -= TILE_SIZE / 2;
    pivotGroup.position.z += edgeZ;

    let startTime = performance.now();

    function animateFrame(time) {
        let elapsed = time - startTime;
        let progress = Math.min(elapsed / config.moveDuration, 1);

        // Simple EaseInOutQuad
        let ease = progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;

        // Reset rotation first to avoid accumulation, then set to exact angle
        pivotGroup.setRotationFromAxisAngle(axis, rotAngle * ease);

        if (progress < 1) {
            requestAnimationFrame(animateFrame);
        } else {
            // Apply logical change once animation finishes
            block.x = newX;
            block.z = newZ;
            block.state = newState;

            // Re-snap standard transforms completely
            // It fixes floating point errors and resets hierarchies perfectly
            updateBlockTransform(true);

            // Heboi feature: random wobble/shake
            if (Math.random() < config.wobbleAmount) {
                renderer.domElement.classList.remove("canvas-shake");
                void renderer.domElement.offsetWidth; // trigger reflow
                renderer.domElement.classList.add("canvas-shake");
            }

            evaluateState();
        }
    }

    requestAnimationFrame(animateFrame);
}

// --- Game Logic Checks ---
function getOccupiedCells() {
    let cells = [{ x: block.x, z: block.z }];
    if (block.state === "yatayX") cells.push({ x: block.x + 1, z: block.z });
    else if (block.state === "yatayZ") cells.push({ x: block.x, z: block.z + 1 });
    return cells;
}

function getTile(x, z) {
    if (z < 0 || z >= currentMap.length || x < 0 || x >= currentMap[z].length) return ' ';
    return currentMap[z][x];
}

function evaluateState() {
    let cells = getOccupiedCells();
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
        if (t === 'B' && block.state !== "dik") anyFragileBad = true;
    });

    if (block.state === "dik" && allInHole) {
        triggerWin();
        return;
    }

    if (fullyEmpty || partiallyEmpty || anyFragileBad) {
        triggerFail(anyFragileBad ? "Nazlı zemin o ağırlığı taşıyamaz!" : "Boşluğa düştünüz.");
        // Simulate immediate drop from physics perspective visually
        fallAnimation();
        return;
    }

    checkSpecialTiles(cells);
}

function checkSpecialTiles(cells) {
    let activated = false;
    cells.forEach(c => {
        let t = getTile(c.x, c.z);

        if (t === 'R' && !activated) {
            // Apply reverse for the NEXT user input, show notification
            if (!heboiReverseActive) {
                heboiReverseActive = true;
                showToast("DİKKAT: YÖNLER TERSİNE DÖNDÜ!", 1500);
            }
        }

        if (t === 'S' && !activated) {
            activated = true;
            // Spring push blindly
            setTimeout(() => {
                if (isGameOver) return;
                showToast("BOING!");
                // Force animation directly instead of queueing to avoid input blockage
                animateBlockRoll(Math.random() > 0.5 ? 'right' : 'down');
            }, config.springDelay);
        }

        if (t === 'F' && !activated) {
            activated = true;
            // Fake Delay
            setTimeout(() => {
                if (isGameOver) return;
                let cur = getOccupiedCells();
                // Check if still standing on it
                if (cur.some(cc => cc.x === c.x && cc.z === c.z)) {
                    // Update map internally so it's empty
                    currentMap[c.z][c.x] = ' ';

                    // Fall physical tile away
                    let tMesh = tileMeshes[`${c.x},${c.z}`];
                    if (tMesh) {
                        boardGroup.remove(tMesh);
                    }
                    showToast("Sahte zemindi, kandırdım!");
                    evaluateState(); // Re-eval to trigger fall
                }
            }, config.fakeDelay);
        }
    });

    if (!activated) {
        // Unlock input ONLY if no delayed trap was activated
        isAnimating = false;
        processQueue(); // Catch up on buffered inputs
    }
}

// --- Failure & Fall Visuals ---
function triggerFail(msg) {
    if (isGameOver) return;
    isGameOver = true;

    const fails = ["Bu hamleye kimse hazır değildi.", "Küp değil, sinir testi.", "Yine olmadı."];
    let joke = fails[Math.floor(Math.random() * fails.length)];

    showToast(joke);

    // Heboi feature: Dramatic CSS UI spinout on fail
    renderer.domElement.classList.add('canvas-spin-out');

    setTimeout(() => resetLevel(), 1200);
}

function fallAnimation() {
    let startY = pivotGroup.position.y;
    let startTime = performance.now();

    function drop(time) {
        let el = time - startTime;
        let pr = Math.min(el / config.fallDuration, 1);

        // Gravity accel curve
        pivotGroup.position.y = startY - (10 * pr * pr);

        // Tumble
        pivotGroup.rotation.x += 0.1;
        pivotGroup.rotation.z += 0.05;

        if (pr < 1) requestAnimationFrame(drop);
    }
    requestAnimationFrame(drop);
}

function triggerWin() {
    if (isGameOver) return;
    isGameOver = true;

    // Animate falling gracefully exactly into the hole
    let startY = pivotGroup.position.y;
    let st = performance.now();
    function suckIn(time) {
        let el = time - st;
        let pr = Math.min(el / config.fallDuration, 1);
        pivotGroup.position.y = startY - (TILE_SIZE * 2 * pr);

        if (pr < 1) requestAnimationFrame(suckIn);
        else {
            const wins = ["İnanılmaz ama geçti.", "Tamamen yetenek. Belki.", "Bir sonraki bölümde görüşürüz."];
            showToast(wins[Math.floor(Math.random() * wins.length)]);
            setTimeout(() => {
                currentLevelIndex++;
                loadLevel(currentLevelIndex);
            }, 1000);
        }
    }
    requestAnimationFrame(suckIn);
}

// --- Utils & Loop ---
function resetLevel() {
    if (isAnimating && !isGameOver) return; // avoid reset mid regular move
    loadLevel(currentLevelIndex);
}

function updateUI() {
    document.getElementById('levelDisplay').innerText = currentLevelIndex + 1;
    document.getElementById('moveDisplay').innerText = moves;
    document.getElementById('inputSourceDisplay').innerText = activeInputSource;
}

let toastTimeout;
function showToast(msg, duration = 2000) {
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

    pollGamepad();

    // Camera Smoothing Lerp to follow block roughly (not too aggressive)
    if (pivotGroup && !isGameOver) {
        let tX = pivotGroup.position.x - 8;
        let tZ = pivotGroup.position.z + 10;

        camera.position.x += (tX - camera.position.x) * config.cameraLerp * 0.5;
        camera.position.z += (tZ - camera.position.z) * config.cameraLerp * 0.5;
    }

    renderer.render(scene, camera);
}

// Ensure execution waits for HTML to fully load
window.onload = init;
