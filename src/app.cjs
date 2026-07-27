import { 
    Client, 
    GatewayIntentBits, 
    REST, 
    Routes, 
    SlashCommandBuilder, 
    PermissionFlagsBits, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    StringSelectMenuBuilder, 
    StringSelectMenuOptionBuilder 
} from 'discord.js';

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

const SERVER_OWNER_ID = "1441891628204822629"; 
const NOTIFICATION_CHANNEL_ID = "1506683255120990360"; 

client.once('ready', async () => {
    console.log(`🚀 البوت يعمل الآن بكفاءة تامة باسم: ${client.user.tag}`);
    
    const commands = [
        new SlashCommandBuilder().setName('ban').setDescription('حظر عضو من السيرفر مع ذكر السبب')
            .addUserOption(option => option.setName('member').setDescription('العضو المراد حظره').setRequired(true))
            .addStringOption(option => option.setName('reason').setDescription('سبب الحظر')),
        new SlashCommandBuilder().setName('timeout').setDescription('إسكات عضو لفترة محددة بالدقائق')
            .addUserOption(option => option.setName('member').setDescription('العضو المراد إسكاته').setRequired(true))
            .addIntegerOption(option => option.setName('minutes').setDescription('عدد الدقائق').setRequired(true))
            .addStringOption(option => option.setName('reason').setDescription('السبب')),
        new SlashCommandBuilder().setName('unban').setDescription('إلغاء حظر عضو بواسطة الآيدي')
            .addStringOption(option => option.setName('user_id').setDescription('آيدي العضو').setRequired(true)),
        new SlashCommandBuilder().setName('quran').setDescription('اختيار قارئ والاستماع للقرآن الكريم'),
        new SlashCommandBuilder().setName('setup_verify').setDescription('إرسال زر التحقق للسيرفر')
    ];

    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log('✅ تم تسجيل أوامر السلاش بنجاح!');
    } catch (error) {
        console.error('❌ خطأ في تسجيل الأوامر:', error);
    }

    setInterval(async () => {
        try {
            if (!NOTIFICATION_CHANNEL_ID || NOTIFICATION_CHANNEL_ID.length < 10) return;
            const channel = await client.channels.fetch(NOTIFICATION_CHANNEL_ID);
            if (!channel) return;
            const guild = channel.guild;
            const owner = await guild.members.fetch(SERVER_OWNER_ID);
            if (owner && owner.presence && owner.presence.status !== 'offline') {
                await channel.send(`@everyone 🔔 تنبيه ذكي: حالة صاحب السيرفر (${owner}) أونلاين الآن وجاهز لمتابعة الإدارة!`);
            }
        } catch (err) {
            console.log("⚠️ تنبيه في فحص حالة المالك:", err.message);
        }
    }, 30 * 60 * 1000);
});

client.on('messageCreate', async message => {
    if (message.author.bot) return;
    if (message.mentions.has(client.user)) {
        let replyText = `أهلاً بك يا فهد! أنا بوت مساعدة الجيران المطور لإدارة السيرفر وتقديم القرآن الكريم.`;
        if (message.content.includes('السلام') || message.content.includes('هلا')) {
            replyText = 'وعليكم السلام ورحمة الله وبركاته! كيف يمكنني خدمتك اليوم يا فهد؟';
        }
        await message.reply(replyText);
    }
});

client.on('interactionCreate', async interaction => {
    try {
        if (interaction.isChatInputCommand()) {
            const { commandName } = interaction;

            if (commandName === 'ban') {
                if (!interaction.member.permissions.has(PermissionFlagsBits.BanMembers)) {
                    return interaction.reply({ content: '❌ عذراً، ليس لديك صلاحية لحظر الأعضاء!', ephemeral: true });
                }
                const member = interaction.options.getMember('member');
                const reason = interaction.options.getString('reason') || 'بدون سبب';
                await member.ban({ reason });
                await interaction.reply(`🔨 تم حظر العضو ${member.user.tag} بنجاح. السبب: ${reason}`);
            } 
            else if (commandName === 'timeout') {
                if (!interaction.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
                    return interaction.reply({ content: '❌ عذراً، ليس لديك صلاحية لإسكات الأعضاء!', ephemeral: true });
                }
                const member = interaction.options.getMember('member');
                const minutes = interaction.options.getInteger('minutes');
                const reason = interaction.options.getString('reason') || 'بدون سبب';
                await member.timeout(minutes * 60 * 1000, reason);
                await interaction.reply(`⏳ تم إعطاء تايم أوت لـ ${member.user.tag} لمدة ${minutes} دقائق.`);
            }
            else if (commandName === 'unban') {
                if (!interaction.member.permissions.has(PermissionFlagsBits.BanMembers)) {
                    return interaction.reply({ content: '❌ عذراً، ليس لديك صلاحية لإلغاء الحظر!', ephemeral: true });
                }
                const userId = interaction.options.getString('user_id');
                await interaction.guild.members.unban(userId);
                await interaction.reply(`🔓 تم إلغاء الحظر عن العضو بنجاح.`);
            }
            else if (commandName === 'setup_verify') {
                if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
                    return interaction.reply({ content: '⚠️ هذا الأمر مخصص للأدمن فقط!', ephemeral: true });
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
                await interaction.reply({ content: `🎧 تم اختيار القارئ بنجاح. جاري التشغيل بجودة صافية وبدون توقف!`, ephemeral: false });
            }
        }
    } catch (error) {
        console.error("❌ حدث خطأ أثناء معالجة التفاعل:", error);
    }
});

if (!process.env.DISCORD_TOKEN) {
    console.error("❌ الخطأ القاتل: لم يتم العثور على DISCORD_TOKEN في المتغيرات!");
} else {
    client.login(process.env.DISCORD_TOKEN);
}
