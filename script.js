// --- CONFIGURATION ---
const videoElement = document.querySelector('.input_video');
const lStat = document.getElementById('l-stat');
const rStat = document.getElementById('r-stat');

let scene, camera, renderer, object3D, crystalMaterial, pointLight;
let smoothDeformation = 0;
let isLeftHandClosed = false;
let lightTargetPos = new THREE.Vector3(0, 0, 3);
let jointsLeft = [], jointsRight = [];

// Stockage des positions initiales des morceaux pour le retour au calme
let originalPositions = [];

function init3D() {
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = 5;

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    document.getElementById('canvas-container').appendChild(renderer.domElement);

    pointLight = new THREE.PointLight(0xffffff, 15, 20);
    pointLight.position.set(0, 0, 3);
    scene.add(pointLight);
    scene.add(new THREE.AmbientLight(0xffffff, 0.5));

    // SHADER CRYSTAL (Version stable pour fragments)
    crystalMaterial = new THREE.ShaderMaterial({
        uniforms: {
            time: { value: 0 },
            lightPos: { value: new THREE.Vector3(0, 0, 3) }
        },
        vertexShader: `
            varying vec3 vNormal;
            varying vec3 vWorldPosition;
            varying vec2 vUv;
            void main() {
                vUv = uv;
                vNormal = normalize(normalMatrix * normal);
                vec4 worldPos = modelMatrix * vec4(position, 1.0);
                vWorldPosition = worldPos.xyz;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `#extension GL_OES_standard_derivatives : enable
            precision highp float;
            uniform float time;
            uniform vec3 lightPos;
            varying vec3 vNormal;
            varying vec3 vWorldPosition;

            vec3 getFakeEnv(vec3 dir) {
                float t = time * 0.1;
                vec3 col = 0.5 + 0.5 * cos(t + dir.xyy * 2.0 + vec3(0,2,4));
                return col * pow(abs(dir.z), 2.0) * 0.4;
            }

            void main() {
                vec3 viewDir = normalize(cameraPosition - vWorldPosition);
                vec3 lightDir = normalize(lightPos - vWorldPosition);
                vec3 fdx = dFdx(vWorldPosition);
                vec3 fdy = dFdy(vWorldPosition);
                vec3 faceNormal = normalize(cross(fdx, fdy));
                vec3 refr = refract(-viewDir, faceNormal, 0.88);
                vec3 crystalCol = getFakeEnv(refr);
                float spec = pow(max(dot(reflect(-lightDir, faceNormal), viewDir), 0.0), 64.0);
                float fresnel = pow(1.0 - max(dot(faceNormal, viewDir), 0.0), 3.0);
                gl_FragColor = vec4(crystalCol + (vec3(0.5, 0.8, 1.0) * fresnel) + vec3(spec)*1.5, 0.95);
            }
        `.trim(),
        transparent: true,
        extensions: { derivatives: true }
    });

    const loader = new THREE.GLTFLoader();
    loader.load('crystal.glb', (gltf) => {
        object3D = gltf.scene;
        
        // On enregistre la position de chaque morceau
        object3D.traverse(c => {
            if(c.isMesh) {
                c.material = crystalMaterial;
                // On stocke la position de départ de chaque fragment
                originalPositions.push({
                    mesh: c,
                    pos: c.position.clone(),
                    // Direction d'explosion (du centre vers le morceau)
                    dir: c.position.clone().normalize().multiplyScalar(2.5) 
                });
            }
        });
        
        object3D.scale.set(1.5, 1.5, 1.5);
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
    if (results.multiHandLandmarks) {
        results.multiHandLandmarks.forEach((lm, i) => {
            const isRight = results.multiHandedness[i].label === 'Right';
            if (isRight) {
                lightTargetPos.x = (lm[9].x - 0.5) * 12;
                lightTargetPos.y = -(lm[9].y - 0.5) * 10;
            } else {
                const dist = Math.sqrt(Math.pow(lm[12].x-lm[0].x,2)+Math.pow(lm[12].y-lm[0].y,2));
                isLeftHandClosed = dist < 0.35;
            }
            lm.forEach((p, idx) => {
                const targetJoints = isRight ? jointsRight : jointsLeft;
                targetJoints[idx].position.set((p.x-0.5)*10, -(p.y-0.5)*8, -p.z*5);
                targetJoints[idx].visible = true;
            });
        });
    }
}

function animate() {
    requestAnimationFrame(animate);
    smoothDeformation += ((isLeftHandClosed ? 1.0 : 0.0) - smoothDeformation) * 0.05;

    if (pointLight) {
        pointLight.position.lerp(lightTargetPos, 0.1);
        crystalMaterial.uniforms.lightPos.value.copy(pointLight.position);
    }

    // LOGIQUE DE SCATTER (Explosion des morceaux)
    originalPositions.forEach(item => {
        // Position cible = Position initiale + (Direction * Intensité Main)
        let targetX = item.pos.x + (item.dir.x * smoothDeformation);
        let targetY = item.pos.y + (item.dir.y * smoothDeformation);
        let targetZ = item.pos.z + (item.dir.z * smoothDeformation);

        // Déplacement fluide vers la cible
        item.mesh.position.x += (targetX - item.mesh.position.x) * 0.1;
        item.mesh.position.y += (targetY - item.mesh.position.y) * 0.1;
        item.mesh.position.z += (targetZ - item.mesh.position.z) * 0.1;

        // Petite rotation individuelle pour le style
        item.mesh.rotation.x += smoothDeformation * 0.02;
        item.mesh.rotation.y += smoothDeformation * 0.03;
    });

    crystalMaterial.uniforms.time.value += 0.015;
    if (object3D) object3D.rotation.y += 0.002; // Rotation lente de l'ensemble
    
    renderer.render(scene, camera);
}

init3D();
animate();

const hands = new Hands({locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`});
hands.setOptions({ maxNumHands: 2, modelComplexity: 1, minDetectionConfidence: 0.6, minTrackingConfidence: 0.6 });
hands.onResults(onResults);
new Camera(videoElement, { onFrame: async () => { await hands.send({image: videoElement}); }, width: 1280, height: 720 }).start();