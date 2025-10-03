// Initialize socket.io connection to the server
const socket = io();

// Global state variables to track current session
let currentRoom = null;  // Stores the room code the user is in
let currentUser = null;  // Stores the current user's name
let isAdmin = false;     // Tracks if current user is the admin

// Parse URL parameters for customization
const params = new URLSearchParams(window.location.search);
const title = params.get('title') || 'LSC Poker';  // Get custom title or use default

// Set the browser tab title from URL parameter
document.title = title;

/**
 * Theme Management System
 * Handles dark/light mode toggling and persistence
 * Respects system preferences when no saved preference exists
 */
const initTheme = () => {
    const themeToggle = document.getElementById('themeToggle');
    const html = document.documentElement;
    const savedTheme = localStorage.getItem('theme');
    const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    
    // Apply saved theme or fall back to system preference
    if(savedTheme === 'dark' || (!savedTheme && systemPrefersDark)){
        html.classList.add('dark');
    }
    else{
        html.classList.remove('dark');
    }

    // Handle manual theme toggle clicks
    themeToggle.addEventListener('click', () => {
        html.classList.toggle('dark');
        localStorage.setItem('theme', html.classList.contains('dark') ? 'dark' : 'light');
    });

    // Listen for system theme changes (only if user hasn't set preference)
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

// Initialize theme on page load
initTheme();

/**
 * Pre-fill form inputs from URL parameters
 * This allows deep linking with name and room code pre-populated
 * Example: ?name=John&title=MEETING1
 */
const prefillFormFromParams = () => {
    // Get name from URL parameter and decode any URL encoding
    const nameParam = params.get('name');
    if (nameParam) {
        document.getElementById('userName').value = decodeURIComponent(nameParam);
    }
    
    // Get title from URL parameter and use it as default room code
    // Convert to uppercase to match room code format
    const titleParam = params.get('title');
    if (titleParam) {
        document.getElementById('roomCode').value = decodeURIComponent(titleParam).toUpperCase();
    }
};

// Pre-fill form inputs when page loads
prefillFormFromParams();

/**
 * Login Form Handler
 * Processes both "Join Room" and "Create Room" actions
 * Validates inputs and emits appropriate socket events
 */
document.getElementById('loginForm').addEventListener('submit', (e) => {
    e.preventDefault();  // Prevent default form submission
    
    // Get which button was clicked (join or create)
    const action = e.submitter.value;
    
    // Get and clean up user inputs
    const userName = document.getElementById('userName').value.trim();
    const roomCode = document.getElementById('roomCode').value.trim().toUpperCase();
    
    // Validate that both fields are filled
    if (!userName || !roomCode) {
        alert('Please enter both name and room code');
        return;
    }
    
    // Store user info globally for later use
    currentUser = userName;
    currentRoom = roomCode;
    
    // Emit appropriate socket event based on action
    if (action === 'create') {
        socket.emit('createRoom', { userName, roomCode });
    } else {
        socket.emit('joinRoom', { userName, roomCode });
    }
});

/**
 * Socket Event: Room Successfully Created
 * Triggered when user creates a new room and becomes admin
 */
socket.on('roomCreated', (data) => {
    isAdmin = true;  // Mark this user as the admin
    showGameRoom(data);
});

/**
 * Socket Event: Successfully Joined Existing Room
 * Triggered when user joins an existing room as a regular player
 */
socket.on('roomJoined', (data) => {
    isAdmin = false;  // Regular player, not admin
    showGameRoom(data);
});

/**
 * Socket Event: Room State Update
 * Receives updated room state and re-renders the display
 * This is called whenever anything changes in the room
 */
socket.on('roomState', (state) => {
    updateRoomDisplay(state);
});

/**
 * Socket Event: Cards Revealed
 * Triggered when admin clicks "Reveal Cards"
 * Animates card flipping and shows results
 */
socket.on('cardsRevealed', (votes) => {
    revealAllCards(votes);
});

/**
 * Socket Event: Room Reset
 * Triggered when admin clicks "Reset Room"
 * Clears all votes and flips cards back face-down
 */
socket.on('roomReset', () => {
    resetAllCards();
});

/**
 * Socket Event: Admin Left Room
 * When admin leaves, the room is destroyed
 * All players are kicked out and page reloads
 */
socket.on('adminLeft', () => {
    alert('The admin has left the room. The room will be closed.');
    location.reload();
});

/**
 * Socket Event: Error Message
 * Displays error messages from server (room doesn't exist, name taken, etc.)
 */
socket.on('error', (message) => {
    alert(message);
});

/**
 * Transition from login screen to game room
 * Shows appropriate controls based on admin status
 * @param {Object} data - Room data including admin name
 */
function showGameRoom(data) {
    // Hide login screen and show game room
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('gameRoom').classList.remove('hidden');
    
    // Display the room code in the header
    document.getElementById('roomDisplay').textContent = currentRoom;
    
    // Show appropriate controls based on user role
    if (isAdmin) {
        // Admin sees their own name and control buttons (reveal/reset)
        document.getElementById('adminName').textContent = currentUser;
        document.getElementById('adminControls').classList.remove('hidden');
    } else {
        // Regular players see admin's name and card selection interface
        document.getElementById('adminName').textContent = data.admin;
        document.getElementById('cardSelection').classList.remove('hidden');
    }
}

/**
 * Update the visual display of all players and their cards
 * Arranges players in a circle around the poker table
 * @param {Object} state - Current room state from server
 */
function updateRoomDisplay(state) {
    const container = document.getElementById('playersContainer');
    container.innerHTML = '';  // Clear existing players
    
    // Filter out the admin from the player list (admin sits in center)
    const players = state.players.filter(p => p.name !== state.admin);
    
    // If no players yet, don't render anything
    if (players.length === 0) {
        return;
    }
    
    // Calculate angular spacing for circular arrangement
    const angleStep = (2 * Math.PI) / players.length;
    
    // Position each player around the table
    players.forEach((player, index) => {
        // Calculate position using polar coordinates
        // Start at top (- Math.PI / 2) and go clockwise
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
    if (state.revealed && state.votes) {
        showVoteResults(state.votes);
    }
}

/**
 * Enable/disable the "Reveal Cards" button based on voting completion
 * Admin can only reveal when all non-admin players have voted
 * @param {Object} state - Current room state
 */
function updateAdminControls(state) {
    // Only update if current user is admin
    if (!isAdmin) return;
    
    const revealButton = document.getElementById('revealCards');
    if (!revealButton) return;
    
    // Filter out admin from players list
    const nonAdminPlayers = state.players.filter(p => p.name !== state.admin);
    
    // Check if all non-admin players have voted
    const allVoted = nonAdminPlayers.length > 0 && 
                     nonAdminPlayers.every(p => p.vote !== null);
    
    // Enable button only if everyone has voted and cards aren't revealed yet
    if (allVoted && !state.revealed) {
        revealButton.disabled = false;
        revealButton.classList.remove('opacity-50', 'cursor-not-allowed');
        revealButton.title = 'All players have voted';
    } else {
        revealButton.disabled = true;
        revealButton.classList.add('opacity-50', 'cursor-not-allowed');
        
        // Set helpful tooltip message
        if (state.revealed) {
            revealButton.title = 'Cards already revealed';
        } else if (nonAdminPlayers.length === 0) {
            revealButton.title = 'Waiting for players to join';
        } else {
            const votedCount = nonAdminPlayers.filter(p => p.vote !== null).length;
            revealButton.title = `Waiting for votes (${votedCount}/${nonAdminPlayers.length})`;
        }
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
    if (revealed && player.vote !== null) {
        card.classList.add('flipped');
    }
    
    /**
     * Card Front (Face Down)
     * Shows loading spinner if no vote yet
     * Shows checkmark if player has voted (but not revealed)
     */
    const front = document.createElement('div');
    front.className = 'card-front bg-gradient-to-br from-blue-600 to-blue-800 rounded-lg shadow-lg flex items-center justify-center';
    
    if (player.vote === null) {
        // Player hasn't voted yet - show loading spinner
        front.innerHTML = '<div class="loading-spinner"></div>';
    } else {
        // Player has voted - show checkmark
        front.innerHTML = `
            <svg class="w-8 h-8 checkmark" fill="currentColor" viewBox="0 0 20 20">
                <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"></path>
            </svg>
        `;
    }
    
    /**
     * Card Back (Face Up - Revealed)
     * Shows the actual vote value when cards are revealed
     */
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

/**
 * Leave Room Button Handler
 * Confirms user wants to leave, then disconnects from room
 */
document.getElementById('leaveRoom')?.addEventListener('click', () => {
    if (confirm('Are you sure you want to leave the room?')) {
        socket.emit('leaveRoom', currentRoom);
        location.reload();  // Reload page to return to login screen
    }
});

/**
 * Handle Page Unload
 * Clean up by leaving room when user closes tab or navigates away
 */
window.addEventListener('beforeunload', (e) => {
    if (currentRoom) {
        socket.emit('leaveRoom', currentRoom);
    }
});

/**
 * Socket Connection Events
 * Log connection status for debugging
 */
socket.on('connect', () => {
    console.log('Connected to server');
});

socket.on('disconnect', () => {
    console.log('Disconnected from server');
});