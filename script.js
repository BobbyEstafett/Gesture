// ==========================================
// --- CONFIGURATION & GLOBALES ---
// ==========================================
const videoElement = document.querySelector('.input_video');
const lStat = document.getElementById('l-stat');
const rStat = document.getElementById('r-stat');

let scene, camera, renderer, object3D, voronoiShaderMaterial, pointLight;

// États lissés pour l'animation
let smoothDeformation = 0;
let isLeftHandClosed = false;
let lightTargetPos = new THREE.Vector3(0, 0, 3); // Position cible de la lumière

// Joints simples pour la visualisation des mains
let jointsLeft = [], jointsRight = [];

// ==========================================
// --- INITIALISATION THREE.JS (LE MONDE 3D) ---
// ==========================================
function init3D() {
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = 5;

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    document.getElementById('canvas-container').appendChild(renderer.domElement);

    // 1. LUMIÈRES
    // Lumière torche contrôlée par la main droite
    pointLight = new THREE.PointLight(0x00ffff, 3, 15);
    pointLight.position.set(0, 0, 3);
    scene.add(pointLight);
    // Lumière d'ambiance pour les zones d'ombre
    scene.add(new THREE.AmbientLight(0xffffff, 0.2));

    // 2. SHADER DYNAMIQUE (Hologramme Solide avec Grille)
    voronoiShaderMaterial = new THREE.ShaderMaterial({
        uniforms: {
            time: { value: 0 },
            deformation: { value: 0 },
            lightPos: { value: new THREE.Vector3(0, 0, 3) } // Uniform pour le shader
        },
        vertexShader: `
            uniform float time;
            uniform float deformation;
            varying float vNoise;
            varying vec3 vNormal;
            varying vec3 vPosition;
            varying vec2 vUv;

            // Fonction de bruit de base (Voronoi simplifié)
            float hash(float n) { return fract(sin(n) * 43758.5453); }
            float noise(vec3 x) {
                vec3 p = floor(x); vec3 f = fract(x);
                f = f*f*(3.0-2.0*f);
                float n = p.x + p.y*57.0 + 113.0*p.z;
                return mix(mix(mix(hash(n+0.0),hash(n+1.0),f.x),mix(hash(n+57.0),hash(n+58.0),f.x),f.y),
                           mix(mix(hash(n+113.0),hash(n+114.0),f.x),mix(hash(n+170.0),hash(n+171.0),f.x),f.y),f.z);
            }

            void main() {
                vUv = uv;
                // Normales calculées dans l'espace caméra pour le Fresnel
                vNormal = normalize(normalMatrix * normal);
                vNoise = noise(position * 2.0 + time * 0.5);
                
                // Déformation de la géométrie basée sur la main gauche
                vec3 newPos = position + normal * vNoise * deformation * 1.2;
                
                // Position du vertex dans l'espace caméra pour l'éclairage
                vPosition = (modelViewMatrix * vec4(newPos, 1.0)).xyz;
                
                gl_Position = projectionMatrix * modelViewMatrix * vec4(newPos, 1.0);
            }
        `,
        fragmentShader: `
            uniform float deformation;
            uniform vec3 lightPos;
            varying float vNoise;
            varying vec3 vNormal;
            varying vec3 vPosition;
            varying vec2 vUv;

            void main() {
                // 1. ÉCLAIRAGE DE BASE (Diffuse)
                // On calcule la direction de la lumière par rapport au vertex
                vec3 lightDir = normalize(lightPos - vPosition);
                float diff = max(dot(vNormal, lightDir), 0.0);
                
                // 2. COULEURS DE L'HOLOGRAMME
                vec3 color1 = vec3(0.0, 1.0, 0.8); // Cyan
                vec3 color2 = vec3(0.6, 0.2, 1.0); // Violet
                // La déformation mixe les deux couleurs
                vec3 baseCol = mix(color1, color2, deformation);
                
                // 3. EFFET DE GRILLE (Filaire simulé)
                // Crée une grille de lignes lumineuses basée sur les UVs
                float grid = sin(vUv.x * 80.0) * sin(vUv.y * 80.0);
                grid = smoothstep(0.9, 1.0, grid); // Lignes fines et nettes
                
                // 4. EFFET FRESNEL (Brillance sur les bords)
                // Rend les bords plus brillants que le centre (effet holographique)
                vec3 viewDir = normalize(-vPosition);
                float fresnel = pow(1.0 - max(dot(vNormal, viewDir), 0.0), 3.0);
                
                // --- COMPOSITION FINALE ---
                // a) Appliquer la lumière diffuse à la couleur de base
                vec3 finalCol = baseCol * diff * 1.2; 
                // b) Ajouter la grille lumineuse (brille même dans l'ombre)
                finalCol += baseCol * grid * 0.6; 
                // c) Ajouter le contour brillant (effet Fresnel cyan)
                finalCol += color1 * fresnel * 0.8; 
                
                // On rend l'objet légèrement translucide pour le style
                gl_FragColor = vec4(finalCol, 0.9);
            }
        `,
        transparent: true,
        wireframe: false // ON DÉSACTIVE LE FILAIRE NATIF
    });

    // 3. CHARGEMENT MODÈLE GLB (Asynchrone)
    const loader = new THREE.GLTFLoader();
    // Charge ton fichier conifer_cone.glb situé dans le même dossier
    loader.load('conifer_cone.glb', (gltf) => {
        object3D = gltf.scene;
        object3D.traverse(c => {
            if(c.isMesh) {
                // On applique notre matériau spécial à tout le maillage
                c.material = voronoiShaderMaterial;
            }
        });
        object3D.scale.set(1.8, 1.8, 1.8);
        scene.add(object3D);
    }, undefined, () => {
        // Fallback : Si le fichier GLB n'est pas trouvé, on crée une sphère 3D
        console.warn("conifer_cone.glb non trouvé, création d'une sphère de secours.");
        object3D = new THREE.Mesh(new THREE.IcosahedronGeometry(1.5, 32), voronoiShaderMaterial);
        scene.add(object3D);
    });

    // 4. VISUALISATION DES JOINTS (Points flottants)
    const jGeo = new THREE.SphereGeometry(0.04, 8, 8);
    for (let i = 0; i < 21; i++) {
        let sL = new THREE.Mesh(jGeo, new THREE.MeshBasicMaterial({color:0xff00cc})); sL.visible = false; jointsLeft.push(sL); scene.add(sL);
        let sR = new THREE.Mesh(jGeo, new THREE.MeshBasicMaterial({color:0x00ffcc})); sR.visible = false; jointsRight.push(sR); scene.add(sR);
    }
}

