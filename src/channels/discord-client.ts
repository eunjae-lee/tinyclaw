#!/usr/bin/env node
/**
 * Discord Client for TinyClaw Simple
 * Writes DM messages to queue and reads responses
 * Does NOT call Claude directly - that's handled by queue-processor
 */

import {
    Client, Events, GatewayIntentBits, Partials, Message, DMChannel, TextChannel,
    ThreadChannel, ChannelType, AttachmentBuilder,
    ButtonBuilder, ActionRowBuilder, ButtonStyle, ButtonInteraction,
} from 'discord.js';
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';

import {
    TINYCLAW_CONFIG_HOME, QUEUE_INCOMING, QUEUE_OUTGOING,
    SETTINGS_FILE, APPROVALS_PENDING, APPROVALS_DECISIONS, RESET_FLAG,
    QUEUE_CANCEL
} from '../lib/config';
import { extractAgentPrefix } from '../lib/routing';
import { sanitizeFileName, buildUniqueFilePath, splitMessage } from '../lib/discord-utils';
import { remapSession } from '../lib/session-store';

const LOG_FILE = path.join(TINYCLAW_CONFIG_HOME, 'logs/discord.log');
const FILES_DIR = path.join(TINYCLAW_CONFIG_HOME, 'files');
const BOT_THREADS_FILE = path.join(TINYCLAW_CONFIG_HOME, 'bot-threads.json');
const PENDING_MESSAGES_FILE = path.join(TINYCLAW_CONFIG_HOME, 'pending-messages.json');

// Ensure directories exist
[QUEUE_INCOMING, QUEUE_OUTGOING, path.dirname(LOG_FILE), FILES_DIR, APPROVALS_PENDING, APPROVALS_DECISIONS, QUEUE_CANCEL].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

// Validate bot token
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
if (!DISCORD_BOT_TOKEN || DISCORD_BOT_TOKEN === 'your_token_here') {
    console.error('ERROR: DISCORD_BOT_TOKEN is not set in .env file');
    process.exit(1);
}

interface PendingMessage {
    message: Message;
    channel: DMChannel | TextChannel | ThreadChannel;
    timestamp: number;
    needsThread: boolean;
}

// Serializable version of PendingMessage for disk persistence
interface SerializedPendingMessage {
    channelId: string;
    messageId: string; // Discord message ID (not our queue messageId)
    timestamp: number;
    needsThread: boolean;
}

interface QueueData {
    channel: string;
    sender: string;
    senderId: string;
    message: string;
    timestamp: number;
    messageId: string;
    files?: string[];
    agent?: string;
    sessionKey?: string;
}

interface ResponseData {
    channel: string;
    sender: string;
    message: string;
    originalMessage: string;
    timestamp: number;
    messageId: string;
    agent?: string;
    files?: string[];
}

interface StreamingData {
    status: 'streaming';
    channel: string;
    sender: string;
    messageId: string;
    partial: string;
    agent?: string;
    timestamp: number;
    cancelable?: boolean;
}

interface StreamingMessage {
    discordMessage: Message;
    channel: DMChannel | TextChannel | ThreadChannel;
    lastContent: string;
    lastEditTime: number;
}

// Track active streaming messages (messageId → StreamingMessage)
const streamingMessages = new Map<string, StreamingMessage>();

// sanitizeFileName, buildUniqueFilePath imported from ../lib/discord-utils

// Download a file from URL to local path
function downloadFile(url: string, destPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(destPath);
        const request = (url.startsWith('https') ? https.get(url, handleResponse) : http.get(url, handleResponse));

        function handleResponse(response: http.IncomingMessage): void {
            if (response.statusCode === 301 || response.statusCode === 302) {
                const redirectUrl = response.headers.location;
                if (redirectUrl) {
                    file.close();
                    fs.unlinkSync(destPath);
                    downloadFile(redirectUrl, destPath).then(resolve).catch(reject);
                    return;
                }
            }
            response.pipe(file);
            file.on('finish', () => { file.close(); resolve(); });
        }

        request.on('error', (err) => {
            fs.unlink(destPath, () => {});
            reject(err);
        });
    });
}

// Track pending messages (waiting for response)
const pendingMessages = new Map<string, PendingMessage>();
let processingOutgoingQueue = false;

// Persist pending messages to disk so they survive restarts
function savePendingMessages(): void {
    try {
        const obj: Record<string, SerializedPendingMessage> = {};
        for (const [id, pm] of pendingMessages) {
            obj[id] = {
                channelId: pm.channel.id,
                messageId: pm.message.id,
                timestamp: pm.timestamp,
                needsThread: pm.needsThread,
            };
        }
        fs.writeFileSync(PENDING_MESSAGES_FILE, JSON.stringify(obj));
    } catch {
        // Best-effort
    }
}

