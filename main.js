import { LitElement, html, css } from 'lit';
import { classMap } from 'lit/directives/class-map.js';
import { v4 as uuidv4 } from 'uuid';
import { lobby } from './network.js';
import { DrawingCanvas } from './canvas.js';

class DrawItApp extends LitElement {
    static properties = {
        gameState: { type: Object, state: true },
        player: { type: Object, state: true },
        groups: { type: Array, state: true },
        currentGroup: { type: Object, state: true },
        error: { type: String, state: true },
        isLoading: { type: Boolean, state: true },
    };

    constructor() {
        super();
        this.player = { id: uuidv4(), name: '' };
        this.groups = [];
        this.currentGroup = null;
        this.error = '';
        this.isLoading = false;
        this.gameState = {};
        this.drawingCanvas = new DrawingCanvas();

        window.addEventListener('groups-update', this.handleGroupsUpdate);
        window.addEventListener('group-update', this.handleGroupUpdate);
        window.addEventListener('game-state-update', this.handleGameStateUpdate);
        window.addEventListener('error', (e) => this.error = e.detail.message);
    }

    connectedCallback() {
        super.connectedCallback();
        lobby.getGroups();
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        window.removeEventListener('groups-update', this.handleGroupsUpdate);
        window.removeEventListener('group-update', this.handleGroupUpdate);
        window.removeEventListener('game-state-update', this.handleGameStateUpdate);
        if (this.currentGroup) {
            lobby.leaveGroup(this.currentGroup.id, this.player);
        }
    }

    handleGroupsUpdate = (e) => this.groups = e.detail;
    handleGroupUpdate = (e) => this.currentGroup = e.detail;
    handleGameStateUpdate = (e) => {
        this.gameState = e.detail;
        this.isLoading = false;
        this.requestUpdate();
    }
    
    _handleNameInput = (e) => this.player.name = e.target.value;

    _createGroup = () => {
        if (!this.player.name) { this.error = "Please enter a name."; return; }
        this.error = '';
        lobby.createGroup(this.player);
    }

    _joinGroup = (groupId) => {
        if (!this.player.name) { this.error = "Please enter a name before joining."; return; }
        this.error = '';
        lobby.joinGroup(groupId, this.player);
    }

    _startGame = async () => {
        this.isLoading = true;
        this.error = '';
        try {
            const playerCount = this.currentGroup.players.length;
            const completion = await websim.chat.completions.create({
                messages: [{
                    role: 'system',
                    content: `Generate a list of ${playerCount} unique, simple, and drawable concepts for a Pictionary-style game. The concepts should be SFW and recognizable by most people. Respond ONLY with a JSON object in the format: {"prompts": ["concept 1", "concept 2", ...]}.`
                }, {
                    role: 'user',
                    content: `Number of players: ${playerCount}`
                }],
                json: true
            });
            const { prompts } = JSON.parse(completion.content);
            if (!prompts || prompts.length < playerCount) throw new Error("AI did not return enough prompts.");
            lobby.startGame(this.currentGroup.id, prompts);
        } catch (err) {
            console.error(err);
            this.error = "Failed to generate prompts from AI. Please try again.";
            this.isLoading = false;
        }
    }

    _submitDrawing = () => {
        const drawing = this.drawingCanvas.toDataURL();
        lobby.submitDrawing(this.currentGroup.id, this.player.id, drawing);
    }
    
    _submitGuess = (e) => {
        e.preventDefault();
        const input = this.shadowRoot.getElementById('guessInput');
        if (!input.value) return;
        lobby.submitGuess(this.currentGroup.id, this.player.id, input.value);
        input.value = '';
    }

    _nextDrawing = () => {
        lobby.nextDrawing(this.currentGroup.id);
    }

    _resetGame = () => {
        lobby.resetGame(this.currentGroup.id);
    }
    
    firstUpdated() {
        const canvasEl = this.shadowRoot.getElementById('drawing-canvas');
        if (canvasEl) {
            this.drawingCanvas.setCanvas(canvasEl);
        }
    }

