// ============================================================================
// Guild Wars Party Bot - Main Entry Point
// ============================================================================

import {
    Client,
    GatewayIntentBits,
    EmbedBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    ButtonBuilder,
    ButtonStyle,
    TextChannel,
    Interaction,
    Message,
    ButtonInteraction,
    StringSelectMenuInteraction,
    ChatInputCommandInteraction,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
} from 'discord.js';
import * as fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import crypto from 'crypto';

// Load environment variables first
dotenv.config();

// ============================================================================
// Configuration
// ============================================================================

const CONFIG = {
    targetChannelId: process.env.TARGET_CHANNEL_ID ?? '1448444485410226259',
    lockTimeout: 3 * 60 * 60 * 1000, // 3 hours in milliseconds
    dataPath: path.join(__dirname, '..', 'data', 'parties.json'),
    version: 'v1.0',
} as const;

const COLORS = {
    success: 0x57f287,
    danger: 0xed4245,
    primary: 0x5865f2,
    locked: 0x2b2d31,
} as const;

// ============================================================================
// Run Configurations
// ============================================================================

interface RunConfig {
    readonly size: number;
    readonly roles: readonly string[];
}

const RUN_CONFIGS: Readonly<Record<string, RunConfig>> = {
    BogSC: { size: 8, roles: ['Tank', 'AotL MM', 'Paragon', 'VoS', 'VoS', 'VoS', 'VoS', 'VoS'] },
    DeepSC: { size: 12, roles: ['Tank', 'EoE', 'UA', 'DPS', 'DPS', 'DPS', 'DPS', 'DPS', 'DPS', 'DPS', 'DPS', 'DPS'] },
    DoASC: { size: 8, roles: ['MT', 'TT', 'Caller', 'TK', 'IAU', 'MLK', 'UA', 'Emo'] },
    FoWSC: { size: 8, roles: ['T1', 'T2', 'T3', 'T4', 'MT', 'VoS', 'VoS', 'VoS'] },
    SoOSC: { size: 8, roles: ['MT', 'Gater', 'VoS', 'TaO', 'Glass Arrows', 'Glass Arrows', 'Glass Arrows', 'Glass Arrows'] },
    UrgozSC: { size: 12, roles: ['Tank', 'VoS', 'SoS/EoE', 'Deep Freeze', 'Spiker', 'Spiker', 'Spiker', 'Spiker', 'Spiker', 'Seeder', 'Seeder', 'Bonder'] },
    UWSC: { size: 8, roles: ['T1', 'T2', 'T3', 'T4', 'LT', 'SoS', 'Spiker', 'Emo'] },
} as const;

// ============================================================================
// Types & Interfaces
// ============================================================================

interface PartySlot {
    role: string;
    user: string | null;
}

interface Party {
    type: string;
    leader: string;
    maxSize: number;
    slots: PartySlot[];
    createdAt: Date;
    messageId?: string;
}

type ButtonAction = 'join' | 'leave' | 'switch' | 'ping' | 'external' | 'kick' | 'promote' | 'disband';

// ============================================================================
// Logger Utility
// ============================================================================

const Logger = {
    info: (message: string) => console.log(`[INFO] ${new Date().toISOString()} - ${message}`),
    warn: (message: string) => console.warn(`[WARN] ${new Date().toISOString()} - ${message}`),
    error: (message: string, error?: unknown) => {
        console.error(`[ERROR] ${new Date().toISOString()} - ${message}`);
        if (error) console.error(error);
    },
    debug: (message: string) => {
        if (process.env.NODE_ENV === 'development') {
            console.log(`[DEBUG] ${new Date().toISOString()} - ${message}`);
        }
    },
};

// ============================================================================
// State Management
// ============================================================================

const activeParties = new Map<string, Party>();
const partyLocks = new Map<string, Promise<void>>();

// ============================================================================
// Discord Client Setup
// ============================================================================

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
    ],
});

// ============================================================================
// Persistence Helpers
// ============================================================================

