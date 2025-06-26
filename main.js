import { LitElement, html, css } from 'lit';
import { classMap } from 'lit/directives/class-map.js';
import { v4 as uuidv4 } from 'uuid';
import { lobby, room } from './network.js';
import { DrawingCanvas } from './canvas.js';

class DrawItApp extends LitElement {
    static properties = {
        gameState: { type: Object, state: true },
        player: { type: Object, state: true },
        groups: { type: Object, state: true },
        currentGroupId: { type: String, state: true },
        error: { type: String, state: true },
        isLoading: { type: Boolean, state: true },
        peers: { type: Object, state: true },
    };

    constructor() {
        super();
        this.player = {};
        this.groups = {};
        this.currentGroupId = null;
        this.error = '';
        this.isLoading = false;
        this.gameState = {};
        this.peers = {};
        this.drawingCanvas = new DrawingCanvas(() => this.requestUpdate());

        lobby.init(() => {
            this.isLoading = false;
            const myPresence = room.presence[room.clientId];
            this.currentGroupId = myPresence?.groupId || null;
            
            this.groups = room.roomState.groups || {};
            this.peers = room.peers;

            if (this.currentGroupId && this.groups[this.currentGroupId]) {
                this.gameState = this.groups[this.currentGroupId].gameState;
            } else {
                this.gameState = {};
            }
            this.requestUpdate();
        });
    }

    connectedCallback() {
        super.connectedCallback();
        // The WebsimSocket will handle disconnection logic internally.
        // Leaving the group on unload is a good practice if desired.
        if (this.currentGroupId) {
            lobby.leaveGroup();
        }
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        // The WebsimSocket will handle disconnection logic internally.
        // Leaving the group on unload is a good practice if desired.
        if (this.currentGroupId) {
            lobby.leaveGroup();
        }
    }

    _createGroup = () => {
        this.error = '';
        lobby.createGroup();
    }

    _joinGroup = (groupId) => {
        this.error = '';
        lobby.joinGroup(groupId);
    }

    _startGame = async () => {
        this.isLoading = true;
        this.error = '';
        try {
            await lobby.startGame(this.currentGroupId);
        } catch (err) {
            console.error(err);
            this.error = "Failed to generate prompts from AI. Please try again.";
        } finally {
            this.isLoading = false;
        }
    }

    _submitDrawing = () => {
        const drawing = this.drawingCanvas.toDataURL();
        lobby.submitDrawing(drawing);
    }
    
    _submitGuess = (e) => {
        e.preventDefault();
        const input = this.shadowRoot.getElementById('guessInput');
        if (!input.value) return;
        lobby.submitGuess(input.value);
        input.value = '';
    }

    _nextDrawing = () => {
        lobby.nextDrawing(this.currentGroupId);
    }

    _resetGame = () => {
        lobby.resetGame(this.currentGroupId);
    }
    
    firstUpdated() {
        const canvasEl = this.shadowRoot.getElementById('drawing-canvas');
        if (canvasEl) {
            this.drawingCanvas.setCanvas(canvasEl);
        }
    }

    updated(changedProperties) {
        // When the game state changes, ensure the canvas is ready
        if (changedProperties.has('gameState')) {
            const canvasEl = this.shadowRoot.getElementById('drawing-canvas');
            if (canvasEl) {
                this.drawingCanvas.setCanvas(canvasEl);
                if(this.gameState.phase !== 'drawing') {
                     this.drawingCanvas.clear();
                }
            }
        }
    }

    render() {
        if (!room.clientId) {
            return html`
                <div id="spinner">
                    <div class="spinner-border text-primary" role="status">
                        <span class="visually-hidden">Connecting...</span>
                    </div>
                </div>
            `;
        }

        const currentGroup = this.currentGroupId ? this.groups[this.currentGroupId] : null;

        return html`
            ${this.isLoading ? html`
                <div id="spinner">
                    <div class="spinner-border text-primary" role="status">
                        <span class="visually-hidden">Loading...</span>
                    </div>
                </div>` : ''}

            <div class="py-3">
                ${this.error ? html`<div class="alert alert-danger">${this.error}</div>` : ''}
                ${!currentGroup ? this.renderLobby() : this.renderGame(currentGroup)}
            </div>
        `;
    }

