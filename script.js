// --- CONFIGURATION ---
const videoElement = document.querySelector('.input_video');
const statMains = document.getElementById('stat-mains');
const statZoom = document.getElementById('stat-zoom');
const statEtat = document.getElementById('stat-etat');

let scene, camera, renderer, object3D, voronoiShaderMaterial;
let isLeftHandClosed = false;
let smoothDeformation = 0;
let rightPinchValue = 0.1; // Distance initiale neutre
let smoothScale = 1.0;

// Squelettes 3D
let jointsLeft = [], bonesLeft = [];
let jointsRight = [], bonesRight = [];
const CONNECTIONS = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];

// ==========================================
// --- INITIALISATION THREE.JS ---
// ==========================================
function init3D() {
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = 5;

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    document.getElementById('canvas-container').appendChild(renderer.domElement);

    // 1. DÉFINITION DU SHADER
    voronoiShaderMaterial = new THREE.ShaderMaterial({
        uniforms: {
            time: { value: 0 },
            deformation: { value: 0 }
        },
        vertexShader: `
            uniform float time;
            uniform float deformation;
            varying float vNoise;
            float hash(float n) { return fract(sin(n) * 43758.5453); }
            float noise(vec3 x) {
                vec3 p = floor(x); vec3 f = fract(x);
                f = f*f*(3.0-2.0*f);
                float n = p.x + p.y*57.0 + 113.0*p.z;
                return mix(mix(mix(hash(n+0.0),hash(n+1.0),f.x),mix(hash(n+57.0),hash(n+58.0),f.x),f.y),
                           mix(mix(hash(n+113.0),hash(n+114.0),f.x),mix(hash(n+170.0),hash(n+171.0),f.x),f.y),f.z);
            }
            void main() {
                vNoise = noise(position * 2.0 + time * 0.5);
                vec3 newPos = position + normal * vNoise * deformation * 1.5;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(newPos, 1.0);
            }
        `,
        fragmentShader: `
            uniform float deformation;
            varying float vNoise;
            void main() {
                vec3 color1 = vec3(0.0, 1.0, 0.8);
                vec3 color2 = vec3(0.5, 0.0, 1.0);
                gl_FragColor = vec4(mix(color1, color2, deformation * (vNoise + 0.5)), 1.0);
            }
        `,
        wireframe: true
    });

    // 2. CHARGEMENT DE L'OBJET GLB
    const loader = new THREE.GLTFLoader();
    loader.load('conifer_cone.glb', function (gltf) {
        object3D = gltf.scene;
        object3D.traverse((child) => {
            if (child.isMesh) child.material = voronoiShaderMaterial;
        });
        scene.add(object3D);
        console.log("Modèle chargé !");
    }, undefined, function (error) {
        console.error("Erreur chargement, fallback sphère", error);
        object3D = new THREE.Mesh(new THREE.IcosahedronGeometry(1.5, 32), voronoiShaderMaterial);
        scene.add(object3D);
    });

    // 3. CRÉATION DES MAINS
    const jointGeo = new THREE.SphereGeometry(0.05, 8, 8);
    const matL = new THREE.MeshBasicMaterial({ color: 0xff00cc, transparent: true, opacity: 0.5 });
    const matR = new THREE.MeshBasicMaterial({ color: 0x00ffcc, transparent: true, opacity: 0.5 });
    const boneMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.2 });

    for (let i = 0; i < 21; i++) {
        let sL = new THREE.Mesh(jointGeo, matL); sL.visible = false; jointsLeft.push(sL); scene.add(sL);
        let sR = new THREE.Mesh(jointGeo, matR); sR.visible = false; jointsRight.push(sR); scene.add(sR);
    }
    CONNECTIONS.forEach(() => {
        let bL = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), boneMat);
        let bR = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), boneMat);
        bL.visible = false; bR.visible = false; bonesLeft.push(bL); bonesRight.push(bR); scene.add(bL); scene.add(bR);
    });

    window.addEventListener('resize', onWindowResize);
}

