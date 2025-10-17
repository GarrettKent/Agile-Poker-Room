// Initialize socket.io connection to the server
const socket = io();

let currentRoom = null;  // Stores the room code the user is in
let currentUser = null;  // Stores the current user's name
let isAdmin = false;     // Tracks if current user is the admin

const params = new URLSearchParams(window.location.search);
const title = params.get('title') || 'LSC Poker';

document.title = title;

const initTheme = () => {
    const themeToggle = document.getElementById('themeToggle');
    const html = document.documentElement;
    const savedTheme = localStorage.getItem('theme');
    const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    
    if(savedTheme === 'dark' || (!savedTheme && systemPrefersDark)){
        html.classList.add('dark');
    }
    else{
        html.classList.remove('dark');
    }

    themeToggle.addEventListener('click', () => {
        html.classList.toggle('dark');
        localStorage.setItem('theme', html.classList.contains('dark') ? 'dark' : 'light');
    });

    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (event) => {
        if (!localStorage.getItem('theme')){
            if(event.matches){
                html.classList.add('dark');
            }
            else{
                html.classList.remove('dark');
            }
        }
    });
};

initTheme();

const prefillFormFromParams = () => {
    const nameParam = params.get('name');
    const titleParam = params.get('title');
    if(nameParam) document.getElementById('userName').value = decodeURIComponent(nameParam);
    if(titleParam) document.getElementById('roomCode').value = decodeURIComponent(titleParam).toUpperCase();
};

prefillFormFromParams();


document.getElementById('loginForm').addEventListener('submit', (e) => {
    e.preventDefault();
    
    // Get which button was clicked (join or create)
    const action = e.submitter.value;
    
    // Get and clean up user inputs
    const userName = document.getElementById('userName').value.trim();
    const roomCode = document.getElementById('roomCode').value.trim().toUpperCase();
    
    // Validate that both fields are filled
    if(!userName || !roomCode){
        alert('Please enter both name and room code');
        return;
    }
    
    // Store user info globally for later use
    currentUser = userName;
    currentRoom = roomCode;
    
    // Emit appropriate socket event based on action
    if(action === 'create'){
        socket.emit('createRoom', { userName, roomCode });
    }
    else{
        socket.emit('joinRoom', { userName, roomCode });
    }
});

socket.on('roomCreated', (data) => {
    isAdmin = true;
    showGameRoom(data);
});

socket.on('roomJoined', (data) => {
    isAdmin = false;
    showGameRoom(data);
});

socket.on('roomState', (state) => {
    updateRoomDisplay(state);
});

socket.on('cardsRevealed', (votes) => {
    revealAllCards(votes);
});

socket.on('roomReset', () => {
    resetAllCards();
});

socket.on('adminLeft', () => {
    alert('The admin has left the room. The room will be closed.');
    location.reload();
});

socket.on('error', (message) => {
    alert(message);
});

function showGameRoom(data) {
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('gameRoom').classList.remove('hidden');
    document.getElementById('roomDisplay').textContent = currentRoom;
    
    if(isAdmin){
        document.getElementById('adminName').textContent = currentUser;
        document.getElementById('adminControls').classList.remove('hidden');
    }
    else{
        document.getElementById('adminName').textContent = data.admin;
        document.getElementById('cardSelection').classList.remove('hidden');
    }
}
function updateRoomDisplay(state) {
    const container = document.getElementById('playersContainer');
    container.innerHTML = '';  // Clear existing players
    
    // Filter out the admin from the player list (admin sits in center)
    const players = state.players.filter(p => p.name !== state.admin);
    
    // If no players yet, don't render anything
    if(players.length === 0) return;
    
    const angleStep = (2 * Math.PI) / players.length;
    
    players.forEach((player, index) => {
        const angle = angleStep * index - Math.PI / 2;
        const x = 50 + 40 * Math.cos(angle);  // Horizontal position (40% radius)
        const y = 50 + 35 * Math.sin(angle);  // Vertical position (35% radius)
        
        // Create the player card element
        const playerCard = createPlayerCard(player, state.revealed);
        
        // Position absolutely within the container
        playerCard.style.position = 'absolute';
        playerCard.style.left = `${x}%`;
        playerCard.style.top = `${y}%`;
        playerCard.style.transform = 'translate(-50%, -50%)';  // Center on position
        
        container.appendChild(playerCard);
    });
    
    // Update admin controls based on voting status
    updateAdminControls(state);
    
    // Show vote results if cards have been revealed
    if(state.revealed && state.votes) showVoteResults(state.votes);
}

