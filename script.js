const videoElement = document.querySelector('.input_video');
const canvasElement = document.querySelector('.output_canvas');
const ctx = canvasElement.getContext('2d');

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

function onResults(results) {
    canvasElement.width = window.innerWidth;
    canvasElement.height = window.innerHeight;

    ctx.fillStyle = "black";
    ctx.fillRect(0, 0, canvasElement.width, canvasElement.height);

    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        const hand = results.multiHandLandmarks[0];
        const thumb = hand[4];
        const index = hand[8];

        const dist = Math.sqrt(Math.pow(index.x - thumb.x, 2) + Math.pow(index.y - thumb.y, 2));
        const numRects = Math.floor(dist * 150) + 2;
        
        drawTunnel(numRects);
    }
}

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

const camera = new Camera(videoElement, {
    onFrame: async () => {
        await hands.send({image: videoElement});
    },
    width: 1280,
    height: 720
});

camera.start();
