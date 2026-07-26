import 'dotenv/config';
import { Client, Collection, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder, Events, AttachmentBuilder } from 'discord.js';
import { REST } from '@discordjs/rest';
import express from 'express';
import cron from 'node-cron';

import config from './config/application.js';
import { initializeDatabase } from './utils/database.js';
import { logger, startupLog, shutdownLog } from './utils/logger.js';
import { checkBirthdays } from './services/birthdayService.js';
import { checkGiveaways } from './services/giveawayService.js';
import { loadCommands, registerCommands as registerSlashCommands } from './handlers/loaders/commandLoader.js';
import { runSafeTask } from './utils/errorHandler.js';
import pkg from '../package.json' with { type: 'json' };

// ==========================================
// الإعدادات والآديهات الخاصة بسيرفرك يا فهد (صحيحة ومثبتة 100%)
// ==========================================
const OWNER_ID = "1441891628204822629";           // آي دي حسابك الشخصي
const STATUS_CHANNEL_ID = "1506683255120990360";   // روم معلومات السيرفر فقط (لحالة صاحب السيرفر)
const QURAN_CHANNEL_ID = "1530998394263310589";    // روم القرآن الكريم والأذان العام
const SEARCH_CHANNEL_ID = "1531004584238125227";   // روم اختر صورتك (البحث الفوري الخاص)

// قائمة أبرز قراء القرآن الكريم
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

