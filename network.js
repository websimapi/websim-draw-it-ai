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
    // Ensure only one timer runs per group, managed by the host.
    if (room.roomState.groups?.[groupId]?.hostId !== room.clientId) {
        return;
    }

    if (timers[groupId]) {
        clearInterval(timers[groupId]);
    }

    timers[groupId] = setInterval(() => {
        const group = room.roomState.groups?.[groupId];
        if (!group || group.gameState.phase !== 'drawing') {
            clearInterval(timers[groupId]);
            delete timers[groupId];
            return;
        }

        const newTime = group.gameState.timer - 1;
        if (newTime <= 0) {
            clearInterval(timers[groupId]);
            delete timers[groupId];
            
            // Time's up, automatically move to guessing phase
            const blankDrawing = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
            const updatedDrawings = { ...group.gameState.drawings };
            Object.keys(group.playerIds).forEach(playerId => {
                if (!updatedDrawings[playerId]) {
                    updatedDrawings[playerId] = blankDrawing;
                }
            });

            room.updateRoomState({
                groups: {
                    [groupId]: {
                        gameState: {
                            timer: 0,
                            drawings: updatedDrawings,
                            phase: 'guessing',
                            guesses: {},
                        }
                    }
                }
            });
        } else {
            room.updateRoomState({
                groups: {
                    [groupId]: {
                        gameState: { timer: newTime }
                    }
                }
            });
        }
    }, 1000);
}

export const room = new WebsimSocket();

const timers = {};

// --- Public API ---
export const lobby = {
    async init(onChangeCallback) {
        await room.initialize();
        room.subscribeRoomState(onChangeCallback);
        room.subscribePresence(onChangeCallback); // Rerender on player changes too
        onChangeCallback(); // Initial render
    },

    createGroup() {
        const groupId = `group_${room.clientId}_${Date.now()}`;
        room.updateRoomState({
            groups: {
                [groupId]: {
                    id: groupId,
                    hostId: room.clientId,
                    playerIds: { [room.clientId]: true },
                    gameState: { phase: 'waiting' },
                }
            }
        });
        room.updatePresence({ groupId });
    },

    joinGroup(groupId) {
        room.updateRoomState({
            groups: {
                [groupId]: {
                    playerIds: { [room.clientId]: true }
                }
            }
        });
        room.updatePresence({ groupId });
    },

    leaveGroup() {
        const { groupId } = room.presence[room.clientId] || {};
        if (!groupId) return;

        const group = room.roomState.groups?.[groupId];
        if (!group) return;

        room.updatePresence({ groupId: null });

        if (group.hostId === room.clientId) {
            // Host is leaving, delete the group
            room.updateRoomState({ groups: { [groupId]: null } });
        } else {
            // Player is leaving
            room.updateRoomState({ groups: { [groupId]: { playerIds: { [room.clientId]: null } } } });
        }
    },

    async startGame(groupId) {
        const group = room.roomState.groups[groupId];
        const playerIds = Object.keys(group.playerIds);
        const playerCount = playerIds.length;

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

        const drawingPrompts = {};
        const drawings = {};
        playerIds.forEach((id, i) => {
            drawingPrompts[id] = prompts[i];
            drawings[id] = null;
        });
        
        // Shuffle player order for drawing reveals
        const drawingOrder = [...playerIds];
        for (let i = drawingOrder.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [drawingOrder[i], drawingOrder[j]] = [drawingOrder[j], drawingOrder[i]];
        }

        room.updateRoomState({
            groups: {
                [groupId]: {
                    gameState: {
                        phase: 'drawing',
                        prompts: drawingPrompts,
                        drawings,
                        timer: 60,
                        drawingOrder,
                        currentDrawingIndex: 0,
                    }
                }
            }
        });
        startDrawingTimer(groupId);
    },

    submitDrawing(drawingData) {
        const { groupId } = room.presence[room.clientId];
        const group = room.roomState.groups[groupId];
        if (!group) return;
        
        const newDrawings = { ...group.gameState.drawings, [room.clientId]: drawingData };
        
        room.updateRoomState({
            groups: {
                [groupId]: {
                    gameState: { drawings: { [room.clientId]: drawingData } }
                }
            }
        });

        const allSubmitted = Object.keys(group.playerIds).every(pid => newDrawings[pid] !== null);
        if (allSubmitted && group.hostId === room.clientId) {
            if(timers[groupId]) clearInterval(timers[groupId]);
            room.updateRoomState({
                groups: {
                    [groupId]: {
                        gameState: {
                            phase: 'guessing',
                            guesses: {},
                        }
                    }
                }
            });
        }
    },
    
    submitGuess(guess) {
        const { groupId } = room.presence[room.clientId];
        const group = room.roomState.groups[groupId];
        if (!group) return;

        room.updateRoomState({
            groups: {
                [groupId]: {
                    gameState: { guesses: { [room.clientId]: guess } }
                }
            }
        });
        
        const newGuesses = { ...group.gameState.guesses, [room.clientId]: guess };
        const playersWhoCanGuess = Object.keys(group.playerIds).length - 1;
        const totalGuesses = Object.values(newGuesses).filter(Boolean).length;
        
        if (totalGuesses >= playersWhoCanGuess && group.hostId === room.clientId) {
            room.updateRoomState({
                groups: {
                    [groupId]: {
                        gameState: { phase: 'reveal' }
                    }
                }
            });
        }
    },

    nextDrawing(groupId) {
        const group = room.roomState.groups[groupId];
        if (!group || group.hostId !== room.clientId) return;

        const nextIndex = group.gameState.currentDrawingIndex + 1;
        if (nextIndex >= group.gameState.drawingOrder.length) {
            this.resetGame(groupId);
        } else {
            room.updateRoomState({
                groups: {
                    [groupId]: {
                        gameState: {
                            currentDrawingIndex: nextIndex,
                            phase: 'guessing',
                            guesses: {},
                        }
                    }
                }
            });
        }
    },

    resetGame(groupId) {
        const group = room.roomState.groups[groupId];
        if (!group || group.hostId !== room.clientId) return;
        room.updateRoomState({
            groups: {
                [groupId]: {
                    gameState: { phase: 'waiting' }
                }
            }
        });
    }
};