// Restore pending messages from disk after the client is ready
async function restorePendingMessages(): Promise<void> {
    let data: Record<string, SerializedPendingMessage>;
    try {
        data = JSON.parse(fs.readFileSync(PENDING_MESSAGES_FILE, 'utf8'));
    } catch {
        return; // No file or corrupt
    }

    const threeDaysAgo = Date.now() - (3 * 24 * 60 * 60 * 1000);

    for (const [queueMsgId, saved] of Object.entries(data)) {
        if (saved.timestamp < threeDaysAgo) continue; // Skip expired

        try {
            const channel = await client.channels.fetch(saved.channelId);
            if (!channel || !channel.isTextBased()) continue;

            const message = await (channel as TextChannel | ThreadChannel | DMChannel).messages.fetch(saved.messageId);
            if (!message) continue;

            pendingMessages.set(queueMsgId, {
                message,
                channel: channel as DMChannel | TextChannel | ThreadChannel,
                timestamp: saved.timestamp,
                needsThread: saved.needsThread,
            });
        } catch {
            // Channel or message no longer accessible — skip
        }
    }

    log('INFO', `Restored ${pendingMessages.size} pending message(s) from disk`);
}

// Track threads created by the bot — persisted to disk so it survives restarts.
// Maps thread ID → agent ID extracted from the starter message (or undefined for default agent)
const botOwnedThreads = new Map<string, string | undefined>();

// Load persisted thread map on startup
try {
    const data = JSON.parse(fs.readFileSync(BOT_THREADS_FILE, 'utf8'));
    for (const [id, agent] of Object.entries(data)) {
        botOwnedThreads.set(id, (agent as string | null) ?? undefined);
    }
} catch {
    // No file yet or corrupt — start fresh
}

function saveBotOwnedThreads(): void {
    try {
        const obj: Record<string, string | null> = {};
        for (const [id, agent] of botOwnedThreads) {
            obj[id] = agent ?? null;
        }
        fs.writeFileSync(BOT_THREADS_FILE, JSON.stringify(obj));
    } catch {
        // Best-effort — don't crash on write failure
    }
}

// Read allowed channel IDs from settings (re-reads each call so changes don't require restart)
function getAllowedChannels(): { channelIds: string[]; defaultAgents: Map<string, string> } {
    try {
        const settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
        const raw = settings.channels?.discord?.allowed_channels ?? [];
        const channelIds: string[] = [];
        const defaultAgents = new Map<string, string>();
        for (const entry of raw) {
            if (typeof entry === 'string') {
                channelIds.push(entry);
            } else {
                channelIds.push(entry.channelId);
                defaultAgents.set(entry.channelId, entry.defaultAgent);
            }
        }
        return { channelIds, defaultAgents };
    } catch {
        return { channelIds: [], defaultAgents: new Map() };
    }
}

// Read heartbeat channel ID from settings (re-reads each call)
function getHeartbeatChannel(): string | null {
    try {
        const settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
        return settings.channels?.discord?.heartbeat_channel || null;
    } catch {
        return null;
    }
}

// Logger
function log(level: string, message: string): void {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${level}] ${message}\n`;
    console.log(logMessage.trim());
    fs.appendFileSync(LOG_FILE, logMessage);
}

// Load teams from settings for /team command
function getTeamListText(): string {
    try {
        const settingsData = fs.readFileSync(SETTINGS_FILE, 'utf8');
        const settings = JSON.parse(settingsData);
        const teams = settings.teams;
        if (!teams || Object.keys(teams).length === 0) {
            return 'No teams configured.\n\nCreate a team with `tinyclaw team add`.';
        }
        let text = '**Available Teams:**\n';
        for (const [id, team] of Object.entries(teams) as [string, any][]) {
            text += `\n**!${id}** - ${team.name}`;
            text += `\n  Agents: ${team.agents.join(', ')}`;
            text += `\n  Leader: !${team.leader_agent}`;
        }
        text += '\n\nUsage: Start your message with `!team_id` to route to a team.';
        return text;
    } catch {
        return 'Could not load team configuration.';
    }
}

// Load agents from settings for /agent command
function getAgentListText(): string {
    try {
        const settingsData = fs.readFileSync(SETTINGS_FILE, 'utf8');
        const settings = JSON.parse(settingsData);
        const agents = settings.agents;
        if (!agents || Object.keys(agents).length === 0) {
            return `No agents configured. Using default single-agent mode.\n\nConfigure agents in \`${SETTINGS_FILE}\` or run \`tinyclaw agent add\`.`;
        }
        let text = '**Available Agents:**\n';
        for (const [id, agent] of Object.entries(agents) as [string, any][]) {
            text += `\n**!${id}** - ${agent.name}`;
            text += `\n  Provider: ${agent.provider}/${agent.model}`;
            text += `\n  Directory: ${agent.working_directory}`;
            if (agent.system_prompt) text += `\n  Has custom system prompt`;
            if (agent.prompt_file) text += `\n  Prompt file: ${agent.prompt_file}`;
        }
        text += '\n\nUsage: Start your message with `!agent_id` to route to a specific agent.';
        return text;
    } catch {
        return 'Could not load agent configuration.';
    }
}

