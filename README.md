# Guild Wars Party Bot

A Discord bot for organizing Guild Wars Speed Clear parties.

## Setup

### 1. Install Node.js
Make sure you have Node.js installed (v18 or higher recommended).

### 2. Install Dependencies
```bash
npm install
```

### 3. Create Discord Bot
1. Go to https://discord.com/developers/applications
2. Click "New Application" and give it a name
3. Go to the "Bot" section and click "Add Bot"
4. Copy the bot token

### 4. Configure Environment
1. Copy `.env.example` to `.env`
2. Paste your bot token as `DISCORD_TOKEN`
3. Set `TARGET_CHANNEL_ID` to the channel where party posts should appear
   - Enable Developer Mode in Discord (Settings > App Settings > Advanced)
   - Right-click the channel and "Copy Channel ID"

### 5. Invite Bot to Server
1. Go to OAuth2 > URL Generator in the Discord Developer Portal
2. Select scopes: `bot`, `applications.commands`
3. Select permissions: `Send Messages`, `Embed Links`, `Read Message History`
4. Copy the generated URL and open it to invite the bot

### 6. Run the Bot
```bash
npm start
```

## Commands

- `/formparty` - Start a new party formation
- `/listparties` - Show all active parties
- `/help` - Show help information

## Features

- Create parties for various Guild Wars speed clears (UWSC, FoWSC, DoASC, etc.)
- Claim, switch, and leave roles
- Add external (non-Discord) players by IGN
- Party leader controls: kick, promote, ping, disband
- Parties auto-lock after 3 hours
- Persistent party data (survives bot restarts)
