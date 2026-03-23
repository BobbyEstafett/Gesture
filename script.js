// --- INITIALISATION DES VARIABLES ---
const videoElement = document.querySelector('.input_video');
const statMains = document.getElementById('stat-mains');
const statZoom = document.getElementById('stat-zoom');
const statEtat = document.getElementById('stat-etat');

let scene, camera, renderer, object3D, voronoiShaderMaterial;

// États lissés pour l'animation
let isLeftHandClosed = false;
let smoothDeformation = 0; // 0 (lisse) à 1 (Voronoi)
let rightPinchValue = 0.15; // Distance pince brute (0.02 à 0.3)
let smoothScale = 1.0; // Échelle finale de l'objet

// Listes pour stocker les 2 squelettes 3D
let jointsLeft = [], bonesLeft = [];
let jointsRight = [], bonesRight = [];

// Structure de connexion des os
const CONNECTIONS = [
    [0,1],[1,2],[2,3],[3,4], // Pouce
    [0,5],[5,6],[6,7],[7,8], // Index
    [5,9],[9,10],[10,11],[11,12], // Majeur
    [9,13],[13,14],[14,15],[15,16], // Annulaire
    [13,17],[17,18],[18,19],[19,20],[0,17] // Auriculaire + Paume
];

// ==========================================
// --- INITIALISATION THREE.JS (LE MONDE 3D) ---
// ==========================================
function init3D() {
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 0, 5); // Caméra centrée

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    document.getElementById('canvas-container').appendChild(renderer.domElement);

    // --- L'OBJET INTERACTIF ---
    const geo = new THREE.IcosahedronGeometry(1.5, 40);
    voronoiShaderMaterial = new THREE.ShaderMaterial({
        uniforms: {
            time: { value: 0 },
            deformation: { value: 0 } // Contrôlé par Main Gauche
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
                vNoise = noise(position * 2.5 + time * 0.5);
                vec3 newPos = position + normal * vNoise * deformation * 1.6;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(newPos, 1.0);
            }
        `,
        fragmentShader: `
            uniform float deformation;
            varying float vNoise;
            void main() {
                vec3 color1 = vec3(0.0, 1.0, 0.8); // Turquoise
                vec3 color2 = vec3(0.5, 0.0, 1.0); // Violet
                // Utilisation correcte de gl_FragColor
                gl_FragColor = vec4(mix(color1, color2, deformation * (vNoise + 0.5)), 1.0);
            }
        `,
        wireframe: true
    });
    object3D = new THREE.Mesh(geo, voronoiShaderMaterial);
    scene.add(object3D);

    // --- CRÉATION DES SQUELETTES ---
    const jointGeo = new THREE.SphereGeometry(0.05, 10, 10);
    
    // Matériaux distincts pour différencier les mains
    const matLeft = new THREE.MeshBasicMaterial({ color: 0xff00cc, transparent: true, opacity: 0.6 }); // Rose
    const matRight = new THREE.MeshBasicMaterial({ color: 0x00ffcc, transparent: true, opacity: 0.6 }); // Cyan
    const boneMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.2 });

    // Générer 21 joints + os pour Gauche
    for (let i = 0; i < 21; i++) {
        const s = new THREE.Mesh(jointGeo, matLeft); s.visible = false;
        jointsLeft.push(s); scene.add(s);
    }
    CONNECTIONS.forEach(() => {
        const bGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
        const line = new THREE.Line(bGeo, boneMat); line.visible = false;
        bonesLeft.push(line); scene.add(line);
    });

    // Générer 21 joints + os pour Droite
    for (let i = 0; i < 21; i++) {
        const s = new THREE.Mesh(jointGeo, matRight); s.visible = false;
        jointsRight.push(s); scene.add(s);
    }
    CONNECTIONS.forEach(() => {
        const bGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
        const line = new THREE.Line(bGeo, boneMat); line.visible = false;
        bonesRight.push(line); scene.add(line);
    });

    window.addEventListener('resize', onWindowResize);
}

// ==========================================
// --- LOGIQUE MEDIAPIPE (DÉTECTION IA) ---
// ==========================================
function onResults(results) {
    // Cacher les squelettes par défaut
    [...jointsLeft, ...bonesLeft, ...jointsRight, ...bonesRight].forEach(obj => obj.visible = false);

    // Sécurité : On vérifie si les éléments UI existent
    const valMains = statMains ? statMains.querySelector('.stat-val') : null;
    const valZoom = statZoom ? statZoom.querySelector('.stat-val') : null;
    const valEtat = statEtat ? statEtat.querySelector('.stat-val') : null;

    if (results.multiHandLandmarks && results.multiHandedness) {
        if (valMains) valMains.innerText = results.multiHandLandmarks.length;

        for (let i = 0; i < results.multiHandLandmarks.length; i++) {
            const landmarks = results.multiHandLandmarks[i];
            // "Left" et "Right" sont inversés à cause de l'effet miroir de la webcam
            const isRightHand = results.multiHandedness[i].label === 'Right';

            if (isRightHand) {
                updateHandVisuals(landmarks, jointsRight, bonesRight);
                const dx = landmarks[8].x - landmarks[4].x;
                const dy = landmarks[8].y - landmarks[4].y;
                rightPinchValue = Math.sqrt(dx*dx + dy*dy);
                if (valZoom) valZoom.innerText = (rightPinchValue * 10).toFixed(2);
                
                object3D.rotation.y = (landmarks[9].x - 0.5) * 4;
                object3D.rotation.x = (landmarks[9].y - 0.5) * 2;
            } else {
                updateHandVisuals(landmarks, jointsLeft, bonesLeft);
                const dPoing = Math.sqrt(
                    Math.pow(landmarks[12].x - landmarks[0].x, 2) +
                    Math.pow(landmarks[12].y - landmarks[0].y, 2)
                );
                isLeftHandClosed = dPoing < 0.35;
                if (valEtat) valEtat.innerText = isLeftHandClosed ? "FERME" : "OUVERT";
            }
        }
    } else {
        if (valMains) valMains.innerText = "0";
    }
}

// --- Fonction utilitaire pour mettre à jour les positions d'un squelette ---
function updateHandVisuals(landmarks, jointList, boneList) {
    // 1. Positionner les joints (sphères)
    landmarks.forEach((lm, i) => {
        // Mapping X,Y (0 à 1) vers coordonnées Three.js (-4 à 4 / -3 à 3)
        const x = (lm.x - 0.5) * 8;
        const y = -(lm.y - 0.5) * 6; // Y inversé dans Three.js
        const z = -lm.z * 5; // La profondeur
        jointList[i].position.set(x, y, z);
        jointList[i].visible = true;
    });

    // 2. Mettre à jour les os (lignes de connexion)
    CONNECTIONS.forEach((conn, i) => {
        const p1 = jointList[conn[0]].position;
        const p2 = jointList[conn[1]].position;
        boneList[i].geometry.setFromPoints([p1, p2]);
        boneList[i].visible = true;
    });
}

// ==========================================
// --- BOUCLE D'ANIMATION (UPDATE & RENDER) ---
// ==========================================
function animate() {
    requestAnimationFrame(animate);

    // 1. Lissage de la déformation (Main Gauche)
    const targetDef = isLeftHandClosed ? 1.0 : 0.0;
    smoothDeformation += (targetDef - smoothDeformation) * 0.1; // Vitesse de transition

    // 2. Lissage du Zoom (Main Droite)
    // On mappe la distance de pincement brute (varie de ~0.02 à ~0.3)
    // vers une échelle d'objet (0.5 à 4.0)
    const targetScale = Math.max(0.3, 0.5 + (rightPinchValue * 12));
    smoothScale += (targetScale - smoothScale) * 0.1;

    // 3. Appliquer les états lissés à l'objet
    if (object3D) {
        object3D.scale.set(smoothScale, smoothScale, smoothScale);
        voronoiShaderMaterial.uniforms.time.value += 0.02; // Vitesse d'animation du Voronoi
        voronoiShaderMaterial.uniforms.deformation.value = smoothDeformation;
    }

    renderer.render(scene, camera);
}

// --- Utilitaires ---
function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// ==========================================
// --- INITIALISATION FINALE ---
// ==========================================
init3D();
animate();

// Configuration MediaPipe Hands (Vérifiée pour HTTPS)
const hands = new Hands({locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`});
hands.setOptions({
    maxNumHands: 2, // <--- Crucial pour 2 mains
    modelComplexity: 1, // Léger pour de meilleures perfs
    minDetectionConfidence: 0.6,
    minTrackingConfidence: 0.6
});
hands.onResults(onResults);

// Lancement caméra (Vérifié pour playsinline)
const cameraApp = new Camera(videoElement, {
    onFrame: async () => { await hands.send({image: videoElement}); },
    width: 1280, height: 720
});
cameraApp.start().then(() => statusElement.innerText = "Système double mains prêt.");