// splitMessage imported from ../lib/discord-utils

// Initialize Discord client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
    partials: [
        Partials.Channel,
        Partials.Message,
    ],
});

// Client ready
client.on(Events.ClientReady, async (readyClient) => {
    log('INFO', `Discord bot connected as ${readyClient.user.tag}`);
    log('INFO', 'Listening for DMs and server messages...');
    await restorePendingMessages();
});

// Message received - Write to queue
client.on(Events.MessageCreate, async (message: Message) => {
    try {
        // Skip bot messages
        if (message.author.bot) {
            return;
        }

        // Determine reply channel and whether we need a thread
        let replyChannel: DMChannel | TextChannel | ThreadChannel;
        let needsThread = false;

        if (!message.guild) {
            // DM — keep existing behavior
            replyChannel = message.channel as DMChannel;
        } else if (
            message.channel.type === ChannelType.PublicThread ||
            message.channel.type === ChannelType.PrivateThread
        ) {
            // Thread message — respond if bot-owned, @mentioned, or thread started on a bot message
            const thread = message.channel as ThreadChannel;
            const isMentioned = message.mentions.has(client.user!);

            if (!botOwnedThreads.has(thread.id) && !isMentioned) {
                // Check if the thread was started on a message sent by the bot
                try {
                    const starterMessage = await thread.fetchStarterMessage();
                    if (starterMessage?.author.id === client.user!.id) {
                        botOwnedThreads.set(thread.id, extractAgentPrefix(starterMessage?.content || ''));
                        saveBotOwnedThreads();
                    } else {
                        return;
                    }
                } catch {
                    return;
                }
            }

            // Once we get here, auto-track so future messages don't re-fetch
            if (!botOwnedThreads.has(thread.id)) {
                botOwnedThreads.set(thread.id, undefined);
                saveBotOwnedThreads();
            }
            replyChannel = thread;
        } else {
            // Server channel message — check allowlist or @mention
            const { channelIds, defaultAgents } = getAllowedChannels();
            const isAllowlisted = channelIds.includes(message.channel.id);
            const isMentioned = message.mentions.has(client.user!);

            if (!isAllowlisted && !isMentioned) {
                return;
            }
            replyChannel = message.channel as TextChannel;
            needsThread = true;
        }

        const hasAttachments = message.attachments.size > 0;
        const hasContent = message.content && message.content.trim().length > 0;

        // Skip messages with no content and no attachments
        if (!hasContent && !hasAttachments) {
            return;
        }

        const sender = message.author.username;

        // Generate unique message ID
        const messageId = `${Date.now()}_${Math.random().toString(36).substring(7)}`;

        // Download any attachments
        const downloadedFiles: string[] = [];
        if (hasAttachments) {
            for (const [, attachment] of message.attachments) {
                try {
                    const attachmentName = attachment.name || `discord_${messageId}_${Date.now()}.bin`;
                    const filename = `discord_${messageId}_${attachmentName}`;
                    const localPath = buildUniqueFilePath(FILES_DIR, filename);

                    await downloadFile(attachment.url, localPath);
                    downloadedFiles.push(localPath);
                    log('INFO', `Downloaded attachment: ${path.basename(localPath)} (${attachment.contentType || 'unknown'})`);
                } catch (dlErr) {
                    log('ERROR', `Failed to download attachment ${attachment.name}: ${(dlErr as Error).message}`);
                }
            }
        }

        let messageText = message.content || '';

        // Strip bot @mention from message text so the agent doesn't see it
        if (client.user) {
            messageText = messageText.replace(new RegExp(`<@!?${client.user.id}>`, 'g'), '').trim();
        }

        log('INFO', `Message from ${sender}: ${messageText.substring(0, 50)}${downloadedFiles.length > 0 ? ` [+${downloadedFiles.length} file(s)]` : ''}...`);

        // Check for agent list command
        if (messageText.trim().match(/^[!/]agent$/i)) {
            log('INFO', 'Agent list command received');
            const agentList = getAgentListText();
            await message.reply(agentList);
            return;
        }

        // Check for team list command
        if (messageText.trim().match(/^[!/]team$/i)) {
            log('INFO', 'Team list command received');
            const teamList = getTeamListText();
            await message.reply(teamList);
            return;
        }

        // Check for reset command
        if (messageText.trim().match(/^[!/]reset$/i)) {
            log('INFO', 'Reset command received');

            // Create reset flag
            fs.mkdirSync(path.dirname(RESET_FLAG), { recursive: true });
            fs.writeFileSync(RESET_FLAG, 'reset');

            // Reply immediately
            await message.reply('Conversation reset! Next message will start a fresh conversation.');
            return;
        }

        // Show typing indicator
        await replyChannel.sendTyping();

        // Build message text with file references
        let fullMessage = messageText;
        if (downloadedFiles.length > 0) {
            const fileRefs = downloadedFiles.map(f => `[file: ${f}]`).join('\n');
            fullMessage = fullMessage ? `${fullMessage}\n\n${fileRefs}` : fileRefs;
        }

        // Look up agent routing: thread agent > channel default > undefined
        const isThread = message.channel.type === ChannelType.PublicThread ||
                         message.channel.type === ChannelType.PrivateThread;
        const threadAgent = isThread ? botOwnedThreads.get(message.channel.id) : undefined;
        const channelDefault = message.guild
            ? (() => {
                const { defaultAgents: da } = getAllowedChannels();
                return da.get(isThread ? (message.channel as ThreadChannel).parentId! : message.channel.id);
            })()
            : undefined;
        const agent = threadAgent ?? channelDefault;

        // Compute session key for per-thread/DM isolation
        const sessionKey = isThread
            ? message.channel.id                    // thread ID
            : message.guild
                ? messageId                          // channel msg (will become thread)
                : `dm_${message.author.id}`;         // DM

        // Write to incoming queue
        const queueData: QueueData = {
            channel: 'discord',
            sender: sender,
            senderId: message.author.id,
            message: fullMessage,
            timestamp: Date.now(),
            messageId: messageId,
            files: downloadedFiles.length > 0 ? downloadedFiles : undefined,
            agent: agent,
            sessionKey: sessionKey,
        };

        const queueFile = path.join(QUEUE_INCOMING, `discord_${messageId}.json`);
        fs.writeFileSync(queueFile, JSON.stringify(queueData, null, 2));

        log('INFO', `Queued message ${messageId}`);

        // Store pending message for response
        pendingMessages.set(messageId, {
            message: message,
            channel: replyChannel,
            timestamp: Date.now(),
            needsThread: needsThread,
        });

        // Clean up old pending messages (older than 3 days)
        const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
        const cutoff = Date.now() - threeDaysMs;
        for (const [id, data] of pendingMessages.entries()) {
            if (data.timestamp < cutoff) {
                log('WARN', `Pending message ${id} expired after 3 days`);
                pendingMessages.delete(id);
            }
        }

        // Persist to disk
        savePendingMessages();

    } catch (error) {
        log('ERROR', `Message handling error: ${(error as Error).message}`);
        // Attempt to notify the user that something went wrong
        try {
            await message.reply('Sorry, something went wrong while processing your message. Please try again.');
        } catch (replyError) {
            log('ERROR', `Failed to send error reply: ${(replyError as Error).message}`);
        }
    }
});

