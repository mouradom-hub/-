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
});

client.on('messageCreate', async message => {
    if (message.author.bot) return;
    if (message.mentions.has(client.user)) {
        await message.reply('وعليكم السلام ورحمة الله وبركاته! كيف يمكنني خدمتك اليوم يا فهد؟');
    }
});

client.on('interactionCreate', async interaction => {
    try {
        if (interaction.isChatInputCommand()) {
            const { commandName } = interaction;
            if (commandName === 'quran') {
                const reciters = ["ياسر الدوسري", "ماهر المعيقلي", "محمد أيوب", "مشاري العفاسي", "وديع اليمني"];
                const options = reciters.map((r, i) => new StringSelectMenuOptionBuilder().setLabel(r).setValue(`reciter_${i}`));
                const select = new StringSelectMenuBuilder().setCustomId('quran_select').setPlaceholder('اختر القارئ...').addOptions(options);
                const row = new ActionRowBuilder().addComponents(select);
                await interaction.reply({ content: '📖 **قائمة القراء:**', components: [row] });
            } else if (commandName === 'setup_verify') {
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('verify_btn').setLabel('✅ تحقق').setStyle(ButtonStyle.Success)
                );
                await interaction.reply({ content: 'اضغط للتحقق:', components: [row] });
            }
        }
    } catch (err) {
        console.error("خطأ في التفاعل:", err);
    }
});

if (!process.env.DISCORD_TOKEN) {
    console.error("❌ الخطأ القاتل: لم يتم العثور على DISCORD_TOKEN في المتغيرات!");
} else {
    client.login(process.env.DISCORD_TOKEN);
}
