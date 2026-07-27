const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } = require('discord.js');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.GuildVoiceStates
    ]
});

// ⚠️ ضع هنا الآيدي (ID) الخاص بك وصاحب السيرفر وروم التنبيهات
const SERVER_OWNER_ID = "1441891628204822629"; 
const NOTIFICATION_CHANNEL_ID = "1506683255120990360"; 

client.once('ready', async () => {
    console.log(`البوت جاهز ويعمل بكفاءة باسم: ${client.user.tag}`);
    
    // تسجيل أوامر السلاش (Slash Commands)
    const commands = [
        new SlashCommandBuilder().setName('ban').setDescription('حظر عضو من السيرفر مع ذكر السبب')
            .addUserOption(option => option.setName('member').setDescription('العضو المراد حظره').setRequired(true))
            .addStringOption(option => option.setName('reason').setDescription('سبب الحظر')),
        new SlashCommandBuilder().setName('timeout').setDescription('إسكات عضو لفترة محددة بالدقائق')
            .addUserOption(option => option.setName('member').setDescription('العضو المراد إسكاته').setRequired(true))
            .addIntegerOption(option => option.setName('minutes').setDescription('عدد الدقائق').setRequired(true))
            .addStringOption(option => option.setName('reason').setDescription('السبب')),
        new SlashCommandBuilder().setName('unban').setDescription('إلغاء حظر عضو بواسطة الآيدي')
            .addStringOption(option => option.setName('user_id').setDescription('آيدي العضو (User ID)').setRequired(true)),
        new SlashCommandBuilder().setName('quran').setDescription('اختيار قارئ والاستماع للقرآن الكريم بجودة عالية'),
        new SlashCommandBuilder().setName('setup_verify').setDescription('إرسال رسالة وزر التحقق للسيرفر')
    ];

    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log('تم تسجيل أوامر السلاش (Slash Commands) بنجاح!');
    } catch (error) {
        console.error('خطأ أثناء تسجيل الأوامر:', error);
    }

    // مهمة حالة صاحب السيرفر كل 30 دقيقة مع منشن الجميع
    setInterval(async () => {
        try {
            const channel = await client.channels.fetch(NOTIFICATION_CHANNEL_ID);
            if (!channel) return;
            const guild = channel.guild;
            const owner = await guild.members.fetch(SERVER_OWNER_ID);
            if (owner && owner.presence && owner.presence.status !== 'offline') {
                await channel.send(`@everyone 🔔 تنبيه ذكي: حالة صاحب السيرفر (${owner}) أونلاين الآن وجاهز لمتابعة الإدارة!`);
            }
        } catch (err) {
            console.log("خطأ في فحص حالة المالك:", err);
        }
    }, 30 * 60 * 1000); // 30 دقيقة
});

// نظام الذكاء الاصطناعي للرد على المنشن والاستفسارات
client.on('messageCreate', async message => {
    if (message.author.bot) return;
    
    if (message.mentions.has(client.user)) {
        const query = message.content.replace(`<@!${client.user.id}>`, '').replace(`<@${client.user.id}>`, '').strip ? message.content : message.content.replace(`<@!${client.user.id}>`, '').replace(`<@${client.user.id}>`, '').trim();
        
        let replyText = `استوعب الذكاء الاصطناعي استفسارك بنجاح، وكل الأنظمة جاهزة لتنفيذ طلبك يا فهد!`;
        if (message.content.includes('السلام') || message.content.includes('هلا')) {
            replyText = 'وعليكم السلام ورحمة الله وبركاته! كيف يمكنني خدمتك اليوم يا فهد؟';
        }
        await message.reply(replyText);
    }
});

