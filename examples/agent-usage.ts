/**
 * Example: Autonomous AI Agent WhatsApp Usage
 */
import { WhatsAppSkill } from '../src/index.js';

async function main() {
  const skill = new WhatsAppSkill();

  // Listen to incoming messages in real-time
  skill.onMessage((msg) => {
    console.log(`[New Message] From: ${msg.senderName || msg.sender} (${msg.chatId})`);
    console.log(`Type: ${msg.messageType} | Text: "${msg.text}"`);
    if (msg.hasAttachment) {
      console.log(`Attachment: ${msg.attachment?.filename} (${msg.attachment?.mediaType})`);
    }
  });

  // Check connection status
  const status = await skill.getConnectionStatus();
  console.log('Current status:', status.state);

  if (status.state !== 'Connected') {
    // Connect using phone number (Pairing Code authentication)
    const phone = process.env.PHONE_NUMBER || '15551234567';
    console.log(`Initiating pairing code for ${phone}...`);
    const pairing = await skill.connectWhatsApp(phone);
    console.log('>>> PAIRING CODE:', pairing.formattedCode);
    console.log('Instructions:');
    pairing.instructions.forEach((i) => console.log('  ', i));
  } else {
    console.log('Already connected as:', status.user?.id);

    // Search messages
    const search = await skill.searchMessages({
      query: 'invoice',
      since: 'this month',
    });
    console.log(`Found ${search.total} invoice messages:`);
    search.messages.forEach((m) => {
      console.log(`- [${m.isoDate}] ${m.senderName || m.sender}: ${m.text}`);
    });
  }
}

main().catch(console.error);
