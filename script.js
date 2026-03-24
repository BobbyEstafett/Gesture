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
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = 5;

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
            deformation: { value: 0 },
            lightPos: { value: new THREE.Vector3(0, 0, 3) }
        },
        vertexShader: `
            varying vec3 vNormal;
            varying vec3 vWorldPosition;
            uniform float time;
            uniform float deformation;

            void main() {
                // Pas de déformation ici pour garder les morceaux intacts (Scatter)
                vec4 worldPos = modelMatrix * vec4(position, 1.0);
                vWorldPosition = worldPos.xyz;
                vNormal = normalize(modelMatrix * vec4(normal, 0.0)).xyz;
                gl_Position = projectionMatrix * viewMatrix * worldPos;
            }
        `,
        fragmentShader: `
            precision highp float;
            uniform float time;
            uniform float deformation;
            uniform vec3 lightPos;
            varying vec3 vNormal;
            varying vec3 vWorldPosition;

            // Simule des reflets arc-en-ciel internes
            vec3 getRainbow(vec3 dir) {
                float t = time * 0.1;
                vec3 col = 0.5 + 0.5 * cos(t + dir.xyy * 2.0 + vec3(0,2,4));
                return col * pow(abs(dir.z), 2.0) * 0.4;
            }

            void main() {
                vec3 viewDir = normalize(cameraPosition - vWorldPosition);
                vec3 lightDir = normalize(lightPos - vWorldPosition);
                
                // 1. FACETTES (Calculées dynamiquement)
                vec3 fdx = dFdx(vWorldPosition);
                vec3 fdy = dFdy(vWorldPosition);
                vec3 faceNormal = normalize(cross(fdx, fdy));

                // 2. RÉFRACTION CHROMATIQUE (Index R, G, B différents)
                vec3 refrR = refract(-viewDir, faceNormal, 0.85);
                vec3 refrG = refract(-viewDir, faceNormal, 0.87);
                vec3 refrB = refract(-viewDir, faceNormal, 0.89);

                vec3 crystalR = getRainbow(refrR);
                vec3 crystalG = getRainbow(refrG);
                vec3 crystalB = getRainbow(refrB);
                vec3 finalCrystal = vec3(crystalR.r, crystalG.g, crystalB.b);

                // 3. BRILLANCE ET FRESNEL
                float spec = pow(max(dot(reflect(-lightDir, faceNormal), viewDir), 0.0), 64.0);
                float fresnel = pow(1.0 - max(dot(faceNormal, viewDir), 0.0), 3.0);
                
                // Couleur holographique sur les bords (fresnel)
                vec3 holoCol = mix(vec3(0.3, 0.8, 1.0), vec3(0.8, 0.2, 1.0), deformation);
                
                // Assemblage
                vec3 color = finalCrystal;
                color += holoCol * fresnel * 1.5;
                color += vec3(spec) * 2.0;

                gl_FragColor = vec4(color, 0.95);
            }
        `,
        transparent: true,
        extensions: { derivatives: true } // Active dFdx/dFdy proprement
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
                lightTargetPos.x = (lm[9].x - 0.5) * 12;
                lightTargetPos.y = -(lm[9].y - 0.5) * 10;
            } else {
                const dist = Math.sqrt(Math.pow(lm[12].x-lm[0].x,2)+Math.pow(lm[12].y-lm[0].y,2));
                isLeftHandClosed = dist < 0.35;
            }
        });
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
        const targetZ = 5 + (smoothDeformation * 5.0); 
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