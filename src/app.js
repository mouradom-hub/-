import 'dotenv/config';
import { Client, Collection, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder, Events } from 'discord.js';
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
// الإعدادات الخاصة بك يا فهد (تم ضبط الآديهات بدقة)
// ==========================================
const OWNER_ID = "1441891628204822629"; // آي دي حسابك
const STATUS_CHANNEL_ID = "1506683255120990360"; // روم حالة السيرفر
const QURAN_CHANNEL_ID = "1530998394263310589"; // روم إرسال الآيات التلقائية
const SEARCH_CHANNEL_ID = "1531004584238125227"; // روم البحث الدائم (اختر صورتك)

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
      this.setupQuranAssistantHandler(); // نظام الرد الذكي في جميع الرومات
      this.setupCronJobs();

      this.once('ready', async () => {
        await this.ensureSearchMessage();
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

  // نظام الرد التلقائي الذكي في جميع الرومات (بناءً على طلب فهد)
  setupQuranAssistantHandler() {
    this.on(Events.MessageCreate, async message => {
      if (message.author.bot) return;

      const content = message.content.toLowerCase();

      // 1. إذا طلب قراءة القرآن أو الدخول لروم القرآن
      if (
        content.includes('أقرأ القرآن') ||
        content.includes('أقرا القرآن') ||
        content.includes('اريد أقرأ') ||
        content.includes('روم القرآن') ||
        content.includes('أدخل القرآن') ||
        content.includes('وين القرآن')
      ) {
        const embed = new EmbedBuilder()
          .setTitle('📖 ركن القرآن الكريم')
          .setDescription(`> أهلاً بك يا أخي! تفضل بالدخول إلى روم القرآن الكريم المخصص هنا:\n> <#${QURAN_CHANNEL_ID}>\n\nستجد هناك التلاوات اليومية والآيات المباركة باستمرار!`)
          .setColor(0x00FF99);

        return await message.reply({ embeds: [embed] });
      }

      // 2. إذا أراد اختيار سورة مخصصة أو البحث عن آية/سورة معينة
      if (
        content.includes('سورة مخصصة') ||
        content.includes('أختار سورة') ||
        content.includes('أريد أختار') ||
        content.includes('كيف أختار') ||
        content.includes('ابحث عن سورة') ||
        content.includes('سورة معينة')
      ) {
        const embed = new EmbedBuilder()
          .setTitle('🔍 اختيار سورة أو آية مخصصة')
          .setDescription(`> تريد اختيار سورة أو آية محددة بنفسك؟\n> توجه فوراً إلى روم البحث الفوري:\n> <#${SEARCH_CHANNEL_ID}>\n\nاضغط على الزر الموجود هناك (**ابحث في القرآن الكريم**) واكتب اسم السورة ورقم الآية لتبحث عنها فوراً!`)
          .setColor(0x00AAFF);

        return await message.reply({ embeds: [embed] });
      }
    });
  }

  async ensureSearchMessage() {
    if (!SEARCH_CHANNEL_ID || SEARCH_CHANNEL_ID.includes("ضع_آي_دي")) return;
    try {
      const channel = await this.channels.fetch(SEARCH_CHANNEL_ID).catch(() => null);
      if (!channel) return;

      const messages = await channel.messages.fetch({ limit: 10 }).catch(() => null);
      const botMessage = messages?.find(m => m.author.id === this.user.id && m.components.length > 0);

      if (!botMessage) {
        const embed = new EmbedBuilder()
          .setTitle(`🔍 محرك البحث القرآني الفوري`)
          .setDescription(`> أهلاً بك في **روم اختر صورتك**.\n> هل أنت مستعجل ولا تريد انتظار الآيات التلقائية؟\n> اضغط على الزر أدناه لبدء البحث عن أي سورة ورقم آية تريدها فوراً!`)
          .setColor(0x00AAFF)
          .setFooter({ text: 'اختر السورة ورقم الآية واستمع للتلاوة بصوت القارئ المفضل لديك 🎧' });

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('open_quran_search_modal')
            .setLabel('📖 ابحث في القرآن الكريم')
            .setStyle(ButtonStyle.Success)
        );

        await channel.send({ embeds: [embed], components: [row] });
      }
    } catch (err) {
      logger.error('Error ensuring search message:', err);
    }
  }

  async sendHourlyDhikr() {
    if (!QURAN_CHANNEL_ID || QURAN_CHANNEL_ID.includes("ضع_آي_دي")) return;
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
    if (!QURAN_CHANNEL_ID || QURAN_CHANNEL_ID.includes("ضع_آي_دي")) return;
    
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
            .setFooter({ text: 'اختر القارئ المفضل من القائمة أدناه للاستماع للتلاوة بصوته 🎧' });

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
            await channel.send({ content: `🎧 **الاستماع للتلاوة (مشاري العفاسي افتراضياً):**\n${ayah.audio}` });
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
          .setTitle('📖 البحث الفوري في القرآن الكريم');

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

        await interaction.deferReply({ ephemeral: false });

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
          let audioLinksText = "";

          if (mode === '2') {
            const selectedAyahs = ayahsList.slice(startIndex);
            resultText = selectedAyahs.map(a => `**[${a.numberInSurah}]** ${a.text}`).join('\n\n');
            if (resultText.length > 3900) resultText = resultText.substring(0, 3900) + '...';
            audioLinksText = `🎧 **رابط التلاوة للآية المحددة:**\n${ayahsList[startIndex].audio}`;
          } else {
            const singleAyah = ayahsList[startIndex];
            resultText = `**[${singleAyah.numberInSurah}]** ${singleAyah.text}`;
            audioLinksText = `🎧 **التسجيل الصوتي:**\n${singleAyah.audio}`;
          }

          const embed = new EmbedBuilder()
            .setTitle(`📖 نتائج البحث: سورة ${targetSurah.name} (${targetSurah.englishName})`)
            .setDescription(`> ${resultText}`)
            .setColor(0x00FF99)
            .setFooter({ text: `السورة رقم ${targetSurah.number} • عدد آياتها ${targetSurah.numberOfAyahs}` });

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
          await interaction.followUp({ content: audioLinksText, ephemeral: false });

        } catch (err) {
          logger.error('Quran Search Error:', err);
          await interaction.editReply({ content: '❌ حدث خطأ أثناء تنفيذ عملية البحث.' });
        }
      }

      if (interaction.isStringSelectMenu() && interaction.customId.startsWith('custom_search_reciter:')) {
        const [, surahNum, ayahNum, mode] = interaction.customId.split(':');
        const selectedEdition = interaction.values[0];
        const selectedReciterObj = RECITERS.find(r => r.value === selectedEdition);

        await interaction.deferReply({ ephemeral: false });

        try {
          const res = await fetch(`https://api.alquran.cloud/v1/surah/${surahNum}/${selectedEdition}`);
          const json = await res.json();

          if (json.code === 200) {
            const ayahsList = json.data.ayahs;
            const startIndex = ayahsList.findIndex(a => a.numberInSurah === parseInt(ayahNum, 10));
            
            let resultText = "";
            let audioLink = "";

            if (mode === '2') {
              const selectedAyahs = ayahsList.slice(startIndex);
              resultText = selectedAyahs.map(a => `**[${a.numberInSurah}]** ${a.text}`).join('\n\n');
              if (resultText.length > 3900) resultText = resultText.substring(0, 3900) + '...';
              audioLink = ayahsList[startIndex].audio;
            } else {
              resultText = `**[${ayahsList[startIndex].numberInSurah}]** ${ayahsList[startIndex].text}`;
              audioLink = ayahsList[startIndex].audio;
            }

            await interaction.editReply({
              content: `🎙️ **القارئ المختار:** ${selectedReciterObj?.label}\n\n> ${resultText}\n\n🎧 **التسجيل الصوتي:**\n${audioLink}`
            });
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

        await interaction.deferReply({ ephemeral: false });

        try {
          const response = await fetch(`https://api.alquran.cloud/v1/ayah/${ayahNumber}/${selectedEdition}`);
          const json = await response.json();

          if (json.code === 200) {
            const data = json.data;
            await interaction.editReply({
              content: `🎙️ **القارئ المختار:** ${selectedReciterObj?.label || 'القارئ'}\n📖 **الآية:** ${data.text} (${data.surah.name} - الآية ${data.numberInSurah})\n🎧 **التسجيل الصوتي:**\n${data.audio}`
            });
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
    if (!STATUS_CHANNEL_ID || STATUS_CHANNEL_ID.includes("ضع_آي_دي")) return;

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