// Watch for streaming partial responses
let processingStreamingCheck = false;
async function checkStreamingFiles(): Promise<void> {
    if (processingStreamingCheck) return;
    processingStreamingCheck = true;

    try {
        const files = fs.readdirSync(QUEUE_OUTGOING)
            .filter(f => f.endsWith('.streaming'));

        for (const file of files) {
            const filePath = path.join(QUEUE_OUTGOING, file);

            try {
                const data: StreamingData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                const { messageId, partial } = data;

                if (!partial) continue;

                const existing = streamingMessages.get(messageId);

                if (existing) {
                    // Update existing streaming message if content changed
                    if (existing.lastContent !== partial) {
                        const now = Date.now();
                        if (now - existing.lastEditTime >= 1000) {
                            try {
                                // Truncate to 2000 chars for Discord limit during streaming
                                const displayText = partial.length > 2000
                                    ? partial.substring(0, 1950) + '\n\n*[streaming...]*'
                                    : partial;

                                const editOptions: { content: string; components?: ActionRowBuilder<ButtonBuilder>[] } = { content: displayText };
                                if (data.cancelable) {
                                    const cancelBtn = new ButtonBuilder()
                                        .setCustomId(`cancel_${messageId}`)
                                        .setLabel('Stop')
                                        .setStyle(ButtonStyle.Secondary);
                                    editOptions.components = [new ActionRowBuilder<ButtonBuilder>().addComponents(cancelBtn)];
                                }
                                await existing.discordMessage.edit(editOptions);
                                existing.lastContent = partial;
                                existing.lastEditTime = now;
                            } catch (editErr) {
                                log('WARN', `Failed to edit streaming message: ${(editErr as Error).message}`);
                            }
                        }
                    }
                } else {
                    // First streaming chunk — send initial message
                    const pending = pendingMessages.get(messageId);
                    if (!pending) continue;

                    let targetChannel = pending.channel;
                    let threadJustCreated = false;

                    // Create thread if needed
                    if (pending.needsThread) {
                        try {
                            const threadName = (pending.message.content || 'conversation').substring(0, 90);
                            const thread = await pending.message.startThread({
                                name: threadName,
                                autoArchiveDuration: 1440,
                            });
                            const { defaultAgents: da } = getAllowedChannels();
                            const parentDefault = da.get(pending.channel.id);
                            botOwnedThreads.set(thread.id, data.agent ?? parentDefault);
                            saveBotOwnedThreads();
                            remapSession(messageId, thread.id);
                            targetChannel = thread;
                            pending.channel = thread;
                            pending.needsThread = false;
                            threadJustCreated = true;
                        } catch (threadErr) {
                            log('WARN', `Failed to create thread for streaming: ${(threadErr as Error).message}`);
                        }
                    }

                    try {
                        const displayText = partial.length > 2000
                            ? partial.substring(0, 1950) + '\n\n*[streaming...]*'
                            : partial;

                        const sendOptions: { content: string; components?: ActionRowBuilder<ButtonBuilder>[] } = { content: displayText };
                        if (data.cancelable) {
                            const cancelBtn = new ButtonBuilder()
                                .setCustomId(`cancel_${messageId}`)
                                .setLabel('Stop')
                                .setStyle(ButtonStyle.Secondary);
                            sendOptions.components = [new ActionRowBuilder<ButtonBuilder>().addComponents(cancelBtn)];
                        }

                        let sentMessage: Message;
                        if (threadJustCreated || pending.needsThread) {
                            // Send in thread (just created) or channel (thread creation failed)
                            sentMessage = await targetChannel.send(sendOptions);
                        } else {
                            try {
                                sentMessage = await pending.message.reply(sendOptions);
                            } catch {
                                sentMessage = await targetChannel.send(sendOptions);
                            }
                        }

                        streamingMessages.set(messageId, {
                            discordMessage: sentMessage,
                            channel: targetChannel,
                            lastContent: partial,
                            lastEditTime: Date.now(),
                        });
                    } catch (sendErr) {
                        log('WARN', `Failed to send initial streaming message: ${(sendErr as Error).message}`);
                    }
                }
            } catch (err) {
                log('WARN', `Error processing streaming file ${file}: ${(err as Error).message}`);
            }
        }
    } catch (err) {
        log('ERROR', `checkStreamingFiles error: ${(err as Error).message}`);
    } finally {
        processingStreamingCheck = false;
    }
}