function saveData(): void {
    try {
        const data = Array.from(activeParties.entries());
        const dir = path.dirname(CONFIG.dataPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(CONFIG.dataPath, JSON.stringify(data, null, 2));
        Logger.debug(`Saved ${data.length} parties to disk`);
    } catch (error) {
        Logger.error('Failed to save party data', error);
    }
}

function loadData(): void {
    try {
        if (fs.existsSync(CONFIG.dataPath)) {
            const raw = fs.readFileSync(CONFIG.dataPath, 'utf-8');
            const data = JSON.parse(raw) as [string, Party][];
            data.forEach(([key, val]) => {
                val.createdAt = new Date(val.createdAt);
                activeParties.set(key, val);
                setupLockTimer(key, val);
            });
            Logger.info(`Loaded ${data.length} parties from disk`);
        }
    } catch (error) {
        Logger.error('Failed to load party data', error);
    }
}

async function safeFetchMessage(channel: TextChannel, id: string): Promise<Message | null> {
    try {
        return await channel.messages.fetch(id);
    } catch {
        return null;
    }
}

async function getTargetChannel(): Promise<TextChannel | null> {
    try {
        const channel = await client.channels.fetch(CONFIG.targetChannelId);
        return channel as TextChannel;
    } catch (error) {
        Logger.error('Failed to fetch target channel', error);
        return null;
    }
}

// ============================================================================
// Party Lock System
// ============================================================================

async function lockParty(partyId: string): Promise<void> {
    const party = activeParties.get(partyId);
    if (!party || !party.messageId) return;

    try {
        const channel = await getTargetChannel();
        if (!channel) return;

        const msg = await safeFetchMessage(channel, party.messageId);
        if (!msg) {
            activeParties.delete(partyId);
            saveData();
            return;
        }

        const baseEmbed = msg.embeds[0] ?? new EmbedBuilder();
        const lockedEmbed = EmbedBuilder.from(baseEmbed)
            .setTitle(`🔒 [LOCKED] ${party.type}`)
            .setColor(COLORS.locked);

        await msg.edit({ embeds: [lockedEmbed], components: [] });
        Logger.info(`Party ${partyId} (${party.type}) auto-locked after timeout`);
    } catch (error) {
        Logger.error(`Failed to lock party ${partyId}`, error);
    } finally {
        activeParties.delete(partyId);
        saveData();
    }
}

function setupLockTimer(partyId: string, party: Party): void {
    const elapsed = Date.now() - new Date(party.createdAt).getTime();
    const remaining = Math.max(0, CONFIG.lockTimeout - elapsed);
    setTimeout(() => lockParty(partyId), remaining);
    Logger.debug(`Lock timer set for party ${partyId}: ${Math.round(remaining / 60000)} minutes remaining`);
}

async function withPartyLock<T>(partyId: string, fn: () => Promise<T>): Promise<T> {
    const previous = partyLocks.get(partyId) ?? Promise.resolve();

    let release!: () => void;
    const current = new Promise<void>(resolve => {
        release = resolve;
    });

    partyLocks.set(partyId, previous.then(() => current));

    try {
        return await fn();
    } finally {
        release();
        if (partyLocks.get(partyId) === current) {
            partyLocks.delete(partyId);
        }
    }
}

// ============================================================================
// Embed & UI Helpers
// ============================================================================

function formatUser(userId: string | null): string {
    if (!userId) return '_Vacant_';

    if (userId.startsWith('IGN:')) {
        const ign = userId.replace('IGN:', '');
        return `**${ign}** (External)`;
    }

    return `<@${userId}>`;
}

function createPartyEmbed(party: Party): EmbedBuilder {
    const filledCount = party.slots.filter(s => s.user !== null).length;

    const slotLines = party.slots.map((slot, index) => {
        const formatted = formatUser(slot.user);
        return `\`${index + 1}\` **${slot.role}**: ${formatted}`;
    });

    const leaderFormatted = formatUser(party.leader);
    const isFull = filledCount === party.maxSize;

    return new EmbedBuilder()
        .setTitle(`⚔️ Speed Clear: ${party.type}`)
        .setDescription(`**Leader:** ${leaderFormatted}\n\n${slotLines.join('\n')}`)
        .setColor(isFull ? COLORS.danger : COLORS.success)
        .addFields({ name: 'Roster Status', value: `${filledCount} / ${party.maxSize}`, inline: true })
        .setFooter({ text: `Created: ${party.createdAt.toLocaleString()}` });
}

function createPartyButtons(partyId: string): ActionRowBuilder<ButtonBuilder>[] {
    // Discord allows max 5 buttons per row
    const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`join_${partyId}`).setLabel('Claim Role').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`leave_${partyId}`).setLabel('Leave').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`switch_${partyId}`).setLabel('Switch Role').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`ping_${partyId}`).setLabel('Ping Party').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`external_${partyId}`).setLabel('Add External').setStyle(ButtonStyle.Secondary),
    );

    const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`kick_${partyId}`).setLabel('Kick Player').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`promote_${partyId}`).setLabel('Promote Leader').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`disband_${partyId}`).setLabel('Disband').setStyle(ButtonStyle.Danger),
    );

    return [row1, row2];
}

