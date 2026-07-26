import 'dotenv/config';
import { Client, Collection, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder, Events, AttachmentBuilder } from 'discord.js';
import { REST } from '@discordjs/rest';
import express from 'express';
import cron from 'node-cron';

import config from './config/application.js';
import { initializeDatabase } from './utils/database.js';
import { getGuildConfig } from './services/config/guildConfig.js';
import { getServerCounters, saveServerCounters, updateCounter } from './services/serverstatsService.js';
import { logger, startupLog, shutdownLog } from './utils/logger.js';
import { checkBirthdays } from './services/birthdayService.js';
import { checkGiveaways } from './services/giveawayService.js';
import { loadCommands, registerCommands as registerSlashCommands } from './handlers/loaders/commandLoader.js';
import { runSafeTask, handleTaskError, ErrorCodes } from './utils/errorHandler.js';
import pkg from '../package.json' with { type: 'json' };
import { EXPECTED_SCHEMA_VERSION, EXPECTED_SCHEMA_LABEL } from './config/database/schemaVersion.js';

// ==========================================
// الإعدادات الخاصة بسيرفرك يا فهد (ضع الآديهات هنا بدقة)
// ==========================================
const OWNER_ID = "1441891628204822629";           // آي دي حسابك الشخصي
const STATUS_CHANNEL_ID = "1506683255120990360";   // روم معلومات السيرفر فقط (لحالة صاحب السيرفر)
const QURAN_CHANNEL_ID = "1530998394263310589";    // روم القرآن الكريم (إرسال الآيات والأذكار عامة)
const SEARCH_CHANNEL_ID = "1531004584238125227";   // روم اختر صورتك (البحث الفوري الخاص)

// قائمة أبرز 10 أئمة وقراء القرآن الكريم
const RECITERS = [
  { label: 'مشاري راشد العفاسي', value: 'ar.alafasy' },
  { label: 'ماهر المعيقلي', value: 'ar.mahermuaiqly' },
  { label: 'عبد الرحمن السديس', value: 'ar.sudais' },
  { label: 'ياسر الدوسري', value: 'ar.yasserdossari' },
  { label: 'عبد الباسط عبد الصمد', value: 'ar.abdulbasit' },
  { label: 'محمود خليل الحصري', value: 'ar.husary' },
  { label: 'محمد صديق المنشاوي', value: 'ar.minshawi' },
  { label: 'سعد الغامدي', value: 'ar.saadalghamdi' },
  { label: 'أبو بكر الشاطري', value: 'ar.shaatry' },
  { label: 'أحمد بن علي العجمي', value: 'ar.ahmedajamy' }
];

// قائمة الأذكار ليوم الجمعة
const ATHKAR_LIST = [
  "✨ **ذكر يوم الجمعة:** سبحان الله وبحمده، سبحان الله العظيم.",
  "✨ **ذكر يوم الجمعة:** لا إله إلا الله وحد لا شريك له، له الملك وله الحمد وهو على كل شيء قدير.",
  "✨ **ذكر يوم الجمعة:** أستغفر الله العظيم الذي لا إله إلا هو الحي القيوم وأتوب إليه.",
  "✨ **تذكير مبارك:** لَا تَنْسَوْا قِرَاءَةَ سُورَةِ الْكَهْفِ وَالْصَّلَاةُ عَلَى النَّبِيِّ ﷺ.",
  "✨ **ذكر يوم الجمعة:** اللَّهُمَّ صَلِّ وَسَلِّمْ عَلَى نَبِيِّنَا مُحَمَّدٍ.",
  "✨ **ذكر يوم الجمعة:** لا حول ولا قوة إلا بالله العلي العظيم."
];

// دالة الذكاء الاصطناعي الحقيقية للرد على استفسارات الدعم الفني، التيكيت، وحل التمارين
async function getAIResponse(prompt) {
  try {
    const response = await fetch(`https://text.pollinations.ai/${encodeURIComponent(prompt)}?model=openai`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });
    if (!response.ok) return "عذراً، لم أتمكن من معالجة السؤال حالياً.";
    const text = await response.text();
    return text || "عذراً، لم أتلق إجابة واضحة.";
  } catch (error) {
    logger.error('AI API Error:', error);
    return "عذراً، حدث خطأ في الاتصال بخدمة الذكاء الاصطناعي.";
  }
}