// Check streaming files every second
setInterval(checkStreamingFiles, 1000);

// Watch for responses in outgoing queue
async function checkOutgoingQueue(): Promise<void> {
    if (processingOutgoingQueue) {
        return;
    }

    processingOutgoingQueue = true;

    try {
        const files = fs.readdirSync(QUEUE_OUTGOING)
            .filter(f => f.startsWith('discord_') && f.endsWith('.json'));

        for (const file of files) {
            const filePath = path.join(QUEUE_OUTGOING, file);

            try {
                const responseData: ResponseData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                const { messageId, message: responseText, sender } = responseData;

                // Check if we were streaming this message
                const streaming = streamingMessages.get(messageId);

                if (streaming) {
                    // Streaming → final transition: edit existing message with final content
                    const targetChannel = streaming.channel;

                    // Send any attached files
                    if (responseData.files && responseData.files.length > 0) {
                        const attachments: AttachmentBuilder[] = [];
                        for (const file of responseData.files) {
                            try {
                                if (!fs.existsSync(file)) continue;
                                attachments.push(new AttachmentBuilder(file));
                            } catch (fileErr) {
                                log('ERROR', `Failed to prepare file ${file}: ${(fileErr as Error).message}`);
                            }
                        }
                        if (attachments.length > 0) {
                            await targetChannel.send({ files: attachments });
                            log('INFO', `Sent ${attachments.length} file(s) to Discord`);
                        }
                    }

                    // Final edit with complete response
                    if (responseText) {
                        const chunks = splitMessage(responseText);

                        // Edit the streaming message with the first chunk (remove cancel button)
                        try {
                            await streaming.discordMessage.edit({ content: chunks[0]!, components: [] });
                        } catch (editErr) {
                            log('WARN', `Failed to edit streaming message with final content: ${(editErr as Error).message}`);
                            // Fall back to sending as a new message
                            await targetChannel.send(chunks[0]!);
                        }

                        // Send remaining chunks as new messages
                        for (let i = 1; i < chunks.length; i++) {
                            await targetChannel.send(chunks[i]!);
                        }
                    }

                    log('INFO', `Finalized streaming response to ${sender} (${responseText.length} chars${responseData.files ? `, ${responseData.files.length} file(s)` : ''})`);

                    // Clean up
                    streamingMessages.delete(messageId);
                    pendingMessages.delete(messageId);
                    savePendingMessages();
                    fs.unlinkSync(filePath);
                } else if (pendingMessages.has(messageId)) {
                    // Non-streaming path (original behavior)
                    const pending = pendingMessages.get(messageId)!;
                    let targetChannel: DMChannel | TextChannel | ThreadChannel = pending.channel;

                    if (pending.needsThread) {
                        // Create a thread from the original message
                        try {
                            const threadName = (pending.message.content || 'conversation').substring(0, 90);
                            const thread = await pending.message.startThread({
                                name: threadName,
                                autoArchiveDuration: 1440,
                            });
                            const { defaultAgents: da } = getAllowedChannels();
                            const parentDefault = da.get(pending.channel.id);
                            botOwnedThreads.set(thread.id, responseData.agent ?? parentDefault);
                            saveBotOwnedThreads();
                            // Remap session from messageId key to thread.id key
                            remapSession(messageId, thread.id);
                            targetChannel = thread;
                        } catch (threadErr) {
                            log('WARN', `Failed to create thread, falling back to channel reply: ${(threadErr as Error).message}`);
                            // Fall back to direct channel reply (targetChannel remains as-is)
                        }
                    }

                    // Send any attached files
                    if (responseData.files && responseData.files.length > 0) {
                        const attachments: AttachmentBuilder[] = [];
                        for (const file of responseData.files) {
                            try {
                                if (!fs.existsSync(file)) continue;
                                attachments.push(new AttachmentBuilder(file));
                            } catch (fileErr) {
                                log('ERROR', `Failed to prepare file ${file}: ${(fileErr as Error).message}`);
                            }
                        }
                        if (attachments.length > 0) {
                            await targetChannel.send({ files: attachments });
                            log('INFO', `Sent ${attachments.length} file(s) to Discord`);
                        }
                    }

                    // Split message if needed (Discord 2000 char limit)
                    if (responseText) {
                        const chunks = splitMessage(responseText);

                        if (pending.needsThread) {
                            // Thread: send all chunks inside the thread (no reply to original)
                            for (const chunk of chunks) {
                                await targetChannel.send(chunk);
                            }
                        } else {
                            // DM or existing thread: first chunk as reply, rest as follow-ups
                            if (chunks.length > 0) {
                                try {
                                    await pending.message.reply(chunks[0]!);
                                } catch {
                                    // Fall back to send() if reply() fails (e.g. system messages)
                                    await targetChannel.send(chunks[0]!);
                                }
                            }
                            for (let i = 1; i < chunks.length; i++) {
                                await targetChannel.send(chunks[i]!);
                            }
                        }
                    }

                    log('INFO', `Sent response to ${sender} (${responseText.length} chars${responseData.files ? `, ${responseData.files.length} file(s)` : ''})`);

                    // Clean up
                    pendingMessages.delete(messageId);
                    savePendingMessages();
                    fs.unlinkSync(filePath);
                } else {
                    // Message expired from pending map or already processed
                    log('WARN', `No pending message for ${messageId} (sender: ${sender}), response discarded. ` +
                        `Response was ${responseText.length} chars. This may indicate the CLI took longer than the pending timeout.`);
                    fs.unlinkSync(filePath);
                }
            } catch (error) {
                const errMsg = (error as Error).message || '';
                log('ERROR', `Error processing response file ${file}: ${errMsg}`);

                // Permanent Discord errors — no point retrying
                if (errMsg.includes('Cannot reply') || errMsg.includes('Unknown Message') || errMsg.includes('Invalid Form Body')) {
                    log('WARN', `Permanent error, cleaning up ${file}`);
                    try {
                        const responseData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                        pendingMessages.delete(responseData.messageId);
                    } catch { /* ignore */ }
                    try { fs.unlinkSync(filePath); } catch { /* ignore */ }
                }
                // Transient errors: leave file for retry
            }
        }

        // Process heartbeat responses
        const heartbeatFiles = fs.readdirSync(QUEUE_OUTGOING)
            .filter(f => f.startsWith('heartbeat_') && f.endsWith('.json'));

        for (const file of heartbeatFiles) {
            const filePath = path.join(QUEUE_OUTGOING, file);

            try {
                const heartbeatChannelId = getHeartbeatChannel();
                if (!heartbeatChannelId) {
                    // No heartbeat channel configured — leave file for heartbeat script
                    continue;
                }

                const responseData: ResponseData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                const agentId = responseData.agent || responseData.sender || 'unknown';
                const responseText = responseData.message || '';

                // Parse heartbeat JSON response
                let heartbeatMessage: string;
                try {
                    const parsed = JSON.parse(responseText.trim());
                    if (parsed.status === 'ok') {
                        fs.unlinkSync(filePath);
                        log('INFO', `Heartbeat from ${agentId}: OK (suppressed)`);
                        continue;
                    }
                    heartbeatMessage = parsed.message || responseText;
                } catch {
                    // Not valid JSON — use raw response text
                    heartbeatMessage = responseText;
                }

                const channel = await client.channels.fetch(heartbeatChannelId);
                if (!channel || !channel.isTextBased()) {
                    log('WARN', `Heartbeat channel ${heartbeatChannelId} not found or not text-based`);
                    continue;
                }

                const formatted = `**Heartbeat — @${agentId}**\n${heartbeatMessage}`;
                const chunks = splitMessage(formatted);
                for (const chunk of chunks) {
                    await (channel as TextChannel).send(chunk);
                }

                fs.unlinkSync(filePath);
                log('INFO', `Posted heartbeat response from ${agentId} to channel ${heartbeatChannelId}`);
            } catch (error) {
                log('ERROR', `Error processing heartbeat file ${file}: ${(error as Error).message}`);
            }
        }
    } catch (error) {
        log('ERROR', `Outgoing queue error: ${(error as Error).message}`);
    } finally {
        processingOutgoingQueue = false;
    }
}