// دالة الذكاء الاصطناعي للرد على الشات والأسئلة بدقة
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
    this.currentAyahIndex = 1; 
    this.userWilayas = new Map(); // تخزين ولايات المستخدمين (userId -> wilayaName)
    this.sentAdhanCache = new Set(); // لمنع تكرار إرسال نفس أذان الولاية في نفس اليوم
  }

  async start() {
    try {
      startupLog('Starting TitanBot...');
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const dbInstance = await initializeDatabase();
      this.db = dbInstance.db;

      this.startWebServer();
      await loadCommands(this);
      await this.login(this.config.bot.token);
      await this.registerCommands();
      
      this.setupInteractionHandlers();
      this.setupSmartAssistantHandler(); 
      this.setupCronJobs();

      this.once('ready', async () => {
        await this.ensureSearchMessage();
        await this.ensureQuranSetupMessage();
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
    app.get('/health', (req, res) => res.status(200).json({ status: 'healthy', uptime: process.uptime() }));
    app.get('/', (req, res) => res.status(200).json({ message: 'TitanBot System Online', version: pkg.version }));
    app.listen(configuredPort, '0.0.0.0');
  }

  setupCronJobs() {
    // كل 3 ساعات إرسال آيات بالترتيب في روم القرآن الكريم
    cron.schedule('0 */3 * * *', async () => {
      await this.sendSequentialQuranVerse();
    });

    // فحص دوري كل دقيقة لتحديث حالة السيرفر والتحقق من أوقات الأذان لكل ولاية مسجلة
    cron.schedule('* * * * *', async () => {
      await this.updateOwnerStatusMessage();
      await this.ensureSearchMessage();
      await this.ensureQuranSetupMessage();
      await this.checkAndSendAzan();
    });

    cron.schedule('0 6 * * *', runSafeTask('birthday_check', () => checkBirthdays(this)));
    cron.schedule('* * * * *', runSafeTask('giveaway_check', () => checkGiveaways(this)));
  }

  // نظام التحقق الديناميكي للأذان حسب الولايات المسجلة للأعضاء
  async checkAndSendAzan() {
    if (!QURAN_CHANNEL_ID) return;
    
    const registeredWilayas = [...new Set(this.userWilayas.values())];
    if (registeredWilayas.length === 0) return;

    const now = new Date();
    const currentTime = now.toLocaleTimeString('en-US', { timeZone: 'Africa/Algiers', hour: '2-digit', minute: '2-digit', hour12: false });
    const currentDateKey = now.toLocaleDateString('en-CA', { timeZone: 'Africa/Algiers' });

    for (const wilaya of registeredWilayas) {
      try {
        const res = await fetch(`https://api.aladhan.com/v1/timingsByCity?city=${encodeURIComponent(wilaya)}&country=Algeria&method=3`);
        const data = await res.json();
        
        if (data && data.code === 200) {
          const timings = data.data.timings;
          const prayers = {
            'الفجر': timings.Fajr?.split(' ')[0],
            'الظهر': timings.Dhuhr?.split(' ')[0],
            'العصر': timings.Asr?.split(' ')[0],
            'المغرب': timings.Maghrib?.split(' ')[0],
            'العشاء': timings.Isha?.split(' ')[0]
          };

          for (const [prayerName, prayerTime] of Object.entries(prayers)) {
            if (!prayerTime) continue;

            if (currentTime === prayerTime) {
              const cacheKey = `${currentDateKey}_${wilaya}_${prayerName}`;
              if (this.sentAdhanCache.has(cacheKey)) continue;
              this.sentAdhanCache.add(cacheKey);

              const usersInWilaya = [];
              for (const [userId, uWilaya] of this.userWilayas.entries()) {
                if (uWilaya.toLowerCase() === wilaya.toLowerCase()) {
                  usersInWilaya.push(`<@${userId}>`);
                }
              }

              const channel = await this.channels.fetch(QURAN_CHANNEL_ID).catch(() => null);
              if (channel) {
                let mentionText = usersInWilaya.length > 0 ? usersInWilaya.join(' ') : '*(لا توجد أعضاء مسجلين بهذه الولاية حالياً)*';

                const embed = new EmbedBuilder()
                  .setTitle(`📢 أذان ${prayerName} في ولاية ${wilaya}`)
                  .setDescription(`> حيّ على الصلاة، حيّ على الفلاح!\n> أذن الآن أذان **${prayerName}** حسب توقيت ولاية **${wilaya}**.\n\n> *«إِنَّ الصَّلَاةَ كَانَتْ عَلَى الْمُؤْمِنِينَ كِتَابًا مَّوْقُوتًا»*\n\n**المعنيون بالمنشن:**\n${mentionText}`)
                  .setColor(0xF1C40F)
                  .setTimestamp();

                const sentMsg = await channel.send({ embeds: [embed] }).catch(() => null);

                if (sentMsg) {
                  setTimeout(async () => {
                    await sentMsg.delete().catch(() => {});
                  }, 30 * 60 * 1000);
                }
              }
            }
          }
        }
      } catch (err) {}
    }
  }

  setupSmartAssistantHandler() {
    this.on(Events.MessageCreate, async message => {
      if (message.author.bot) return;
      if (message.channel.id === STATUS_CHANNEL_ID) return;

      const content = message.content.trim();
      const lowerContent = content.toLowerCase();

      if (lowerContent.includes('أقرأ القرآن') || lowerContent.includes('روم القرآن')) {
        const embed = new EmbedBuilder()
          .setTitle('📖 ركن القرآن الكريم')
          .setDescription(`> أهلاً بك يا فهد! تفضل بالدخول إلى روم القرآن الكريم المخصص هنا:\n> <#${QURAN_CHANNEL_ID}>`)
          .setColor(0x00FF99);
        return await message.reply({ embeds: [embed] });
      }

      if (content.length > 1 && !content.startsWith('!')) {
        const typingMsg = await message.channel.send({ content: '🤖 جاري التفكير في الإجابة...' }).catch(() => null);
        const aiAnswer = await getAIResponse(content);

        if (typingMsg) await typingMsg.delete().catch(() => {});

        const replyEmbed = new EmbedBuilder()
          .setTitle('🤖 المساعد الذكي')
          .setDescription(aiAnswer.length > 4000 ? aiAnswer.substring(0, 3990) + '...' : aiAnswer)
          .setColor(0x5865F2)
          .setFooter({ text: `رد على: ${message.author.username}` });

        return await message.reply({ embeds: [replyEmbed] });
      }
    });
  }

  async ensureQuranSetupMessage() {
    if (!QURAN_CHANNEL_ID) return;
    try {
      const channel = await this.channels.fetch(QURAN_CHANNEL_ID).catch(() => null);
      if (!channel) return;

      const messages = await channel.messages.fetch({ limit: 10 }).catch(() => null);
      const setupMsg = messages?.find(m => m.author.id === this.user.id && m.components.some(c => c.components.some(comp => comp.customId === 'select_wilaya_btn')));

      if (!setupMsg) {
        const embed = new EmbedBuilder()
          .setTitle('🇩🇿 تحديد ولايتك الجزائرية لتنبيهات الأذان والقرآن')
          .setDescription(`> أهلاً بك في ركن القرآن الكريم والأذان.\n> يرجى اختيار ولايتك لتتلقى تنبيهات الأذان الخاصة بولايتك وحدك في وقتها الحقيقي بدقة مع منشن مخصص!`)
          .setColor(0xF1C40F);

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('select_wilaya_btn')
            .setLabel('📍 حدد ولايتك الآن')
            .setStyle(ButtonStyle.Primary)
        );

        await channel.send({ embeds: [embed], components: [row] });
      }
    } catch (err) {
      logger.error('Error ensuring quran setup message:', err);
    }
  }

  async ensureSearchMessage() {
    if (!SEARCH_CHANNEL_ID) return;
    try {
      const channel = await this.channels.fetch(SEARCH_CHANNEL_ID).catch(() => null);
      if (!channel) return;

      const messages = await channel.messages.fetch({ limit: 10 }).catch(() => null);
      const botMessage = messages?.find(m => m.author.id === this.user.id && m.components.length > 0);

      if (!botMessage) {
        const embed = new EmbedBuilder()
          .setTitle(`🔍 محرك البحث القرآني الفوري الخاص`)
          .setDescription(`> هل تريد البحث عن سورة أو آية بشكل خاص **دون أن يراها أحد غيرك**؟\n> اضغط على الزر أدناه لبدء البحث الفوري الخاص!`)
          .setColor(0x00AAFF);

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

  async sendSequentialQuranVerse() {
    if (!QURAN_CHANNEL_ID) return;
    try {
      const response = await fetch(`https://api.alquran.cloud/v1/ayah/${this.currentAyahIndex}/ar.alafasy`);
      const data = await response.json();

      if (data && data.code === 200) {
        const ayah = data.data;
        const channel = await this.channels.fetch(QURAN_CHANNEL_ID).catch(() => null);
        
        if (channel) {
          const embed = new EmbedBuilder()
            .setTitle(`📖 تلاوة متتابعة من القرآن الكريم`)
            .setDescription(`> ${ayah.text}\n\n**السورة:** ${ayah.surah.name}\n**رقم الآية:** ${ayah.numberInSurah}\n**الجزء:** ${ayah.juz}`)
            .setColor(0x00FF99);

          const row = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId(`quran_reciter:${ayah.surah.number}:${ayah.numberInSurah}`)
              .setPlaceholder('🎙️ اختر القارئ لسماع التلاوة بصوته...')
              .addOptions(RECITERS.map(r => ({ label: r.label, value: r.value })))
          );

          await channel.send({ embeds: [embed], components: [row] });

          if (ayah.audio) {
            try {
              const audioRes = await fetch(ayah.audio);
              if (audioRes.ok) {
                const audioBuffer = Buffer.from(await audioRes.arrayBuffer());
                const attachment = new AttachmentBuilder(audioBuffer, { name: 'quran_recitation.mp3' });
                await channel.send({ content: `🎧 **التسجيل الصوتي (مشاري العفاسي):**`, files: [attachment] });
              }
            } catch (e) {}
          }
        }

        this.currentAyahIndex++;
        if (this.currentAyahIndex > 6236) this.currentAyahIndex = 1;
      }
    } catch (error) {
      logger.error('Error sending sequential Quran verse:', error);
    }
  }

  setupInteractionHandlers() {
    this.on(Events.InteractionCreate, async interaction => {
      if (interaction.isButton() && interaction.customId === 'select_wilaya_btn') {
        const modal = new ModalBuilder()
          .setCustomId('wilaya_submit_modal')
          .setTitle('📍 تحديد ولايتك في الجزائر');

        const wilayaInput = new TextInputBuilder()
          .setCustomId('wilaya_input')
          .setLabel('اكتب اسم ولايتك أو رقمها (مثال: 16 أو تمنراست)')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(wilayaInput));
        return await interaction.showModal(modal);
      }

      if (interaction.isModalSubmit() && interaction.customId === 'wilaya_submit_modal') {
        const wilaya = interaction.fields.getTextInputValue('wilaya_input').trim();
        this.userWilayas.set(interaction.user.id, wilaya);

        return await interaction.reply({ 
          content: `✅ تم بنجاح تسجيل ولايتك (**${wilaya}**)! سيتم منشنك عند دخول وقت الأذان الخاص بمنطقتك تلقائياً.`, 
          ephemeral: true 
        });
      }

      if (interaction.isButton() && interaction.customId === 'open_quran_search_modal') {
        const modal = new ModalBuilder()
          .setCustomId('quran_search_submit_modal')
          .setTitle('📖 البحث الفوري الخاص في القرآن');

        const surahInput = new TextInputBuilder().setCustomId('surah_input').setLabel('اسم السورة أو رقمها').setStyle(TextInputStyle.Short).setRequired(true);
        const ayahInput = new TextInputBuilder().setCustomId('ayah_input').setLabel('رقم الآية').setStyle(TextInputStyle.Short).setRequired(true);
        const modeInput = new TextInputBuilder().setCustomId('mode_input').setLabel('اكتب (1) لآية | (2) لنهاية السورة').setStyle(TextInputStyle.Short).setValue('1').setRequired(true);

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
          let targetSurah = !isNaN(surahQuery) ? surahsJson.data.find(s => s.number === parseInt(surahQuery, 10)) : surahsJson.data.find(s => s.name.includes(surahQuery));

          if (!targetSurah) return await interaction.editReply({ content: `❌ لم يتم العثور على السورة: **${surahQuery}**` });

          const fullSurahRes = await fetch(`https://api.alquran.cloud/v1/surah/${targetSurah.number}/ar.alafasy`);
          const fullSurahJson = await fullSurahRes.json();
          const ayahsList = fullSurahJson.data.ayahs;
          const startIndex = ayahsList.findIndex(a => a.numberInSurah === ayahNumber);

          if (startIndex === -1) return await interaction.editReply({ content: `❌ رقم الآية غير موجود.` });

          let resultText = mode === '2' ? ayahsList.slice(startIndex).map(a => `[${a.numberInSurah}] ${a.text}`).join('\n') : `[${ayahsList[startIndex].numberInSurah}] ${ayahsList[startIndex].text}`;
          let audioUrl = ayahsList[startIndex].audio;

          const embed = new EmbedBuilder().setTitle(`📖 سورة ${targetSurah.name}`).setDescription(`> ${resultText}`).setColor(0x00FF99);
          const row = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId(`custom_search_reciter:${targetSurah.number}:${ayahNumber}:${mode}`)
              .setPlaceholder('🎙️ غير القارئ...')
              .addOptions(RECITERS.map(r => ({ label: r.label, value: r.value })))
          );

          await interaction.editReply({ embeds: [embed], components: [row] });
          if (audioUrl) {
            try {
              const audioRes = await fetch(audioUrl);
              if (audioRes.ok) {
                const attachment = new AttachmentBuilder(Buffer.from(await audioRes.arrayBuffer()), { name: 'quran_recitation.mp3' });
                await interaction.followUp({ content: `🎧 **التسجيل الصوتي:**`, files: [attachment], ephemeral: true });
              }
            } catch (e) {}
          }
        } catch (err) {
          await interaction.editReply({ content: '❌ حدث خطأ أثناء البحث.' });
        }
      }

      if (interaction.isStringSelectMenu()) {
        const customId = interaction.customId;
        const selectedEdition = interaction.values[0];
        const selectedReciterObj = RECITERS.find(r => r.value === selectedEdition);

        await interaction.deferReply({ ephemeral: true });

        try {
          if (customId.startsWith('custom_search_reciter:')) {
            const [, surahNum, ayahNum, mode] = customId.split(':');
            const res = await fetch(`https://api.alquran.cloud/v1/surah/${surahNum}/${selectedEdition}`);
            const json = await res.json();
            if (json.code === 200) {
              const ayahsList = json.data.ayahs;
              const startIndex = ayahsList.findIndex(a => a.numberInSurah === parseInt(ayahNum, 10));
              let text = mode === '2' ? ayahsList.slice(startIndex).map(a => `[${a.numberInSurah}] ${a.text}`).join('\n') : `[${ayahsList[startIndex].numberInSurah}] ${ayahsList[startIndex].text}`;
              let audio = ayahsList[startIndex]?.audio;

              const embed = new EmbedBuilder().setTitle(`🎙️ القارئ: ${selectedReciterObj?.label}`).setDescription(`> ${text}`).setColor(0x00FF99);
              await interaction.editReply({ embeds: [embed] });
              if (audio) {
                try {
                  const audioRes = await fetch(audio);
                  if (audioRes.ok) {
                    const attachment = new AttachmentBuilder(Buffer.from(await audioRes.arrayBuffer()), { name: 'quran_recitation.mp3' });
                    await interaction.followUp({ content: `🎧 **التسجيل الصوتي:**`, files: [attachment], ephemeral: true });
                  }
                } catch (e) {}
              }
            }
          } else if (customId.startsWith('quran_reciter:')) {
            const [, surahNum, ayahNumInSurah] = customId.split(':');
            const res = await fetch(`https://api.alquran.cloud/v1/surah/${surahNum}/${selectedEdition}`);
            const json = await res.json();
            if (json.code === 200) {
              const ayahsList = json.data.ayahs;
              const targetAyah = ayahsList.find(a => a.numberInSurah === parseInt(ayahNumInSurah, 10));
              
              if (targetAyah) {
                const embed = new EmbedBuilder().setTitle(`🎙️ القارئ: ${selectedReciterObj?.label}`).setDescription(`📖 **الآية:** ${targetAyah.text}`).setColor(0x00FF99);
                await interaction.editReply({ embeds: [embed] });
                if (targetAyah.audio) {
                  try {
                    const audioRes = await fetch(targetAyah.audio);
                    if (audioRes.ok) {
                      const attachment = new AttachmentBuilder(Buffer.from(await audioRes.arrayBuffer()), { name: 'quran_recitation.mp3' });
                      await interaction.followUp({ content: `🎧 **التسجيل الصوتي:**`, files: [attachment], ephemeral: true });
                    }
                  } catch (e) {}
                }
              } else {
                await interaction.editReply({ content: `🎙️ **القارئ:** ${selectedReciterObj?.label}\n❌ لم يتم العثور على الآية المحددة.` });
              }
            }
          }
        } catch (err) {
          await interaction.editReply({ content: `🎙️ **القارئ:** ${selectedReciterObj?.label}\n✅ تم اختيار القارئ بنجاح.` });
        }
      }
    });
  }

  async updateOwnerStatusMessage() {
    if (!STATUS_CHANNEL_ID) return;
    for (const [guildId, guild] of this.guilds.cache) {
      try {
        const ownerMember = await guild.members.fetch(OWNER_ID).catch(() => null);
        if (!ownerMember) continue;
        const status = ownerMember.presence?.status || 'offline';
        let statusText = status === 'online' ? `🟢 صاحب السيرفر **فهد الشمري** أونلاين!` : `🌙 صاحب السيرفر **فهد الشمري** أوفلاين.`;
        
        const channel = guild.channels.cache.get(STATUS_CHANNEL_ID);
        if (channel) {
          const messages = await channel.messages.fetch({ limit: 5 }).catch(() => null);
          const botMessage = messages?.find(m => m.author.id === this.user.id);
          const embed = new EmbedBuilder().setTitle('📊 حالة صاحب السيرفر').setDescription(statusText).setColor(0x57F287);
          if (botMessage) await botMessage.edit({ embeds: [embed] }).catch(() => {});
          else await channel.send({ embeds: [embed] });
        }
      } catch (err) {}
    }
  }

  async registerCommands() {
    try { await registerSlashCommands(this, { clientId: this.config.bot.clientId }); } catch (error) {}
  }
}

const bot = new TitanBot();
bot.start().catch(() => process.exit(1));
export default TitanBot;
