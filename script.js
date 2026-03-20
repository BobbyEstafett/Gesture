// On récupère les éléments du DOM
const videoElement = document.querySelector('.input_video');
const canvasElement = document.querySelector('.output_canvas');
const ctx = canvasElement.getContext('2d');

// Fonction de dessin du tunnel
function drawTunnel(count) {
    const centerX = canvasElement.width / 2;
    const centerY = canvasElement.height / 2;
    
    ctx.strokeStyle = '#00ffcc';
    ctx.lineWidth = 2;

    for (let i = 0; i < count; i++) {
        const scale = 1 - (i / count);
        const w = canvasElement.width * scale;
        const h = canvasElement.height * scale;
        
        ctx.globalAlpha = scale;
        ctx.strokeRect(centerX - w / 2, centerY - h / 2, w, h);
    }
}

// Fonction appelée à chaque détection de main
function onResults(results) {
    // Ajuster le canvas à la taille de la fenêtre
    canvasElement.width = window.innerWidth;
    canvasElement.height = window.innerHeight;

    // Effacer l'écran (fond noir)
    ctx.fillStyle = "black";
    ctx.fillRect(0, 0, canvasElement.width, canvasElement.height);

    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        const hand = results.multiHandLandmarks[0];
        const thumb = hand[4];
        const index = hand[8];

        // Calcul de la distance
        const dist = Math.sqrt(Math.pow(index.x - thumb.x, 2) + Math.pow(index.y - thumb.y, 2));
        
        // On multiplie la distance pour avoir entre 2 et 60 rectangles
        const numRects = Math.floor(dist * 150) + 2;
        
        drawTunnel(numRects);
    }
}

// Initialisation de MediaPipe Hands
const hands = new Hands({
    locateFile: (file) => {
        return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
    }
});

hands.setOptions({
    maxNumHands: 1,
    modelComplexity: 1,
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5
});

hands.onResults(onResults);

// Lancement de la caméra
const camera = new Camera(videoElement, {
    onFrame: async () => {
        await hands.send({image: videoElement});
    },
    width: 1280,
    height: 720
});

camera.start();
