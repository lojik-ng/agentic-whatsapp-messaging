/**
 * Example: Sending Media & Attachments
 */
import { WhatsAppSkill } from '../src/index.js';

async function main() {
  const skill = new WhatsAppSkill();
  await skill.init();

  const recipient = process.env.RECIPIENT || '+15551234567';

  // 1. Send Document / PDF
  console.log('Sending PDF document...');
  const docMsg = await skill.sendAttachment(
    recipient,
    './test-document.pdf',
    'Here is the requested report',
    { fileName: 'Quarterly_Report.pdf' }
  );
  console.log('Sent document:', docMsg.messageId);

  // 2. Reply to a message with an image
  console.log('Replying with an image...');
  const replyMsg = await skill.replyWithAttachment(
    docMsg.messageId,
    './screenshot.png',
    'Here is the screenshot'
  );
  console.log('Sent reply with attachment:', replyMsg.messageId);
}

main().catch(console.error);
