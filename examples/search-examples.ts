/**
 * Example: Powerful Message Search Queries
 */
import { WhatsAppSkill } from '../src/index.js';

async function main() {
  const skill = new WhatsAppSkill();

  console.log('--- Example 1: Find messages from John between Sep 1 and Sep 15 ---');
  const res1 = await skill.searchMessages({
    senderName: 'John',
    since: '2026-09-01',
    until: '2026-09-15',
  });
  console.log(`Found: ${res1.total} messages`);

  console.log('\n--- Example 2: Find messages containing "payment" this month ---');
  const res2 = await skill.searchMessages({
    query: 'payment',
    since: 'this month',
  });
  console.log(`Found: ${res2.total} messages`);

  console.log('\n--- Example 3: Messages with documents from group yesterday ---');
  const res3 = await skill.searchMessages({
    isGroup: true,
    hasAttachment: true,
    attachmentType: 'document',
    since: 'yesterday',
    until: 'yesterday',
  });
  console.log(`Found: ${res3.total} documents`);

  console.log('\n--- Example 4: Unread messages received today ---');
  const res4 = await skill.searchMessages({
    isRead: false,
    since: 'today',
  });
  console.log(`Found: ${res4.total} unread messages`);
}

main().catch(console.error);
