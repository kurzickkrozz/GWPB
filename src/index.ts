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
    ColorResolvable
} from 'discord.js';
import * as fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const TARGET_CHANNEL_ID = '1448444485410226259';
const LOCK_TIMEOUT = 3 * 60 * 60 * 1000; // 3 Hours
const DATA_PATH = path.join(__dirname, '..', 'data', 'parties.json');

const RUN_CONFIGS: Record<string, { roles: string[], size: number }> = {
    'BogSC':   { size: 8,  roles: ['Tank', 'AotL MM', 'Paragon', 'VoS', 'VoS', 'VoS', 'VoS', 'VoS'] },
    'DeepSC':  { size: 12, roles: ['Tank', 'EoE', 'UA', 'DPS', 'DPS', 'DPS', 'DPS', 'DPS', 'DPS', 'DPS', 'DPS', 'DPS'] },
    'DoASC':   { size: 8,  roles: ['MT', 'TT', 'Caller', 'TK', 'IAU', 'MLK', 'UA', 'Emo'] },
    'FoWSC':   { size: 8,  roles: ['T1', 'T2', 'T3', 'T4', 'MT', 'VoS', 'VoS', 'VoS'] },
    'SoOSC':   { size: 8,  roles: ['MT', 'Gater', 'VoS', 'TaO', 'Glass Arrows', 'Glass Arrows', 'Glass Arrows', 'Glass Arrows'] },
    'UrgozSC': { size: 12, roles: ['Tank', 'VoS', 'SoS/EoE', 'Deep Freeze', 'Spiker', 'Spiker', 'Spiker', 'Spiker', 'Spiker', 'Seeder', 'Seeder', 'Bonder'] },
    'UWSC':    { size: 8,  roles: ['T1', 'T2', 'T3', 'T4', 'LT', 'SoS', 'Spiker', 'Emo'] }
};

interface Party {
    type: string;
    leader: string;
    maxSize: number;
    slots: { role: string, user: string | null }[];
    createdAt: Date;
    messageId?: string;
}

const activeParties = new Map<string, Party>();
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// --- Persistence Helpers ---
const saveData = () => {
    const data = Array.from(activeParties.entries());
    if (!fs.existsSync(path.dirname(DATA_PATH))) fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
    fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
};

const lockParty = async (partyId: string) => {
    const party = activeParties.get(partyId);
    if (!party || !party.messageId) return;

    try {
        const channel = await client.channels.fetch(TARGET_CHANNEL_ID) as TextChannel;
        const msg = await channel.messages.fetch(party.messageId);
        const lockedEmbed = EmbedBuilder.from(msg.embeds[0])
            .setTitle(`🔒 [LOCKED] ${party.type}`)
            .setColor(0x2b2d31 as ColorResolvable);
        await msg.edit({ embeds: [lockedEmbed], components: [] });
    } catch (e) {
        console.error(`Failed to lock party ${partyId}:`, e);
    } finally {
        activeParties.delete(partyId);
        saveData();
    }
};

const setupLockTimer = (partyId: string, party: Party) => {
    const elapsed = Date.now() - new Date(party.createdAt).getTime();
    const remaining = Math.max(0, LOCK_TIMEOUT - elapsed);
    setTimeout(() => lockParty(partyId), remaining);
};

// --- Event Handlers ---
client.once('ready', async () => {
    // Load Persistence
    if (fs.existsSync(DATA_PATH)) {
        const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'));
        data.forEach(([key, val]: [string, Party]) => {
            val.createdAt = new Date(val.createdAt);
            activeParties.set(key, val);
            setupLockTimer(key, val);
        });
    }
    
    await client.application?.commands.create({
        name: 'formparty',
        description: 'Start a GW1 Speed Clear formation',
    });
    console.log(`Logged in as ${client.user?.tag}. Persistence active.`);
});

