const videoElement = document.querySelector('.input_video');
const container = document.getElementById('canvas-container');

let scene, camera, renderer, object3D, voronoiShaderMaterial;
let smoothDeformation = 0;
let isHandClosed = false;

// VARIABLES POUR LA MAIN 3D
let handGroup3D; // Conteneur pour tous les points et lignes de la main
const handJoints3D = []; // Stockage des sphères (articulations)
const handBones3D = []; // Stockage des lignes (os)

// Constante MediaPipe pour savoir comment connecter les joints
const HAND_PALM_CONNECTIONS = [[0,1], [0,5], [9,13], [13,17], [5,9], [0,17]];
const HAND_THUMB_CONNECTIONS = [[1,2], [2,3], [3,4]];
const HAND_INDEX_FINGER_CONNECTIONS = [[5,6], [6,7], [7,8]];
const HAND_MIDDLE_FINGER_CONNECTIONS = [[9,10], [10,11], [11,12]];
const HAND_RING_FINGER_CONNECTIONS = [[13,14], [14,15], [15,16]];
const HAND_PINKY_FINGER_CONNECTIONS = [[17,18], [18,19], [19,20]];
const ALL_CONNECTIONS = [...HAND_PALM_CONNECTIONS, ...HAND_THUMB_CONNECTIONS, ...HAND_INDEX_FINGER_CONNECTIONS, ...HAND_MIDDLE_FINGER_CONNECTIONS, ...HAND_RING_FINGER_CONNECTIONS, ...HAND_PINKY_FINGER_CONNECTIONS];

// ==========================================
// --- INITIALISATION THREE.JS (CORRIGÉE) ---
// ==========================================
function init3D() {
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    // On recule la caméra pour voir toute la scène
    camera.position.z = 6;

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);

    // 1. L'OBJET DÉFORMABLE
    const geometry = new THREE.IcosahedronGeometry(1.5, 32);
    voronoiShaderMaterial = new THREE.ShaderMaterial({
        uniforms: {
            time: { value: 0.0 },
            deformation: { value: 0.0 }
        },
        vertexShader: `
            uniform float time;
            uniform float deformation;
            varying float vNoise;
            varying vec3 vPosition;

            float hash(float n) { return fract(sin(n) * 43758.5453123); }
            float noise(vec3 x) {
                vec3 p = floor(x); vec3 f = fract(x);
                f = f*f*(3.0-2.0*f);
                float n = p.x + p.y*57.0 + 113.0*p.z;
                return mix(mix(mix( hash(n+0.0), hash(n+1.0), f.x),
                                mix( hash(n+57.0), hash(n+58.0), f.x), f.y),
                            mix(mix( hash(n+113.0), hash(n+114.0), f.x),
                                mix( hash(n+170.0), hash(n+171.0), f.x), f.y), f.z);
            }

            void main() {
                vNoise = noise(position * 2.0 + time);
                vPosition = position;
                vec3 newPosition = position + normal * vNoise * deformation * 1.5;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(newPosition, 1.0);
            }
        `,
        fragmentShader: `
            uniform float deformation;
            varying float vNoise;
            varying vec3 vPosition;
            void main() {
                vec3 colorSmooth = vec3(0.0, 0.9, 0.7); // Turquoise
                vec3 colorDeformed = vec3(0.1, 0.0, 0.4); // Bleu sombre
                
                // Mélange de couleur basé sur la déformation et la position
                vec3 baseColor = mix(colorSmooth, colorDeformed, deformation);
                // Ajoute de la texture Voronoi
                vec3 finalColor = mix(baseColor, vec3(0.0), vNoise * deformation);
                
                gl_FragColor = vec4(finalColor, 1.0);
            }
        `,
        wireframe: true
    });
    object3D = new THREE.Mesh(geometry, voronoiShaderMaterial);
    scene.add(object3D);

    // 2. CRÉATION DE LA MAIN 3D
    handGroup3D = new THREE.Group();
    scene.add(handGroup3D);

    // Matériau commun pour les articulations
    const jointMaterial = new THREE.MeshBasicMaterial({ color: 0x00ffcc, transparent: true, opacity: 0.7 });
    const jointGeometry = new THREE.SphereGeometry(0.08, 8, 8);

    // Créer les 21 articulations
    for (let i = 0; i < 21; i++) {
        const joint = new THREE.Mesh(jointGeometry, jointMaterial);
        handJoints3D.push(joint);
        handGroup3D.add(joint);
    }

    // Matériau commun pour les os (lignes)
    const boneMaterial = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.3 });

    // Créer les lignes de connexion
    ALL_CONNECTIONS.forEach(() => {
        const boneGeometry = new THREE.BufferGeometry();
        // On initialise avec des points vides, on les remplira plus tard
        boneGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
        const bone = new THREE.Line(boneGeometry, boneMaterial);
        handBones3D.push(bone);
        handGroup3D.add(bone);
    });

    // Ajuster lors du redimensionnement
    window.addEventListener('resize', onWindowResize, false);
}

