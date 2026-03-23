// ==========================================
// --- CONFIGURATION INITIALE & VARIABLES ---
// ==========================================
const videoElement = document.querySelector('.input_video');
const container = document.getElementById('canvas-container');

let scene, camera, renderer, object3D, voronoiShaderMaterial;
let smoothDeformation = 0; // Entre 0 (lisse) et 1 (Voronoi complet)
let isHandClosed = false;

// ==========================================
// --- INITIALISATION THREE.JS (LE MONDE 3D) ---
// ==========================================
function init3D() {
    // 1. Scène et Caméra
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = 5;

    // 2. Renderer (Moteur de rendu)
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);

    // 3. L'Objet (Une sphère avec beaucoup de subdivisions pour se déformer)
    const geometry = new THREE.IcosahedronGeometry(1.5, 30); // 30 subdivisions

    // 4. LE SHADER (Le 'Deformer' Voronoi)
    // C'est ici que réside la complexité. Voici une version très simplifiée.
    voronoiShaderMaterial = new THREE.ShaderMaterial({
        uniforms: {
            time: { value: 0.0 },
            deformation: { value: 0.0 } // 0 à 1, contrôlé par la main
        },
        // Vertex Shader : modifie la position des points (Voronoi simplifié par Noise)
        vertexShader: `
            uniform float time;
            uniform float deformation;
            varying vec2 vUv;
            varying float vNoise;

            // Simple noise function for deformation (pseudo-Voronoi)
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
                vUv = uv;
                // Génère une déformation basée sur la position et le temps
                vNoise = noise(position * 3.0 + time * 0.5);
                
                // Aplique la déformation seulement si deformation > 0
                vec3 newPosition = position + normal * vNoise * deformation * 0.8;
                
                gl_Position = projectionMatrix * modelViewMatrix * vec4(newPosition, 1.0);
            }
        `,
        // Fragment Shader : modifie la couleur des pixels
        fragmentShader: `
            uniform float deformation;
            varying float vNoise;
            
            void main() {
                // Change de couleur du turquoise (lisse) au bleu sombre (déformé)
                vec3 colorSmooth = vec3(0.0, 1.0, 0.8);
                vec3 colorDeformed = vec3(0.1, 0.2, 0.5);
                
                vec3 finalColor = mix(colorSmooth, colorDeformed, deformation * (vNoise + 0.5));
                
                gl_Position = vec4(finalColor, 1.0);
            }
        `,
        wireframe: true // On l'affiche en fil de fer pour mieux voir la déformation
    });

    object3D = new THREE.Mesh(geometry, voronoiShaderMaterial);
    scene.add(object3D);

    // Ajuster lors du redimensionnement de la fenêtre
    window.addEventListener('resize', onWindowResize, false);
}

// ==========================================
// --- LOGIQUE DE DÉTECTION DE GESTE (MEDIAPIPE) ---
// ==========================================
function onResults(results) {
    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        const hand = results.multiHandLandmarks[0];
        
        // 1. Détecter si la main est fermée (poing)
        // On calcule la distance entre le poignet (0) et le bout des doigts
        const wrist = hand[0];
        const indexTip = hand[8];
        const dist = Math.sqrt(Math.pow(indexTip.x - wrist.x, 2) + Math.pow(indexTip.y - wrist.y, 2));
        
        // Si la distance est faible, on considère la main fermée (0.2 est un seuil arbitraire)
        isHandClosed = (dist < 0.25);
    }
}

// ==========================================
// --- BOUCLE D'ANIMATION (UPDATE & RENDER) ---
// ==========================================
function animate() {
    requestAnimationFrame(animate);
    
    // 1. Lissage de la déformation (Lerp)
    const targetDeformation = isHandClosed ? 1.0 : 0.0;
    smoothDeformation += (targetDeformation - smoothDeformation) * 0.05; // 0.05 = vitesse de transition

    // 2. Mettre à jour les uniformes du Shader
    voronoiShaderMaterial.uniforms.time.value += 0.01;
    voronoiShaderMaterial.uniforms.deformation.value = smoothDeformation;
    
    // 3. Faire tourner l'objet pour voir la 3D
    if (object3D) {
        object3D.rotation.y += 0.005;
        object3D.rotation.x += 0.002;
    }

    // 4. Rendu de la scène
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
hands.setOptions({ maxNumHands: 1, modelComplexity: 1, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
hands.onResults(onResults);
const cameraMediaPipe = new Camera(videoElement, {
    onFrame: async () => { await hands.send({image: videoElement}); },
    width: 1280, height: 720
});
cameraMediaPipe.start();
