const express = require('express'); 
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');

const app = express();

const server = http.createServer(app);

const io = socketIO(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    }
});

// Serve static files (HTML, CSS, JS)from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

/**
 * Room Management
 * In-memory storage for all active poker rooms
 * Key: room code (string), Value: room object
 */
const rooms = new Map();

const createRoom = (code, admin) => {
    return {
        code: code,
        admin: admin,
        players: [{ name: admin, vote: null, socketId: null }],
        revealed: false,   
        
        addPlayer(name, socketId){
            const existingPlayer = this.players.find(p => p.name === name);
            if(existingPlayer){
                existingPlayer.socketId = socketId;
            }
            else{
                this.players.push({ name, vote: null, socketId });
            }
        },
        
        removePlayer(socketId) {
            const index = this.players.findIndex(p => p.socketId === socketId);
            if (index > -1) {
                const player = this.players[index];
                const wasAdmin = player.name === this.admin;
                this.players.splice(index, 1); 
                return { removed: true, wasAdmin };
            }
            return { removed: false, wasAdmin: false };
        },
        
        setVote(name, vote) {
            const player = this.players.find(p => p.name === name);
            if (player && player.name !== this.admin){
                player.vote = vote;
                return true;
            }
            return false;
        },
        
        revealCards() {
            this.players.forEach(p => {
                if(p.name !== this.admin && p.vote === null) {
                    p.vote = '?';
                }
            });
            
            this.revealed = true;
            
            const votes = {};
            this.players.forEach(p => {
                if(p.name !== this.admin) votes[p.name] = p.vote;
            });
            return votes;
        },
        
        reset(){
            this.revealed = false;
            this.players.forEach(p => {
                if(p.name !== this.admin) p.vote = null;
            });
        },
        
        getState(){
            return {
                code: this.code,
                admin: this.admin,
                players: this.players.map(p => ({
                    name: p.name,
                    vote: this.revealed ? p.vote : (p.vote !== null ? 'voted' : null)
                })),
                revealed: this.revealed,
                votes: this.revealed ? this.getVotes() : null  // Only include votes if revealed
            };
        },
        
        getVotes(){
            const votes = {};
            this.players.forEach(p => {
                if(p.name !== this.admin) votes[p.name] = p.vote;
            });
            return votes;
        }
    };
};

io.on('connection', (socket) => {
    socket.on('createRoom', ({ userName, roomCode }) => {
        if(rooms.has(roomCode)){
            socket.emit('error', 'Room already exists');
            return;
        }

        const room = createRoom(roomCode, userName);
        room.players[0].socketId = socket.id; 
        rooms.set(roomCode, room);
        socket.join(roomCode);
        
        socket.emit('roomCreated', { roomCode, admin: userName });
        
        io.to(roomCode).emit('roomState', room.getState());
        
    });

    socket.on('joinRoom', ({ userName, roomCode }) => {
        const room = rooms.get(roomCode);
        
        if(!room){
            socket.emit('error', 'Room does not exist');
            return;
        }
        if(userName === room.admin){
            socket.emit('error', 'Name already taken (admin)');
            return;
        }

        room.addPlayer(userName, socket.id);
        socket.join(roomCode);
        
        socket.emit('roomJoined', { roomCode, admin: room.admin });
        
        io.to(roomCode).emit('roomState', room.getState());
        
    });

    socket.on('vote', ({ roomCode, vote }) => {
        const room = rooms.get(roomCode);
        if (!room) return;
        
        const player = room.players.find(p => p.socketId === socket.id);
        
        if(player && player.name !== room.admin){
            room.setVote(player.name, vote);
            io.to(roomCode).emit('roomState', room.getState());
        }
    });

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
            }else{
                // Not all players have voted yet
                socket.emit('error', 'Cannot reveal cards. Not all players have voted.');
                console.log(`Reveal attempted in room ${roomCode} but not all players voted`);
            }
        }
    });

    socket.on('resetRoom', (roomCode) => {
        const room = rooms.get(roomCode);
        if (!room) return;

        const player = room.players.find(p => p.socketId === socket.id);
        if(player && player.name === room.admin) {
            room.reset();
            io.to(roomCode).emit('roomState', room.getState());
            io.to(roomCode).emit('roomReset');
        }
    });

    socket.on('leaveRoom', (roomCode) => {
        const room = rooms.get(roomCode);
        if (!room) return;

        const result = room.removePlayer(socket.id);
        
        if(result.removed){
            socket.leave(roomCode);
            if(result.wasAdmin){
                io.to(roomCode).emit('adminLeft');
                rooms.delete(roomCode);
            }
            else if (room.players.length === 0){
                rooms.delete(roomCode);
            }
            else{
                io.to(roomCode).emit('roomState', room.getState());
            }
        }
    });

    socket.on('disconnect', () => {
        rooms.forEach((room, roomCode) => {
            const result = room.removePlayer(socket.id);
            
            if(result.removed){
                if(result.wasAdmin){
                    io.to(roomCode).emit('adminLeft');
                    rooms.delete(roomCode);
                }
                else if (room.players.length === 0){
                    rooms.delete(roomCode);
                }
                else{
                    io.to(roomCode).emit('roomState', room.getState());
                }
            }
        });
    });
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});


const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));