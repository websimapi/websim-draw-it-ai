export class DrawingCanvas {
    constructor() {
        this.canvas = null;
        this.ctx = null;
        this.drawing = false;
        this.lastPos = { x: 0, y: 0 };
        this.colors = ['#000000', '#dc3545', '#fd7e14', '#ffc107', '#198754', '#0d6efd', '#6f42c1'];
        this.activeColor = '#000000';
    }

    setCanvas(canvasElement) {
        if (!canvasElement) return;
        this.canvas = canvasElement;
        this.ctx = this.canvas.getContext('2d');
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';
        this.ctx.lineWidth = 5;
        this.addEventListeners();
        this.resizeCanvas();
    }

    addEventListeners() {
        this.canvas.addEventListener('mousedown', (e) => this.startDrawing(this.getPos(e)));
        this.canvas.addEventListener('mouseup', () => this.stopDrawing());
        this.canvas.addEventListener('mouseout', () => this.stopDrawing());
        this.canvas.addEventListener('mousemove', (e) => this.draw(this.getPos(e)));
        
        this.canvas.addEventListener('touchstart', (e) => this.startDrawing(this.getPos(e.touches[0])), { passive: false });
        this.canvas.addEventListener('touchend', () => this.stopDrawing());
        this.canvas.addEventListener('touchmove', (e) => {
            e.preventDefault();
            this.draw(this.getPos(e.touches[0]));
        }, { passive: false });
        
        window.addEventListener('resize', this.resizeCanvas.bind(this));
    }
    
    resizeCanvas() {
        const parent = this.canvas.parentElement;
        if(parent) {
            const data = this.toDataURL(); // Save drawing
            this.canvas.width = parent.clientWidth;
            this.canvas.height = parent.clientWidth; // Maintain square
            this.ctx.lineCap = 'round';
            this.ctx.lineJoin = 'round';
            this.ctx.lineWidth = 5;
            this.setColor(this.activeColor); // re-apply settings
            const img = new Image();
            img.onload = () => {
                this.ctx.drawImage(img, 0, 0);
            };
            img.src = data;
        }
    }
    
    getPos(event) {
        const rect = this.canvas.getBoundingClientRect();
        return {
            x: event.clientX - rect.left,
            y: event.clientY - rect.top,
        };
    }

    startDrawing(pos) {
        this.drawing = true;
        this.lastPos = pos;
    }

    stopDrawing() {
        this.drawing = false;
    }

    draw(pos) {
        if (!this.drawing) return;
        this.ctx.beginPath();
        this.ctx.moveTo(this.lastPos.x, this.lastPos.y);
        this.ctx.lineTo(pos.x, pos.y);
        this.ctx.stroke();
        this.lastPos = pos;
    }
    
    setColor(color) {
        this.activeColor = color;
        this.ctx.strokeStyle = this.activeColor;
        // Trigger a re-render in the Lit component
        document.querySelector('draw-it-app').requestUpdate();
    }
    
    clear() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
    
    toDataURL() {
        return this.canvas.toDataURL('image/png');
    }
}

