# CRDT Collaborative Editor

A collaborative text editor built with CRDT (Conflict-free Replicated Data Type) for real-time synchronization.

## Features

- **Local-First Sync**: All changes are saved to localStorage immediately, ensuring your work is never lost
- **Network Synchronization**: Real-time collaboration over WebSocket with automatic conflict resolution
- **Offline Support**: Works offline - changes are saved locally and sync when connection is restored
- **CRDT Algorithm**: Uses FugueMax CRDT algorithm for conflict-free merging of concurrent edits

## Getting Started

### Prerequisites

- Node.js 18+ 
- npm or compatible package manager

### Installation

```bash
npm install
```

### Running the Server

```bash
npm start
```

This will start:
- HTTP server on `http://localhost:3001` (serves the web app)
- WebSocket server on `ws://localhost:3002` (handles real-time sync)

### Development

1. Start the server: `npm start`
2. Open multiple browser tabs/windows to `http://localhost:3001`
3. Type in one tab and watch changes appear in other tabs in real-time
4. Changes are automatically saved to localStorage
5. Works offline - try disconnecting and reconnecting to see sync resume

### Sharing with Friends (using ngrok)

To share the editor with friends over the internet:

1. **Start the server** (in Terminal 1):
   ```bash
   npm start
   ```
   The server will start on `http://localhost:3001`

2. **Install ngrok** (if not already installed):
   ```bash
   # macOS
   brew install ngrok
   
   # Or download from https://ngrok.com/download
   # Sign up for a free account at https://ngrok.com to get your authtoken
   ```

3. **Create ngrok tunnel** (in Terminal 2):
   ```bash
   ngrok http 3001
   ```

4. **Share the ngrok URL** with your friends:
   - ngrok will display a URL like `https://abc123.ngrok-free.app`
   - Share this URL with your friends
   - They can open it in their browser and start collaborating!

**That's it!** The editor automatically detects when it's running through ngrok and uses the correct WebSocket connection. Both HTTP and WebSocket traffic go through the same ngrok tunnel on port 3001.

**Note**: 
- The free ngrok plan works perfectly for this use case
- WebSocket connections are automatically handled through the same tunnel
- The editor code automatically detects ngrok URLs and adjusts the WebSocket connection

### How It Works

1. **Local-First**: Every keystroke is immediately saved to localStorage
2. **Network Sync**: Changes are broadcast over WebSocket to other connected clients (debounced to 300ms)
3. **CRDT Merging**: When remote changes arrive, they're merged using the CRDT algorithm
4. **Automatic Recovery**: If connection is lost, the app automatically reconnects