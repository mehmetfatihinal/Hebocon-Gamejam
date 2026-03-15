const fs = require('fs');

// Stub out browser globals
global.window = {
    addEventListener: () => {},
    innerWidth: 800,
    innerHeight: 600
};
global.document = {
    addEventListener: () => {},
    getElementById: () => ({ innerText: '', classList: { remove: ()=>{}, add: ()=>{} }, appendChild: ()=>{} }),
    createElement: () => ({ getContext: () => ({ fillRect: ()=>{}, beginPath: ()=>{}, moveTo: ()=>{}, lineTo: ()=>{}, fill: ()=>{}, arc: ()=>{}, stroke: ()=>{} }) })
};
global.navigator = { getGamepads: () => [] };
global.requestAnimationFrame = () => {};
global.performance = { now: () => 0 };

global.THREE = {
    Scene: class {},
    PerspectiveCamera: class { position={set:()=>{}}; lookAt=()=>{}; },
    Group: class { children=[]; add=()=>{}; remove=()=>{}; position={set:()=>{}, clone:()=>({x:0,y:0,z:0})}; rotation={set:()=>{}}; setRotationFromAxisAngle=()=>{};},
    Color: class {},
    AmbientLight: class {},
    DirectionalLight: class { position={set:()=>{}}; shadow={camera:{}, mapSize:{}}; },
    WebGLRenderer: class { setSize=()=>{}; domElement={classList:{remove:()=>{}, add:()=>{}}}; capabilities={getMaxAnisotropy:()=>1}; shadowMap={}; render=()=>{}; },
    BoxGeometry: class {},
    MeshStandardMaterial: class {},
    Mesh: class { position={set:()=>{}}; rotation={set:()=>{}}; scale={}; },
    Vector3: class { set=()=>{}; },
    CanvasTexture: class { },
    LinearMipmapLinearFilter: 1,
    PCFSoftShadowMap: 1
};

const code = fs.readFileSync('game.js', 'utf8');

global.showToast = (msg) => console.log("TOAST:", msg);
global.fallAnimation = (p) => console.log("FALL ANIMATION CALLED ON P" + p.id);
global.triggerFail = (p, msg) => console.log("FAIL CALLED P" + p.id, msg);

eval(code.replace('window.onload = init;', 'init();'));

console.log("P1 pos:", players[0].x, players[0].z, "State:", players[0].state);
console.log("P2 pos:", players[1].x, players[1].z, "State:", players[1].state);
console.log("P1 mesh exists:", !!players[0].mesh);
console.log("P2 mesh exists:", !!players[1].mesh);
console.log("Game setup complete. Did anything fall?");