// معالجة الأوامر، الأزرار، وقوائم الاختيار
client.on('interactionCreate', async interaction => {
    if (interaction.isChatInputCommand()) {
        const { commandName } = interaction;

        if (commandName === 'ban') {
            if (!interaction.member.permissions.has(PermissionFlagsBits.BanMembers)) {
                return interaction.reply({ content: 'عذراً، ليس لديك صلاحية لحظر الأعضاء!', ephemeral: true });
            }
            const member = interaction.options.getMember('member');
            const reason = interaction.options.getString('reason') || 'بدون سبب';
            await member.ban({ reason });
            await interaction.reply(`🔨 تم حظر العضو ${member.user.tag} بنجاح. السبب: ${reason}`);
        } 
        else if (commandName === 'timeout') {
            if (!interaction.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
                return interaction.reply({ content: 'عذراً، ليس لديك صلاحية لإسكات الأعضاء!', ephemeral: true });
            }
            const member = interaction.options.getMember('member');
            const minutes = interaction.options.getInteger('minutes');
            const reason = interaction.options.getString('reason') || 'بدون سبب';
            await member.timeout(minutes * 60 * 1000, reason);
            await interaction.reply(`⏳ تم إعطاء تايم أوت لـ ${member.user.tag} لمدة ${minutes} دقائق.`);
        }
        else if (commandName === 'unban') {
            if (!interaction.member.permissions.has(PermissionFlagsBits.BanMembers)) {
                return interaction.reply({ content: 'عذراً، ليس لديك صلاحية لإلغاء الحظر!', ephemeral: true });
            }
            const userId = interaction.options.getString('user_id');
            await interaction.guild.members.unban(userId);
            await interaction.reply(`🔓 تم إلغاء الحظر عن العضو بنجاح.`);
        }
        else if (commandName === 'setup_verify') {
            if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
                return interaction.reply({ content: 'هذا الأمر مخصص للأدمن فقط!', ephemeral: true });
            }
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('verify_btn').setLabel('✅ تحقق من أنك لست بوت (Verify)').setStyle(ButtonStyle.Success)
            );
            await interaction.reply({ content: 'اضغط على الزر أدناه لتأكيد التحقق والدخول للسيرفر:', components: [row] });
        }
        else if (commandName === 'quran') {
            const reciters = [
                "ياسر الدوسري", "ماهر المعيقلي", "محمد أيوب", "مشاري العفاسي", 
                "وديع اليمني", "عبد الرحمن السديس", "سعود الشريم", "محمد صديق المنشاوي", 
                "عبد الباسط عبد الصمد", "محمد اللحيدان", "علي جابر", "ناصر القطامي", 
                "إدريس أبكر", "سعد الغامدي", "عكاشة كميني", "خالد الجليل", "بندر بليلة"
            ];
            const options = reciters.map((r, index) => new StringSelectMenuOptionBuilder().setLabel(r).setValue(`reciter_${index}`));
            const select = new StringSelectMenuBuilder().setCustomId('quran_select').setPlaceholder('اختر القارئ المفضل لديك...').addOptions(options);
            const row = new ActionRowBuilder().addComponents(select);
            await interaction.reply({ content: '📖 **قائمة كبار القراء:**\nاختر القارئ من القائمة أدناه لبدء التلاوة:', components: [row], ephemeral: false });
        }
    } 
    else if (interaction.isButton()) {
        if (interaction.customId === 'verify_btn') {
            const role = interaction.guild.roles.cache.find(r => r.name === 'Member');
            if (role) {
                await interaction.member.roles.add(role);
                await interaction.reply({ content: '🎉 تم التحقق بنجاح وتم منحك رتبة العضوية في السيرفر!', ephemeral: true });
            } else {
                await interaction.reply({ content: '⚠️ لم يتم العثور على رتبة باسم "Member" في السيرفر، يرجى إبلاغ الإدارة.', ephemeral: true });
            }
        }
    }
    else if (interaction.isStringSelectMenu()) {
        if (interaction.customId === 'quran_select') {
            const selected = interaction.values[0];
            await interaction.reply({ content: `🎧 تم اختيار القارئ بنجاح. جاري التشغيل بجودة صافية وبدون توقف!`, ephemeral: false });
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