/**
 * Enable/disable the "Reveal Cards" button based on voting completion
 * Admin can only reveal when all non-admin players have voted
 * @param {Object} state - Current room state
 */
function updateAdminControls(state) {
    // Only update if current user is admin
    if(!isAdmin) return;
    
    const revealButton = document.getElementById('revealCards');
    if(!revealButton) return;
    
    // Enable button unless cards are already revealed
    if(!state.revealed){
        revealButton.disabled = false;
        revealButton.classList.remove('opacity-50', 'cursor-not-allowed');
        revealButton.title = 'Reveal all cards';
    } 
    else{
        revealButton.disabled = true;
        revealButton.classList.add('opacity-50', 'cursor-not-allowed');
        revealButton.title = 'Cards already revealed';
    }
}

/**
 * Create a visual card element for a player
 * Shows loading spinner, checkmark (voted), or revealed vote value
 * @param {Object} player - Player object with name and vote
 * @param {boolean} revealed - Whether cards are currently revealed
 * @returns {HTMLElement} The complete player card wrapper element
 */
function createPlayerCard(player, revealed) {
    // Container for card and name
    const wrapper = document.createElement('div');
    wrapper.className = 'player-card-wrapper flex flex-col items-center';
    
    // The 3D flipping card
    const card = document.createElement('div');
    card.className = 'card-3d w-16 h-24 md:w-20 md:h-28 relative mb-2';
    
    // Add flipped class if cards are revealed and player has voted
    if(revealed && player.vote !== null) card.classList.add('flipped');
    
    const front = document.createElement('div');
    front.className = 'card-front bg-gradient-to-br from-blue-600 to-blue-800 rounded-lg shadow-lg flex items-center justify-center';
    
    if(player.vote === null){
        front.innerHTML = '<div class="loading-spinner"></div>';
    }
    else{
        front.innerHTML = `
            <svg class="w-8 h-8 checkmark" fill="currentColor" viewBox="0 0 20 20">
                <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"></path>
            </svg>
        `;
    }
    
    const back = document.createElement('div');
    back.className = 'card-back bg-white dark:bg-gray-700 border-2 border-gray-300 dark:border-gray-600 rounded-lg shadow-lg flex items-center justify-center';
    back.innerHTML = `<span class="text-2xl font-bold text-gray-800 dark:text-white">${player.vote || ''}</span>`;
    
    // Add both faces to the card
    card.appendChild(front);
    card.appendChild(back);
    wrapper.appendChild(card);
    
    // Add player name below the card
    const name = document.createElement('div');
    name.className = 'text-sm font-semibold text-white text-center';
    name.textContent = player.name;
    wrapper.appendChild(name);
    
    // Add fade-in animation
    wrapper.classList.add('fade-in');
    return wrapper;
}

/**
 * Calculate and display voting results
 * Shows average of numeric votes (excludes "?" votes)
 * @param {Object} votes - Object mapping player names to their votes
 */
const showVoteResults = votes => {
    const voteResult = document.getElementById('voteResult');
    const averageSpan = document.getElementById('average');

    // Collect only numeric votes (filter out "?" and null)
    const numericVotes = [];
    for(const v of Object.values(votes)){
        if(v !== '?' && v != null) numericVotes.push(Number(v));
    }

    // Calculate average if there are numeric votes
    let averageText = 'N/A';
    if(numericVotes.length){
        let sum = 0;
        for(const n of numericVotes) sum += n;
        averageText = (sum / numericVotes.length).toFixed(1);
    }

    // Update and show the results
    averageSpan.textContent = averageText;
    voteResult.classList.remove('hidden');
}

