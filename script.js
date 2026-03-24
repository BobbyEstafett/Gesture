// --- CONFIGURATION ---
const videoElement = document.querySelector('.input_video');
const lStat = document.getElementById('l-stat');
const rStat = document.getElementById('r-stat');
const textureLoader = new THREE.TextureLoader();
// Remplace 'ton_image.jpg' par le vrai nom de ton fichier
const taTextureDiffuse = textureLoader.load('tex/gltf_embedded_0.png');

let scene, camera, renderer, object3D, crystalMaterial, pointLight, particleMaterial, particleSystem;
let smoothDeformation = 0;
let isLeftHandClosed = false;
let lightTargetPos = new THREE.Vector3(0, 0, 3);
let jointsLeft = [], jointsRight = [];

// Stockage des données des morceaux pour l'explosion
let fragments = [];

function init3D() {
    // 1. CHARGEMENT DE L'ENVIRONNEMENT
    const rgbeLoader = new THREE.TextureLoader();
    // Utilisation d'une image compatible Three.js pour tester si le lien GitHub bug
    const envMap = rgbeLoader.load('wooden_studio_09_2k.jpg');
    envMap.mapping = THREE.EquirectangularReflectionMapping;
    

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = 5; // On commence directement à 5

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    document.getElementById('canvas-container').appendChild(renderer.domElement);

    // LUMIÈRES
    pointLight = new THREE.PointLight(0xfffff, 20, 20);
    pointLight.position.set(0, 0, 3);
    scene.add(pointLight);
    scene.add(new THREE.AmbientLight(0xffffff, 0.5));

   

    // SHADER CRYSTAL AMÉLIORÉ
crystalMaterial = new THREE.ShaderMaterial({
        extensions: { 
            derivatives: true 
        },
        uniforms: {
            time: { value: 0 },
            lightPos: { value: new THREE.Vector3(0, 0, 3) },
            uEnvMap: { value: envMap },
            uDiffuse: { value: taTextureDiffuse },
            // Note: On n'ajoute pas 'deformation' ici pour l'instant pour éviter les erreurs
        },
vertexShader: `
    varying vec3 vNormal;
    varying vec3 vWorldPosition;
    varying vec3 vViewDir;
    varying vec2 vUv; // <-- Indispensable

    void main() {
        vUv = uv; // <-- Récupère les UV du modèle
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        vNormal = normalize(modelMatrix * vec4(normal, 0.0)).xyz;
        vViewDir = normalize(worldPosition.xyz - cameraPosition);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`,
fragmentShader: `
            precision highp float;
            uniform float time;
            uniform sampler2D uEnvMap;
            uniform sampler2D uDiffuse; // Ta texture digital
            uniform vec3 lightPos;
            varying vec3 vNormal;
            varying vec3 vWorldPosition;
            varying vec3 vViewDir;
            varying vec2 vUv; 

            void main() {
                // 1. Facettes (On garde dFdx)
                vec3 fdx = dFdx(vWorldPosition);
                vec3 fdy = dFdy(vWorldPosition);
                vec3 faceNormal = normalize(cross(fdx, fdy));

                // 2. Aberration Chromatique RÉDUITE (Indices plus serrés)
                // On utilise 0.84, 0.85, 0.86 pour éviter que le bleu ne domine trop (et crée du violet)
                vec3 refrR = refract(vViewDir, faceNormal, 0.75);
                vec3 refrG = refract(vViewDir, faceNormal, 0.85);
                vec3 refrB = refract(vViewDir, faceNormal, 0.95);

                vec2 uvR = vec2(atan(refrR.z, refrR.x) / 6.28 + 0.5, acos(clamp(refrR.y, -1.0, 1.0)) / 3.14);
                vec2 uvG = vec2(atan(refrG.z, refrG.x) / 6.28 + 0.5, acos(clamp(refrG.y, -1.0, 1.0)) / 3.14);
                vec2 uvB = vec2(atan(refrB.z, refrB.x) / 6.28 + 0.5, acos(clamp(refrB.y, -1.0, 1.0)) / 3.14);

                vec3 crystalCol;
                crystalCol.r = texture2D(uEnvMap, uvR).r;
                crystalCol.g = texture2D(uEnvMap, uvG).g;
                crystalCol.b = texture2D(uEnvMap, uvB).b;

                // --- CORRECTION A : NEUTRALISER LE VIOLET ---
                // On calcule la luminosité
                float lum = (crystalCol.r + crystalCol.g + crystalCol.b) / 3.0;
                // Si la luminosité est faible (gris sombre), on force la couleur vers le gris (mix 0.8)
                // Cela enlève le violet des zones sombres du corps.
                crystalCol = mix(crystalCol, vec3(lum), 0.8);

                // --- INTÉGRATION STRATÉGIQUE DE LA DIFFUSE ---
                vec3 texDiffuse = texture2D(uDiffuse, vUv).rgb;
                
                // --- CORRECTION B : FAIRE RESSORTIR LA DIFFUSE SUR LE SOMBRE ---
                // On utilise la luminosité comme masque.
                // Sur les zones sombres de l'objet, on affiche 80% de la diffuse.
                // Sur les éclats brillants, on garde le rainbow.
                // On multiplie par 3.0 pour l'effet "néon" flashy
                crystalCol = mix(texDiffuse * 1.0, crystalCol * 3.0, smoothstep(0.1, 0.5, lum));

                // --- 4. Corrections Visuelles RÉDUITES ---
                // On applique un pow plus léger pour ne pas reperdre en luminosité
                crystalCol = pow(crystalCol, vec3(3));
                crystalCol += vec3(0.05, 0.0, 0.1); // Teinte de secours

                // --- 5. Réflexion & Fresnel ---
                vec3 reflectDir = reflect(vViewDir, faceNormal);
                vec2 uvReflect = vec2(atan(reflectDir.z, reflectDir.x) / 6.28 + 0.5, acos(clamp(reflectDir.y, -1.0, 1.0)) / 3.14);
                vec3 reflection = texture2D(uEnvMap, uvReflect).rgb;

                // On baisse le Fresnel à 2.0 pour que les bords ne soient plus des miroirs blancs
                float fresnel = pow(1.0 + dot(vViewDir, faceNormal), 1.5);
                vec3 finalCol = mix(crystalCol, reflection, fresnel * 0.8);
                
                // Specular (On le garde fin)
                vec3 lightDir = normalize(lightPos - vWorldPosition);
                float spec = pow(max(dot(reflect(-lightDir, faceNormal), -vViewDir), 0.0), 32.0);
                
                gl_FragColor = vec4(finalCol + spec * 0.4, 1.0);
            }
        `,
        transparent: true
    });

// --- SYSTÈME DE PARTICULES GRAVITATIONNELLES ---
const particleCount = 2000; // Nombre de particules (tu peux augmenter)
const particleGeometry = new THREE.BufferGeometry();
const positions = new Float32Array(particleCount * 3);
const sizes = new Float32Array(particleCount);
const offsets = new Float32Array(particleCount); // Pour décaler le mouvement

for (let i = 0; i < particleCount; i++) {
    // Position initiale aléatoire dans une sphère
    const radius = 2 + Math.random() * 2; // Entre 2 et 4 de distance
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos((Math.random() * 2) - 1);

    positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
    positions[i * 3 + 2] = radius * Math.cos(phi);

    // Taille aléatoire
    sizes[i] = 0.02 + Math.random() * 0.05;

    // Décalage temporel aléatoire pour l'orbite
    offsets[i] = Math.random() * 1000;
}

particleGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
particleGeometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
particleGeometry.setAttribute('offset', new THREE.BufferAttribute(offsets, 1));

// Matériau des Particules (Shader)
const particleMaterial = new THREE.ShaderMaterial({
    uniforms: {
        time: { value: 0 },
        color: { value: new THREE.Color(0x00ffff) }, // Cyan Néon
        deformation: { value: 0 } // On liera ça à smoothDeformation
    },
    vertexShader: `
        uniform float time;
        uniform float deformation;
        attribute float size;
        attribute float offset;
        varying float vOpacity;

        void main() {
            // Calcul de l'orbite
            float t = time + offset;
            
            // Position de base (l'attribut 'position' généré en JS)
            vec3 p = position;

            // Rotation orbitale autour de l'axe Y
            float orbitSpeed = 0.2 + deformation * 0.5; // Accélère avec l'explosion
            float angle = t * orbitSpeed;
            float cosA = cos(angle);
            float sinA = sin(angle);
            
            vec3 rotatedPos;
            rotatedPos.x = p.x * cosA - p.z * sinA;
            rotatedPos.y = p.y + sin(t * 0.5 + offset) * 0.1; // Légère oscillation verticale
            rotatedPos.z = p.x * sinA + p.z * cosA;

            // Effet d'attraction/répulsion
            float pulse = sin(t * 1.0) * 0.1;
            rotatedPos *= (1.0 + pulse + deformation * 0.5);

            vec4 mvPosition = modelViewMatrix * vec4(rotatedPos, 1.0);
            
            // Taille variable avec la distance (perspective)
            gl_PointSize = size * (300.0 / -mvPosition.z);
            
            // Opacité variable pour le scintillement
            vOpacity = 0.5 + sin(t * 5.0) * 0.3;

            gl_Position = projectionMatrix * mvPosition;
        }
    `,
    fragmentShader: `
        uniform vec3 color;
        varying float vOpacity;

        void main() {
            // Dessiner un cercle flou (plus joli qu'un carré)
            float d = distance(gl_PointCoord, vec2(0.5));
            if (d > 0.5) discard;
            
            float strength = 1.0 - smoothstep(0.0, 0.5, d);
            gl_FragColor = vec4(color, strength * vOpacity);
        }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending, // Pour l'effet lumineux
    depthWrite: false // Pour éviter les problèmes de transparence
});

const particleSystem = new THREE.Points(particleGeometry, particleMaterial);
scene.add(particleSystem);




    const loader = new THREE.GLTFLoader();
    loader.load('crystal.glb', (gltf) => {
        object3D = gltf.scene;
        const box = new THREE.Box3().setFromObject(object3D);
        const center = box.getCenter(new THREE.Vector3());
        object3D.position.sub(center);

        fragments = [];
        object3D.traverse(c => {
            if(c.isMesh) {
                c.material = crystalMaterial;
                fragments.push({
                    mesh: c,
                    originalPos: c.position.clone(),
                    originalRot: c.rotation.clone(),
                    explodeDir: c.position.clone().normalize()
                });
            }
        });
        object3D.scale.set(2, 2, 2);
        scene.add(object3D);
    }, undefined, (error) => {
        // Fallback Sphere si le GLB ne charge pas
        object3D = new THREE.Group();
        for(let i=0; i<20; i++) {
            let m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 0), crystalMaterial);
            m.position.set((Math.random()-0.5)*2, (Math.random()-0.5)*2, (Math.random()-0.5)*2);
            object3D.add(m);
            fragments.push({ mesh: m, originalPos: m.position.clone(), originalRot: m.rotation.clone(), explodeDir: m.position.clone().normalize() });
        }
        scene.add(object3D);
    });

    const jGeo = new THREE.SphereGeometry(0.04, 8, 8);
    for (let i = 0; i < 21; i++) {
        let sL = new THREE.Mesh(jGeo, new THREE.MeshBasicMaterial({color:0xff00cc})); sL.visible = false; jointsLeft.push(sL); scene.add(sL);
        let sR = new THREE.Mesh(jGeo, new THREE.MeshBasicMaterial({color:0x00ffcc})); sR.visible = false; jointsRight.push(sR); scene.add(sR);
    }
}

function onResults(results) {
    [jointsLeft, jointsRight].forEach(list => list.forEach(j => j.visible = false));

    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        results.multiHandLandmarks.forEach((lm, i) => {
            const isRight = results.multiHandedness[i].label === 'Right';
            const targetJoints = isRight ? jointsRight : jointsLeft;
            
            // Affichage des points
            lm.forEach((p, idx) => {
                targetJoints[idx].position.set((p.x-0.5)*10, -(p.y-0.5)*8, -p.z*5);
                targetJoints[idx].visible = true;
            });

            if (isRight) {
                // Main Droite : Contrôle de la lumière (inchangé)
                lightTargetPos.x = (lm[9].x - 0.5) * 12;
                lightTargetPos.y = -(lm[9].y - 0.5) * 10;
            } else {
                // --- DETECTION DU POING GAUCHE ROBUSTE ---
                // On vérifie si les 4 doigts longs sont courbés
                // Index: 8, Majeur: 12, Annulaire: 16, Auriculaire: 20
                const fingerTips = [8, 12, 16, 20];
                const fingerBases = [5, 9, 13, 17]; // Articulations de base
                
                let curledFingers = 0;
                fingerTips.forEach((tipIdx, index) => {
                    const tip = lm[tipIdx];
                    const base = lm[fingerBases[index]];
                    const wrist = lm[0];

                    // Si le bout du doigt est plus proche du poignet que sa propre base
                    // alors le doigt est considéré comme plié (curl)
                    const distTip = Math.hypot(tip.x - wrist.x, tip.y - wrist.y);
                    const distBase = Math.hypot(base.x - wrist.x, base.y - wrist.y);
                    
                    if (distTip < distBase) curledFingers++;
                });

                // On considère le poing fermé si au moins 3 doigts sur 4 sont pliés
                // C'est beaucoup plus stable que la distance simple !
                isLeftHandClosed = (curledFingers >= 3);
                
                if(lStat) lStat.innerText = isLeftHandClosed ? "FRACTURE" : "STABLE";
            }
        });
    } else {
        isLeftHandClosed = false;
        lightTargetPos.set(0, 0, 3);
    }
}

function animate() {
    requestAnimationFrame(animate);

    const deltaTime = 0.01; 
    crystalMaterial.uniforms.time.value += deltaTime;
    
    smoothDeformation += ((isLeftHandClosed ? 1.0 : 0.0) - smoothDeformation) * 0.05;

    // Caméra
    if (camera) {
        const targetZ = 5 + (smoothDeformation * 2.0); 
        camera.position.z += (targetZ - camera.position.z) * 0.05;
    }

// 2. Mise à jour du temps global pour tous les shaders
    const currentTime = crystalMaterial.uniforms.time.value += 0.01;

    // --- MISE À JOUR DES PARTICULES (À AJOUTER ICI) ---
    if (particleSystem) {
        // On synchronise le temps avec celui du cristal
        particleSystem.material.uniforms.time.value = crystalMaterial.uniforms.time.value;
        
        // On passe la déformation pour l'accélération
        particleSystem.material.uniforms.deformation.value = smoothDeformation;
    }

    
    // Lumière
    if (pointLight) {
        pointLight.position.lerp(lightTargetPos, 0.1);
        crystalMaterial.uniforms.lightPos.value.copy(pointLight.position);
    }

    // SCATTER
    fragments.forEach(f => {
        const targetX = f.originalPos.x + (f.explodeDir.x * smoothDeformation * 0.2);
        const targetY = f.originalPos.y + (f.explodeDir.y * smoothDeformation * 0.2);
        const targetZ = f.originalPos.z + (f.explodeDir.z * smoothDeformation * 0.2);

        f.mesh.position.lerp(new THREE.Vector3(targetX, targetY, targetZ), 0.1);

        const time = crystalMaterial.uniforms.time.value;
        const rotOffsetX = smoothDeformation * Math.sin(time * 2.0 + f.originalPos.x) * 1.5;
        const rotOffsetZ = smoothDeformation * Math.cos(time * 2.0 + f.originalPos.y) * 1.5;

        // On crée un Euler cible pour interpoler proprement
        f.mesh.rotation.x += (f.originalRot.x + rotOffsetX - f.mesh.rotation.x) * 0.1;
        f.mesh.rotation.z += (f.originalRot.z + rotOffsetZ - f.mesh.rotation.z) * 0.1;
    });

    

    crystalMaterial.uniforms.time.value += 0.01;
    if (object3D) object3D.rotation.y += 0.002;
    
    renderer.render(scene, camera);
}

init3D();
animate();

// MediaPipe
const hands = new Hands({locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`});
hands.setOptions({ maxNumHands: 2, modelComplexity: 1, minDetectionConfidence: 0.6, minTrackingConfidence: 0.6 });
hands.onResults(onResults);
new Camera(videoElement, { onFrame: async () => { await hands.send({image: videoElement}); }, width: 1280, height: 720 }).start();

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});