// Check outgoing queue every second
setInterval(checkOutgoingQueue, 1000);

// Auto-track threads created on bot messages
client.on(Events.ThreadCreate, async (thread) => {
    try {
        const starterMessage = await thread.fetchStarterMessage();
        if (starterMessage?.author.id === client.user?.id) {
            botOwnedThreads.set(thread.id, extractAgentPrefix(starterMessage?.content || ''));
            saveBotOwnedThreads();
            log('INFO', `Auto-tracked thread ${thread.id} (created on bot message)`);
        }
    } catch {
        // Ignore — will be checked lazily on first message
    }
});

// Clean up bot-owned thread tracker when threads are deleted
client.on(Events.ThreadDelete, (thread) => {
    botOwnedThreads.delete(thread.id);
    saveBotOwnedThreads();
});

// Refresh typing indicator every 8 seconds (Discord typing expires after ~10s)
// Skip messages that are actively streaming (the updating message serves as feedback)
setInterval(() => {
    for (const [id, data] of pendingMessages.entries()) {
        if (streamingMessages.has(id)) continue;
        data.channel.sendTyping().catch(() => {
            // Ignore typing errors silently
        });
    }
}, 8000);

// --- Tool Approval System ---

interface PendingApproval {
    request_id: string;
    tool_name: string;
    tool_pattern?: string;
    tool_input_summary: string;
    agent_id: string;
    message_id?: string;
    timestamp: number;
    notified: boolean;
}