function createHelpEmbed(): EmbedBuilder {
    return new EmbedBuilder()
        .setTitle('📘 Guild Wars Party Bot Help')
        .setDescription('Here is a list of all available functions and what they do.')
        .setColor(COLORS.primary)
        .addFields(
            { name: '⚔️ /formparty', value: 'Starts a new party formation and posts it in the pre-configured channel(s).' },
            { name: '📋 /listparties', value: 'Displays a list of all active parties that are being formed with GWPB.' },
            { name: 'ℹ️ /help', value: 'Shows this menu.' },
            { name: '✏️ Claim Role', value: 'Allows a Discord user to select and reserve an available role in the party.' },
            { name: '🚪 Leave', value: 'Removes you from your currently claimed role.' },
            { name: '🔄 Switch Role', value: 'Lets you change your claimed role to another available one.' },
            { name: '➕ Add External Player', value: 'Party Leader only. Reserve a slot for a non‑Discord player by entering their IGN and selecting a role.' },
            { name: '❌ Kick Player', value: 'Party Leader only. Removes a selected player (Discord or external) from the party.' },
            { name: '👑 Promote Leader', value: 'Party Leader only. Transfers leadership to another Discord user in the party.' },
            { name: '🔔 Ping Party', value: 'Party Leader only. Pings all filled slots to gather attention.' },
            { name: '🛑 Disband', value: 'Party Leader only. Disbands the party and locks the post.' },
            { name: '🔒 Auto‑Lock', value: 'Parties automatically lock after 3 hours to prevent stale formations.' },
        )
        .setFooter({ text: `Guild Wars Party Bot — ${CONFIG.version} — by Kurzick Krozz` });
}

// ============================================================================
// Slash Command Registration
// ============================================================================

async function registerCommands(): Promise<void> {
    const commands = [
        { name: 'formparty', description: 'Start a Guild Wars Speed Clear party formation!' },
        { name: 'listparties', description: 'Show all active parties.' },
        { name: 'help', description: 'Show information about all GWPB features.' },
    ];

    for (const cmd of commands) {
        await client.application?.commands.create(cmd);
    }

    Logger.info(`Registered ${commands.length} slash commands`);
}

// ============================================================================
// Event Handlers - Ready
// ============================================================================

client.once('clientReady', async () => {
    Logger.info(`Logging in as ${client.user?.tag}...`);

    // Load persisted party data
    loadData();

    // Register slash commands
    await registerCommands();

    Logger.info(`✓ Bot ready! Tracking ${activeParties.size} active parties`);
});

// ============================================================================
// Slash Command Handlers
// ============================================================================

async function handleFormParty(interaction: ChatInputCommandInteraction): Promise<void> {
    const select = new StringSelectMenuBuilder()
        .setCustomId('select_run')
        .setPlaceholder('Select the run type...')
        .addOptions(Object.keys(RUN_CONFIGS).map(k => ({ label: k, value: k })));

    await interaction.reply({
        content: 'Select run type:',
        components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
        ephemeral: true,
    });
}

async function handleListParties(interaction: ChatInputCommandInteraction): Promise<void> {
    if (activeParties.size === 0) {
        await interaction.reply({ content: 'No active parties.', ephemeral: true });
        return;
    }

    const lines: string[] = [];
    for (const [, party] of activeParties.entries()) {
        const jumpUrl = `https://discord.com/channels/${interaction.guildId}/${CONFIG.targetChannelId}/${party.messageId}`;
        lines.push(`• **${party.type}** — Leader: <@${party.leader}> — [Jump](${jumpUrl})`);
    }

    await interaction.reply({ content: lines.join('\n'), ephemeral: true });
}

async function handleHelp(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.reply({ embeds: [createHelpEmbed()], ephemeral: true });
}

// ============================================================================
// Select Menu Handlers
// ============================================================================