// ==========================================
// --- LOGIQUE IA (MEDIAPIPE RÉSULTATS) ---
// ==========================================
function onResults(results) {
    // Reset visibilité des joints à chaque frame
    jointsLeft.forEach(j => j.visible = false);
    jointsRight.forEach(j => j.visible = false);

    if (results.multiHandLandmarks) {
        results.multiHandLandmarks.forEach((lm, i) => {
            const isRight = results.multiHandedness[i].label === 'Right';
            const targetJoints = isRight ? jointsRight : jointsLeft;

            // Mise à jour de la position des points de la main
            lm.forEach((p, idx) => {
                targetJoints[idx].position.set((p.x-0.5)*10, -(p.y-0.5)*8, -p.z*5);
                targetJoints[idx].visible = true;
            });

            if (isRight) {
                // --- MAIN DROITE : DÉPLACE LA LUMIÈRE ---
                // Mapping des coordonnées caméra (0->1) vers Three.js
                lightTargetPos.x = (lm[9].x - 0.5) * 12;
                lightTargetPos.y = -(lm[9].y - 0.5) * 10;
                if(rStat) rStat.innerText = "ACTIVE (LIGHT)";
            } else {
                // --- MAIN GAUCHE : CONTRÔLE VORONOI (OUVERT/FERMÉ) ---
                // Distance Poignet (0) - Bout Majeur (12)
                const dist = Math.sqrt(Math.pow(lm[12].x-lm[0].x,2)+Math.pow(lm[12].y-lm[0].y,2));
                isLeftHandClosed = dist < 0.35; // Seuil de détection du poing
                if(lStat) lStat.innerText = isLeftHandClosed ? "FERMÉ (MAX)" : "OUVERT (MIN)";
            }
        });
    } else {
        if(lStat) lStat.innerText = "--";
        if(rStat) rStat.innerText = "--";
    }
}

// ==========================================
// --- BOUCLE D'ANIMATION (UPDATE & RENDER) ---
// ==========================================
function animate() {
    requestAnimationFrame(animate);

    // 1. Lissage de la déformation (Main Gauche)
    smoothDeformation += ((isLeftHandClosed ? 1.0 : 0.0) - smoothDeformation) * 0.1;

    // 2. Lissage de la position de la lumière (Main Droite)
    if (pointLight) {
        pointLight.position.lerp(lightTargetPos, 0.1);
        // CRITICAL: Transmettre la position de la lumière au Shader Uniform
        if(voronoiShaderMaterial) {
            voronoiShaderMaterial.uniforms.lightPos.value.copy(pointLight.position);
        }
    }

    // 3. Mise à jour de l'objet 3D
    if (object3D && voronoiShaderMaterial) {
        voronoiShaderMaterial.uniforms.deformation.value = smoothDeformation;
        voronoiShaderMaterial.uniforms.time.value += 0.02; // Animation du bruit
        
        // Rotation constante et douce
        object3D.rotation.y += 0.008;
    }

    renderer.render(scene, camera);
}

// ==========================================
// --- INITIALISATION FINALE & LANCEMENT ---
// ==========================================
init3D();
animate();

// Configuration MediaPipe Hands
const hands = new Hands({locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`});
hands.setOptions({ maxNumHands: 2, modelComplexity: 1, minDetectionConfidence: 0.6, minTrackingConfidence: 0.6 });
hands.onResults(onResults);

// Lancement Caméra
const cameraApp = new Camera(videoElement, {
    onFrame: async () => { await hands.send({image: videoElement}); },
    width: 1280, height: 720
});
cameraApp.start();

// Gestion du redimensionnement de la fenêtre
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});