/**
 * Animate all cards flipping to reveal votes
 * Cards flip in sequence with staggered timing for visual effect
 * @param {Object} votes - Object mapping player names to their votes
 */
function revealAllCards(votes) {
    const cards = document.querySelectorAll('.card-3d');
    
    // Flip each card with 100ms delay between cards
    cards.forEach((card, index) => {
        setTimeout(() => {
            card.classList.add('flipped');
        }, index * 100);
    });
    
    // Show vote results after all cards have flipped
    setTimeout(() => {
        showVoteResults(votes);
    }, cards.length * 100);
}

/**
 * Reset all cards back to face-down state
 * Clears votes and hides results
 * Called when admin clicks "Reset Room"
 */
function resetAllCards() {
    // Flip all cards back to face-down
    const cards = document.querySelectorAll('.card-3d');
    cards.forEach(card => {
        card.classList.remove('flipped');
    });
    
    // Hide the vote results display
    document.getElementById('voteResult').classList.add('hidden');
    
    // Clear selected card styling for the current user
    document.querySelectorAll('.card-option').forEach(btn => {
        btn.classList.remove('card-selected');
    });
    
    // Hide the "Clear Vote" button
    document.getElementById('clearVote').classList.add('hidden');
}

/**
 * Card Selection Event Handlers (for non-admin players)
 * When a player clicks a card value, send vote to server
 */
document.querySelectorAll('.card-option').forEach(button => {
    button.addEventListener('click', () => {
        const value = button.dataset.value;  // Get card value (0.5, 1, 2, etc.)
        
        // Send vote to server
        socket.emit('vote', { roomCode: currentRoom, vote: value });
        
        // Update UI to show selected card
        document.querySelectorAll('.card-option').forEach(btn => {
            btn.classList.remove('card-selected');
        });
        button.classList.add('card-selected');
        
        // Show the "Clear Vote" button
        document.getElementById('clearVote').classList.remove('hidden');
    });
});

/**
 * Clear Vote Button Handler
 * Allows player to retract their vote before cards are revealed
 */
document.getElementById('clearVote')?.addEventListener('click', () => {
    // Send null vote to server (clears the vote)
    socket.emit('vote', { roomCode: currentRoom, vote: null });
    
    // Clear UI selection state
    document.querySelectorAll('.card-option').forEach(btn => {
        btn.classList.remove('card-selected');
    });
    document.getElementById('clearVote').classList.add('hidden');
});

/**
 * Admin Control: Reveal Cards
 * Admin clicks to flip all cards and show votes
 * Only enabled when all players have voted
 */
document.getElementById('revealCards')?.addEventListener('click', () => {
    socket.emit('revealCards', currentRoom);
});

/**
 * Admin Control: Reset Room
 * Clears all votes and starts a new round
 */
document.getElementById('resetRoom')?.addEventListener('click', () => {
    socket.emit('resetRoom', currentRoom);
});

/**
 * Copy Room Code to Clipboard
 * Provides visual feedback when code is copied
 */
document.getElementById('copyRoom')?.addEventListener('click', () => {
    navigator.clipboard.writeText(currentRoom).then(() => {
        const btn = document.getElementById('copyRoom');
        const originalText = btn.textContent;
        
        // Show "Copied!" feedback
        btn.textContent = 'Copied!';
        btn.classList.add('copied-feedback', 'show');
        
        // Restore original text after 2 seconds
        setTimeout(() => {
            btn.textContent = originalText;
            btn.classList.remove('show');
        }, 2000);
    }).catch(err => {
        console.error('Failed to copy:', err);
        alert('Failed to copy room code');
    });
});

document.getElementById('leaveRoom')?.addEventListener('click', () => {
    if(confirm('Are you sure you want to leave the room?')){
        socket.emit('leaveRoom', currentRoom);
        location.reload();  // Reload page to return to login screen
    }
});

window.addEventListener('beforeunload', (e) => {
    if(currentRoom) socket.emit('leaveRoom', currentRoom);
});

socket.on('connect', () => {
    console.log('Connected to server');
});

socket.on('disconnect', () => {
    console.log('Disconnected from server');
});