class TitanBot extends Client {
  constructor() {
    super({
      intents: [
        GatewayIntentBits.Guilds,                        
        GatewayIntentBits.GuildMembers,               
        GatewayIntentBits.GuildMessages,                      
        GatewayIntentBits.GuildMessageReactions,        
        GatewayIntentBits.MessageContent,                     
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildVoiceStates,                     
        GatewayIntentBits.GuildBans,
        GatewayIntentBits.GuildPresences,
      ],
    });

    this.config = config;
    this.commands = new Collection();
    this.events = new Collection();
    this.buttons = new Collection();
    this.selectMenus = new Collection();
    this.modals = new Collection();
    this.cooldowns = new Collection();
    this.db = null;
    this.rest = new REST({ version: '10' }).setToken(config.bot.token);
  }

  async start() {
    try {
      startupLog('Starting TitanBot...');
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      startupLog('Initializing database...');
      const dbInstance = await initializeDatabase();
      this.db = dbInstance.db;

      startupLog('Starting web server...');
      this.startWebServer();
      
      startupLog('Loading commands...');
      await loadCommands(this);
      startupLog(`Commands loaded: ${this.commands.size}`);
      
      startupLog('Loading handlers...');
      await this.loadHandlers();
      startupLog('Handlers loaded');
      
      startupLog('Logging into Discord...');
      await this.login(this.config.bot.token);
      startupLog('Discord login successful');
      
      startupLog('Registering slash commands globally...');
      await this.registerCommands();
      startupLog('Slash commands registration complete');
      
      startupLog(`ONLINE ✅ | ${this.commands.size} commands loaded`);
      
      this.setupInteractionHandlers();
      this.setupSmartAssistantHandler(); 
      this.setupCronJobs();

      this.once('ready', async () => {
        await this.ensureSearchMessage();
        await this.updateOwnerStatusMessage(); 
      });

    } catch (error) {
      logger.error('Failed to start bot:', error);
      process.exit(1);
    }
  }

  startWebServer() {
    const app = express();
    const configuredPort = Number(this.config.api?.port || process.env.PORT || 3000);
    const host = process.env.WEB_HOST || '0.0.0.0';

    app.get('/health', (req, res) => res.status(200).json({ status: 'healthy', uptime: process.uptime() }));
    app.get('/', (req, res) => res.status(200).json({ message: 'TitanBot System Online', version: pkg.version }));

    app.listen(configuredPort, host, () => {
      startupLog(`✅ Web Server running on ${host}:${configuredPort}`);
    });
  }

  setupCronJobs() {
    cron.schedule('0 * * * *', async () => {
      const now = new Date();
      const dayOfWeek = now.getDay();
      const currentHour = now.getHours();

      if (dayOfWeek === 5) {
        if (currentHour % 2 === 0) {
          await this.sendHourlyDhikr();
        } else {
          await this.sendHourlyQuranVerse();
        }
      } else {
        if (currentHour % 3 === 0) {
          await this.sendHourlyQuranVerse();
        }
      }
    });

    cron.schedule('* * * * *', async () => {
      await this.updateOwnerStatusMessage();
      await this.ensureSearchMessage();
    });

    cron.schedule('0 6 * * *', runSafeTask('birthday_check', () => checkBirthdays(this)));
    cron.schedule('* * * * *', runSafeTask('giveaway_check', () => checkGiveaways(this)));
  }

