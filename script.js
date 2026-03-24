// --- CONFIGURATION ---
const videoElement = document.querySelector('.input_video');
const lStat = document.getElementById('l-stat');

let scene, camera, renderer, object3D, crystalMaterial, pointLight;
let smoothDeformation = 0;
let isLeftHandClosed = false;
let lightTargetPos = new THREE.Vector3(0, 0, 3);
let jointsLeft = [], jointsRight = [];
let fragments = [];

function init3D() {
    const loaderTex = new THREE.TextureLoader();
    const envMap = loaderTex.load('https://raw.githubusercontent.com/bobbyestafett/Gesture/main/wooden_studio_09_2k.jpg');
    envMap.mapping = THREE.EquirectangularReflectionMapping;

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = 5;

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    document.getElementById('canvas-container').appendChild(renderer.domElement);

    pointLight = new THREE.PointLight(0xffffff, 20, 20);
    pointLight.position.set(0, 0, 3);
    scene.add(pointLight);

    // SHADERMATERIAL STANDARD (Plus robuste que RawShader)
    crystalMaterial = new THREE.ShaderMaterial({
        extensions: { derivatives: true },
        uniforms: {
            time: { value: 0 },
            deformation: { value: 0 },
            uEnvMap: { value: envMap },
            lightPos: { value: new THREE.Vector3(0, 0, 3) }
        },
        vertexShader: `
            varying vec3 vNormal;
            varying vec3 vWorldPosition;
            void main() {
                vec4 worldPosition = modelMatrix * vec4(position, 1.0);
                vWorldPosition = worldPosition.xyz;
                vNormal = normalize(normalMatrix * normal);
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            #extension GL_OES_standard_derivatives : enable
            precision highp float;
            varying vec3 vNormal;
            varying vec3 vWorldPosition;
            uniform float time;
            uniform float deformation;
            uniform sampler2D uEnvMap;
            uniform vec3 lightPos;

            void main() {
                // Vecteur de vue
                vec3 viewDir = normalize(vWorldPosition - cameraPosition);
                
                // Flat Shading (Facettes)
                vec3 fdx = dFdx(vWorldPosition);
                vec3 fdy = dFdy(vWorldPosition);
                vec3 faceNormal = normalize(cross(fdx, fdy));

                // Motif Digital Scanlines
                vec2 uvPattern = vNormal.xy * 2.0 + vWorldPosition.xz * 0.5;
                float lines = sin(uvPattern.y * 30.0 + time * 2.0) * 0.5 + 0.5;
                float scan = smoothstep(0.4, 0.5, lines);

                // Réfraction Chromatique (Effet Rainbow)
                vec3 refrR = refract(viewDir, faceNormal, 0.82);
                vec3 refrG = refract(viewDir, faceNormal, 0.85);
                vec3 refrB = refract(viewDir, faceNormal, 0.88);
                
                vec3 colR = 0.5 + 0.5 * cos(time + refrR.zxy * 3.0 + vec3(0.0, 2.0, 4.0));
                vec3 colG = 0.5 + 0.5 * cos(time + refrG.zxy * 3.0 + vec3(2.0, 4.0, 0.0));
                vec3 colB = 0.5 + 0.5 * cos(time + refrB.zxy * 3.0 + vec3(4.0, 0.0, 2.0));
                
                vec3 baseColor = vec3(colR.r, colG.g, colB.b) * (0.3 + scan * 0.7);
                
                // Fresnel & Brillance de surface
                float fresnel = pow(1.0 + dot(viewDir, faceNormal), 3.0);
                vec3 finalColor = mix(baseColor, vec3(0.5, 0.8, 1.0), fresnel * 0.5);

                // Éclat Spéculaire
                vec3 lightDir = normalize(lightPos - vWorldPosition);
                float spec = pow(max(dot(reflect(-lightDir, faceNormal), -viewDir), 0.0), 32.0);

                gl_FragColor = vec4(finalColor + spec * (1.0 + deformation), 0.95);
            }
        `,
        transparent: true
    });

    const loader = new THREE.GLTFLoader();
    loader.load('crystal.glb', (gltf) => {
        object3D = gltf.scene;
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
    }, undefined, () => {
        // Fallback Group
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
            lm.forEach((p, idx) => {
                targetJoints[idx].position.set((p.x-0.5)*10, -(p.y-0.5)*8, -p.z*5);
                targetJoints[idx].visible = true;
            });
            if (isRight) {
                lightTargetPos.x = (lm[9].x - 0.5) * 12;
                lightTargetPos.y = -(lm[9].y - 0.5) * 10;
            } else {
                let curled = 0;
                [8, 12, 16, 20].forEach((tip, idx) => {
                    const base = [5, 9, 13, 17][idx];
                    if (Math.hypot(lm[tip].x - lm[0].x, lm[tip].y - lm[0].y) < Math.hypot(lm[base].x - lm[0].x, lm[base].y - lm[0].y)) curled++;
                });
                isLeftHandClosed = curled >= 3;
            }
        });
    } else {
        isLeftHandClosed = false;
    }
}

function animate() {
    requestAnimationFrame(animate);

    smoothDeformation += ((isLeftHandClosed ? 1.0 : 0.0) - smoothDeformation) * 0.05;

    if (camera) {
        camera.position.z += (5 + (smoothDeformation * 2.5) - camera.position.z) * 0.05;
    }

    if (crystalMaterial && crystalMaterial.uniforms) {
        crystalMaterial.uniforms.time.value += 0.015;
        crystalMaterial.uniforms.deformation.value = smoothDeformation;
        if (pointLight) {
            pointLight.position.lerp(lightTargetPos, 0.1);
            crystalMaterial.uniforms.lightPos.value.copy(pointLight.position);
        }
    }

    fragments.forEach(f => {
        // Multiplicateur 1.5 pour l'éclatement visible
        const tPos = new THREE.Vector3().copy(f.originalPos).addScaledVector(f.explodeDir, smoothDeformation * 1.5);
        f.mesh.position.lerp(tPos, 0.1);
        
        const t = crystalMaterial.uniforms.time.value;
        f.mesh.rotation.x += (f.originalRot.x + (smoothDeformation * Math.sin(t * 2.0 + f.originalPos.x) * 1.5) - f.mesh.rotation.x) * 0.1;
        f.mesh.rotation.z += (f.originalRot.z + (smoothDeformation * Math.cos(t * 2.0 + f.originalPos.y) * 1.5) - f.mesh.rotation.z) * 0.1;
    });

    if (object3D) object3D.rotation.y += 0.002;
    renderer.render(scene, camera);
}

init3D();
animate();

const hands = new Hands({locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`});
hands.setOptions({ maxNumHands: 2, modelComplexity: 1, minDetectionConfidence: 0.6, minTrackingConfidence: 0.6 });
hands.onResults(onResults);
new Camera(videoElement, { onFrame: async () => { await hands.send({image: videoElement}); }, width: 1280, height: 720 }).start();