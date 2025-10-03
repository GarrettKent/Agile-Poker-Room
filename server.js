// Import required modules
const express = require('express');        // Web server framework
const http = require('http');              // HTTP server
const socketIO = require('socket.io');     // Real-time bidirectional communication
const path = require('path');              // File path utilities

// Initialize Express application
const app = express();

// Create HTTP server with Express app
const server = http.createServer(app);

// Initialize Socket.IO with CORS enabled for cross-origin requests
const io = socketIO(server, {
    cors: {
        origin: '*',                       // Allow all origins (adjust for production)
        methods: ['GET', 'POST']           // Allowed HTTP methods
    }
});

// Serve static files (HTML, CSS, JS) from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

/**
 * Room Management
 * In-memory storage for all active poker rooms
 * Key: room code (string), Value: room object
 */
const rooms = new Map();

/**
 * Room Factory Function
 * Creates a new room object with all necessary methods
 * Using factory pattern instead of class/constructor
 * 
 * @param {string} code - The unique room code
 * @param {string} admin - Name of the admin (room creator)
 * @returns {Object} Room object with methods and properties
 */
const createRoom = (code, admin) => {
    return {
        // Room properties
        code: code,                         // Unique identifier for this room
        admin: admin,                       // Name of the admin user
        players: [{ 
            name: admin,                    // Admin is also a player
            vote: null,                     // Admin doesn't vote
            socketId: null                  // Socket connection ID
        }],
        revealed: false,                    // Whether votes are currently visible
        
        /**
         * Add a new player to the room or update existing player's socket
         * Handles reconnection scenarios where player name exists but socket changed
         * @param {string} name - Player name
         * @param {string} socketId - Socket.IO connection ID
         */
        addPlayer(name, socketId) {
            const existingPlayer = this.players.find(p => p.name === name);
            if (existingPlayer) {
                // Player rejoining - update their socket ID
                existingPlayer.socketId = socketId;
            } else {
                // New player - add to the room
                this.players.push({ name, vote: null, socketId });
            }
        },
        
        /**
         * Remove a player from the room by socket ID
         * Returns info about whether removal was successful and if it was admin
         * @param {string} socketId - Socket.IO connection ID
         * @returns {Object} {removed: boolean, wasAdmin: boolean}
         */
        removePlayer(socketId) {
            const index = this.players.findIndex(p => p.socketId === socketId);
            if (index > -1) {
                const player = this.players[index];
                const wasAdmin = player.name === this.admin;
                this.players.splice(index, 1);  // Remove from array
                return { removed: true, wasAdmin };
            }
            return { removed: false, wasAdmin: false };
        },
        
        /**
         * Record a player's vote
         * Admin cannot vote, only regular players
         * @param {string} name - Player name
         * @param {*} vote - Vote value (number, "?", or null to clear)
         * @returns {boolean} Whether vote was successfully recorded
         */
        setVote(name, vote) {
            const player = this.players.find(p => p.name === name);
            // Only allow non-admin players to vote
            if (player && player.name !== this.admin) {
                player.vote = vote;
                return true;
            }
            return false;
        },
        
        /**
         * Reveal all cards (make votes visible)
         * Only allowed if all non-admin players have voted
         * @returns {Object|null} Object mapping names to votes, or null if not ready
         */
        revealCards() {
            // Get all non-admin players
            const nonAdminPlayers = this.players.filter(p => p.name !== this.admin);
            
            // Check if everyone has voted
            const allVoted = nonAdminPlayers.length > 0 && 
                           nonAdminPlayers.every(p => p.vote !== null);
            
            // Only reveal if all players have voted
            if (!allVoted) {
                return null;  // Not ready to reveal
            }
            
            this.revealed = true;
            
            // Collect all votes (excluding admin)
            const votes = {};
            this.players.forEach(p => {
                if (p.name !== this.admin) {
                    votes[p.name] = p.vote;
                }
            });
            return votes;
        },
        
        /**
         * Reset the room for a new round
         * Clears all votes and sets revealed back to false
         */
        reset() {
            this.revealed = false;
            this.players.forEach(p => {
                // Clear votes for non-admin players only
                if (p.name !== this.admin) {
                    p.vote = null;
                }
            });
        },
        
        /**
         * Get current room state for broadcasting to clients
         * Hides unrevealed votes from players
         * @returns {Object} Sanitized room state
         */
        getState() {
            return {
                code: this.code,
                admin: this.admin,
                players: this.players.map(p => ({
                    name: p.name,
                    // Show actual vote if revealed, otherwise just show 'voted' status
                    vote: this.revealed ? p.vote : (p.vote !== null ? 'voted' : null)
                })),
                revealed: this.revealed,
                votes: this.revealed ? this.getVotes() : null  // Only include votes if revealed
            };
        },
        
        /**
         * Get all votes (excluding admin)
         * Used when cards are revealed
         * @returns {Object} Object mapping player names to votes
         */
        getVotes() {
            const votes = {};
            this.players.forEach(p => {
                if (p.name !== this.admin) {
                    votes[p.name] = p.vote;
                }
            });
            return votes;
        }
    };
};

/**
 * Socket.IO Connection Handler
 * Manages all real-time communication with clients
 */