// ==========================================
// --- LOGIQUE DE DÉTECTION (MEDIAPIPE) ---
// ==========================================
function onResults(results) {
    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        const handLandmarks = results.multiHandLandmarks[0];
        
        // 1. Mettre à jour la main 3D
        updateHand3D(handLandmarks);

        // 2. Détecter le poing fermé
        const wrist = handLandmarks[0];
        const middleTip = handLandmarks[12];
        const dist = Math.sqrt(
            Math.pow(middleTip.x - wrist.x, 2) +
            Math.pow(middleTip.y - wrist.y, 2) +
            Math.pow(middleTip.z - wrist.z, 2)
        );
        isHandClosed = (dist < 0.35); // Seuil de détection

        // 3. Rotation de l'objet selon la position de la main (plus stable)
        // handLandmarks[9] est le centre de la paume
        object3D.rotation.y = (handLandmarks[9].x - 0.5) * Math.PI;
        object3D.rotation.x = (handLandmarks[9].y - 0.5) * Math.PI / 2;
    }
}

// --- Fonction pour mettre à jour les positions de la main 3D ---
function updateHand3D(landmarks) {
    // 1. Mettre à jour les articulations (sphères)
    landmarks.forEach((landmark, i) => {
        // MediaPipe fournit X,Y entre 0 et 1. On doit le mapper sur notre scène 3D.
        // On multiplie par 8 pour donner de l'amplitude
        const x3D = (landmark.x - 0.5) * 8;
        const y3D = -(landmark.y - 0.5) * 6; // Y est inversé dans Three.js
        const z3D = -landmark.z * 5; // La profondeur (Z) est souvent inversée

        handJoints3D[i].position.set(x3D, y3D, z3D);
    });

    // 2. Mettre à jour les os (lignes)
    ALL_CONNECTIONS.forEach((connection, i) => {
        const startJoint = handJoints3D[connection[0]];
        const endJoint = handJoints3D[connection[1]];
        
        const bone = handBones3D[i];
        const positions = bone.geometry.attributes.position.array;

        // Point de départ de la ligne
        positions[0] = startJoint.position.x;
        positions[1] = startJoint.position.y;
        positions[2] = startJoint.position.z;

        // Point d'arrivée de la ligne
        positions[3] = endJoint.position.x;
        positions[4] = endJoint.position.y;
        positions[5] = endJoint.position.z;

        bone.geometry.attributes.position.needsUpdate = true; // Crucial pour queThree.js redessine
    });
}

// ==========================================
// --- BOUCLE D'ANIMATION ---
// ==========================================
function animate() {
    requestAnimationFrame(animate);
    
    // Transition fluide de la déformation
    const targetDef = isHandClosed ? 1.0 : 0.0;
    smoothDeformation += (targetDef - smoothDeformation) * 0.1; // 0.1 = vitesse de transition

    // Mettre à jour les uniformes du shader
    voronoiShaderMaterial.uniforms.time.value += 0.02;
    voronoiShaderMaterial.uniforms.deformation.value = smoothDeformation;
    
    // Rendu de la scène
    if (renderer && scene && camera) {
        renderer.render(scene, camera);
    }
}

// --- Fonctions utilitaires ---
function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// --- INITIALISATION FINALE ---
init3D();
animate();

// --- Configuration MediaPipe ---
const hands = new Hands({ locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}` });
hands.setOptions({ maxNumHands: 1, modelComplexity: 1, minDetectionConfidence: 0.7, minTrackingConfidence: 0.7 });
hands.onResults(onResults);
const cameraMediaPipe = new Camera(videoElement, {
    onFrame: async () => { await hands.send({image: videoElement}); },
    width: 1280, height: 720
});
cameraMediaPipe.start();
