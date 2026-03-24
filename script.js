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
    const rgbeLoader = new THREE.TextureLoader();
const envMap = rgbeLoader.load('https://raw.githubusercontent.com/BobbyEstafett/Gesture/main/wooden_studio_09_2k.jpg'); // Exemple de nuit étoilée
envMap.mapping = THREE.EquirectangularReflectionMapping;
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = 2;

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    document.getElementById('canvas-container').appendChild(renderer.domElement);

    // LUMIÈRES
    pointLight = new THREE.PointLight(0xffffff, 20, 20);
    pointLight.position.set(0, 0, 3);
    scene.add(pointLight);
    scene.add(new THREE.AmbientLight(0xffffff, 0.5));

    // SHADER CRYSTAL (Stable et Performant)
crystalMaterial = new THREE.ShaderMaterial({
    uniforms: {
        time: { value: 0 },
        lightPos: { value: new THREE.Vector3(0, 0, 3) },
        uEnvMap: { value: envMap }, // On passe la cubemap ici
        uCameraPos: { value: new THREE.Vector3() }
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
        #extension GL_OES_standard_derivatives : enable
        precision highp float;

        uniform float time;
        uniform sampler2D uEnvMap; // Utilisation d'une map panoramique simple
        uniform vec3 lightPos;
        varying vec3 vNormal;
        varying vec3 vWorldPosition;
        varying vec3 vViewDir;

        void main() {
            // 1. FLAT SHADING (L'aspect taillé de ykob)
            vec3 fdx = dFdx(vWorldPosition);
            vec3 fdy = dFdy(vWorldPosition);
            vec3 faceNormal = normalize(cross(fdx, fdy));

            // 2. RÉFRACTION CHROMATIQUE (Triple échantillonnage)
            // On décale les indices pour créer l'arc-en-ciel interne
            vec3 refrR = refract(vViewDir, faceNormal, 0.82);
            vec3 refrG = refract(vViewDir, faceNormal, 0.84);
            vec3 refrB = refract(vViewDir, faceNormal, 0.86);

            // On transforme les vecteurs de réfraction en coordonnées UV pour la texture
            vec2 uvR = vec2(atan(refrR.z, refrR.x) / 6.2831 + 0.5, acos(refrR.y) / 3.1415);
            vec2 uvG = vec2(atan(refrG.z, refrG.x) / 6.2831 + 0.5, acos(refrG.y) / 3.1415);
            vec2 uvB = vec2(atan(refrB.z, refrB.x) / 6.2831 + 0.5, acos(refrB.y) / 3.1415);

            float r = texture2D(uEnvMap, uvR).r;
            float g = texture2D(uEnvMap, uvG).g;
            float b = texture2D(uEnvMap, uvB).b;

            // 3. RÉFLEXION (Le miroir de surface)
            vec3 reflectDir = reflect(vViewDir, faceNormal);
            vec2 uvReflect = vec2(atan(reflectDir.z, reflectDir.x) / 6.2831 + 0.5, acos(reflectDir.y) / 3.1415);
            vec3 reflection = texture2D(uEnvMap, uvReflect).rgb;

            // 4. FRESNEL (Mélange réfraction/réflexion)
            float fresnel = pow(1.0 + dot(vViewDir, faceNormal), 5.0);

            // 5. FINAL COMBINATION
            vec3 color = vec3(r, g, b); // Base refractée
            color = mix(color, reflection, fresnel); // Ajout des reflets sur les bords
            
            // Ajout d'un éclat spéculaire pour le punch
            vec3 lightDir = normalize(lightPos - vWorldPosition);
            float spec = pow(max(dot(reflect(-lightDir, faceNormal), -vViewDir), 0.0), 32.0);
            color += spec * 0.8;

            gl_FragColor = vec4(color, 1.0);
        }
    `.trim(),
    transparent: true,
    extensions: { derivatives: true }
});

    const loader = new THREE.GLTFLoader();
    loader.load('crystal.glb', (gltf) => {
        object3D = gltf.scene;
        
        // On recentre le groupe principal
        const box = new THREE.Box3().setFromObject(object3D);
        const center = box.getCenter(new THREE.Vector3());
        object3D.position.sub(center);

        fragments = []; // On vide au cas où
        
        object3D.traverse(c => {
    if(c.isMesh) {
        c.material = crystalMaterial;
        fragments.push({
            mesh: c,
            originalPos: c.position.clone(),
            originalRot: c.rotation.clone(), // ON AJOUTE CECI
            explodeDir: c.position.clone().normalize()
        });
    }
});
        
        object3D.scale.set(1.5, 1.5, 1.5);
        scene.add(object3D);
    }, undefined, (error) => {
        console.warn("Erreur GLB, création d'une sphère fracturée par défaut.");
        object3D = new THREE.Group();
        for(let i=0; i<20; i++) {
            let m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 0), crystalMaterial);
            m.position.set((Math.random()-0.5)*2, (Math.random()-0.5)*2, (Math.random()-0.5)*2);
            object3D.add(m);
            fragments.push({ mesh: m, originalPos: m.position.clone(), explodeDir: m.position.clone().normalize() });
        }
        scene.add(object3D);
    });

    // Mains
    const jGeo = new THREE.SphereGeometry(0.04, 8, 8);
    for (let i = 0; i < 21; i++) {
        let sL = new THREE.Mesh(jGeo, new THREE.MeshBasicMaterial({color:0xff00cc})); sL.visible = false; jointsLeft.push(sL); scene.add(sL);
        let sR = new THREE.Mesh(jGeo, new THREE.MeshBasicMaterial({color:0x00ffcc})); sR.visible = false; jointsRight.push(sR); scene.add(sR);
    }
}

function onResults(results) {
    // 1. On cache tous les points par défaut
    [jointsLeft, jointsRight].forEach(list => list.forEach(j => j.visible = false));

    // 2. Si on détecte des mains
    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        results.multiHandLandmarks.forEach((lm, i) => {
            const isRight = results.multiHandedness[i].label === 'Right';
            const targetJoints = isRight ? jointsRight : jointsLeft;
            
            lm.forEach((p, idx) => {
                targetJoints[idx].position.set((p.x-0.5)*10, -(p.y-0.5)*8, -p.z*5);
                targetJoints[idx].visible = true;
            });

            if (isRight) {
                lightTargetPos.x = (lm[9].x - 0.5) * 12;
                lightTargetPos.y = -(lm[9].y - 0.5) * 10;
            } else {
                const dist = Math.sqrt(Math.pow(lm[12].x-lm[0].x,2)+Math.pow(lm[12].y-lm[0].y,2));
                isLeftHandClosed = dist < 0.35;
            }
        });
    } else {
        // --- SÉCURITÉ : MAINS PERDUES ---
        // Si aucune main n'est vue par la caméra, on "ferme" l'état d'explosion
        isLeftHandClosed = false;
        // On peut aussi recentrer la lumière par défaut si on veut
        lightTargetPos.set(0, 0, 3);
    }
}

function animate() {
    requestAnimationFrame(animate);
    
    // 1. Lissage de la main gauche (force d'explosion)
    // On peut ralentir un peu le lissage (0.05) pour plus de lourdeur/classe
    smoothDeformation += ((isLeftHandClosed ? 1.0 : 0.0) - smoothDeformation) * 0.05;

    // 2. AUTO-ZOOM : La caméra recule quand ça éclate
    // Position par défaut = 5. Position éclatée = 8.
    if (camera) {
        const targetZ = 5 + (smoothDeformation * 2.0); 
        camera.position.z += (targetZ - camera.position.z) * 0.05;
    }

    // 3. Gestion de la lumière
    if (pointLight) {
        pointLight.position.lerp(lightTargetPos, 0.1);
        crystalMaterial.uniforms.lightPos.value.copy(pointLight.position);
    }

    // 4. Animation du SCATTER (Explosion contrôlée)
    fragments.forEach(f => {
    // 1. POSITION (RETOUR PARFAIT)
    const targetX = f.originalPos.x + (f.explodeDir.x * smoothDeformation * 0.2);
    const targetY = f.originalPos.y + (f.explodeDir.y * smoothDeformation * 0.2);
    const targetZ = f.originalPos.z + (f.explodeDir.z * smoothDeformation * 0.2);

    f.mesh.position.x += (targetX - f.mesh.position.x) * 0.1;
    f.mesh.position.y += (targetY - f.mesh.position.y) * 0.1;
    f.mesh.position.z += (targetZ - f.mesh.position.z) * 0.1;

    // 2. ROTATION (RETOUR PARFAIT)
    // On calcule une rotation "d'éclatement" (offset)
    // On utilise le temps pour que ça tourne un peu en l'air
    const time = crystalMaterial.uniforms.time.value;
    const rotOffsetX = smoothDeformation * Math.sin(time * 2.0 + f.originalPos.x) * 2.0;
    const rotOffsetZ = smoothDeformation * Math.cos(time * 2.0 + f.originalPos.y) * 2.0;

    // On définit la cible : Rotation d'origine + Offset d'explosion
    const targetRotX = f.originalRot.x + rotOffsetX;
    const targetRotZ = f.originalRot.z + rotOffsetZ;

    // On applique de façon fluide
    f.mesh.rotation.x += (targetRotX - f.mesh.rotation.x) * 0.1;
    f.mesh.rotation.z += (targetRotZ - f.mesh.rotation.z) * 0.1;
});

    // 5. Mise à jour du Shader et rotation globale
    crystalMaterial.uniforms.time.value += 0.01;
    if (object3D) {
        // Le cristal continue de tourner sur lui-même, même éclaté
        object3D.rotation.y += 0.002;
    }
    
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