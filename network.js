/**
 * Simulated Real-time Multiplayer Service
 * This file mimics a server-side lobby and game management system.
 * It uses a global object (`window.__LOBBY_DATA__`) as a "database"
 * and CustomEvents for real-time communication between clients (in the same browser).
 */

// Initialize the "server" state
window.__LOBBY_DATA__ = {
    groups: {}, // { [groupId]: { id, host, players, gameState } }
};

const DB = window.__LOBBY_DATA__;

function dispatch(eventName, detail) {
    window.dispatchEvent(new CustomEvent(eventName, { detail }));
}

function broadcastGroups() {
    const groupList = Object.values(DB.groups).map(({ id, host, players }) => ({ id, host, players: players.map(p=>p) }));
    dispatch('groups-update', groupList);
}

function broadcastGroupState(groupId) {
    if (!DB.groups[groupId]) return;
    const { players, host } = DB.groups[groupId];
    dispatch('group-update', { ...DB.groups[groupId], players: [...players], host: {...host} });
}

function broadcastGameState(groupId) {
    if (!DB.groups[groupId] || !DB.groups[groupId].gameState) return;
    dispatch('game-state-update', { ...DB.groups[groupId].gameState });
}

function createGameState(prompts, players) {
    const drawingPrompts = {};
    const drawings = {};
    const playerIds = players.map(p => p.id);
    // Shuffle player order for drawing reveals
    for (let i = playerIds.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [playerIds[i], playerIds[j]] = [playerIds[j], playerIds[i]];
    }

    players.forEach((p, i) => {
        drawingPrompts[p.id] = prompts[i];
        drawings[p.id] = null;
    });

    return {
        phase: 'drawing', // 'waiting', 'drawing', 'guessing', 'reveal', 'end'
        prompts: drawingPrompts,
        drawings,
        guesses: {},
        timer: 60,
        drawingOrder: playerIds,
        currentDrawingIndex: 0,
    };
}

let gameInterval = null;

function startDrawingTimer(groupId) {
    gameInterval = setInterval(() => {
        const group = DB.groups[groupId];
        if (!group || group.gameState.phase !== 'drawing') {
            clearInterval(gameInterval);
            return;
        }
        group.gameState.timer -= 1;
        if (group.gameState.timer <= 0) {
            clearInterval(gameInterval);
            // Time's up, automatically move to guessing phase
            const allDrawingsSubmitted = Object.values(group.gameState.drawings).every(d => d !== null);
            if (!allDrawingsSubmitted) {
                // Submit blank drawings for those who didn't finish
                group.players.forEach(p => {
                    if (!group.gameState.drawings[p.id]) {
                        group.gameState.drawings[p.id] = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
                    }
                });
            }
            group.gameState.phase = 'guessing';
            group.gameState.guesses = {}; // Reset guesses for the first drawing
        }
        broadcastGameState(groupId);
    }, 1000);
}

// --- Public API ---
export const lobby = {
    createGroup(player) {
        const groupId = `group_${Date.now()}`;
        DB.groups[groupId] = {
            id: groupId,
            host: player,
            players: [player],
            gameState: { phase: 'waiting' },
        };
        broadcastGroups();
        broadcastGroupState(groupId);
        broadcastGameState(groupId);
    },

    joinGroup(groupId, player) {
        const group = DB.groups[groupId];
        if (group && !group.players.find(p => p.id === player.id)) {
            group.players.push(player);
            broadcastGroups();
            broadcastGroupState(groupId);
            broadcastGameState(groupId);
        } else {
            dispatch('error', { message: 'Group not found or you are already in it.' });
        }
    },

    getGroups() {
        broadcastGroups();
    },

    leaveGroup(groupId, player) {
       // Simplified: In a real app, handle host leaving, etc.
       const group = DB.groups[groupId];
       if (!group) return;
       group.players = group.players.filter(p => p.id !== player.id);
       if (group.players.length === 0) {
           delete DB.groups[groupId];
       }
       broadcastGroups();
       broadcastGroupState(groupId);
    },

    startGame(groupId, prompts) {
        const group = DB.groups[groupId];
        if (!group) return;
        group.gameState = createGameState(prompts, group.players);
        broadcastGameState(groupId);
        startDrawingTimer(groupId);
    },

    submitDrawing(groupId, playerId, drawingData) {
        const group = DB.groups[groupId];
        if (!group) return;
        group.gameState.drawings[playerId] = drawingData;

        // Check if all drawings are submitted
        const allSubmitted = group.players.every(p => group.gameState.drawings[p.id] !== null);
        if (allSubmitted) {
            clearInterval(gameInterval);
            group.gameState.phase = 'guessing';
            group.gameState.guesses = {}; // Reset guesses
        }
        broadcastGameState(groupId);
    },
    
    submitGuess(groupId, playerId, guess) {
        const group = DB.groups[groupId];
        if (!group) return;
        group.gameState.guesses[playerId] = guess;

        const playersWhoCanGuess = group.players.length - 1;
        const totalGuesses = Object.values(group.gameState.guesses).filter(Boolean).length;

        if (totalGuesses >= playersWhoCanGuess) {
            group.gameState.phase = 'reveal';
        }
        broadcastGameState(groupId);
    },

    nextDrawing(groupId) {
        const group = DB.groups[groupId];
        if (!group) return;
        group.gameState.currentDrawingIndex++;
        if (group.gameState.currentDrawingIndex >= group.gameState.drawingOrder.length) {
            // End of game
            this.resetGame(groupId); // Or go to a final score screen
        } else {
            group.gameState.phase = 'guessing';
            group.gameState.guesses = {}; // Reset for next drawing
            broadcastGameState(groupId);
        }
    },

    resetGame(groupId) {
        const group = DB.groups[groupId];
        if (!group) return;
        group.gameState = { phase: 'waiting' };
        broadcastGameState(groupId);
        broadcastGroupState(groupId);
    }
};

