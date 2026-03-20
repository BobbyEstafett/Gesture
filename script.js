const videoElement = document.querySelector('.input_video');
const canvasElement = document.querySelector('.output_canvas');
const ctx = canvasElement.getContext('2d');

// --- VARIABLES D'ÉTAT ---
let smoothDist = 0; // Distance lissée pour éviter les saccades
let rotationAngle = 0; // Pour l'effet de rotation progressive

function drawTunnel(count) {
    const centerX = canvasElement.width / 2;
    const centerY = canvasElement.height / 2;
    
    ctx.lineWidth = 2;

    for (let i = 0; i < count; i++) {
        ctx.save();
        ctx.translate(centerX, centerY);
        
        // Effet de rotation : chaque rectangle tourne un peu plus que le précédent
        // On multiplie par smoothDist pour que ça tourne plus quand on écarte les doigts
        ctx.rotate(i * 0.02 + rotationAngle);
        
        // Perspective exponentielle (plus réaliste que linéaire)
        const scale = Math.pow(0.96, i);
        const w = canvasElement.width * scale;
        const h = canvasElement.height * scale;
        
        // Couleur : Dégradé du Turquoise (180) vers le Bleu/Violet
        const hue = 180 + (i * 2);
        const light = 50 - (i / count) * 40; // Assombrit le fond du tunnel
        ctx.strokeStyle = `hsl(${hue}, 100%, ${light}%)`;
        
        // Opacité : s'estompe vers le fond
        ctx.globalAlpha = 1 - (i / count);
        
        // Dessin du rectangle (centré grâce au translate)
        ctx.strokeRect(-w / 2, -h / 2, w, h);
        
        ctx.restore();
    }
    
    // Fait tourner le tunnel doucement en continu
    rotationAngle += 0.005;
}

function onResults(results) {
    // Adapter le canvas à la fenêtre
    canvasElement.width = window.innerWidth;
    canvasElement.height = window.innerHeight;

    // EFFET DE TRAÎNÉE (Motion Blur)
    // Au lieu de tout effacer, on dessine un rectangle noir très transparent
    ctx.fillStyle = "rgba(0, 0, 0, 0.15)";
    ctx.fillRect(0, 0, canvasElement.width, canvasElement.height);

    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        const hand = results.multiHandLandmarks[0];
        const thumb = hand[4];
        const index = hand[8];

        // Distance brute (0.0 à 1.0 environ)
        const rawDist = Math.sqrt(Math.pow(index.x - thumb.x, 2) + Math.pow(index.y - thumb.y, 2));
        
        // LISSAGE (Interpolation Linéaire)
        // On ne prend que 10% de la nouvelle valeur à chaque frame
        smoothDist += (rawDist - smoothDist) * 0.1;
        
        // On mappe la distance sur le nombre de rectangles (max 80 pour la performance)
        const numRects = Math.floor(smoothDist * 200) + 5;
        
        drawTunnel(numRects);
    } else {
        // Si aucune main n'est détectée, on continue d'afficher le tunnel
        // avec la dernière distance connue, mais on le réduit doucement
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
  .then(() => console.log("Système prêt !"))
  .catch(e => console.error("Erreur de caméra :", e));
