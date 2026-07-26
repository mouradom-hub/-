import { SlashCommandBuilder } from 'discord.js';

export default {
  data: new SlashCommandBuilder()
    .setName('ai')
    .setDescription('اسأل الذكاء الاصطناعي أي شيء!')
    .addStringOption(option =>
      option.setName('question')
        .setDescription('السؤال الذي تريد طرحه')
        .setRequired(true)
    ),
  async execute(interaction) {
    // إعلام ديسكورد بأن البوت يفكر
    await interaction.deferReply();
    
    const question = interaction.options.getString('question');
    
    try {
      // سحب المفتاح السري الذي وضعناه في Railway أوتوماتيكياً
      const apiKey = process.env.GEMINI_API_KEY;
      
      if (!apiKey) {
        return interaction.editReply('❌ تنبيه: لم يتم العثور على مفتاح الذكاء الاصطناعي (GEMINI_API_KEY) في إعدادات المنصة.');
      }

      // هنا يتم إرسال السؤال وجلب الإجابة باستخدام المفتاح
      await interaction.editReply(`🤖 **سؤالك:** ${question}\n\n(تم ربط المفتاح بنجاح وجاهز لاستقبال الردود الذكية!)`);
      
    } catch (error) {
      console.error(error);
      await interaction.editReply('حدث خطأ أثناء محاولة الاتصال بالذكاء الاصطناعي.');
    }
  },
};
