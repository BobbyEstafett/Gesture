const videoElement = document.querySelector('.input_video');
const canvasElement = document.querySelector('.output_canvas');
const ctx = canvasElement.getContext('2d');

// --- VARIABLES D'ÉTAT ---
let smoothDist = 0; // Distance lissée pour éviter les saccades
let rotationAngle = 0; // Pour l'effet de rotation progressive

// --- FONCTION DE DEBUG : DESSINER LA MAIN ---
function drawHandDebug(landmarks) {
    // On définit un style semi-transparent pour ne pas masquer le tunnel
    const connectionsStyle = {color: 'rgba(255, 255, 255, 0.2)', lineWidth: 2};
    const landmarksStyle = {color: 'rgba(0, 255, 200, 0.4)', lineWidth: 1, radius: 3};

    // drawConnectors et drawLandmarks sont fournis par drawing_utils.js
    drawConnectors(ctx, landmarks, HAND_CONNECTIONS, connectionsStyle);
    drawLandmarks(ctx, landmarks, landmarksStyle);

    // Optionnel : Surligner spécifiquement le pouce (4) et l'index (8)
    const thumb = landmarks[4];
    const index = landmarks[8];
    
    ctx.fillStyle = 'rgba(255, 255, 0, 0.6)'; // Jaune pour les points actifs
    ctx.beginPath();
    ctx.arc(thumb.x * canvasElement.width, thumb.y * canvasElement.height, 8, 0, 2 * Math.PI);
    ctx.arc(index.x * canvasElement.width, index.y * canvasElement.height, 8, 0, 2 * Math.PI);
    ctx.fill();
}

// --- FONCTION DE DESSIN DU TUNNEL ---
function drawTunnel(count) {
    const centerX = canvasElement.width / 2;
    const centerY = canvasElement.height / 2;
    
    ctx.lineWidth = 2;

    for (let i = 0; i < count; i++) {
        ctx.save();
        ctx.translate(centerX, centerY);
        ctx.rotate(i * 0.02 + rotationAngle);
        
        const scale = Math.pow(0.96, i);
        const w = canvasElement.width * scale;
        const h = canvasElement.height * scale;
        
        const hue = 180 + (i * 2);
        const light = 50 - (i / count) * 40;
        ctx.strokeStyle = `hsl(${hue}, 100%, ${light}%)`;
        
        ctx.globalAlpha = 1 - (i / count);
        
        ctx.strokeRect(-w / 2, -h / 2, w, h);
        
        ctx.restore();
    }
    rotationAngle += 0.005;
}

// --- BOUCLE PRINCIPALE ---
function onResults(results) {
    // Adapter le canvas à la fenêtre
    canvasElement.width = window.innerWidth;
    canvasElement.height = window.innerHeight;

    // EFFET DE TRAÎNÉE (Motion Blur)
    ctx.fillStyle = "rgba(0, 0, 0, 0.15)";
    ctx.fillRect(0, 0, canvasElement.width, canvasElement.height);

    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        const hand = results.multiHandLandmarks[0];
        const thumb = hand[4];
        const index = hand[8];

        // 1. DESSINER LA RÉPRESENTATION DE LA MAIN (DEBUG)
        // On le fait AVANT le tunnel pour qu'il soit en arrière-plan
        drawHandDebug(hand);

        // 2. CALCUL ET DESSIN DU TUNNEL
        const rawDist = Math.sqrt(Math.pow(index.x - thumb.x, 2) + Math.pow(index.y - thumb.y, 2));
        smoothDist += (rawDist - smoothDist) * 0.1;
        const numRects = Math.floor(smoothDist * 200) + 5;
        
        drawTunnel(numRects);
    } else {
        // Mode autonome si pas de main
        smoothDist *= 0.98;
        if (smoothDist > 0.01) drawTunnel(Math.floor(smoothDist * 200) + 5);
    }
}

// --- CONFIGURATION MEDIAPIPE ---
const hands = new Hands({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
});

hands.setOptions({
    maxNumHands: 1,
    modelComplexity: 1,
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5
});

hands.onResults(onResults);

// --- LANCEMENT CAMÉRA ---
const camera = new Camera(videoElement, {
    onFrame: async () => {
        await hands.send({image: videoElement});
    },
    width: 1280,
    height: 720
});

camera.start()
  .then(() => console.log("Système prêt avec Debug Visuel !"))
  .catch(e => console.error("Erreur de caméra :", e));
