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

    // LUMIÈRES
    pointLight = new THREE.PointLight(0xffffff, 20, 20);
    pointLight.position.set(0, 0, 3);
    scene.add(pointLight);
    scene.add(new THREE.AmbientLight(0xffffff, 0.5));

    // SHADER "PURE CRYSTAL" - VERSION FIXÉE
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

            float hash(float n) { return fract(sin(n) * 43758.5453); }
            float noise(vec3 x) {
                vec3 p = floor(x); vec3 f = fract(x);
                f = f*f*(3.0-2.0*f);
                float n = p.x + p.y*57.0 + 113.0*p.z;
                return mix(mix(mix(hash(n+0.0),hash(n+1.0),f.x),mix(hash(n+57.0),hash(n+58.0),f.x),f.y),
                           mix(mix(hash(n+113.0),hash(n+114.0),f.x),mix(hash(n+170.0),hash(n+171.0),f.x),f.y),f.z);
            }

            void main() {
                float n = noise(position * 2.0 + time * 0.5);
                vec3 newPos = position + normal * n * deformation * 1.0;
                vec4 worldPos = modelMatrix * vec4(newPos, 1.0);
                vWorldPosition = worldPos.xyz;
                vNormal = normalize(modelMatrix * vec4(normal, 0.0)).xyz;
                gl_Position = projectionMatrix * viewMatrix * worldPos;
            }
        `,
        fragmentShader: `
            #extension GL_OES_standard_derivatives : enable
            precision highp float;

            uniform float time;
            uniform float deformation;
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
                
                // Calcul des facettes dures
                vec3 fdx = dFdx(vWorldPosition);
                vec3 fdy = dFdy(vWorldPosition);
                vec3 faceNormal = normalize(cross(fdx, fdy));

                // Réfraction interne
                vec3 refr = refract(-viewDir, faceNormal, 0.88);
                vec3 crystalCol = getFakeEnv(refr);

                // Scintillement
                float spec = pow(max(dot(reflect(-lightDir, faceNormal), viewDir), 0.0), 64.0);
                float fresnel = pow(1.0 - max(dot(faceNormal, viewDir), 0.0), 3.0);
                
                vec3 holoCol = mix(vec3(0.0, 1.0, 0.8), vec3(0.6, 0.2, 1.0), deformation);
                vec3 finalCol = crystalCol + (holoCol * fresnel * 1.2);
                finalCol += vec3(spec) * 2.0;

                gl_FragColor = vec4(finalCol, 0.95);
            }
        `,
        transparent: true,
        extensions: { derivatives: true }
    });

    const loader = new THREE.GLTFLoader();
    loader.load('crystal.glb', (gltf) => {
        object3D = gltf.scene;
        // Centrage automatique
        const box = new THREE.Box3().setFromObject(object3D);
        const center = box.getCenter(new THREE.Vector3());
        object3D.position.sub(center);
        
        object3D.traverse(c => {
            if(c.isMesh) {
                c.material = crystalMaterial;
                c.material.wireframe = false;
            }
        });
        object3D.scale.set(1.5, 1.5, 1.5);
        scene.add(object3D);
    }, undefined, (error) => {
        // En cas d'erreur (comme ta 404), on lance la sphère
        console.warn("Erreur GLB, chargement de la sphère facétisée.");
        object3D = new THREE.Mesh(new THREE.IcosahedronGeometry(1.5, 3), crystalMaterial);
        scene.add(object3D);
    });

    // Points des mains
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
    smoothDeformation += ((isLeftHandClosed ? 1.0 : 0.0) - smoothDeformation) * 0.05;
    if (pointLight) {
        pointLight.position.lerp(lightTargetPos, 0.1);
        crystalMaterial.uniforms.lightPos.value.copy(pointLight.position);
    }
    crystalMaterial.uniforms.time.value += 0.015;
    crystalMaterial.uniforms.deformation.value = smoothDeformation;
    if (object3D) object3D.rotation.y += 0.005;
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