// Track which approval requests we've already sent DMs for
const notifiedApprovals = new Set<string>();

function getAdminUserId(): string | null {
    try {
        const settingsData = fs.readFileSync(SETTINGS_FILE, 'utf8');
        const settings = JSON.parse(settingsData);
        return settings.admin_user_id || null;
    } catch {
        return null;
    }
}

// Poll for pending approval requests and send Discord DMs
async function checkPendingApprovals(): Promise<void> {
    const adminUserId = getAdminUserId();
    if (!adminUserId) return;

    let files: string[];
    try {
        files = fs.readdirSync(APPROVALS_PENDING).filter(f => f.endsWith('.json'));
    } catch {
        return;
    }

    for (const file of files) {
        const filePath = path.join(APPROVALS_PENDING, file);
        let approval: PendingApproval;

        try {
            approval = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        } catch {
            continue;
        }

        const requestId = approval.request_id;

        // Skip if already notified
        if (notifiedApprovals.has(requestId) || approval.notified) {
            continue;
        }

        try {
            // Truncate tool input summary for display
            let inputDisplay = approval.tool_input_summary || '{}';
            if (inputDisplay.length > 300) {
                inputDisplay = inputDisplay.substring(0, 297) + '...';
            }

            const allowBtn = new ButtonBuilder()
                .setCustomId(`approve_${requestId}`)
                .setLabel('Allow this time')
                .setStyle(ButtonStyle.Primary);

            const alwaysBtn = new ButtonBuilder()
                .setCustomId(`always_${requestId}`)
                .setLabel('Always allow')
                .setStyle(ButtonStyle.Success);

            const alwaysAllBtn = new ButtonBuilder()
                .setCustomId(`always_all_${requestId}`)
                .setLabel('Always allow globally')
                .setStyle(ButtonStyle.Success);

            const denyBtn = new ButtonBuilder()
                .setCustomId(`deny_${requestId}`)
                .setLabel('Deny')
                .setStyle(ButtonStyle.Danger);

            const row = new ActionRowBuilder<ButtonBuilder>().addComponents(allowBtn, alwaysBtn, alwaysAllBtn, denyBtn);

            const toolDisplay = approval.tool_pattern || approval.tool_name;
            const content = `**Tool approval needed**\nAgent \`${approval.agent_id}\` wants to use **${toolDisplay}**\n\`\`\`\n${inputDisplay}\n\`\`\``;

            // Try to post in the same thread/channel as the original message
            const pending = approval.message_id ? pendingMessages.get(approval.message_id) : undefined;
            if (pending) {
                // If this message needs a thread but doesn't have one yet, create it now
                if (pending.needsThread) {
                    try {
                        const threadName = (pending.message.content || 'conversation').substring(0, 90);
                        const thread = await pending.message.startThread({
                            name: threadName,
                            autoArchiveDuration: 1440,
                        });
                        const { defaultAgents: da } = getAllowedChannels();
                        const parentDefault = da.get(pending.channel.id);
                        botOwnedThreads.set(thread.id, approval.agent_id ?? parentDefault);
                        saveBotOwnedThreads();
                        // Update pending so future approvals and the final response use this thread
                        pending.channel = thread;
                        pending.needsThread = false;
                    } catch (threadErr) {
                        log('WARN', `Failed to create thread for approval, posting in channel: ${(threadErr as Error).message}`);
                    }
                }
                await pending.channel.send({ content, components: [row] });
            } else {
                // Fallback to DM
                const adminUser = await client.users.fetch(adminUserId);
                await adminUser.send({ content, components: [row] });
            }

            // Mark as notified (update file and in-memory set)
            notifiedApprovals.add(requestId);
            approval.notified = true;
            fs.writeFileSync(filePath, JSON.stringify(approval, null, 2));

            log('INFO', `Sent approval request for ${approval.tool_name} (${requestId})${pending ? ' in thread' : ' via DM'}`);
        } catch (err) {
            log('ERROR', `Failed to send approval request: ${(err as Error).message}`);
        }
    }
}

