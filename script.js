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
    // SHADER "DIGITAL GLITCH CRYSTAL"
    crystalMaterial = new THREE.RawShaderMaterial({
    uniforms: {
        time: { value: 0 },
        deformation: { value: 0 },
        uEnvMap: { value: envMap },
        lightPos: { value: new THREE.Vector3(0, 0, 3) }, // AJOUTE CETTE LIGNE
        projectionMatrix: { value: camera.projectionMatrix },
        modelViewMatrix: { value: new THREE.Matrix4() },
        cameraPosition: { value: camera.position }
    },
        vertexShader: `
            precision highp float;
            attribute vec3 position;
            attribute vec3 normal;
            uniform mat4 modelViewMatrix;
            uniform mat4 projectionMatrix;
            uniform mat4 modelMatrix;
            varying vec3 vNormal;
            varying vec3 vWorldPosition;
            
            void main() {
                vec4 worldPos = modelMatrix * vec4(position, 1.0);
                vWorldPosition = worldPos.xyz;
                vNormal = normalize(mat3(modelMatrix) * normal);
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            precision highp float;
            #extension GL_OES_standard_derivatives : enable

            uniform float time;
            uniform float deformation;
            uniform sampler2D uEnvMap;
            uniform vec3 lightPos;
            uniform vec3 cameraPosition;
            varying vec3 vNormal;
            varying vec3 vWorldPosition;

            void main() {
                vec3 viewDir = normalize(vWorldPosition - cameraPosition);
                
                // 1. FACETTES (Effet taillé de l'image)
                vec3 fdx = dFdx(vWorldPosition);
                vec3 fdy = dFdy(vWorldPosition);
                vec3 faceNormal = normalize(cross(fdx, fdy));

                // 2. MOTIF DIGITAL (Les lignes de ton image)
                vec2 uv = vNormal.xy * 2.0 + vWorldPosition.xz * 0.5;
                float lines = sin(uv.y * 40.0 + time * 2.0) * 0.5 + 0.5;
                float scan = smoothstep(0.4, 0.5, lines);
                
                // 3. RÉFRACTION ARC-EN-CIEL (Chromatic Aberration)
                vec3 refrR = refract(viewDir, faceNormal, 0.82);
                vec3 refrG = refract(viewDir, faceNormal, 0.85);
                vec3 refrB = refract(viewDir, faceNormal, 0.88);
                
                // Couleurs procédurales style "Glitch"
                vec3 colR = 0.5 + 0.5 * cos(time + refrR.zxy * 3.0 + vec3(0,2,4));
                vec3 colG = 0.5 + 0.5 * cos(time + refrG.zxy * 3.0 + vec3(2,4,0));
                vec3 colB = 0.5 + 0.5 * cos(time + refrB.zxy * 3.0 + vec3(4,0,2));
                
                vec3 finalColor = vec3(colR.r, colG.g, colB.b) * scan;

                // 4. REFLETS DE SURFACE
                float fresnel = pow(1.0 + dot(viewDir, faceNormal), 3.0);
                finalColor += fresnel * vec3(0.5, 0.8, 1.0) * (1.0 + deformation);

                gl_FragColor = vec4(finalColor, 0.9);
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