// ==========================================
// --- LOGIQUE IA ---
// ==========================================
function onResults(results) {
    [...jointsLeft, ...bonesLeft, ...jointsRight, ...bonesRight].forEach(obj => obj.visible = false);

    if (results.multiHandLandmarks && results.multiHandedness) {
        const spanMains = statMains.querySelector('.stat-val');
        if(spanMains) spanMains.innerText = results.multiHandLandmarks.length;

        for (let i = 0; i < results.multiHandLandmarks.length; i++) {
            const landmarks = results.multiHandLandmarks[i];
            const isRightHand = results.multiHandedness[i].label === 'Right';

            if (isRightHand) {
                updateHandVisuals(landmarks, jointsRight, bonesRight);

                // LOGIQUE WORLD COORDINATES (STABLE)
                if (results.multiHandWorldLandmarks && results.multiHandWorldLandmarks[i]) {
                    const worldLM = results.multiHandWorldLandmarks[i];
                    const dx = worldLM[8].x - worldLM[4].x;
                    const dy = worldLM[8].y - worldLM[4].y;
                    const dz = worldLM[8].z - worldLM[4].z;
                    rightPinchValue = Math.sqrt(dx*dx + dy*dy + dz*dz);
                    
                    const spanZoom = statZoom.querySelector('.stat-val');
                    if(spanZoom) spanZoom.innerText = (rightPinchValue * 100).toFixed(1);
                }

                if (object3D) {
                    object3D.rotation.y = (landmarks[9].x - 0.5) * 4;
                    object3D.rotation.x = (landmarks[9].y - 0.5) * 2;
                }
            } else {
                updateHandVisuals(landmarks, jointsLeft, bonesLeft);
                const dPoing = Math.sqrt(Math.pow(landmarks[12].x - landmarks[0].x, 2) + Math.pow(landmarks[12].y - landmarks[0].y, 2));
                isLeftHandClosed = dPoing < 0.35;
                const spanEtat = statEtat.querySelector('.stat-val');
                if(spanEtat) spanEtat.innerText = isLeftHandClosed ? "FERME" : "OUVERT";
            }
        }
    }
}

function updateHandVisuals(landmarks, jointList, boneList) {
    landmarks.forEach((lm, i) => {
        jointList[i].position.set((lm.x - 0.5) * 8, -(lm.y - 0.5) * 6, -lm.z * 5);
        jointList[i].visible = true;
    });
    CONNECTIONS.forEach((conn, i) => {
        boneList[i].geometry.setFromPoints([jointList[conn[0]].position, jointList[conn[1]].position]);
        boneList[i].visible = true;
    });
}

// ==========================================
// --- ANIMATION ---
// ==========================================
function animate() {
    requestAnimationFrame(animate);

    smoothDeformation += ((isLeftHandClosed ? 1.0 : 0.0) - smoothDeformation) * 0.1;
    
    // On multiplie par 25 car les coordonnées World sont en mètres (pincé ~ 0.02, ouvert ~ 0.12)
    const targetScale = Math.max(0.2, rightPinchValue * 25);
    smoothScale += (targetScale - smoothScale) * 0.1;

    if (object3D) {
        object3D.scale.set(smoothScale, smoothScale, smoothScale);
        voronoiShaderMaterial.uniforms.time.value += 0.02;
        voronoiShaderMaterial.uniforms.deformation.value = smoothDeformation;
    }
    renderer.render(scene, camera);
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

init3D();
animate();

const hands = new Hands({locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`});
hands.setOptions({ maxNumHands: 2, modelComplexity: 1, minDetectionConfidence: 0.6, minTrackingConfidence: 0.6 });
hands.onResults(onResults);

const cameraApp = new Camera(videoElement, {
    onFrame: async () => { await hands.send({image: videoElement}); },
    width: 1280, height: 720
});
cameraApp.start();
