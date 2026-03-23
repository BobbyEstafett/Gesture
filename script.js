// --- CONFIGURATION ---
const videoElement = document.querySelector('.input_video');
const statMains = document.getElementById('stat-mains');
const statZoom = document.getElementById('stat-zoom'); // Deviendra "LUMIÈRE"
const statEtat = document.getElementById('stat-etat'); // Deviendra "PROXIMITÉ"

let scene, camera, renderer, object3D, voronoiShaderMaterial, pointLight;
let handDistToCenter = 0; // Pour l'aimant
let handZDepth = 0;       // Pour la croissance
let lightPos = { x: 0, y: 0 };

// Squelettes 3D
let jointsLeft = [], bonesLeft = [];
let jointsRight = [], bonesRight = [];
const CONNECTIONS = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];

function init3D() {
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = 5;

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.getElementById('canvas-container').appendChild(renderer.domElement);

    // 1. LUMIÈRES
    pointLight = new THREE.PointLight(0x00ffff, 2, 20);
    scene.add(pointLight);
    scene.add(new THREE.AmbientLight(0xffffff, 0.3));

    // 2. SHADER DYNAMIQUE
    voronoiShaderMaterial = new THREE.ShaderMaterial({
        uniforms: {
            time: { value: 0 },
            deformation: { value: 0 },
            opacity: { value: 1.0 }
        },
        vertexShader: `
            uniform float time;
            uniform float deformation;
            varying float vNoise;
            varying vec3 vNormal;
            float hash(float n) { return fract(sin(n) * 43758.5453); }
            float noise(vec3 x) {
                vec3 p = floor(x); vec3 f = fract(x);
                f = f*f*(3.0-2.0*f);
                float n = p.x + p.y*57.0 + 113.0*p.z;
                return mix(mix(mix(hash(n+0.0),hash(n+1.0),f.x),mix(hash(n+57.0),hash(n+58.0),f.x),f.y),
                           mix(mix(hash(n+113.0),hash(n+114.0),f.x),mix(hash(n+170.0),hash(n+171.0),f.x),f.y),f.z);
            }
            void main() {
                vNormal = normal;
                vNoise = noise(position * 2.0 + time * 0.5);
                vec3 newPos = position + normal * vNoise * deformation * 1.5;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(newPos, 1.0);
            }
        `,
        fragmentShader: `
            uniform float deformation;
            uniform float opacity;
            varying float vNoise;
            void main() {
                vec3 col1 = vec3(0.0, 1.0, 0.8);
                vec3 col2 = vec3(0.5, 0.0, 1.0);
                vec3 finalCol = mix(col1, col2, deformation);
                gl_FragColor = vec4(finalCol, opacity);
            }
        `,
        transparent: true,
        wireframe: true
    });

    // 3. CHARGEMENT MODÈLE
    const loader = new THREE.GLTFLoader();
    loader.load('conifer_cone.glb', (gltf) => {
        object3D = gltf.scene;
        object3D.traverse(c => { if(c.isMesh) c.material = voronoiShaderMaterial; });
        object3D.scale.set(1.5, 1.5, 1.5);
        scene.add(object3D);
    });

    // 4. MAINS VISUELLES
    const jGeo = new THREE.SphereGeometry(0.04, 8, 8);
    for (let i = 0; i < 21; i++) {
        let sL = new THREE.Mesh(jGeo, new THREE.MeshBasicMaterial({color:0xff00cc})); jointsLeft.push(sL); scene.add(sL);
        let sR = new THREE.Mesh(jGeo, new THREE.MeshBasicMaterial({color:0x00ffcc})); jointsRight.push(sR); scene.add(sR);
    }
    CONNECTIONS.forEach(() => {
        let b = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({color:0xffffff, opacity:0.2, transparent:true}));
        bonesLeft.push(b); scene.add(b);
        let b2 = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({color:0xffffff, opacity:0.2, transparent:true}));
        bonesRight.push(b2); scene.add(b2);
    });
}

function onResults(results) {
    [...jointsLeft, ...bonesLeft, ...jointsRight, ...bonesRight].forEach(o => o.visible = false);
    
    if (results.multiHandLandmarks) {
        for (let i = 0; i < results.multiHandLandmarks.length; i++) {
            const lm = results.multiHandLandmarks[i];
            const isRight = results.multiHandedness[i].label === 'Right';

            if (isRight) {
                updateHand(lm, jointsRight, bonesRight);
                // INTERACTION 2 & 3 : Lumière (X,Y) et Croissance (Z)
                lightPos.x = (lm[9].x - 0.5) * 10;
                lightPos.y = -(lm[9].y - 0.5) * 8;
                handZDepth = lm[9].z; // Z relatif
            } else {
                updateHand(lm, jointsLeft, bonesLeft);
                // INTERACTION 1 : Aimant (Distance au centre)
                const dx = lm[9].x - 0.5;
                const dy = lm[9].y - 0.5;
                handDistToCenter = Math.sqrt(dx*dx + dy*dy);
            }
        }
    }
}

function updateHand(lm, jList, bList) {
    lm.forEach((p, i) => {
        jList[i].position.set((p.x-0.5)*8, -(p.y-0.5)*6, -p.z*5);
        jList[i].visible = true;
    });
    CONNECTIONS.forEach((c, i) => {
        bList[i].geometry.setFromPoints([jList[c[0]].position, jList[c[1]].position]);
        bList[i].visible = true;
    });
}

function animate() {
    requestAnimationFrame(animate);

    // 1. AIMANT : Plus la main gauche est proche du centre, plus on déforme
    const targetDef = Math.max(0, 1.0 - (handDistToCenter * 2.5));
    smoothDeformation += (targetDef - smoothDeformation) * 0.1;

    // 2. LUMIÈRE : Suit la main droite
    if (pointLight) {
        pointLight.position.lerp(new THREE.Vector3(lightPos.x, lightPos.y, 2), 0.1);
    }

    // 3. CROISSANCE : La profondeur Z de la main droite change l'opacité
    const targetOpacity = Math.min(1.0, Math.max(0.2, 1.0 + (handZDepth * 5)));
    
    if (object3D && voronoiShaderMaterial) {
        voronoiShaderMaterial.uniforms.deformation.value = smoothDeformation;
        voronoiShaderMaterial.uniforms.opacity.value = targetOpacity;
        voronoiShaderMaterial.uniforms.time.value += 0.02;
        // Rotation automatique pour le style
        object3D.rotation.y += 0.005;
    }

    renderer.render(scene, camera);
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

init3D();
animate();

const hands = new Hands({locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`});
hands.setOptions({ maxNumHands: 2, modelComplexity: 1, minDetectionConfidence: 0.6, minTrackingConfidence: 0.6 });
hands.onResults(onResults);
const cameraApp = new Camera(videoElement, { onFrame: async () => { await hands.send({image: videoElement}); }, width: 1280, height: 720 });
cameraApp.start();