    renderLobby() {
        const myInfo = this.peers[room.clientId];
        return html`
            <div class="row justify-content-center">
                <div class="col-md-8 col-lg-6">
                    <div class="card text-center">
                        <div class="card-body">
                            <h1 class="card-title">Draw It <span class="text-primary">AI</span></h1>
                             <p class="card-text">
                                Welcome, <img src="${myInfo?.avatarUrl}" class="player-avatar" style="width:24px;height:24px;vertical-align:middle;"> <strong>${myInfo?.username}</strong>!
                            </p>
                            <p class="card-text">Create a group or join an existing one.</p>
                            <button class="btn btn-primary w-100 mb-3" @click=${this._createGroup}>Create New Group</button>
                            
                            <h2 class="h5 mt-4">Join a Group</h2>
                            <div class="list-group">
                                ${Object.keys(this.groups).length === 0 ? html`<p class="text-muted">No active groups. Create one!</p>` : ''}
                                ${Object.values(this.groups).map(group => {
                                    const hostInfo = this.peers[group.hostId];
                                    return html`
                                    <button type="button" class="list-group-item list-group-item-action d-flex justify-content-between align-items-center" @click=${() => this._joinGroup(group.id)}>
                                        <span>
                                            <img src="${hostInfo?.avatarUrl}" class="player-avatar">
                                            ${hostInfo?.username}'s Group
                                        </span>
                                        <span class="badge bg-primary rounded-pill">${Object.keys(group.playerIds).length} players</span>
                                    </button>
                                `})}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    renderGame(currentGroup) {
        switch(this.gameState.phase) {
            case 'drawing': return this.renderDrawingPhase(currentGroup);
            case 'guessing': return this.renderGuessingPhase(currentGroup);
            case 'reveal': return this.renderRevealPhase(currentGroup);
            default: return this.renderWaitingRoom(currentGroup);
        }
    }

    renderWaitingRoom(currentGroup) {
        const isHost = currentGroup.hostId === room.clientId;
        const hostInfo = this.peers[currentGroup.hostId];
        return html`
            <div class="row justify-content-center">
                <div class="col-md-8 col-lg-6">
                    <div class="card">
                        <div class="card-header">
                            <h2 class="h4 mb-0">Waiting Room</h2>
                            <p class="mb-0 text-muted">Host: ${hostInfo?.username}</p>
                        </div>
                        <div class="card-body">
                            <h3 class="h5">Players:</h3>
                            <ul class="list-group">
                                ${Object.keys(currentGroup.playerIds).map(pid => this.peers[pid]).filter(Boolean).map(p => html`
                                <li class="list-group-item d-flex align-items-center">
                                    <img src="${p.avatarUrl}" class="player-avatar">
                                    ${p.username} ${p.id === room.clientId ? '(You)' : ''}
                                </li>`)}
                            </ul>
                        </div>
                        <div class="card-footer">
                           ${isHost ? html`<button class="btn btn-success w-100" @click=${this._startGame} ?disabled=${Object.keys(currentGroup.playerIds).length < 1}>Start Game</button>`
                                   : html`<p class="text-center text-muted mb-0">Waiting for host to start the game...</p>`}
                        </div>
                    </div>
                </div>
            </div>
        `;
    }
    
    renderDrawingPhase(currentGroup) {
        const myPrompt = this.gameState.prompts[room.clientId];
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
                           ${this.gameState.drawings[room.clientId]
                                ? html`<p class="text-success fw-bold">Drawing submitted! Waiting for others...</p>`
                                : html`<button class="btn btn-primary w-100" @click=${this._submitDrawing}>Submit Drawing</button>`
                            }
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    renderGuessingPhase(currentGroup) {
        const currentDrawingPlayerId = this.gameState.drawingOrder[this.gameState.currentDrawingIndex];
        const drawingData = this.gameState.drawings[currentDrawingPlayerId];
        const isMyDrawing = currentDrawingPlayerId === room.clientId;
        const haveIGuessed = this.gameState.guesses[room.clientId];
        const drawingPlayerInfo = this.peers[currentDrawingPlayerId];

        return html`
            <div class="row justify-content-center">
                <div class="col-12 col-md-10 col-lg-8 text-center">
                    <div class="card">
                         <div class="card-header">
                            <h2 class="h4">Guess ${drawingPlayerInfo?.username}'s drawing!</h2>
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
                            ${Object.values(this.gameState.guesses).filter(Boolean).length} / ${Object.keys(currentGroup.playerIds).length - 1} guesses received.
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    renderRevealPhase(currentGroup) {
        const currentDrawingPlayerId = this.gameState.drawingOrder[this.gameState.currentDrawingIndex];
        const drawingData = this.gameState.drawings[currentDrawingPlayerId];
        const correctAnswer = this.gameState.prompts[currentDrawingPlayerId];
        const playerGuesses = Object.keys(currentGroup.playerIds)
            .filter(pid => pid !== currentDrawingPlayerId)
            .map(pid => {
                const peer = this.peers[pid];
                return { name: peer?.username, avatarUrl: peer?.avatarUrl, guess: this.gameState.guesses[pid] || 'No guess' };
            });
        
        const isHost = currentGroup.hostId === room.clientId;

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
                                    <div class="list-group-item d-flex align-items-center">
                                        <img src="${item.avatarUrl}" class="player-avatar" />
                                        <strong>${item.name}:</strong> <span class="ms-2">${item.guess}</span>
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