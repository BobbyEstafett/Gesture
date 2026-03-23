// --- CONFIGURATION ---
const videoElement = document.querySelector('.input_video');
const lStat = document.getElementById('l-stat');
const rStat = document.getElementById('r-stat');

let scene, camera, renderer, object3D, crystalMaterial, pointLight;
let smoothDeformation = 0;
let isLeftHandClosed = false;
let lightTargetPos = new THREE.Vector3(0, 0, 3);
let jointsLeft = [], jointsRight = [];

function init3D() {
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = 5;

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    document.getElementById('canvas-container').appendChild(renderer.domElement);

    // LUMIÈRES BLANCHES INTENSES (Pour le scintillement)
    pointLight = new THREE.PointLight(0xffffff, 15, 20); // Puissance élevée
    pointLight.position.set(0, 0, 3);
    scene.add(pointLight);
    scene.add(new THREE.AmbientLight(0xffffff, 0.4));

    // SHADER "PURE CRYSTAL" AVANCÉ
    crystalMaterial = new THREE.ShaderMaterial({
        uniforms: {
            time: { value: 0 },
            deformation: { value: 0 },
            lightPos: { value: new THREE.Vector3(0, 0, 3) }
        },
        vertexShader: `
            uniform float time;
            uniform float deformation;
            varying float vNoise;
            varying vec3 vNormal;
            varying vec3 vWorldPosition;
            varying vec2 vUv;

            // Fonction de bruit pour la déformation
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
                vNormal = normalize(normalMatrix * normal);
                vNoise = noise(position * 2.0 + time * 0.5);
                
                // Déformation (Main Gauche)
                vec3 newPos = position + normal * vNoise * deformation * 1.5;
                vec4 worldPos = modelMatrix * vec4(newPos, 1.0);
                vWorldPosition = worldPos.xyz;
                
                gl_Position = projectionMatrix * modelViewMatrix * vec4(newPos, 1.0);
            }
        `,
        fragmentShader: `
            // Nécessaire pour le dFdx (les facettes)
            #extension GL_OES_standard_derivatives : enable
            
            uniform float deformation;
            uniform float time;
            uniform vec3 lightPos;
            varying float vNoise;
            varying vec3 vNormal;
            varying vec3 vWorldPosition;
            varying vec2 vUv;

            // Fonction pour créer un faux reflet d'environnement (Rainbow Intern)
            vec3 getFakeEnv(vec3 dir) {
                float t = time * 0.1;
                // Crée un dégradé de couleurs qui change selon l'angle de vue
                vec3 col = 0.5 + 0.5 * cos(t + dir.xyy * 2.0 + vec3(0,2,4));
                // On atténue les couleurs pour qu'elles soient subtiles
                return col * pow(abs(dir.z), 2.0) * 0.4;
            }

            void main() {
                vec3 viewDir = normalize(cameraPosition - vWorldPosition);
                vec3 lightDir = normalize(lightPos - vWorldPosition);
                
                // 1. FLAT SHADING SIMULÉ (Calcul des facettes dures)
                vec3 fdx = dFdx(vWorldPosition);
                vec3 fdy = dFdy(vWorldPosition);
                vec3 faceNormal = normalize(cross(fdx, fdy));

                // 2. RÉFRACTION CHROMATIQUE INTERNE
                // On dévie la lumière pour créer des reflets colorés
                vec3 refrR = refract(-viewDir, faceNormal, 0.85);
                vec3 refrG = refract(-viewDir, faceNormal, 0.87);
                vec3 refrB = refract(-viewDir, faceNormal, 0.89);
                
                // Lecture de notre faux environnement interne
                vec3 envR = getFakeEnv(refrR);
                vec3 envG = getFakeEnv(refrG);
                vec3 envB = getFakeEnv(refrB);
                vec3 crystalCol = vec3(envR.r, envG.g, envB.b);

                // 3. REFLETS SPÉCULAIRES (Le scintillement blanc pur)
                float spec = pow(max(dot(reflect(-lightDir, faceNormal), viewDir), 0.0), 32.0);
                
                // 4. FRESNEL (Brillance des arêtes)
                float fresnel = pow(1.0 - max(dot(faceNormal, viewDir), 0.0), 2.5);
                
                // --- COMPOSITION FINALE ---
                // La base est le reflet interne coloré
                vec3 finalCol = crystalCol; 
                
                // On ajoute l'éclat du cristal
                // Un peu de cyan/violet pour le style holographique sur les bords
                vec3 currentHolo = mix(vec3(0.0, 1.0, 0.8), vec3(0.6, 0.2, 1.0), deformation);
                finalCol += currentHolo * fresnel * 0.8; // Bords brillants
                
                // On ajoute le scintillement blanc de haute intensité
                finalCol += vec3(spec) * 1.5; 

                // On rend l'objet presque totalement opaque pour bien voir les facettes
                gl_FragColor = vec4(finalCol, 0.98);
            }
        `,
        transparent: true,
        extensions: { derivatives: true } // FORCE L'EXTENSION
    });

    const loader = new THREE.GLTFLoader();
    // CHARGEMENT DE TON OBJET D'ORIGINE
    loader.load('crystal.glb', (gltf) => {
        object3D = gltf.scene;
        object3D.traverse(c => {
            if(c.isMesh) {
                // ON APPLIQUE LE SHADER "PURE CRYSTAL"
                c.material = crystalMaterial;
                // S'assurer que le modèle n'a pas hérité du filaire
                c.material.wireframe = false;
            }
        });
        object3D.scale.set(1.8, 1.8, 1.8);
        scene.add(object3D);
    }, undefined, (error) => {
        // FALLBACK SPHÈRE LOW-POLY
        console.warn("Utilisation de la Sphère de Secours (Icosahedron).");
        object3D = new THREE.Mesh(new THREE.IcosahedronGeometry(1.5, 3), crystalMaterial);
        scene.add(object3D);
    });

    // Joints mains (oints flottants simples)
    const jGeo = new THREE.SphereGeometry(0.04, 8, 8);
    for (let i = 0; i < 21; i++) {
        let sL = new THREE.Mesh(jGeo, new THREE.MeshBasicMaterial({color:0xff00cc})); sL.visible = false; jointsLeft.push(sL); scene.add(sL);
        let sR = new THREE.Mesh(jGeo, new THREE.MeshBasicMaterial({color:0x00ffcc})); sR.visible = false; jointsRight.push(sR); scene.add(sR);
    }
}