async function handleRunSelection(interaction: StringSelectMenuInteraction): Promise<void> {
    const type = interaction.values[0];
    const config = RUN_CONFIGS[type];
    const partyId = `party_${crypto.randomUUID()}`;

    const newParty: Party = {
        type,
        leader: interaction.user.id,
        maxSize: config.size,
        slots: config.roles.map(r => ({ role: r, user: null })),
        createdAt: new Date(),
    };

    activeParties.set(partyId, newParty);

    const channel = await getTargetChannel();
    if (!channel) {
        await interaction.update({ content: 'Failed to access the party channel.', components: [] });
        return;
    }

    const sent = await channel.send({
        embeds: [createPartyEmbed(newParty)],
        components: createPartyButtons(partyId),
    });

    newParty.messageId = sent.id;
    saveData();
    setupLockTimer(partyId, newParty);

    Logger.info(`Party created: ${type} by ${interaction.user.tag} (${partyId})`);
    await interaction.update({ content: `Party posted in <#${CONFIG.targetChannelId}>`, components: [] });
}

// ============================================================================
// Button Action Handlers
// ============================================================================

async function handleLeaveAction(interaction: ButtonInteraction, party: Party): Promise<void> {
    party.slots.forEach(slot => {
        if (slot.user === interaction.user.id) slot.user = null;
    });
    saveData();

    await interaction.update({
        embeds: [createPartyEmbed(party)],
    });
}

async function handleJoinAction(interaction: ButtonInteraction, party: Party, partyId: string): Promise<void> {
    if (party.slots.some(s => s.user === interaction.user.id)) {
        await interaction.reply({ content: 'You already have a role.', ephemeral: true });
        return;
    }

    const available = party.slots
        .map((s, i) => ({ ...s, i }))
        .filter(s => s.user === null);

    if (available.length === 0) {
        await interaction.reply({ content: 'Party is full!', ephemeral: true });
        return;
    }

    const roleMenu = new StringSelectMenuBuilder()
        .setCustomId(`pick_${partyId}`)
        .setPlaceholder('Select your role...')
        .addOptions(available.map(s => ({ label: s.role, value: s.i.toString(), description: `Slot #${s.i + 1}` })));

    await interaction.reply({
        content: 'Choose a role:',
        components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(roleMenu)],
        ephemeral: true,
    });
}

async function handleDisbandAction(interaction: ButtonInteraction, party: Party, partyId: string): Promise<void> {
    if (interaction.user.id !== party.leader) {
        await interaction.reply({ content: 'Only the party leader can disband the party!', ephemeral: true });
        return;
    }

    activeParties.delete(partyId);
    saveData();

    const channel = await getTargetChannel();
    if (channel && party.messageId) {
        const msg = await safeFetchMessage(channel, party.messageId);
        if (msg) {
            const embed = new EmbedBuilder()
                .setTitle(`❌ [DISBANDED] ${party.type}`)
                .setColor(COLORS.danger);
            await msg.edit({ embeds: [embed], components: [] });
        }
    }

    Logger.info(`Party disbanded: ${party.type} (${partyId})`);
    await interaction.reply({ content: 'Party disbanded.', ephemeral: true });
}

async function handleSwitchAction(interaction: ButtonInteraction, party: Party, partyId: string): Promise<void> {
    const currentSlot = party.slots.find(s => s.user === interaction.user.id);
    if (!currentSlot) {
        await interaction.reply({ content: "You don't have a role to switch from.", ephemeral: true });
        return;
    }

    const available = party.slots
        .map((s, i) => ({ ...s, i }))
        .filter(s => s.user === null || s.user === interaction.user.id);

    const roleMenu = new StringSelectMenuBuilder()
        .setCustomId(`switchpick_${partyId}`)
        .setPlaceholder('Select your new role...')
        .addOptions(available.map(s => ({ label: s.role, value: s.i.toString(), description: `Slot #${s.i + 1}` })));

    await interaction.reply({
        content: 'Choose your new role:',
        components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(roleMenu)],
        ephemeral: true,
    });
}

async function handlePingAction(interaction: ButtonInteraction, party: Party): Promise<void> {
    if (interaction.user.id !== party.leader) {
        await interaction.reply({ content: 'Only the leader can ping the party.', ephemeral: true });
        return;
    }

    const mentions = party.slots
        .filter(s => s.user !== null && !s.user.startsWith('IGN:'))
        .map(s => `<@${s.user}>`)
        .join(' ');

    if (!mentions) {
        await interaction.reply({ content: 'No Discord users to ping.', ephemeral: true });
        return;
    }

    await interaction.reply({ content: `Party ping: ${mentions}`, ephemeral: false });
}