// Handle button interactions for approval decisions
client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isButton()) return;

    const buttonInteraction = interaction as ButtonInteraction;
    const customId = buttonInteraction.customId;

    // Handle cancel button
    if (customId.startsWith('cancel_')) {
        const cancelMessageId = customId.substring('cancel_'.length);
        try {
            // Write cancel signal file
            const cancelFile = path.join(QUEUE_CANCEL, `${cancelMessageId}.json`);
            fs.writeFileSync(cancelFile, JSON.stringify({ messageId: cancelMessageId, timestamp: Date.now() }));

            // Disable the button
            const disabledBtn = new ButtonBuilder()
                .setCustomId(`cancel_${cancelMessageId}`)
                .setLabel('Stopping...')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(true);
            const row = new ActionRowBuilder<ButtonBuilder>().addComponents(disabledBtn);

            await buttonInteraction.update({
                components: [row],
            });

            log('INFO', `Cancel requested for message ${cancelMessageId}`);
        } catch (err) {
            log('ERROR', `Failed to handle cancel: ${(err as Error).message}`);
            try {
                await buttonInteraction.reply({ content: 'Failed to cancel. Please try again.', ephemeral: true });
            } catch { /* ignore */ }
        }
        return;
    }

    // Parse action and request_id from customId
    let action: string;
    let requestId: string;

    if (customId.startsWith('approve_')) {
        action = 'allow';
        requestId = customId.substring('approve_'.length);
    } else if (customId.startsWith('always_all_')) {
        action = 'always_allow_all';
        requestId = customId.substring('always_all_'.length);
    } else if (customId.startsWith('always_')) {
        action = 'always_allow';
        requestId = customId.substring('always_'.length);
    } else if (customId.startsWith('deny_')) {
        action = 'deny';
        requestId = customId.substring('deny_'.length);
    } else {
        return; // Not an approval button
    }

    // Read pending file to get tool_name/tool_pattern (for always_allow / always_allow_all)
    let toolName = '';
    let toolPattern = '';
    const pendingFile = path.join(APPROVALS_PENDING, `${requestId}.json`);
    try {
        const pending: PendingApproval = JSON.parse(fs.readFileSync(pendingFile, 'utf8'));
        toolName = pending.tool_name;
        toolPattern = pending.tool_pattern || pending.tool_name;
    } catch {
        // Pending file may already be cleaned up
    }

    // Write decision file
    const decisionFile = path.join(APPROVALS_DECISIONS, `${requestId}.json`);
    const decision: Record<string, string> = { decision: action };
    if ((action === 'always_allow' || action === 'always_allow_all') && toolName) {
        decision.tool_name = toolName;
    }

    try {
        fs.writeFileSync(decisionFile, JSON.stringify(decision, null, 2));
    } catch (err) {
        log('ERROR', `Failed to write decision file: ${(err as Error).message}`);
        await buttonInteraction.reply({ content: 'Error writing decision. Please try again.', ephemeral: true });
        return;
    }

    // Reply to interaction and disable buttons
    let replyText: string;
    switch (action) {
        case 'allow':
            replyText = 'Approved (this time)';
            break;
        case 'always_allow':
            replyText = `Always allowed \`${toolPattern}\` for this agent`;
            break;
        case 'always_allow_all':
            replyText = `Always allowed \`${toolPattern}\` globally`;
            break;
        case 'deny':
            replyText = 'Denied';
            break;
        default:
            replyText = 'Done';
    }

    try {
        await buttonInteraction.update({
            content: `${buttonInteraction.message.content}\n\n**Decision:** ${replyText}`,
            components: [], // Remove buttons
        });
    } catch (err) {
        // Fallback: reply if update fails
        try {
            await buttonInteraction.reply({ content: replyText, ephemeral: true });
        } catch {
            // Ignore
        }
    }

    // Clean up tracking
    notifiedApprovals.delete(requestId);

    log('INFO', `Approval decision for ${requestId}: ${action}`);
});

// Check pending approvals every second
setInterval(checkPendingApprovals, 1000);

// Graceful shutdown
process.on('SIGINT', () => {
    log('INFO', 'Shutting down Discord client...');
    client.destroy();
    process.exit(0);
});

process.on('SIGTERM', () => {
    log('INFO', 'Shutting down Discord client...');
    client.destroy();
    process.exit(0);
});

// Start client
log('INFO', 'Starting Discord client...');
client.login(DISCORD_BOT_TOKEN);
