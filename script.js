const videoElement = document.querySelector('.input_video');
const statusElement = document.getElementById('status');

let scene, camera, renderer, object3D, voronoiShaderMaterial;
let isHandClosed = false;
let smoothDeformation = 0;
let pinchDist = 0;
let smoothScale = 1;

// Configuration du squelette de la main
let handJoints = [];
let handBones = [];
const CONNECTIONS = [
    [0,1],[1,2],[2,3],[3,4], [0,5],[5,6],[6,7],[7,8],
    [5,9],[9,10],[10,11],[11,12], [9,13],[13,14],[14,15],[15,16],
    [13,17],[17,18],[18,19],[19,20],[0,17]
];

function init3D() {
    // SCÈNE & CAMÉRA
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = 5;

    // RENDERER
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    document.getElementById('canvas-container').appendChild(renderer.domElement);

    // L'OBJET INTERACTIF (Shader Custom)
    const geometry = new THREE.IcosahedronGeometry(1.2, 40);
    voronoiShaderMaterial = new THREE.ShaderMaterial({
        uniforms: {
            time: { value: 0 },
            deformation: { value: 0 }
        },
        vertexShader: `
            uniform float time;
            uniform float deformation;
            varying float vNoise;
            varying vec3 vNormal;

            float hash(float n) { return fract(sin(n) * 43758.5453123); }
            float noise(vec3 x) {
                vec3 p = floor(x); vec3 f = fract(x);
                f = f*f*(3.0-2.0*f);
                float n = p.x + p.y*57.0 + 113.0*p.z;
                return mix(mix(mix(hash(n+0.0),hash(n+1.0),f.x),mix(hash(n+57.0),hash(n+58.0),f.x),f.y),
                           mix(mix(hash(n+113.0),hash(n+114.0),f.x),mix(hash(n+170.0),hash(n+171.0),f.x),f.y),f.z);
            }

            void main() {
                vNormal = normal;
                vNoise = noise(position * 2.5 + time * 0.6);
                // Déformation basée sur le poing fermé
                vec3 newPos = position + normal * vNoise * deformation * 1.5;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(newPos, 1.0);
            }
        `,
        fragmentShader: `
            uniform float deformation;
            varying float vNoise;
            varying vec3 vNormal;
            void main() {
                vec3 color1 = vec3(0.0, 1.0, 0.8); // Cyan
                vec3 color2 = vec3(0.6, 0.1, 1.0); // Purple
                
                // Feedback visuel : effet de brillance/pulse
                float glow = pow(0.6 - dot(vNormal, vec3(0,0,1.0)), 2.0);
                vec3 finalColor = mix(color1, color2, deformation);
                finalColor += glow * 0.5 + (vNoise * deformation * 0.3);
                
                gl_FragColor = vec4(finalColor, 1.0);
            }
        `,
        wireframe: true
    });

    object3D = new THREE.Mesh(geometry, voronoiShaderMaterial);
    scene.add(object3D);

    // SQUELETTE DE LA MAIN (Points et Lignes)
    const jointGeo = new THREE.SphereGeometry(0.05, 12, 12);
    const jointMat = new THREE.MeshBasicMaterial({ color: 0x00ffcc, transparent: true, opacity: 0.8 });
    for (let i = 0; i < 21; i++) {
        const s = new THREE.Mesh(jointGeo, jointMat);
        handJoints.push(s);
        scene.add(s);
    }

    const boneMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.3 });
    CONNECTIONS.forEach(() => {
        const bGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
        const line = new THREE.Line(bGeo, boneMat);
        handBones.push(line);
        scene.add(line);
    });

    window.addEventListener('resize', onWindowResize);
}

function onResults(results) {
    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        statusElement.innerText = "Système en ligne : Main détectée";
        const landmarks = results.multiHandLandmarks[0];

        // 1. Mise à jour positions visuelles
        landmarks.forEach((lm, i) => {
            const x = (lm.x - 0.5) * 8;
            const y = -(lm.y - 0.5) * 6;
            const z = -lm.z * 5;
            handJoints[i].position.set(x, y, z);
        });

        CONNECTIONS.forEach((conn, i) => {
            const p1 = handJoints[conn[0]].position;
            const p2 = handJoints[conn[1]].position;
            handBones[i].geometry.setFromPoints([p1, p2]);
        });

        // 2. Détection du POING (Distance Wrist-MiddleTip)
        const dPoing = Math.sqrt(Math.pow(landmarks[12].x - landmarks[0].x, 2) + Math.pow(landmarks[12].y - landmarks[0].y, 2));
        isHandClosed = (dPoing < 0.3);

        // 3. Calcul du ZOOM (Distance ThumbTip-IndexTip)
        pinchDist = Math.sqrt(Math.pow(landmarks[8].x - landmarks[4].x, 2) + Math.pow(landmarks[8].y - landmarks[4].y, 2));
        
        // 4. Rotation de l'objet selon la paume
        object3D.rotation.y = (landmarks[9].x - 0.5) * 4;
        object3D.rotation.x = (landmarks[9].y - 0.5) * 2;
    } else {
        statusElement.innerText = "Recherche de signal manuel...";
        isHandClosed = false;
    }
}

function animate() {
    requestAnimationFrame(animate);

    // Lissage Déformation
    const targetDef = isHandClosed ? 1.0 : 0.0;
    smoothDeformation += (targetDef - smoothDeformation) * 0.1;

    // Lissage Zoom (Scaling)
    // On convertit la distance de pincement (0.05 -> 0.4) en échelle (0.5 -> 3.0)
    const targetScale = 0.5 + (pinchDist * 7);
    smoothScale += (targetScale - smoothScale) * 0.1;

    if (object3D) {
        object3D.scale.set(smoothScale, smoothScale, smoothScale);
        voronoiShaderMaterial.uniforms.time.value += 0.02 + (smoothDeformation * 0.04);
        voronoiShaderMaterial.uniforms.deformation.value = smoothDeformation;
    }

    renderer.render(scene, camera);
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// Lancement global
init3D();
animate();

const hands = new Hands({locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`});
hands.setOptions({maxNumHands: 1, modelComplexity: 1, minDetectionConfidence: 0.6, minTrackingConfidence: 0.6});
hands.onResults(onResults);

const cameraApp = new Camera(videoElement, {
    onFrame: async () => { await hands.send({image: videoElement}); },
    width: 1280, height: 720
});
cameraApp.start().then(() => statusElement.innerText = "Initialisation terminée. Prêt.");
