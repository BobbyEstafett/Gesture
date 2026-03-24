// --- CONFIGURATION ---
const videoElement = document.querySelector('.input_video');
const lStat = document.getElementById('l-stat');
const rStat = document.getElementById('r-stat');

let scene, camera, renderer, object3D, crystalMaterial, pointLight;
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
    const envMap = rgbeLoader.load('https://raw.githubusercontent.com/BobbyEstafett/Gesture/main/wooden_studio_09_2k.jpg');
    envMap.mapping = THREE.EquirectangularReflectionMapping;

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = 5; // On commence directement à 5

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    document.getElementById('canvas-container').appendChild(renderer.domElement);

    // LUMIÈRES
    pointLight = new THREE.PointLight(0xffffff, 20, 20);
    pointLight.position.set(0, 0, 3);
    scene.add(pointLight);
    scene.add(new THREE.AmbientLight(0xffffff, 0.5));

    // SHADER CRYSTAL AMÉLIORÉ
    crystalMaterial = new THREE.ShaderMaterial({
        extensions: { 
            derivatives: true // C'est CECI qui remplace le #extension problématique
        },
        uniforms: {
            time: { value: 0 },
            lightPos: { value: new THREE.Vector3(0, 0, 3) },
            uEnvMap: { value: envMap }
        },
        vertexShader: `
            varying vec3 vNormal;
            varying vec3 vWorldPosition;
            varying vec3 vViewDir;
            void main() {
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
            uniform vec3 lightPos;
            varying vec3 vNormal;
            varying vec3 vWorldPosition;
            varying vec3 vViewDir;

            void main() {
                // 1. Calcul des normales de face (pour le look taillé)
                vec3 fdx = dFdx(vWorldPosition);
                vec3 fdy = dFdy(vWorldPosition);
                vec3 faceNormal = normalize(cross(fdx, fdy));

                // 2. Réfraction Chromatique
                vec3 refrR = refract(vViewDir, faceNormal, 0.82);
                vec3 refrG = refract(vViewDir, faceNormal, 0.84);
                vec3 refrB = refract(vViewDir, faceNormal, 0.86);

                vec2 uvR = vec2(atan(refrR.z, refrR.x) / 6.2831 + 0.5, acos(clamp(refrR.y, -1.0, 1.0)) / 3.1415);
                vec2 uvG = vec2(atan(refrG.z, refrG.x) / 6.2831 + 0.5, acos(clamp(refrG.y, -1.0, 1.0)) / 3.1415);
                vec2 uvB = vec2(atan(refrB.z, refrB.x) / 6.2831 + 0.5, acos(clamp(refrB.y, -1.0, 1.0)) / 3.1415);

                vec3 color;
                color.r = texture2D(uEnvMap, uvR).r;
                color.g = texture2D(uEnvMap, uvG).g;
                color.b = texture2D(uEnvMap, uvB).b;

                if(length(color) < 0.01) color = vec3(0.1, 0.25, 0.45);

                // 3. Réflexion & Fresnel
                vec3 reflectDir = reflect(vViewDir, faceNormal);
                vec2 uvReflect = vec2(atan(reflectDir.z, reflectDir.x) / 6.2831 + 0.5, acos(clamp(reflectDir.y, -1.0, 1.0)) / 3.1415);
                vec3 reflection = texture2D(uEnvMap, uvReflect).rgb;

                float fresnel = pow(1.0 + dot(vViewDir, faceNormal), 5.0);
                vec3 finalCol = mix(color, reflection, fresnel * 0.5);
                
                // 4. Specular (Brillance)
                vec3 lightDir = normalize(lightPos - vWorldPosition);
                float spec = pow(max(dot(reflect(-lightDir, faceNormal), -vViewDir), 0.0), 32.0);

                // --- AJOUT DES ARÊTES (EDGE DETECTION) ---
                // Comparaison normale lisse vs normale de face
                float edge = dot(vNormal, faceNormal);
                // On crée un masque très fin (plus le 0.95 est haut, plus le trait est fin)
                float edgeMask = 1.0 - smoothstep(0.8, 0.95, edge);
                vec3 edgeColor = vec3(0.0, 1.0, 1.0); // Cyan néon
                
                // On ajoute les arêtes lumineuses au résultat
                vec3 finalWithEdges = finalCol + (edgeColor * edgeMask * 2.0) + (spec * 0.5);

                gl_FragColor = vec4(finalWithEdges, 1.0);
            }
            `,
        transparent: true
    });

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
        object3D.scale.set(1.5, 1.5, 1.5);
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
    
    smoothDeformation += ((isLeftHandClosed ? 1.0 : 0.0) - smoothDeformation) * 0.05;

    // Caméra
    if (camera) {
        const targetZ = 5 + (smoothDeformation * 2.0); 
        camera.position.z += (targetZ - camera.position.z) * 0.05;
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