// 1. SELECTEURS ET VARIABLES GLOBALES
const videoElement = document.getElementsByClassName('input_video')[0];
const sysStat = document.getElementById('sys-stat');
const lStat = document.getElementById('l-stat');
const rStat = document.getElementById('r-stat');

let scene, camera, renderer, object3D, voronoiShaderMaterial, pointLight;
let handDistToCenter = 1.0;
let handZDepth = 0.0;
let lightPos = { x: 0, y: 0 };
let smoothDeformation = 0;
let smoothOpacity = 1.0;

let jointsLeft = [], bonesLeft = [];
let jointsRight = [], bonesRight = [];
const CONNECTIONS = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];

// 2. INITIALISATION DU MOTEUR 3D
function init3D() {
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = 5;

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    document.getElementById('canvas-container').appendChild(renderer.domElement);

    // Lumières
    pointLight = new THREE.PointLight(0x00ffff, 2, 20);
    pointLight.position.set(0, 0, 3);
    scene.add(pointLight);
    scene.add(new THREE.AmbientLight(0xffffff, 0.4));

    // Matériau Shader
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
            float hash(float n) { return fract(sin(n) * 43758.5453); }
            float noise(vec3 x) {
                vec3 p = floor(x); vec3 f = fract(x);
                f = f*f*(3.0-2.0*f);
                float n = p.x + p.y*57.0 + 113.0*p.z;
                return mix(mix(mix(hash(n+0.0),hash(n+1.0),f.x),mix(hash(n+57.0),hash(n+58.0),f.x),f.y),
                           mix(mix(hash(n+113.0),hash(n+114.0),f.x),mix(hash(n+170.0),hash(n+171.0),f.x),f.y),f.z);
            }
            void main() {
                vNoise = noise(position * 2.5 + time * 0.5);
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
                gl_FragColor = vec4(mix(col1, col2, deformation), opacity);
            }
        `,
        transparent: true,
        wireframe: true
    });

    // Chargement du modèle GLB
    const loader = new THREE.GLTFLoader();
    loader.load('conifer_cone.glb', (gltf) => {
        object3D = gltf.scene;
        object3D.traverse(c => { if(c.isMesh) c.material = voronoiShaderMaterial; });
        object3D.scale.set(1.5, 1.5, 1.5);
        scene.add(object3D);
        if(sysStat) sysStat.innerText = "READY";
    }, undefined, (err) => {
        console.warn("Modèle non trouvé, utilisation de la sphère.");
        object3D = new THREE.Mesh(new THREE.IcosahedronGeometry(1.5, 32), voronoiShaderMaterial);
        scene.add(object3D);
        if(sysStat) sysStat.innerText = "READY (FALLBACK)";
    });

    // Squelettes des mains
    const jGeo = new THREE.SphereGeometry(0.05, 8, 8);
    for (let i = 0; i < 21; i++) {
        let sL = new THREE.Mesh(jGeo, new THREE.MeshBasicMaterial({color:0xff00cc})); sL.visible = false; jointsLeft.push(sL); scene.add(sL);
        let sR = new THREE.Mesh(jGeo, new THREE.MeshBasicMaterial({color:0x00ffcc})); sR.visible = false; jointsRight.push(sR); scene.add(sR);
    }
    const bMat = new THREE.LineBasicMaterial({color:0xffffff, opacity:0.1, transparent:true});
    CONNECTIONS.forEach(() => {
        let bL = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), bMat);
        let bR = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), bMat);
        bonesLeft.push(bL); scene.add(bL); bonesRight.push(bR); scene.add(bR);
    });
}

// 3. FONCTION DE MISE À JOUR VISUELLE
function updateHandVisuals(lm, jList, bList) {
    lm.forEach((p, i) => {
        jList[i].position.set((p.x-0.5)*8, -(p.y-0.5)*6, -p.z*5);
        jList[i].visible = true;
    });
    CONNECTIONS.forEach((c, i) => {
        bList[i].geometry.setFromPoints([jList[c[0]].position, jList[c[1]].position]);
        bList[i].visible = true;
    });
}

// 4. RÉCEPTION DES RÉSULTATS IA
function onResults(results) {
    [...jointsLeft, ...bonesLeft, ...jointsRight, ...bonesRight].forEach(o => o.visible = false);
    
    if (results.multiHandLandmarks) {
        results.multiHandLandmarks.forEach((lm, i) => {
            const isRight = results.multiHandedness[i].label === 'Right';
            if (isRight) {
                updateHandVisuals(lm, jointsRight, bonesRight);
                lightPos.x = (lm[9].x - 0.5) * 10;
                lightPos.y = -(lm[9].y - 0.5) * 8;
                handZDepth = lm[9].z;
                if(rStat) rStat.innerText = "DETECTED";
            } else {
                updateHandVisuals(lm, jointsLeft, bonesLeft);
                handDistToCenter = Math.sqrt(Math.pow(lm[9].x-0.5, 2) + Math.pow(lm[9].y-0.5, 2));
                if(lStat) lStat.innerText = "DETECTED";
            }
        });
    }
}

// 5. BOUCLE D'ANIMATION
function animate() {
    requestAnimationFrame(animate);

    smoothDeformation += (Math.max(0, 1.0 - (handDistToCenter * 2.5)) - smoothDeformation) * 0.1;
    smoothOpacity += (Math.min(1.0, Math.max(0.2, 1.0 + (handZDepth * 5))) - smoothOpacity) * 0.1;

    if (pointLight) {
        pointLight.position.x += (lightPos.x - pointLight.position.x) * 0.1;
        pointLight.position.y += (lightPos.y - pointLight.position.y) * 0.1;
    }

    if (object3D) {
        voronoiShaderMaterial.uniforms.deformation.value = smoothDeformation;
        voronoiShaderMaterial.uniforms.opacity.value = smoothOpacity;
        voronoiShaderMaterial.uniforms.time.value += 0.02;
        object3D.rotation.y += 0.005;
    }

    renderer.render(scene, camera);
}

// 6. LANCEMENT
init3D();
animate();

const hands = new Hands({locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`});
hands.setOptions({ maxNumHands: 2, modelComplexity: 1, minDetectionConfidence: 0.6, minTrackingConfidence: 0.6 });
hands.onResults(onResults);

const cameraApp = new Camera(videoElement, {
    onFrame: async () => { await hands.send({image: videoElement}); },
    width: 1280, height: 720
});

cameraApp.start().catch(() => { if(sysStat) sysStat.innerText = "ERREUR CAMERA"; });

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});