async function handleExternalAction(interaction: ButtonInteraction, party: Party, partyId: string): Promise<void> {
    if (interaction.user.id !== party.leader) {
        await interaction.reply({ content: 'Only the party leader can reserve slots for external players.', ephemeral: true });
        return;
    }

    const available = party.slots
        .map((s, i) => ({ ...s, i }))
        .filter(s => s.user === null);

    if (available.length === 0) {
        await interaction.reply({ content: 'No available slots to reserve.', ephemeral: true });
        return;
    }

    const roleMenu = new StringSelectMenuBuilder()
        .setCustomId(`externalrole_${partyId}`)
        .setPlaceholder('Select role to reserve')
        .addOptions(available.map(s => ({ label: s.role, value: s.i.toString() })));

    await interaction.reply({
        content: 'Select a role to reserve, then you will be asked to type the IGN.',
        components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(roleMenu)],
        ephemeral: true,
    });
}

async function handleKickAction(interaction: ButtonInteraction, party: Party, partyId: string): Promise<void> {
    if (interaction.user.id !== party.leader) {
        await interaction.reply({ content: 'Only the party leader can kick players.', ephemeral: true });
        return;
    }

    const filled = party.slots
        .map((s, i) => ({ ...s, i }))
        .filter(s => s.user !== null);

    if (filled.length === 0) {
        await interaction.reply({ content: 'There are no players to kick.', ephemeral: true });
        return;
    }

    const menu = new StringSelectMenuBuilder()
        .setCustomId(`kickpick_${partyId}`)
        .setPlaceholder('Select a player to remove')
        .addOptions(
            filled.map(s => ({
                label: s.role,
                value: s.i.toString(),
                description: s.user!.startsWith('IGN:') ? `External: ${s.user!.replace('IGN:', '')}` : `Discord: ${s.user}`,
            })),
        );

    await interaction.reply({
        content: 'Choose a player to remove:',
        components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)],
        ephemeral: true,
    });
}

async function handlePromoteAction(interaction: ButtonInteraction, party: Party, partyId: string): Promise<void> {
    if (interaction.user.id !== party.leader) {
        await interaction.reply({ content: 'Only the party leader can promote a new leader.', ephemeral: true });
        return;
    }

    const eligible = party.slots
        .map((s, i) => ({ ...s, i }))
        .filter(s => s.user !== null && !s.user.startsWith('IGN:'));

    if (eligible.length === 0) {
        await interaction.reply({ content: 'No eligible players to promote.', ephemeral: true });
        return;
    }

    const menu = new StringSelectMenuBuilder()
        .setCustomId(`promotepick_${partyId}`)
        .setPlaceholder('Select a new party leader')
        .addOptions(eligible.map(s => ({ label: s.role, value: s.user!, description: `Slot #${s.i + 1}` })));

    await interaction.reply({
        content: 'Choose a new party leader:',
        components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)],
        ephemeral: true,
    });
}

// ============================================================================
// Party Embed Update Helper
// ============================================================================

async function updatePartyMessage(party: Party): Promise<void> {
    if (!party.messageId) return;

    const channel = await getTargetChannel();
    if (!channel) return;

    const msg = await safeFetchMessage(channel, party.messageId);
    if (msg) {
        await msg.edit({ embeds: [createPartyEmbed(party)] });
    }
}

// ============================================================================
// Event Handler - Interactions
// ============================================================================