  setupSmartAssistantHandler() {
    this.on(Events.MessageCreate, async message => {
      if (message.author.bot) return;

      const content = message.content.trim();
      const lowerContent = content.toLowerCase();

      if (
        lowerContent.includes('أقرأ القرآن') ||
        lowerContent.includes('أقرا القرآن') ||
        lowerContent.includes('اريد أقرأ') ||
        lowerContent.includes('روم القرآن') ||
        lowerContent.includes('أدخل القرآن') ||
        lowerContent.includes('وين القرآن')
      ) {
        const embed = new EmbedBuilder()
          .setTitle('📖 ركن القرآن الكريم')
          .setDescription(`> أهلاً بك يا فهد! تفضل بالدخول إلى روم القرآن الكريم المخصص هنا:\n> <#${QURAN_CHANNEL_ID}>\n\nستجد هناك التلاوات اليومية والآيات المباركة باستمرار!`)
          .setColor(0x00FF99);

        return await message.reply({ embeds: [embed] });
      }

      if (
        lowerContent.includes('سورة مخصصة') ||
        lowerContent.includes('أختار سورة') ||
        lowerContent.includes('أريد أختار') ||
        lowerContent.includes('كيف أختار') ||
        lowerContent.includes('ابحث عن سورة') ||
        lowerContent.includes('سورة معينة')
      ) {
        const embed = new EmbedBuilder()
          .setTitle('🔍 اختيار سورة أو آية مخصصة')
          .setDescription(`> تريد اختيار سورة أو آية محددة بنفسك؟\n> توجه فوراً إلى روم البحث الفوري (اختر صورتك):\n> <#${SEARCH_CHANNEL_ID}>\n\nاضغط على الزر هناك وابحث بشكل خاص وخاص بك وحدك!`)
          .setColor(0x00AAFF);

        return await message.reply({ embeds: [embed] });
      }

      if (content.length > 1 && !content.startsWith('!')) {
        const typingMsg = await message.channel.send({ content: '🤖 جاري التفكير في الإجابة...' }).catch(() => null);
        
        const aiAnswer = await getAIResponse(content);

        if (typingMsg) {
          await typingMsg.delete().catch(() => {});
        }

        const replyEmbed = new EmbedBuilder()
          .setTitle('🤖 المساعد الذكي (الدعم الفني والتمارين)')
          .setDescription(aiAnswer.length > 4000 ? aiAnswer.substring(0, 3990) + '...' : aiAnswer)
          .setColor(0x5865F2)
          .setFooter({ text: `رد على: ${message.author.username}` });

        return await message.reply({ embeds: [replyEmbed] });
      }
    });
  }

