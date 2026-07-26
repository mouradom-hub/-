import 'dotenv/config';
import { Client, Collection, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, Events } from 'discord.js';
import { REST } from '@discordjs/rest';
import express from 'express';
import cron from 'node-cron';
import fetch from 'node-fetch';

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
// الإعدادات الخاصة بك يا فهد (ضع الآديهات هنا فقط وانسى الباقي)
// ==========================================
const OWNER_ID = "1441891628204822629"; // آي دي حسابك
const STATUS_CHANNEL_ID = "ضع_آي_دي_روم_معلومات_السيرفر_هنا"; // استبدله بـ ID روم السيرفر
const QURAN_CHANNEL_ID = "ضع_آي_دي_روم_القرآن_الكريم_هنا"; // استبدله بـ ID روم القرآن

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
        GatewayIntentBits.GuildPresences, // لتتبع حالة الأونلاين والأوفلاين بدقة
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
      
      // تفعيل التفاعل مع قائمة الأئمة
      this.setupInteractionHandlers();
      
      // تشغيل المهام التلقائية
      this.setupCronJobs();
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
    // 1. نظام القرآن والأذكار الذكي
    // في الأيام العادية: كل 3 ساعات آية قرآنية
    // يوم الجمعة: كل ساعة تبديل (ساعة ذكر، ساعة آية)
    cron.schedule('0 * * * *', async () => {
      const now = new Date();
      const dayOfWeek = now.getDay(); // 5 يعني الجمعة
      const currentHour = now.getHours();

      if (dayOfWeek === 5) {
        // يوم الجمعة: تبديل بالساعة (زوجي = ذكر، فردي = آية)
        if (currentHour % 2 === 0) {
          await this.sendHourlyDhikr();
        } else {
          await this.sendHourlyQuranVerse();
        }
      } else {
        // الأيام العادية: كل 3 ساعات آية
        if (currentHour % 3 === 0) {
          await this.sendHourlyQuranVerse();
        }
      }
    });

    // 2. نظام مراقبة حالة صاحب السيرفر (يعمل كل دقيقة)
    cron.schedule('* * * * *', async () => {
      await this.updateOwnerStatusMessage();
    });

    cron.schedule('0 6 * * *', runSafeTask('birthday_check', () => checkBirthdays(this)));
    cron.schedule('* * * * *', runSafeTask('giveaway_check', () => checkGiveaways(this)));
  }

  // إرسال ذكر يوم الجمعة
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

  // إرسال آية قرآنية مع قائمة الأئمة التفاعلية
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
            .setFooter({ text: 'اختر القارئ المفضلك من القائمة أدناه للاستماع للتلاوة بصوته 🎧' });

          // إنشاء القائمة المنسدلة (Select Menu) للأئمة العشرة
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

  // معالجة اختيار العضو للقارئ من القائمة المنسدلة
  setupInteractionHandlers() {
    this.on(Events.InteractionCreate, async interaction => {
      if (!interaction.isStringSelectMenu()) return;
      
      if (interaction.customId.startsWith('quran_reciter:')) {
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

  // تحديث حالة صاحب السيرفر تلقائياً
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