client.on('interactionCreate', async (interaction: Interaction) => {
    try {
        // Slash Commands
        if (interaction.isChatInputCommand()) {
            switch (interaction.commandName) {
                case 'formparty':
                    return await handleFormParty(interaction);
                case 'listparties':
                    return await handleListParties(interaction);
                case 'help':
                    return await handleHelp(interaction);
            }
        }

        // Run Type Selection
        if (interaction.isStringSelectMenu() && interaction.customId === 'select_run') {
            return await handleRunSelection(interaction);
        }

        // Button Actions
        if (interaction.isButton()) {
            const [action, ...rest] = interaction.customId.split('_');
            const partyId = rest.join('_');

            await withPartyLock(partyId, async () => {
                const party = activeParties.get(partyId);
                if (!party) {
                    await interaction.reply({ content: 'This party is locked or no longer exists.', ephemeral: true });
                    return;
                }

                switch (action as ButtonAction) {
                    case 'leave':
                        return await handleLeaveAction(interaction, party);
                    case 'join':
                        return await handleJoinAction(interaction, party, partyId);
                    case 'disband':
                        return await handleDisbandAction(interaction, party, partyId);
                    case 'switch':
                        return await handleSwitchAction(interaction, party, partyId);
                    case 'ping':
                        return await handlePingAction(interaction, party);
                    case 'external':
                        return await handleExternalAction(interaction, party, partyId);
                    case 'kick':
                        return await handleKickAction(interaction, party, partyId);
                    case 'promote':
                        return await handlePromoteAction(interaction, party, partyId);
                }
            });
            return;
        }

        // Role Pick (Join)
        if (interaction.isStringSelectMenu() && interaction.customId.startsWith('pick_')) {
            const partyId = interaction.customId.replace('pick_', '');

            await withPartyLock(partyId, async () => {
                const party = activeParties.get(partyId);
                if (!party) {
                    await interaction.reply({ content: 'This party no longer exists.', ephemeral: true });
                    return;
                }

                const slotIdx = parseInt(interaction.values[0]);
                if (party.slots[slotIdx].user !== null) {
                    await interaction.reply({ content: 'That slot was just taken.', ephemeral: true });
                    return;
                }

                party.slots[slotIdx].user = interaction.user.id;
                saveData();
                await updatePartyMessage(party);
                await interaction.update({ content: 'Role confirmed.', components: [] });
            });
            return;
        }

        // Role Switch Pick
        if (interaction.isStringSelectMenu() && interaction.customId.startsWith('switchpick_')) {
            const partyId = interaction.customId.replace('switchpick_', '');

            await withPartyLock(partyId, async () => {
                const party = activeParties.get(partyId);
                if (!party) {
                    await interaction.reply({ content: 'This party no longer exists.', ephemeral: true });
                    return;
                }

                const newIdx = parseInt(interaction.values[0]);
                const oldIdx = party.slots.findIndex(s => s.user === interaction.user.id);

                if (oldIdx === -1) {
                    await interaction.reply({ content: "You don't have a role to switch.", ephemeral: true });
                    return;
                }

                party.slots[oldIdx].user = null;
                party.slots[newIdx].user = interaction.user.id;
                saveData();
                await updatePartyMessage(party);
                await interaction.update({ content: 'Role switched!', components: [] });
            });
            return;
        }

        // External Player Role Selection - Show Modal for IGN input
        if (interaction.isStringSelectMenu() && interaction.customId.startsWith('externalrole_')) {
            const partyId = interaction.customId.replace('externalrole_', '');
            const party = activeParties.get(partyId);

            if (!party) {
                await interaction.reply({ content: 'This party no longer exists.', ephemeral: true });
                return;
            }

            if (interaction.user.id !== party.leader) {
                await interaction.reply({ content: 'Only the party leader can reserve slots.', ephemeral: true });
                return;
            }

            const roleIdx = parseInt(interaction.values[0]);
            if (party.slots[roleIdx].user !== null) {
                await interaction.reply({ content: 'That slot was just taken.', ephemeral: true });
                return;
            }

            const roleName = party.slots[roleIdx].role;

            // Create and show modal for IGN input
            const modal = new ModalBuilder()
                .setCustomId(`externalign_${partyId}_${roleIdx}`)
                .setTitle('Add External Player');

            const ignInput = new TextInputBuilder()
                .setCustomId('ign_input')
                .setLabel(`Enter IGN for ${roleName}`)
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('Player Name')
                .setRequired(true)
                .setMaxLength(50);

            const actionRow = new ActionRowBuilder<TextInputBuilder>().addComponents(ignInput);
            modal.addComponents(actionRow);

            await interaction.showModal(modal);
            return;
        }

        // Kick Player Pick
        if (interaction.isStringSelectMenu() && interaction.customId.startsWith('kickpick_')) {
            const partyId = interaction.customId.replace('kickpick_', '');

            await withPartyLock(partyId, async () => {
                const party = activeParties.get(partyId);
                if (!party) {
                    await interaction.reply({ content: 'This party no longer exists.', ephemeral: true });
                    return;
                }

                if (interaction.user.id !== party.leader) {
                    await interaction.reply({ content: 'Only the party leader can kick players.', ephemeral: true });
                    return;
                }

                const slotIdx = parseInt(interaction.values[0]);
                const kickedUser = party.slots[slotIdx].user;

                if (!kickedUser) {
                    await interaction.reply({ content: 'That slot is already empty.', ephemeral: true });
                    return;
                }

                party.slots[slotIdx].user = null;
                saveData();
                await updatePartyMessage(party);

                const displayName = kickedUser.startsWith('IGN:')
                    ? kickedUser.replace('IGN:', '')
                    : `<@${kickedUser}>`;

                await interaction.update({ content: `Removed **${displayName}** from the party.`, components: [] });
            });
            return;
        }

        // Promote Leader Pick
        if (interaction.isStringSelectMenu() && interaction.customId.startsWith('promotepick_')) {
            const partyId = interaction.customId.replace('promotepick_', '');

            await withPartyLock(partyId, async () => {
                const party = activeParties.get(partyId);
                if (!party) {
                    await interaction.reply({ content: 'This party no longer exists.', ephemeral: true });
                    return;
                }

                if (interaction.user.id !== party.leader) {
                    await interaction.reply({ content: 'Only the current leader can promote a new leader.', ephemeral: true });
                    return;
                }

                const newLeaderId = interaction.values[0];
                if (newLeaderId.startsWith('IGN:')) {
                    await interaction.reply({ content: 'You cannot promote an external (non‑Discord) player.', ephemeral: true });
                    return;
                }

                party.leader = newLeaderId;
                saveData();
                await updatePartyMessage(party);
                await interaction.update({ content: `Promoted <@${newLeaderId}> to Party Leader.`, components: [] });
            });
            return;
        }

        // Modal Submit - External Player IGN
        if (interaction.isModalSubmit() && interaction.customId.startsWith('externalign_')) {
            const parts = interaction.customId.split('_');
            const partyId = parts.slice(1, -1).join('_'); // Handle party IDs with underscores
            const roleIdx = parseInt(parts[parts.length - 1]);

            await withPartyLock(partyId, async () => {
                const party = activeParties.get(partyId);
                if (!party) {
                    await interaction.reply({ content: 'This party no longer exists.', ephemeral: true });
                    return;
                }

                if (interaction.user.id !== party.leader) {
                    await interaction.reply({ content: 'Only the party leader can reserve slots.', ephemeral: true });
                    return;
                }

                if (party.slots[roleIdx].user !== null) {
                    await interaction.reply({ content: 'That slot was just taken.', ephemeral: true });
                    return;
                }

                const ign = interaction.fields.getTextInputValue('ign_input').trim();
                if (!ign) {
                    await interaction.reply({ content: 'IGN cannot be empty.', ephemeral: true });
                    return;
                }

                party.slots[roleIdx].user = `IGN:${ign}`;
                saveData();
                await updatePartyMessage(party);
                await interaction.reply({ content: `Reserved slot for **${ign}**.`, ephemeral: true });
                Logger.debug(`External player added: ${ign} to party ${partyId}`);
            });
            return;
        }
    } catch (error) {
        Logger.error('Error handling interaction', error);
        try {
            if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: 'An error occurred while processing your request.', ephemeral: true });
            }
        } catch {
            // Ignore follow-up errors
        }
    }
});

// ============================================================================
// Graceful Shutdown
// ============================================================================

async function gracefulShutdown(signal: string): Promise<void> {
    Logger.info(`Received ${signal}. Shutting down gracefully...`);

    // Save current state
    saveData();
    Logger.info(`Saved ${activeParties.size} parties to disk`);

    // Destroy client connection
    await client.destroy();
    Logger.info('Discord client destroyed');

    process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    Logger.error('Uncaught exception', error);
    saveData();
    process.exit(1);
});

process.on('unhandledRejection', (reason) => {
    Logger.error('Unhandled rejection', reason);
});

// ============================================================================
// Bot Startup
// ============================================================================

async function main(): Promise<void> {
    try {
        Logger.info('Starting Guild Wars Party Bot...');
        await client.login(process.env.DISCORD_TOKEN);
    } catch (error) {
        Logger.error('Failed to start bot', error);
        process.exit(1);
    }
}

main();