    updated(changedProperties) {
        if (changedProperties.has('gameState')) {
            const canvasEl = this.shadowRoot.getElementById('drawing-canvas');
            if (canvasEl) {
                this.drawingCanvas.setCanvas(canvasEl);
                this.drawingCanvas.clear();
            }
        }
    }

    render() {
        return html`
            ${this.isLoading ? html`
                <div id="spinner">
                    <div class="spinner-border text-primary" role="status">
                        <span class="visually-hidden">Loading...</span>
                    </div>
                </div>` : ''}

            <div class="py-3">
                ${this.error ? html`<div class="alert alert-danger">${this.error}</div>` : ''}
                ${!this.currentGroup ? this.renderLobby() : this.renderGame()}
            </div>
        `;
    }

    renderLobby() {
        return html`
            <div class="row justify-content-center">
                <div class="col-md-8 col-lg-6">
                    <div class="card text-center">
                        <div class="card-body">
                            <h1 class="card-title">Draw It <span class="text-primary">AI</span></h1>
                            <p class="card-text">Enter your name, then create a group or join an existing one.</p>
                            <div class="mb-3">
                                <input type="text" class="form-control" placeholder="Your Name" .value=${this.player.name} @input=${this._handleNameInput}>
                            </div>
                            <button class="btn btn-primary w-100 mb-3" @click=${this._createGroup}>Create New Group</button>
                            
                            <h2 class="h5 mt-4">Join a Group</h2>
                            <div class="list-group">
                                ${this.groups.length === 0 ? html`<p class="text-muted">No active groups. Create one!</p>` : ''}
                                ${this.groups.map(group => html`
                                    <button type="button" class="list-group-item list-group-item-action" @click=${() => this._joinGroup(group.id)}>
                                        ${group.host.name}'s Group (${group.players.length} players)
                                    </button>
                                `)}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    renderGame() {
        switch(this.gameState.phase) {
            case 'drawing': return this.renderDrawingPhase();
            case 'guessing': return this.renderGuessingPhase();
            case 'reveal': return this.renderRevealPhase();
            default: return this.renderWaitingRoom();
        }
    }

    renderWaitingRoom() {
        const isHost = this.currentGroup.host.id === this.player.id;
        return html`
            <div class="row justify-content-center">
                <div class="col-md-8 col-lg-6">
                    <div class="card">
                        <div class="card-header">
                            <h2 class="h4 mb-0">Waiting Room</h2>
                            <p class="mb-0 text-muted">Host: ${this.currentGroup.host.name}</p>
                        </div>
                        <div class="card-body">
                            <h3 class="h5">Players:</h3>
                            <ul class="list-group">
                                ${this.currentGroup.players.map(p => html`<li class="list-group-item">${p.name} ${p.id === this.player.id ? '(You)' : ''}</li>`)}
                            </ul>
                        </div>
                        <div class="card-footer">
                           ${isHost ? html`<button class="btn btn-success w-100" @click=${this._startGame} ?disabled=${this.currentGroup.players.length < 1}>Start Game</button>`
                                   : html`<p class="text-center text-muted mb-0">Waiting for host to start the game...</p>`}
                        </div>
                    </div>
                </div>
            </div>
        `;
    }
    
    renderDrawingPhase() {
        const myPrompt = this.gameState.prompts[this.player.id];
        return html`
            <div class="row justify-content-center">
                <div class="col-12 col-md-10 col-lg-8 text-center">
                     <div class="card">
                        <div class="card-header">
                            <h2 class="h4">Time left: ${this.gameState.timer}s</h2>
                            <p class="h5 text-primary fw-bold">Draw: ${myPrompt}</p>
                        </div>
                        <div class="card-body">
                            <canvas id="drawing-canvas" width="500" height="500"></canvas>
                             <div class="mt-3 d-flex justify-content-center align-items-center flex-wrap gap-2">
                                ${this.drawingCanvas.colors.map(color => html`
                                    <div class="color-swatch ${classMap({active: this.drawingCanvas.activeColor === color})}" 
                                         style="background-color: ${color}"
                                         @click=${() => this.drawingCanvas.setColor(color)}>
                                    </div>
                                `)}
                                <button class="btn btn-secondary btn-sm" @click=${() => this.drawingCanvas.setColor('#FFFFFF')}>Eraser</button>
                                <button class="btn btn-danger btn-sm" @click=${() => this.drawingCanvas.clear()}>Clear</button>
                            </div>
                        </div>
                        <div class="card-footer">
                           ${this.gameState.drawings[this.player.id]
                                ? html`<p class="text-success fw-bold">Drawing submitted! Waiting for others...</p>`
                                : html`<button class="btn btn-primary w-100" @click=${this._submitDrawing}>Submit Drawing</button>`
                            }
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    renderGuessingPhase() {
        const currentDrawingPlayerId = this.gameState.drawingOrder[this.gameState.currentDrawingIndex];
        const drawingData = this.gameState.drawings[currentDrawingPlayerId];
        const isMyDrawing = currentDrawingPlayerId === this.player.id;
        const haveIGuessed = this.gameState.guesses[this.player.id];

        return html`
            <div class="row justify-content-center">
                <div class="col-12 col-md-10 col-lg-8 text-center">
                    <div class="card">
                         <div class="card-header">
                            <h2 class="h4">Guess the drawing!</h2>
                        </div>
                        <div class="card-body">
                            <img src=${drawingData} class="player-drawing img-fluid" alt="Player's drawing">
                            ${isMyDrawing 
                                ? html`<p class="mt-3 text-muted fw-bold">This is your drawing. Let's see what others guess!</p>`
                                : haveIGuessed
                                    ? html`<p class="mt-3 text-success fw-bold">Guess submitted! Waiting for others...</p>`
                                    : html`
                                        <form @submit=${this._submitGuess} class="mt-3">
                                            <div class="input-group">
                                                <input id="guessInput" type="text" class="form-control" placeholder="Your guess...">
                                                <button class="btn btn-primary" type="submit">Submit</button>
                                            </div>
                                        </form>
                                    `
                            }
                        </div>
                         <div class="card-footer text-muted">
                            ${Object.values(this.gameState.guesses).filter(Boolean).length} / ${this.currentGroup.players.length - 1} guesses received.
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    renderRevealPhase() {
        const currentDrawingPlayerId = this.gameState.drawingOrder[this.gameState.currentDrawingIndex];
        const drawingData = this.gameState.drawings[currentDrawingPlayerId];
        const correctAnswer = this.gameState.prompts[currentDrawingPlayerId];
        const playerGuesses = this.currentGroup.players
            .filter(p => p.id !== currentDrawingPlayerId)
            .map(p => ({ name: p.name, guess: this.gameState.guesses[p.id] || 'No guess' }));
        
        const isHost = this.currentGroup.host.id === this.player.id;

        return html`
            <div class="row justify-content-center">
                <div class="col-12 col-md-10 col-lg-8 text-center">
                    <div class="card">
                        <div class="card-header">
                           <h2 class="h4">Results</h2>
                        </div>
                        <div class="card-body">
                            <img src=${drawingData} class="player-drawing img-fluid mb-3" alt="Player's drawing">
                            <p class="text-muted">The answer was:</p>
                            <div class="correct-answer mb-4">${correctAnswer}</div>
                            <h3 class="h5">Guesses:</h3>
                             <div class="list-group text-start">
                                ${playerGuesses.map(item => html`
                                    <div class="list-group-item">
                                        <strong>${item.name}:</strong> ${item.guess}
                                    </div>
                                `)}
                            </div>
                        </div>
                        <div class="card-footer">
                             ${isHost ? html`<button class="btn btn-primary w-100" @click=${this._nextDrawing}>Next Drawing</button>`
                                      : html`<p class="text-muted">Waiting for host to continue...</p>`}
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    static styles = css`
        :host {
            display: block;
        }
    `;
}

customElements.define('draw-it-app', DrawItApp);

// Mount the app
const appRoot = document.getElementById('app');
appRoot.innerHTML = '<draw-it-app></draw-it-app>';

