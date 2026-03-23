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

    // LUMIÈRES (Indispensables pour le cristal)
    pointLight = new THREE.PointLight(0xffffff, 10, 20); // Lumière blanche intense
    pointLight.position.set(0, 0, 3);
    scene.add(pointLight);
    scene.add(new THREE.AmbientLight(0x404040, 0.5));

    // SHADER CRYSTAL / RÉFRACTION
    // SHADER CRYSTAL AMÉLIORÉ
        crystalMaterial = new THREE.ShaderMaterial({
            uniforms: {
                time: { value: 0 },
                deformation: { value: 0 },
                lightPos: { value: new THREE.Vector3(0, 0, 3) },
                uTexture: { value: new THREE.Texture() }
            },
            vertexShader: `
                uniform float time;
                uniform float deformation;
                varying float vNoise;
                varying vec3 vNormal;
                varying vec3 vWorldPosition;
                varying vec2 vUv;

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
                    vNoise = noise(position * 1.5 + time * 0.4);
                    vec3 newPos = position + normal * vNoise * deformation * 0.3;
                    vec4 worldPos = modelMatrix * vec4(newPos, 1.0);
                    vWorldPosition = worldPos.xyz;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(newPos, 1.0);
                }
            `,
            fragmentShader: `
                uniform float deformation;
                uniform float time;
                uniform sampler2D uTexture;
                uniform vec3 lightPos;
                varying vec3 vNormal;
                varying vec3 vWorldPosition;
                varying vec2 vUv;

                void main() {
                    vec3 viewDir = normalize(cameraPosition - vWorldPosition);
                    vec3 lightDir = normalize(lightPos - vWorldPosition);
                    
                    // 1. FLAT SHADING (Facettes)
                    vec3 fdx = dFdx(vWorldPosition);
                    vec3 fdy = dFdy(vWorldPosition);
                    vec3 faceNormal = normalize(cross(fdx, fdy));

                    // 2. RÉFRACTION CHROMATIQUE (Effet Prisme)
                    // On augmente un peu l'index pour plus de distorsion
                    float refractIndex = 1.15 + deformation * 0.3;
                    vec3 refractR = refract(-viewDir, faceNormal, 1.0/refractIndex);
                    vec3 refractG = refract(-viewDir, faceNormal, 1.0/(refractIndex + 0.05));
                    vec3 refractB = refract(-viewDir, faceNormal, 1.0/(refractIndex + 0.1));
                    
                    // Lecture texture avec décalage RGB prononcé
                    float r = texture2D(uTexture, vUv + refractR.xy * 0.15).r;
                    float g = texture2D(uTexture, vUv + refractG.xy * 0.15).g;
                    float b = texture2D(uTexture, vUv + refractB.xy * 0.15).b;
                    vec3 crystalCol = vec3(r, g, b);

                    // 3. REFLETS SPÉCULAIRES (Scintillement)
                    // Augmenté à 64.0 pour un éclat plus "sec" et brillant
                    float spec = pow(max(dot(reflect(-lightDir, faceNormal), viewDir), 0.0), 64.0);
                    
                    // 4. FRESNEL (Contour arc-en-ciel)
                    float fresnel = pow(1.0 - max(dot(faceNormal, viewDir), 0.0), 2.5);
                    vec3 rainbow = 0.5 + 0.5 * cos(time + vUv.xyx + vec3(0,2,4));
                    
                    // MIX FINAL
                    vec3 finalCol = crystalCol;
                    finalCol += rainbow * fresnel * 0.5; // Ajout de couleurs sur les arêtes
                    finalCol += vec3(spec) * 1.5; // Reflet de lumière blanc intense
                    
                    gl_FragColor = vec4(finalCol, 0.95);
                }
            `,
            transparent: true,
            extensions: { derivatives: true }
        });

    const loader = new THREE.GLTFLoader();
    loader.load('crystal.glb', (gltf) => {
        object3D = gltf.scene;
        object3D.traverse(c => {
            if(c.isMesh) {
                if (c.material.map) crystalMaterial.uniforms.uTexture.value = c.material.map;
                c.material = crystalMaterial;
            }
        });
        object3D.scale.set(1.8, 1.8, 1.8);
        scene.add(object3D);
    }, undefined, () => {
        object3D = new THREE.Mesh(new THREE.IcosahedronGeometry(1.5, 4), crystalMaterial);
        scene.add(object3D);
    });

    // Joints mains
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
                if(rStat) rStat.innerText = "CRYSTAL LIGHT";
            } else {
                const dist = Math.sqrt(Math.pow(lm[12].x-lm[0].x,2)+Math.pow(lm[12].y-lm[0].y,2));
                isLeftHandClosed = dist < 0.35;
                if(lStat) lStat.innerText = isLeftHandClosed ? "FRACTURE" : "STABLE";
            }
        });
    }
}

function animate() {
    requestAnimationFrame(animate);
    smoothDeformation += ((isLeftHandClosed ? 1.0 : 0.0) - smoothDeformation) * 0.05;
    if (pointLight) {
        pointLight.position.lerp(lightTargetPos, 0.1);
        if(crystalMaterial) crystalMaterial.uniforms.lightPos.value.copy(pointLight.position);
    }
    if (object3D) {
        crystalMaterial.uniforms.deformation.value = smoothDeformation;
        crystalMaterial.uniforms.time.value += 0.015;
        object3D.rotation.y += 0.005;
    }
    renderer.render(scene, camera);
}

init3D();
animate();

const hands = new Hands({locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`});
hands.setOptions({ maxNumHands: 2, modelComplexity: 1, minDetectionConfidence: 0.6, minTrackingConfidence: 0.6 });
hands.onResults(onResults);
new Camera(videoElement, { onFrame: async () => { await hands.send({image: videoElement}); }, width: 1280, height: 720 }).start();

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});