function onResults(results) {
    [jointsLeft, jointsRight].forEach(list => list.forEach(j => j.visible = false));
    if (results.multiHandLandmarks) {
        results.multiHandLandmarks.forEach((lm, i) => {
            const isRight = results.multiHandedness[i].label === 'Right';
            const targetJoints = isRight ? jointsRight : jointsLeft;
            lm.forEach((p, idx) => {
                targetJoints[idx].position.set((p.x-0.5)*10, -(p.y-0.5)*8, -p.z*5);
                targetJoints[idx].visible = true;
            });
            if (isRight) {
                // Main Droite -> Déplace la lumière
                lightTargetPos.x = (lm[9].x - 0.5) * 12;
                lightTargetPos.y = -(lm[9].y - 0.5) * 10;
                if(rStat) rStat.innerText = "LIGHT CONTROL";
            } else {
                // Main Gauche -> Fracture le cristal
                const dist = Math.sqrt(Math.pow(lm[12].x-lm[0].x,2)+Math.pow(lm[12].y-lm[0].y,2));
                isLeftHandClosed = dist < 0.35;
                if(lStat) lStat.innerText = isLeftHandClosed ? "FRACTURE (MAX)" : "STABLE (MIN)";
            }
        });
    } else {
        if(lStat) lStat.innerText = "--";
        if(rStat) rStat.innerText = "--";
    }
}

function animate() {
    requestAnimationFrame(animate);
    // Lissage de la déformation
    smoothDeformation += ((isLeftHandClosed ? 1.0 : 0.0) - smoothDeformation) * 0.05;
    
    // Lissage de la position de la lumière
    if (pointLight) {
        pointLight.position.lerp(lightTargetPos, 0.1);
        if(crystalMaterial) crystalMaterial.uniforms.lightPos.value.copy(pointLight.position);
    }
    
    // Mise à jour de l'objet 3D
    if (object3D) {
        crystalMaterial.uniforms.deformation.value = smoothDeformation;
        crystalMaterial.uniforms.time.value += 0.015; // Animation lente de la réfraction
        
        // Rotation constante et douce
        object3D.rotation.y += 0.005;
    }
    renderer.render(scene, camera);
}

init3D();
animate();

// Configuration MediaPipe Hands
const hands = new Hands({locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`});
hands.setOptions({ maxNumHands: 2, modelComplexity: 1, minDetectionConfidence: 0.6, minTrackingConfidence: 0.6 });
hands.onResults(onResults);

// Lancement Caméra
new Camera(videoElement, { onFrame: async () => { await hands.send({image: videoElement}); }, width: 1280, height: 720 }).start();

// Redimensionnement de la fenêtre
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});