io.on('connection', (socket) => {
    console.log('New connection:', socket.id);

    /**
     * Event: Create New Room
     * User wants to create a new room and become admin
     */
    socket.on('createRoom', ({ userName, roomCode }) => {
        // Check if room already exists
        if (rooms.has(roomCode)) {
            socket.emit('error', 'Room already exists');
            return;
        }

        // Create new room with this user as admin
        const room = createRoom(roomCode, userName);
        room.players[0].socketId = socket.id;  // Set admin's socket ID
        rooms.set(roomCode, room);             // Store room in memory
        socket.join(roomCode);                 // Join Socket.IO room for broadcasting
        
        // Notify client that room was created successfully
        socket.emit('roomCreated', { roomCode, admin: userName });
        
        // Send initial room state to all clients in room
        io.to(roomCode).emit('roomState', room.getState());
        
        console.log(`Room ${roomCode} created by ${userName}`);
    });

    /**
     * Event: Join Existing Room
     * User wants to join an existing room as a regular player
     */
    socket.on('joinRoom', ({ userName, roomCode }) => {
        const room = rooms.get(roomCode);
        
        // Check if room exists
        if (!room) {
            socket.emit('error', 'Room does not exist');
            return;
        }

        // Prevent user from taking admin's name
        if (userName === room.admin) {
            socket.emit('error', 'Name already taken (admin)');
            return;
        }

        // Add player to room
        room.addPlayer(userName, socket.id);
        socket.join(roomCode);  // Join Socket.IO room
        
        // Notify client they successfully joined
        socket.emit('roomJoined', { roomCode, admin: room.admin });
        
        // Broadcast updated room state to all clients in room
        io.to(roomCode).emit('roomState', room.getState());
        
        console.log(`${userName} joined room ${roomCode}`);
    });

    /**
     * Event: Player Submits Vote
     * A player selects or changes their vote
     */
    socket.on('vote', ({ roomCode, vote }) => {
        const room = rooms.get(roomCode);
        if (!room) return;  // Room doesn't exist

        // Find which player this socket belongs to
        const player = room.players.find(p => p.socketId === socket.id);
        
        // Only allow non-admin players to vote
        if (player && player.name !== room.admin) {
            room.setVote(player.name, vote);
            
            // Broadcast updated state to all clients
            io.to(roomCode).emit('roomState', room.getState());
            
            console.log(`${player.name} voted ${vote} in room ${roomCode}`);
        }
    });

    /**
     * Event: Admin Reveals Cards
     * Admin clicks button to flip all cards and show votes
     * Only works if all non-admin players have voted
     */
    socket.on('revealCards', (roomCode) => {
        const room = rooms.get(roomCode);
        if (!room) return;

        // Verify this socket belongs to the admin
        const player = room.players.find(p => p.socketId === socket.id);
        if (player && player.name === room.admin) {
            // Attempt to reveal cards (returns null if not all players voted)
            const votes = room.revealCards();
            
            if (votes !== null) {
                // All players have voted - reveal cards
                io.to(roomCode).emit('roomState', room.getState());
                io.to(roomCode).emit('cardsRevealed', votes);
                console.log(`Cards revealed in room ${roomCode}`);
            } else {
                // Not all players have voted yet
                socket.emit('error', 'Cannot reveal cards. Not all players have voted.');
                console.log(`Reveal attempted in room ${roomCode} but not all players voted`);
            }
        }
    });

    /**
     * Event: Admin Resets Room
     * Clears all votes and starts a new round
     */
    socket.on('resetRoom', (roomCode) => {
        const room = rooms.get(roomCode);
        if (!room) return;

        // Verify this socket belongs to the admin
        const player = room.players.find(p => p.socketId === socket.id);
        if (player && player.name === room.admin) {
            room.reset();  // Clear all votes
            
            // Broadcast reset to all clients
            io.to(roomCode).emit('roomState', room.getState());
            io.to(roomCode).emit('roomReset');
            
            console.log(`Room ${roomCode} reset`);
        }
    });

    /**
     * Event: User Leaves Room
     * Player explicitly clicks "Leave Room" button
     */
    socket.on('leaveRoom', (roomCode) => {
        const room = rooms.get(roomCode);
        if (!room) return;

        // Remove player from room
        const result = room.removePlayer(socket.id);
        
        if (result.removed) {
            socket.leave(roomCode);  // Leave Socket.IO room
            
            if (result.wasAdmin) {
                // Admin left - destroy room and kick all players
                io.to(roomCode).emit('adminLeft');
                rooms.delete(roomCode);
                console.log(`Room ${roomCode} deleted (admin left)`);
            } else if (room.players.length === 0) {
                // Last player left - delete empty room
                rooms.delete(roomCode);
                console.log(`Room ${roomCode} deleted (empty)`);
            } else {
                // Regular player left - update remaining players
                io.to(roomCode).emit('roomState', room.getState());
            }
        }
    });

    /**
     * Event: Socket Disconnected
     * Triggered when a client loses connection (closed tab, network issue, etc.)
     * Need to clean up player from all rooms they were in
     */
    socket.on('disconnect', () => {
        // Check all rooms to find where this socket was connected
        rooms.forEach((room, roomCode) => {
            const result = room.removePlayer(socket.id);
            
            if (result.removed) {
                if (result.wasAdmin) {
                    // Admin disconnected - destroy the entire room
                    io.to(roomCode).emit('adminLeft');
                    rooms.delete(roomCode);
                    console.log(`Room ${roomCode} deleted (admin disconnected)`);
                } else if (room.players.length === 0) {
                    // Last player disconnected - delete empty room
                    rooms.delete(roomCode);
                    console.log(`Room ${roomCode} deleted (empty)`);
                } else {
                    // Regular player disconnected - update remaining players
                    io.to(roomCode).emit('roomState', room.getState());
                }
            }
        });
        
        console.log('Disconnected:', socket.id);
    });
});

/**
 * Route: Serve Main HTML Page
 * Serves the index.html file for the root URL
 */
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/**
 * Start the server
 * Listen on specified port (from environment variable or default 3000)
 */
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));