  async ensureSearchMessage() {
    if (!SEARCH_CHANNEL_ID || SEARCH_CHANNEL_ID.includes("1531004584238125227")) return;
    try {
      const channel = await this.channels.fetch(SEARCH_CHANNEL_ID).catch(() => null);
      if (!channel) return;

      const messages = await channel.messages.fetch({ limit: 10 }).catch(() => null);
      const botMessage = messages?.find(m => m.author.id === this.user.id && m.components.length > 0);

      if (!botMessage) {
        const embed = new EmbedBuilder()
          .setTitle(`🔍 محرك البحث القرآني الفوري الخاص`)
          .setDescription(`> أهلاً بك في روم اختر صورتك (البحث).\n> هل تريد البحث عن سورة أو آية بشكل خاص **دون أن يراها أحد غيرك**؟\n> اضغط على الزر أدناه لبدء البحث الفوري الخاص!`)
          .setColor(0x00AAFF)
          .setFooter({ text: 'البحث يظهر لك وحدك تماماً (Ephemeral) مع مشغل صوتي مباشر داخل ديسكورد 🎧' });

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('open_quran_search_modal')
            .setLabel('📖 ابحث في القرآن الكريم (خاص بك وحدك)')
            .setStyle(ButtonStyle.Success)
        );

        await channel.send({ embeds: [embed], components: [row] });
      }
    } catch (err) {
      logger.error('Error ensuring search message:', err);
    }
  }

  async sendHourlyDhikr() {
    if (!QURAN_CHANNEL_ID || QURAN_CHANNEL_ID.includes("1530998394263310589")) return;
    try {
      const channel = await this.channels.fetch(QURAN_CHANNEL_ID).catch(() => null);
      if (channel) {
        const randomDhikr = ATHKAR_LIST[Math.floor(Math.random() * ATHKAR_LIST.length)];
        const embed = new EmbedBuilder()
          .setTitle(`🌹 نفحات يوم الجمعة المباركة`)
          .setDescription(`> ${randomDhikr}`)
          .setColor(0xF1C40F)
          .setFooter({ text: 'كثروا من الصلاة على النبي ﷺ يوم الجمعة' });

        await channel.send({ embeds: [embed] });
      }
    } catch (err) {
      logger.error('Error sending dhikr:', err);
    }
  }

  async sendHourlyQuranVerse() {
    if (!QURAN_CHANNEL_ID || QURAN_CHANNEL_ID.includes("1530998394263310589")) return;
    
    try {
      const response = await fetch('https://api.alquran.cloud/v1/ayah/random/ar.alafasy');
      const data = await response.json();

      if (data && data.code === 200) {
        const ayah = data.data;
        const channel = await this.channels.fetch(QURAN_CHANNEL_ID).catch(() => null);
        
        if (channel) {
          const embed = new EmbedBuilder()
            .setTitle(`📖 آية من الذكر الحكيم`)
            .setDescription(`> ${ayah.text}\n\n**السورة:** ${ayah.surah.name} (${ayah.surah.englishName})\n**رقم الآية:** ${ayah.numberInSurah}\n**الجزء:** ${ayah.juz}`)
            .setColor(0x00FF99)
            .setFooter({ text: 'اختر القارئ المفضل من القائمة للاستماع للتلاوة مباشرة 🎧' });

          const row = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId(`quran_reciter:${ayah.number}`)
              .setPlaceholder('🎙️ اختر القارئ لسماع التلاوة بصوته...')
              .addOptions(
                RECITERS.map(reciter => ({
                  label: reciter.label,
                  value: reciter.value
                }))
              )
          );

          await channel.send({ embeds: [embed], components: [row] });

          if (ayah.audio) {
            try {
              const audioRes = await fetch(ayah.audio);
              const audioBuffer = Buffer.from(await audioRes.arrayBuffer());
              const attachment = new AttachmentBuilder(audioBuffer, { name: 'quran_recitation.mp3' });
              await channel.send({ content: `🎧 **التسجيل الصوتي (مشاري العفاسي افتراضياً):**`, files: [attachment] });
            } catch (err) {
              logger.error('Error downloading hourly audio:', err);
            }
          }
        }
      }
    } catch (error) {
      logger.error('Error fetching hourly Quran verse:', error);
    }
  }

  setupInteractionHandlers() {
    this.on(Events.InteractionCreate, async interaction => {
      if (interaction.isButton() && interaction.customId === 'open_quran_search_modal') {
        const modal = new ModalBuilder()
          .setCustomId('quran_search_submit_modal')
          .setTitle('📖 البحث الفوري الخاص في القرآن');

        const surahInput = new TextInputBuilder()
          .setCustomId('surah_input')
          .setLabel('اسم السورة أو رقمها (مثال: البقرة أو 2)')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        const ayahInput = new TextInputBuilder()
          .setCustomId('ayah_input')
          .setLabel('رقم الآية البدئية (مثال: 59)')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        const modeInput = new TextInputBuilder()
          .setCustomId('mode_input')
          .setLabel('اكتب (1) لآية واحدة | (2) إلى نهاية السورة')
          .setStyle(TextInputStyle.Short)
          .setValue('1')
          .setRequired(true);

        modal.addComponents(
          new ActionRowBuilder().addComponents(surahInput),
          new ActionRowBuilder().addComponents(ayahInput),
          new ActionRowBuilder().addComponents(modeInput)
        );

        return await interaction.showModal(modal);
      }

      if (interaction.isModalSubmit() && interaction.customId === 'quran_search_submit_modal') {
        const surahQuery = interaction.fields.getTextInputValue('surah_input').trim();
        const ayahNumber = parseInt(interaction.fields.getTextInputValue('ayah_input').trim(), 10);
        const mode = interaction.fields.getTextInputValue('mode_input').trim();

        await interaction.deferReply({ ephemeral: true });

        try {
          const surahsRes = await fetch('https://api.alquran.cloud/v1/surah');
          const surahsJson = await surahsRes.json();
          
          let targetSurah = null;
          if (!isNaN(surahQuery)) {
            targetSurah = surahsJson.data.find(s => s.number === parseInt(surahQuery, 10));
          } else {
            targetSurah = surahsJson.data.find(s => s.name.includes(surahQuery) || s.englishName.toLowerCase().includes(surahQuery.toLowerCase()));
          }

          if (!targetSurah) {
            return await interaction.editReply({ content: `❌ عذراً، لم أتمكن من العثور على السورة: **${surahQuery}**.` });
          }

          const fullSurahRes = await fetch(`https://api.alquran.cloud/v1/surah/${targetSurah.number}/ar.alafasy`);
          const fullSurahJson = await fullSurahRes.json();

          if (fullSurahJson.code !== 200) {
            return await interaction.editReply({ content: '❌ حدث خطأ أثناء جلب الآيات من السيرفر.' });
          }

          const ayahsList = fullSurahJson.data.ayahs;
          const startIndex = ayahsList.findIndex(a => a.numberInSurah === ayahNumber);

          if (startIndex === -1) {
            return await interaction.editReply({ content: `❌ رقم الآية **${ayahNumber}** غير موجود في سورة **${targetSurah.name}**.` });
          }

          let resultText = "";
          let audioUrl = "";

          if (mode === '2') {
            const selectedAyahs = ayahsList.slice(startIndex);
            resultText = selectedAyahs.map(a => `**[${a.numberInSurah}]** ${a.text}`).join('\n\n');
            if (resultText.length > 3500) resultText = resultText.substring(0, 3500) + '...';
            audioUrl = ayahsList[startIndex].audio;
          } else {
            const singleAyah = ayahsList[startIndex];
            resultText = `**[${singleAyah.numberInSurah}]** ${singleAyah.text}`;
            audioUrl = singleAyah.audio;
          }

          const embed = new EmbedBuilder()
            .setTitle(`📖 نتائج بحثك الخاص: سورة ${targetSurah.name}`)
            .setDescription(`> ${resultText}`)
            .setColor(0x00FF99)
            .setFooter({ text: `هذه النتيجة تظهر لك وحدك تماماً ولن يراها غيرك.` });

          const row = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId(`custom_search_reciter:${targetSurah.number}:${ayahNumber}:${mode}`)
              .setPlaceholder('🎙️ غير القارئ لسماع التلاوة بصوت آخر...')
              .addOptions(
                RECITERS.map(reciter => ({
                  label: reciter.label,
                  value: reciter.value
                }))
              )
          );

          await interaction.editReply({ embeds: [embed], components: [row] });

          if (audioUrl) {
            const audioRes = await fetch(audioUrl);
            const audioBuffer = Buffer.from(await audioRes.arrayBuffer());
            const attachment = new AttachmentBuilder(audioBuffer, { name: 'quran_recitation.mp3' });
            await interaction.followUp({ content: `🎧 **التسجيل الصوتي المباشر:**`, files: [attachment], ephemeral: true });
          }

        } catch (err) {
          logger.error('Quran Search Error:', err);
          await interaction.editReply({ content: '❌ حدث خطأ أثناء تنفيذ عملية البحث.' });
        }
      }

      if (interaction.isStringSelectMenu() && interaction.customId.startsWith('custom_search_reciter:')) {
        const [, surahNum, ayahNum, mode] = interaction.customId.split(':');
        const selectedEdition = interaction.values[0];
        const selectedReciterObj = RECITERS.find(r => r.value === selectedEdition);

        await interaction.deferReply({ ephemeral: true });

        try {
          const res = await fetch(`https://api.alquran.cloud/v1/surah/${surahNum}/${selectedEdition}`);
          const json = await res.json();

          if (json.code === 200) {
            const ayahsList = json.data.ayahs;
            const startIndex = ayahsList.findIndex(a => a.numberInSurah === parseInt(ayahNum, 10));
            
            let resultText = "";
            let audioUrl = "";

            if (mode === '2') {
              const selectedAyahs = ayahsList.slice(startIndex);
              resultText = selectedAyahs.map(a => `**[${a.numberInSurah}]** ${a.text}`).join('\n\n');
              if (resultText.length > 3500) resultText = resultText.substring(0, 3500) + '...';
              audioUrl = ayahsList[startIndex].audio;
            } else {
              resultText = `**[${ayahsList[startIndex].numberInSurah}]** ${ayahsList[startIndex].text}`;
              audioUrl = ayahsList[startIndex].audio;
            }

            await interaction.editReply({
              content: `🎙️ **القارئ المختار:** ${selectedReciterObj?.label}\n\n> ${resultText}`
            });

            if (audioUrl) {
              const audioRes = await fetch(audioUrl);
              const audioBuffer = Buffer.from(await audioRes.arrayBuffer());
              const attachment = new AttachmentBuilder(audioBuffer, { name: 'quran_recitation.mp3' });
              await interaction.followUp({ content: `🎧 **التسجيل الصوتي للمقارئ ${selectedReciterObj?.label}:**`, files: [attachment], ephemeral: true });
            }
          } else {
            await interaction.editReply({ content: '❌ لم نتمكن من جلب التلاوة بهذا الصوت.' });
          }
        } catch (err) {
          await interaction.editReply({ content: '❌ حدث خطأ أثناء تغيير القارئ.' });
        }
      }

      if (interaction.isStringSelectMenu() && interaction.customId.startsWith('quran_reciter:')) {
        const [, ayahNumber] = interaction.customId.split(':');
        const selectedEdition = interaction.values[0];
        const selectedReciterObj = RECITERS.find(r => r.value === selectedEdition);

        await interaction.deferReply({ ephemeral: true });

        try {
          const response = await fetch(`https://api.alquran.cloud/v1/ayah/${ayahNumber}/${selectedEdition}`);
          const json = await response.json();

          if (json.code === 200) {
            const data = json.data;
            await interaction.editReply({
              content: `🎙️ **القارئ المختار:** ${selectedReciterObj?.label || 'القارئ'}\n📖 **الآية:** ${data.text} (${data.surah.name} - الآية ${data.numberInSurah})`
            });

            if (data.audio) {
              const audioRes = await fetch(data.audio);
              const audioBuffer = Buffer.from(await audioRes.arrayBuffer());
              const attachment = new AttachmentBuilder(audioBuffer, { name: 'quran_recitation.mp3' });
              await interaction.followUp({ content: `🎧 **التسجيل الصوتي المباشر:**`, files: [attachment], ephemeral: true });
            }
          } else {
            await interaction.editReply({ content: '❌ عذراً، لم نتمكن من جلب التلاوة بهذا الصوت حالياً.' });
          }
        } catch (err) {
          await interaction.editReply({ content: '❌ حدث خطأ أثناء جلب تلاوة القارئ.' });
        }
      }
    });
  }

  async updateOwnerStatusMessage() {
    if (!STATUS_CHANNEL_ID || STATUS_CHANNEL_ID.includes("1506683255120990360")) return;

    for (const [guildId, guild] of this.guilds.cache) {
      try {
        const ownerMember = await guild.members.fetch(OWNER_ID).catch(() => null);
        if (!ownerMember) continue;

        const status = ownerMember.presence?.status || 'offline';
        let statusText = "";
        let color = 0x747F8D;

        if (status === 'online') {
          statusText = `🟢 صاحب السيرفر **فهد الشمري** (<@${OWNER_ID}>) حالياً **أونلاين** وجاهز للرد!`;
          color = 0x57F287;
        } else if (status === 'dnd') {
          statusText = `🔴 صاحب السيرفر **فهد الشمري** (<@${OWNER_ID}>) في وضع **عدم الإزعاج (DND)** حالياً.`;
          color = 0xED4245;
        } else if (status === 'idle') {
          statusText = `🟡 صاحب السيرفر **فهد الشمري** (<@${OWNER_ID}>) في وضع **الخمول (AFK)**.`;
          color = 0xFEE75C;
        } else {
          statusText = `🌙 صاحب السيرفر **فهد الشمري** (<@${OWNER_ID}>) حالياً **أوفلاين** (غير متصل).`;
          color = 0x747F8D;
        }

        const channel = guild.channels.cache.get(STATUS_CHANNEL_ID);
        if (channel) {
          const messages = await channel.messages.fetch({ limit: 5 }).catch(() => null);
          const botMessage = messages?.find(m => m.author.id === this.user.id);

          const embed = new EmbedBuilder()
            .setTitle('📊 حالة صاحب السيرفر المباشرة')
            .setDescription(statusText)
            .setColor(color)
            .setTimestamp();

          if (botMessage) {
            await botMessage.edit({ embeds: [embed] }).catch(() => {});
          } else {
            await channel.send({ embeds: [embed] });
          }
        }
      } catch (err) {
        logger.error(`Error updating owner status for guild ${guildId}:`, err);
      }
    }
  }

  async loadHandlers() {
    const handlers = [{ path: 'events', required: true }, { path: 'interactions', required: true }];
    for (const h of handlers) {
      try {
        const module = await import(`./handlers/loaders/${h.path}.js`);
        if (typeof module.default === 'function') await module.default(this);
      } catch (e) {
        if (h.required) throw e;
      }
    }
  }

  async registerCommands() {
    try {
      await registerSlashCommands(this, { clientId: this.config.bot.clientId });
    } catch (error) {
      logger.error('Error registering commands:', error);
    }
  }

  async shutdown(reason = 'UNKNOWN') {
    shutdownLog(`Bot is shutting down (${reason})...`);
    try {
      cron.getTasks().forEach(task => task.stop());
      if (this.isReady()) this.destroy();
      process.exit(0);
    } catch (error) {
      process.exit(1);
    }
  }
}

const bot = new TitanBot();
bot.start().catch(() => process.exit(1));
export default TitanBot;