client.on('interactionCreate', async (interaction: Interaction) => {
    // 1. Initial Command
    if (interaction.isChatInputCommand() && interaction.commandName === 'formparty') {
        const select = new StringSelectMenuBuilder()
            .setCustomId('select_run')
            .setPlaceholder('Select the run type...')
            .addOptions(Object.keys(RUN_CONFIGS).map(k => ({ label: k, value: k })));
        await interaction.reply({ content: 'Select run type:', components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)], ephemeral: true });
    }

    // 2. Run Choice
    if (interaction.isStringSelectMenu() && interaction.customId === 'select_run') {
        const type = interaction.values[0];
        const config = RUN_CONFIGS[type];
        const partyId = `party_${Date.now()}`;
        
        const newParty: Party = {
            type,
            leader: interaction.user.username,
            maxSize: config.size,
            slots: config.roles.map(r => ({ role: r, user: null })),
            createdAt: new Date()
        };

        activeParties.set(partyId, newParty);
        const channel = await client.channels.fetch(TARGET_CHANNEL_ID) as TextChannel;
        const sent = await channel.send({ 
            embeds: [createPartyEmbed(newParty)], 
            components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder().setCustomId(`join_${partyId}`).setLabel('Claim Role').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId(`leave_${partyId}`).setLabel('Leave').setStyle(ButtonStyle.Danger)
            )]
        });

        newParty.messageId = sent.id;
        saveData();
        setupLockTimer(partyId, newParty);
        await interaction.update({ content: `Party posted in <#${TARGET_CHANNEL_ID}>`, components: [] });
    }

    // 3. Buttons (Join/Leave)
    if (interaction.isButton()) {
        const [action, partyId] = interaction.customId.split('_');
        const party = activeParties.get(partyId);
        if (!party) return interaction.reply({ content: "This log is locked.", ephemeral: true });

        if (action === 'leave') {
            party.slots.forEach(s => { if (s.user === interaction.user.username) s.user = null; });
            saveData();
            await interaction.update({ embeds: [createPartyEmbed(party)] });
        } else if (action === 'join') {
            if (party.slots.some(s => s.user === interaction.user.username)) return interaction.reply({ content: "You already have a role.", ephemeral: true });
            const available = party.slots.map((s, i) => ({...s, i})).filter(s => s.user === null);
            if (available.length === 0) return interaction.reply({ content: "Party is full!", ephemeral: true });

            const roleMenu = new StringSelectMenuBuilder()
                .setCustomId(`pick_${partyId}`)
                .setPlaceholder('Select your role...')
                .addOptions(available.map(s => ({ label: s.role, value: s.i.toString(), description: `Slot #${s.i + 1}` })));
            await interaction.reply({ content: 'Choose a role:', components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(roleMenu)], ephemeral: true });
        }
    }

    // 4. Role Assignment
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('pick_')) {
        const partyId = interaction.customId.split('_')[1];
        const party = activeParties.get(partyId);
        const slotIdx = parseInt(interaction.values[0]);

        if (party && party.slots[slotIdx].user === null) {
            party.slots[slotIdx].user = interaction.user.username;
            saveData();
            const channel = await client.channels.fetch(TARGET_CHANNEL_ID) as TextChannel;
            const msg = await channel.messages.fetch(party.messageId!);
            await msg.edit({ embeds: [createPartyEmbed(party)] });
            await interaction.update({ content: 'Role confirmed.', components: [] });
        }
    }
});

function createPartyEmbed(party: Party) {
    const count = party.slots.filter(s => s.user !== null).length;
    const list = party.slots.map((s, i) => `\`${i + 1}\` **${s.role}**: ${s.user ? `**${s.user}**` : '_Vacant_'}`).join('\n');
    return new EmbedBuilder()
        .setTitle(`⚔️ Speed Clear: ${party.type}`)
        .setDescription(`**Leader:** ${party.leader}\n\n${list}`)
        .setColor(count === party.maxSize ? 0xed4245 : 0x57f287)
        .addFields({ name: 'Roster Status', value: `${count} / ${party.maxSize}`, inline: true })
        .setFooter({ text: `Created: ${party.createdAt.toLocaleString()}` });
}

client.login(process.env.DISCORD_TOKEN);