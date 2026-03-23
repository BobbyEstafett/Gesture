// --- CONFIGURATION ---
const videoElement = document.querySelector('.input_video');
const lStat = document.getElementById('l-stat');
const rStat = document.getElementById('r-stat');

let scene, camera, renderer, object3D, voronoiShaderMaterial, pointLight;
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
    pointLight = new THREE.PointLight(0x00ffff, 5, 20);
    pointLight.position.set(0, 0, 3);
    scene.add(pointLight);
    scene.add(new THREE.AmbientLight(0xffffff, 0.4));

    // SHADER HOLOGRAMME AVEC TEXTURE
    voronoiShaderMaterial = new THREE.ShaderMaterial({
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
            varying vec3 vPosition;
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
                vNoise = noise(position * 2.0 + time * 0.5);
                vec3 newPos = position + normal * vNoise * deformation * 1.2;
                vPosition = (modelViewMatrix * vec4(newPos, 1.0)).xyz;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(newPos, 1.0);
            }
        `,
        fragmentShader: `
            uniform float deformation;
            uniform sampler2D uTexture;
            uniform vec3 lightPos;
            varying float vNoise;
            varying vec3 vNormal;
            varying vec3 vPosition;
            varying vec2 vUv;

            void main() {
                vec4 texColor = texture2D(uTexture, vUv);
                vec3 lightDir = normalize(lightPos - vPosition);
                float diff = max(dot(vNormal, lightDir), 0.2);
                
                vec3 color1 = vec3(0.0, 1.0, 0.8);
                vec3 color2 = vec3(0.6, 0.2, 1.0);
                vec3 holoCol = mix(color1, color2, deformation);
                
                vec3 baseOutput = mix(texColor.rgb, holoCol, 0.25 + deformation * 0.5);
                
                float grid = sin(vUv.x * 60.0) * sin(vUv.y * 60.0);
                grid = smoothstep(0.98, 1.0, grid);
                
                vec3 viewDir = normalize(-vPosition);
                float fresnel = pow(1.0 - max(dot(vNormal, viewDir), 0.0), 3.0);
                
                vec3 finalCol = baseOutput * diff;
                finalCol += holoCol * grid * 0.7;
                finalCol += color1 * fresnel * 1.2;
                
                gl_FragColor = vec4(finalCol, 1.0);
            }
        `,
        transparent: true
    });

    const loader = new THREE.GLTFLoader();
    loader.load('conifer_cone.glb', (gltf) => {
        object3D = gltf.scene;
        object3D.traverse(c => {
            if(c.isMesh) {
                if (c.material.map) {
                    voronoiShaderMaterial.uniforms.uTexture.value = c.material.map;
                    voronoiShaderMaterial.uniforms.uTexture.value.needsUpdate = true;
                }
                c.material = voronoiShaderMaterial;
            }
        });
        object3D.scale.set(1.8, 1.8, 1.8);
        scene.add(object3D);
    }, undefined, (error) => {
        object3D = new THREE.Mesh(new THREE.IcosahedronGeometry(1.5, 32), voronoiShaderMaterial);
        scene.add(object3D);
    });

    const jGeo = new THREE.SphereGeometry(0.04, 8, 8);
    for (let i = 0; i < 21; i++) {
        let sL = new THREE.Mesh(jGeo, new THREE.MeshBasicMaterial({color:0xff00cc})); sL.visible = false; jointsLeft.push(sL); scene.add(sL);
        let sR = new THREE.Mesh(jGeo, new THREE.MeshBasicMaterial({color:0x00ffcc})); sR.visible = false; jointsRight.push(sR); scene.add(sR);
    }
}

function onResults(results) {
    jointsLeft.forEach(j => j.visible = false);
    jointsRight.forEach(j => j.visible = false);

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
                if(rStat) rStat.innerText = "LIGHT ACTIVE";
            } else {
                const dist = Math.sqrt(Math.pow(lm[12].x-lm[0].x,2)+Math.pow(lm[12].y-lm[0].y,2));
                isLeftHandClosed = dist < 0.35;
                if(lStat) lStat.innerText = isLeftHandClosed ? "POING FERMÉ" : "OUVERT";
            }
        });
    }
}

function animate() {
    requestAnimationFrame(animate);
    smoothDeformation += ((isLeftHandClosed ? 1.0 : 0.0) - smoothDeformation) * 0.1;
    if (pointLight) {
        pointLight.position.lerp(lightTargetPos, 0.1);
        if(voronoiShaderMaterial) voronoiShaderMaterial.uniforms.lightPos.value.copy(pointLight.position);
    }
    if (object3D) {
        voronoiShaderMaterial.uniforms.deformation.value = smoothDeformation;
        voronoiShaderMaterial.uniforms.time.value += 0.02;
        object3D.rotation.y += 0.008;
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
