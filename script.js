const videoElement = document.querySelector('.input_video');
const statusElement = document.getElementById('status');

let scene, camera, renderer, object3D, voronoiShaderMaterial;
let isHandClosed = false;
let smoothDeformation = 0;

let handJoints = [];
let handBones = [];
const CONNECTIONS = [
    [0,1],[1,2],[2,3],[3,4], [0,5],[5,6],[6,7],[7,8],
    [5,9],[9,10],[10,11],[11,12], [9,13],[13,14],[14,15],[15,16],
    [13,17],[17,18],[18,19],[19,20],[0,17]
];

function init3D() {
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = 5;

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.getElementById('canvas-container').appendChild(renderer.domElement);

    // --- SHADER CORRIGÉ ---
    const geo = new THREE.IcosahedronGeometry(1.5, 32);
    voronoiShaderMaterial = new THREE.ShaderMaterial({
        uniforms: {
            time: { value: 0 },
            deformation: { value: 0 }
        },
        vertexShader: `
            uniform float time;
            uniform float deformation;
            varying float vNoise;
            
            float hash(float n) { return fract(sin(n) * 43758.5453123); }
            float noise(vec3 x) {
                vec3 p = floor(x); vec3 f = fract(x);
                f = f*f*(3.0-2.0*f);
                float n = p.x + p.y*57.0 + 113.0*p.z;
                return mix(mix(mix(hash(n+0.0),hash(n+1.0),f.x),mix(hash(n+57.0),hash(n+58.0),f.x),f.y),
                           mix(mix(hash(n+113.0),hash(n+114.0),f.x),mix(hash(n+170.0),hash(n+171.0),f.x),f.y),f.z);
            }

            void main() {
                vNoise = noise(position * 2.0 + time * 0.5);
                // Déplacement des points
                vec3 newPos = position + normal * vNoise * deformation * 1.2;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(newPos, 1.0);
            }
        `,
        fragmentShader: `
            uniform float deformation;
            varying float vNoise;
            void main() {
                vec3 color1 = vec3(0.0, 1.0, 0.8); // Turquoise
                vec3 color2 = vec3(0.5, 0.0, 1.0); // Violet
                // Utilisation de gl_FragColor (OBLIGATOIRE en Fragment Shader)
                gl_FragColor = vec4(mix(color1, color2, deformation * (vNoise + 0.5)), 1.0);
            }
        `,
        wireframe: true
    });

    object3D = new THREE.Mesh(geo, voronoiShaderMaterial);
    scene.add(object3D);

    // --- VISUEL MAIN ---
    const jointGeo = new THREE.SphereGeometry(0.06, 8, 8);
    const jointMat = new THREE.MeshBasicMaterial({ color: 0x00ffcc });
    for (let i = 0; i < 21; i++) {
        const s = new THREE.Mesh(jointGeo, jointMat);
        handJoints.push(s);
        scene.add(s);
    }

    const boneMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4 });
    CONNECTIONS.forEach(() => {
        const bGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
        const line = new THREE.Line(bGeo, boneMat);
        handBones.push(line);
        scene.add(line);
    });

    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });
}

function onResults(results) {
    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        statusElement.innerText = "Main détectée ! Fermez le poing pour déformer.";
        const landmarks = results.multiHandLandmarks[0];

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

        // Calcul distance Poignet - Bout du majeur pour le poing
        const d = Math.sqrt(Math.pow(landmarks[12].x - landmarks[0].x, 2) + Math.pow(landmarks[12].y - landmarks[0].y, 2));
        isHandClosed = (d < 0.32);
        
        // Suivi de la main pour la rotation
        object3D.rotation.y = (landmarks[9].x - 0.5) * 3;
        object3D.rotation.x = (landmarks[9].y - 0.5) * 2;
    } else {
        statusElement.innerText = "En attente de détection...";
    }
}

function animate() {
    requestAnimationFrame(animate);
    
    smoothDeformation += ( (isHandClosed ? 1.0 : 0.0) - smoothDeformation) * 0.1;

    if (voronoiShaderMaterial) {
        voronoiShaderMaterial.uniforms.time.value += 0.02;
        voronoiShaderMaterial.uniforms.deformation.value = smoothDeformation;
    }
    
    renderer.render(scene, camera);
}

init3D();
animate();

const hands = new Hands({locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`});
hands.setOptions({maxNumHands: 1, modelComplexity: 1, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5});
hands.onResults(onResults);

const cameraApp = new Camera(videoElement, {
    onFrame: async () => { await hands.send({image: videoElement}); },
    width: 1280, height: 720
});
cameraApp.start();
